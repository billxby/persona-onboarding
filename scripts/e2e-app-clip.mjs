// App Clip walkthrough against a running dev server: card in the thread → system card → clip runs in the phone → CTA → close → Contacts off = plain link → in-phone Safari.
// Usage: node scripts/e2e-app-clip.mjs [--base http://localhost:3000] [--out ./e2e-out]
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > -1 ? process.argv[i + 1] : d; };
const BASE = arg("--base", process.env.BASE ?? "http://localhost:3000");
const OUT = arg("--out", process.env.OUT ?? "./e2e-out");
const EXE = process.env.CHROME ?? `${process.env.HOME}/Library/Caches/ms-playwright/chromium-1243/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`;
fs.mkdirSync(OUT, { recursive: true });
const t0 = Date.now();
const log = (...a) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s]`, ...a);
let shotN = 0;
const shot = async (pg, name) => { const f = path.join(OUT, `${String(++shotN).padStart(2, "0")}-${name}.png`); await pg.screenshot({ path: f }); log("shot", f); };

const browser = await chromium.launch({ executablePath: fs.existsSync(EXE) ? EXE : undefined, headless: true });
const ctx = await browser.newContext({ viewport: { width: 1180, height: 900 } });
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => { errors.push(String(e)); log("  [pageerror]", String(e).slice(0, 300)); });
page.on("console", (m) => { if (m.type() === "error") log("  [console.error]", m.text().slice(0, 200)); });

let ok = true;
const check = (cond, msg) => { if (cond) log("✓", msg); else { ok = false; log("✗", msg); } };
try {
  await page.goto(BASE + "/", { waitUntil: "domcontentloaded" });
  // the thread starts empty with "Hey Persona" prefilled in the compose field; sending it gets the opener
  await page.waitForFunction(() => (document.querySelector("textarea")?.value ?? "").length > 0, null, { timeout: 30_000 });
  log("draft:", await page.$eval("textarea", (t) => t.value));
  await page.click("[aria-label='Send']");
  await page.waitForSelector(".bubble-in[data-bubble]", { timeout: 60_000 });
  // the opener is three messages (intro, App Clip card, ask); wait for the ask so later counts start clean
  await page.waitForFunction(() => document.querySelectorAll(".bubble-in[data-bubble]").length >= 2, null, { timeout: 60_000 });
  const sid = await page.evaluate(() => window.__persona.session.getState().sessionId);
  log("session", sid);

  // Persona in Contacts → App Clip bubbles render
  await page.evaluate(() => window.__persona.session.getState().setSenderInContacts(true));
  const res = await page.request.post(BASE + "/api/tools/send_app_clip", { data: { session_id: sid, input: { reason: "e2e" } } });
  const body = await res.json();
  check(res.ok() && body.result?.ok, `send_app_clip → ${res.status()} ${JSON.stringify(body.result?.data ?? body).slice(0, 120)}`);

  // the App Clip bubble (Open button inside a link bubble) arrives via realtime/polling
  const openBtn = page.locator("[data-bubble] button", { hasText: /^Open$/ }).first();
  await openBtn.waitFor({ timeout: 30_000 });
  check(true, "App Clip bubble rendered with an Open button");
  await shot(page, "clip-bubble");

  await openBtn.click();
  await page.waitForSelector("text=This App Clip can send you notifications", { timeout: 10_000 });
  check(await page.locator("text=Meet your Persona").first().isVisible(), "system App Clip card shows 'Meet your Persona'");
  await shot(page, "system-card");

  // Open → splash → runner iframe
  await page.locator("button", { hasText: /^Open$/ }).last().click();
  await page.waitForSelector("[data-app-clip-runner]", { timeout: 10_000 });
  const splash = await page.locator("[data-app-clip-splash]").count();
  check(splash === 1, "launch splash shown");
  await shot(page, "splash");
  const frame = page.frameLocator("[data-app-clip-runner] iframe");
  await frame.locator("[data-clip='hero'] h1").waitFor({ timeout: 20_000 });
  const heroTitle = await frame.locator("[data-clip='hero'] h1").textContent();
  check(!!heroTitle?.trim(), `runner iframe hero title: ${heroTitle}`);
  check(await page.locator("text=Persona · App Clip").count() > 0 || await page.locator("[data-app-clip-runner]").locator("text=App Clip").count() > 0, "App Clip top bar visible");
  await page.waitForTimeout(400);
  await shot(page, "runner-hero");

  // scroll inside the clip and tap the wristband CTA: the outer page must not navigate
  const urlBefore = page.url();
  await frame.locator("[data-clip='wristband']").scrollIntoViewIfNeeded();
  await page.waitForTimeout(300);
  await shot(page, "runner-wristband");
  await frame.locator("[data-clip-cta='band-waitlist']").click();
  await page.waitForTimeout(800);
  check(page.url() === urlBefore, "wristband CTA did not navigate the outer page");
  check(ctx.pages().length === 1, "wristband CTA opened no new tab inside the clip");
  const featureCount = await frame.locator("[data-clip-feature]").count();
  check(featureCount === 6, `feature grid has ${featureCount} tiles`);
  await frame.locator("[data-clip='experience']").scrollIntoViewIfNeeded();
  await page.waitForTimeout(300);
  await shot(page, "runner-experience");

  // "Try your Persona": one real turn on the demo inbox from inside the clip, then hand off to Messages
  await frame.locator("[data-clip='tryit']").scrollIntoViewIfNeeded();
  const chip = frame.locator("[data-demo-chip]").first();
  const chipText = await chip.textContent();
  await chip.click();
  log("demo task:", chipText?.trim());
  await frame.locator("[data-demo-bubble='out']").waitFor({ timeout: 5000 });
  await frame.locator("[data-demo-bubble='in']").first().waitFor({ timeout: 60_000 });
  await page.waitForTimeout(1800);
  const demoBubbles = await frame.locator("[data-demo-bubble='in']").allTextContents();
  check(demoBubbles.length >= 1, `demo answered with ${demoBubbles.length} bubble(s): ${demoBubbles[0]?.slice(0, 140)}`);
  for (const b of demoBubbles.slice(1)) log("   A:", b.slice(0, 140));
  await shot(page, "runner-demo");
  const cont = frame.locator("[data-demo-cta='continue']");
  await cont.waitFor({ timeout: 10_000 });
  check(await cont.isVisible(), "'Continue in Messages' CTA appears after the demo");
  await cont.click();
  await page.waitForSelector("[data-app-clip-runner]", { state: "detached", timeout: 8000 });
  check(true, "Continue in Messages closed the runner");

  // events recorded on the server
  const ev = await page.request.get(BASE + `/api/session/${sid}`);
  const view = await ev.json();
  check(view.session?.id === sid, "session view still loads");

  // Contacts off → the same message is a plain rich link preview (no Open button)
  await page.evaluate(() => window.__persona.session.getState().setSenderInContacts(false));
  await page.waitForTimeout(300);
  const openCount = await page.locator("[data-bubble] button", { hasText: /^Open$/ }).count();
  const plainLink = await page.locator("[data-bubble] button", { hasText: "Meet your Persona" }).count();
  check(openCount === 0 && plainLink >= 1, `Contacts off: plain link preview (Open buttons: ${openCount}, previews: ${plainLink})`);
  await shot(page, "plain-link");

  // Tapping the plain preview opens the in-phone Safari sheet, never a browser tab
  const pagesBefore = ctx.pages().length;
  const outerUrl = page.url();
  await page.locator("[data-bubble] button", { hasText: "Meet your Persona" }).last().click();
  await page.waitForSelector("[data-safari-sheet]", { timeout: 8000 });
  const doneVisible = await page.locator("[data-safari-sheet] >> text=Done").isVisible();
  const safariSrc = (await page.locator("[data-safari-sheet] iframe").getAttribute("src")) ?? "";
  await page.waitForTimeout(800);
  check(doneVisible && safariSrc.includes("/clip"), `plain link opened in-phone Safari (Done visible, iframe ${safariSrc})`);
  check(ctx.pages().length === pagesBefore && page.url() === outerUrl, "no new tab and the phone page stayed put");
  await shot(page, "safari-sheet");
  await page.locator("[data-safari-sheet] >> text=Done").click();
  await page.waitForSelector("[data-safari-sheet]", { state: "detached", timeout: 8000 });
  check(true, "Done closed the Safari sheet");

  // the web fallback itself renders at /clip
  const web = await ctx.newPage();
  await web.goto(BASE + `/clip?sid=${sid}`, { waitUntil: "domcontentloaded" });
  await web.waitForSelector("[data-clip='hero'] h1", { timeout: 20_000 });
  const banner = await web.locator('meta[name="apple-itunes-app"]').getAttribute("content");
  check(!!banner && banner.includes("app-clip-bundle-id="), `Smart App Banner meta present: ${banner}`);
  await web.setViewportSize({ width: 430, height: 900 });
  await shot(web, "web-fallback");
  await web.close();
} catch (e) {
  ok = false;
  log("!! FAILED:", e?.stack ?? String(e));
  await shot(page, "failure").catch(() => {});
} finally {
  await browser.close();
}
if (errors.length) { ok = false; log("page errors:", errors.length); }
log(ok ? "APP CLIP E2E OK" : "APP CLIP E2E HAD FAILURES");
process.exit(ok ? 0 : 1);
