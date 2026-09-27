// A silent caller against a running dev server: answer the call, say nothing, and watch the timing
// (DESIGN §10.6). Captions should grow at speech pace and turn final only when a line has been said, the
// silence tiers should fire only after the assistant has finished talking (6 s, then ≥5 s of quiet after
// each check-in), the call should end after the goodbye has been heard, and the thread should then get
// the call-log bubble and the silence_end follow-up.
// Usage: node scripts/e2e-silence.mjs [--base http://localhost:3000] [--out ./e2e-out]
// Chrome's default fake microphone is not reliably silent, so a WAV of zeros is fed as the capture file.
import { chromium } from "playwright";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > -1 ? process.argv[i + 1] : d; };
const BASE = arg("--base", process.env.BASE ?? "http://localhost:3000");
const OUT = arg("--out", process.env.OUT ?? "./e2e-out");
const EXE = process.env.CHROME ?? `${process.env.HOME}/Library/Caches/ms-playwright/chromium-1243/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`;
fs.mkdirSync(OUT, { recursive: true });
const t0 = Date.now();
const log = (...a) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s]`, ...a);

/** 16-bit mono 48 kHz silence; Chrome loops the file. */
function silentWav(seconds) {
  const rate = 48_000;
  const dataBytes = rate * seconds * 2;
  const buf = Buffer.alloc(44 + dataBytes);
  buf.write("RIFF", 0);
  buf.writeUInt32LE(36 + dataBytes, 4);
  buf.write("WAVE", 8);
  buf.write("fmt ", 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(rate, 24);
  buf.writeUInt32LE(rate * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write("data", 36);
  buf.writeUInt32LE(dataBytes, 40);
  const file = path.join(os.tmpdir(), "persona-silence.wav");
  fs.writeFileSync(file, buf);
  return file;
}

const browser = await chromium.launch({
  executablePath: fs.existsSync(EXE) ? EXE : undefined,
  headless: true,
  args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", `--use-file-for-fake-audio-capture=${silentWav(180)}`, "--autoplay-policy=no-user-gesture-required"],
});
const ctx = await browser.newContext({ permissions: ["microphone"], viewport: { width: 1180, height: 900 } });
const page = await ctx.newPage();
page.on("console", (m) => {
  const t = m.text();
  if (m.type() === "error" || m.type() === "warning" || t.includes("[realtime]")) log(`  [console.${m.type()}]`, t.slice(0, 300));
});
page.on("pageerror", (e) => log("  [pageerror]", String(e).slice(0, 300)));

let ok = true;
try {
  await page.goto(BASE + "/", { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => (document.querySelector("textarea")?.value ?? "").length > 0, null, { timeout: 30_000 });
  await page.click("[aria-label='Send']");
  await page.waitForFunction(() => document.querySelectorAll(".bubble-in[data-bubble]").length >= 2, null, { timeout: 60_000 });
  log("session", await page.evaluate(() => window.__persona.session.getState().sessionId));
  await page.click('[aria-label="Simulation menu"]');
  await page.click("text=Incoming call");
  await page.waitForSelector('[aria-label="Accept"]', { timeout: 10_000 });
  await page.click('[aria-label="Accept"]', { force: true });
  await page.waitForSelector('[aria-label="End call"]', { timeout: 30_000 });
  const live = Date.now();
  log("call answered; saying nothing");
  let lastLine = "";
  let endReason = null;
  for (let i = 0; i < 300; i++) {
    const s = await page.evaluate(() => {
      const st = window.__persona.session.getState();
      const last = st.captions[st.captions.length - 1];
      return {
        call: st.call.state,
        endReason: st.call.endReason,
        n: st.captions.length,
        last: last ? `${last.speaker}${last.final ? "*" : ""}: ${last.text}` : "",
        speaking: !!document.querySelector('[class*="ring-ios-green"]'),
      };
    });
    const line = `${s.call} caps=${s.n} spk=${s.speaking ? "Y" : "."} | ${s.last}`;
    if (line !== lastLine) {
      log(`+${((Date.now() - live) / 1000).toFixed(1)}s`, line);
      lastLine = line;
    }
    if (s.call === "ended" || s.call === "idle") {
      endReason = s.endReason;
      log("call ended:", endReason, `after ${((Date.now() - live) / 1000).toFixed(1)}s`);
      break;
    }
    await page.waitForTimeout(400);
  }
  if (endReason !== "silence") { ok = false; log("!! expected the call to end on silence, got", endReason); }
  // the thread takes over: call-log bubble, then the silence_end reply
  const before = await page.evaluate(() => window.__persona.session.getState().messages.length);
  await page
    .waitForFunction((b) => window.__persona.session.getState().messages.length > b + 1, before, { timeout: 45_000 })
    .catch(() => { ok = false; log("!! no text follow-up within 45 s"); });
  await page.waitForTimeout(3000);
  const tail = await page.evaluate(() => window.__persona.session.getState().messages.slice(-4).map((m) => `${m.role}/${m.content.kind}: ${(m.content.text ?? m.content.call?.reason ?? m.content.link?.title ?? "").slice(0, 160)}`));
  for (const l of tail) log("  message:", l);
  const caps = await page.evaluate(() => window.__persona.session.getState().captions.map((c) => `${c.speaker}${c.final ? "*" : ""}: ${c.text}`));
  for (const c of caps) log("  caption:", c);
  if (caps.some((c) => !c.includes("*"))) { ok = false; log("!! a caption never turned final"); }
  await page.screenshot({ path: path.join(OUT, "silence-end.png") });
} catch (e) {
  ok = false;
  log("!! FAILED", e?.stack ?? String(e));
  await page.screenshot({ path: path.join(OUT, "silence-failure.png") }).catch(() => {});
}
await browser.close();
log(ok ? "OK" : "FAILED");
process.exit(ok ? 0 : 1);
