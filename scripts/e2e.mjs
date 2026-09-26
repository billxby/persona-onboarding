// Browser walkthrough against a running dev server: text flow, Gmail demo-inbox flow, optional live call.
// Usage: node scripts/e2e.mjs [--voice] [--base http://localhost:3000] [--out ./e2e-out]
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > -1 ? process.argv[i + 1] : d; };
const BASE = arg("--base", process.env.BASE ?? "http://localhost:3000");
const OUT = arg("--out", process.env.OUT ?? "./e2e-out");
const VOICE = process.argv.includes("--voice");
const VOICE_ONLY = process.argv.includes("--voice-only");
const EXE = process.env.CHROME ?? `${process.env.HOME}/Library/Caches/ms-playwright/chromium-1243/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`;
fs.mkdirSync(OUT, { recursive: true });
const t0 = Date.now();
const log = (...a) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s]`, ...a);
let shotN = 0;
const shot = async (pg, name) => { const f = path.join(OUT, `${String(++shotN).padStart(2, "0")}-${name}.png`); await pg.screenshot({ path: f }); log("shot", f); };

const browser = await chromium.launch({
  executablePath: fs.existsSync(EXE) ? EXE : undefined,
  headless: true,
  args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", "--autoplay-policy=no-user-gesture-required"],
});
const ctx = await browser.newContext({ permissions: ["microphone"], viewport: { width: 1180, height: 900 } });
const page = await ctx.newPage();
page.on("console", (m) => { if (m.type() === "error" || m.type() === "warning") log(`  [console.${m.type()}]`, m.text().slice(0, 300)); });
page.on("pageerror", (e) => log("  [pageerror]", String(e).slice(0, 300)));

const inTexts = () => page.$$eval(".bubble-in[data-bubble]", (els) => els.map((e) => e.textContent.trim()));
const state = () => page.evaluate(() => { const s = window.__persona?.session.getState(); return s && { sessionId: s.sessionId, slots: s.slots, phase: s.phase, mode: s.mode, channel: s.channel, call: s.call.state, connection: s.connection, nba: s.nextBestAsk, beliefs: (s.beliefs ?? []).length }; });
async function send(msg) { await page.fill("textarea", msg); await page.keyboard.press("Enter"); log("U:", msg); }
async function waitNewIn(prev, timeout = 90_000, settle = 3000) {
  await page.waitForFunction((n) => document.querySelectorAll(".bubble-in[data-bubble]").length > n, prev, { timeout });
  await page.waitForTimeout(settle);
  const all = await inTexts();
  for (const b of all.slice(prev)) log("A:", b.slice(0, 200));
  return all;
}

let ok = true;
let bubbles = [];
let n = 0;
try {
  await page.goto(BASE + "/", { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".bubble-in[data-bubble]", { timeout: 30_000 });
  bubbles = await inTexts();
  log("opener:", bubbles[0]);
  log("state:", JSON.stringify(await state()));
  await shot(page, "opener");

  if (!VOICE_ONLY) {
  // 1. all-in-one-breath-ish: name + need
  n = bubbles.length;
  await send("hey it's Bill, I need to cancel my gym membership");
  bubbles = await waitNewIn(n);
  log("state:", JSON.stringify(await state()));
  await shot(page, "need");

  // 2. ask for gmail → link card → popup → demo inbox → value moment
  n = bubbles.length;
  await send("sure, connect gmail");
  bubbles = await waitNewIn(n);
  const card = page.locator("button", { hasText: "Connect Gmail to Persona" }).last();
  if (await card.count()) {
    const [popup] = await Promise.all([ctx.waitForEvent("page", { timeout: 20_000 }), card.click()]);
    await popup.waitForLoadState("domcontentloaded");
    log("popup:", popup.url());
    await shot(popup, "connect-page");
    n = (await inTexts()).length;
    await popup.getByRole("button", { name: /demo inbox/i }).click();
    bubbles = await waitNewIn(n, 120_000, 4000);
    log("state:", JSON.stringify(await state()));
    await shot(page, "gmail-value");
  } else {
    log("!! no Connect Gmail link card rendered"); ok = false;
  }

  // 3. drive to a draft + graduation
  n = bubbles.length;
  await send("yes, draft a reply to the landlord");
  bubbles = await waitNewIn(n, 120_000, 4000);
  log("state:", JSON.stringify(await state()));
  await shot(page, "draft");

  n = bubbles.length;
  await send("perfect, that's all I need for now. call yourself Jarvis");
  bubbles = await waitNewIn(n, 120_000, 4000);
  const st = await state();
  log("state:", JSON.stringify(st));
  log("agent name:", st?.slots?.agent_name?.value ?? "(none)");
  await shot(page, "graduated");

  // 4. behind the scenes
  const db = await ctx.newPage();
  await db.goto(BASE + "/db", { waitUntil: "domcontentloaded" });
  await db.waitForTimeout(4000);
  await shot(db, "db");
  }

  if (VOICE) {
    log("--- voice ---");
    await page.bringToFront();
    await page.click('[aria-label="Simulation menu"]');
    await page.click("text=Incoming call");
    await page.waitForSelector('[aria-label="Accept"]', { timeout: 10_000 });
    await shot(page, "ringing");
    await page.click('[aria-label="Accept"]', { force: true });
    await page.waitForSelector('[aria-label="End call"]', { timeout: 30_000 });
    log("call live; waiting for the opener to be spoken");
    await page.waitForTimeout(9000);
    let caps = await page.evaluate(() => window.__persona.session.getState().captions.map((c) => `${c.speaker}: ${c.text}`));
    log("captions:", JSON.stringify(caps));
    await shot(page, "call-opener");
    await page.evaluate(() => window.__persona.callController.injectUserSpeech("Yeah it's Bill. Also, my landlord emailed about the lease, what did she say?"));
    await page.waitForTimeout(14000);
    caps = await page.evaluate(() => window.__persona.session.getState().captions.map((c) => `${c.speaker}: ${c.text}`));
    log("captions:", JSON.stringify(caps));
    log("state:", JSON.stringify(await state()));
    await shot(page, "call-turn");
    const assistantCount = () => page.evaluate(() => window.__persona.session.getState().messages.filter((m) => m.role === "assistant").length);
    const before = await assistantCount();
    await page.click('[aria-label="End call"]');
    log("hung up; waiting for the text resume (assistant messages before:", before, ")");
    await page.waitForFunction((b) => window.__persona.session.getState().messages.filter((m) => m.role === "assistant").length > b, before, { timeout: 60_000 }).catch((e) => { log("!! no resume text:", e.message); ok = false; });
    await page.waitForTimeout(4000);
    const after = await page.evaluate(() => window.__persona.session.getState().messages.slice(-4).map((m) => `${m.role}/${m.content.kind}: ${(m.content.text ?? m.content.call?.reason ?? m.content.link?.title ?? "").slice(0, 160)}`));
    for (const l of after) log("  ", l);
    log("state:", JSON.stringify(await state()));
    await shot(page, "after-call");
  }
} catch (e) {
  ok = false;
  log("!! FAILED:", e?.stack ?? String(e));
  await shot(page, "failure").catch(() => {});
} finally {
  await browser.close();
}
log(ok ? "E2E OK" : "E2E HAD FAILURES");
process.exit(ok ? 0 : 1);
