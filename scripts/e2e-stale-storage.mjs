// Regression check: a stale/poisoned localStorage session (pre-refactor shapes, junk entries) must not crash / or /db.
// Usage: node scripts/e2e-stale-storage.mjs   (dev server on :3000)
import { chromium } from "playwright";
const EXE = `${process.env.HOME}/Library/Caches/ms-playwright/chromium-1243/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`;
const browser = await chromium.launch({ executablePath: EXE, headless: true });
const ctx = await browser.newContext();
await ctx.addInitScript(() => {
  if (localStorage.getItem("__poisoned")) return;
  const now = Date.now();
  localStorage.setItem("persona-onboarding-session", JSON.stringify({ version: 0, state: {
    sessionId: crypto.randomUUID(), createdAt: now, phase: "collecting", channel: "text", assistantTyping: true,
    slots: { user_name: { status: "filled", value: "Old" }, need: { status: "empty" }, gmail: { status: "empty" }, agent_name: { status: "empty" } },
    messages: [
      { id: "old-1", role: "assistant", ts: now - 5000, text: "old-shape message with text field" },
      { id: "old-2", role: "user", ts: now - 4000 },
      { id: "old-3", role: "assistant", ts: now - 3000, content: { kind: "text", text: "fine one" }, reactions: [{ type: "tapback", tapback: "heart", by: "user" }, { kind: { type: "tapback", tapback: "haha" }, by: "user", ts: now }] },
      null, "junk",
    ],
    call: { state: "live", startedAt: now - 60000 }, captions: null, events: "nope", screen: "call", senderInContacts: false,
  }}));
  localStorage.setItem("__poisoned", "1");
});
let errors = [];
for (const path of ["/", "/db"]) {
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(`${path}: ${String(e).slice(0, 160)}`));
  await page.goto("http://localhost:3000" + path, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(6000);
  // nextjs-portal also hosts the dev badge; only an error overlay mentions a runtime/build error
  const overlayText = await page.evaluate(() => Array.from(document.querySelectorAll("nextjs-portal")).map((el) => el.shadowRoot?.textContent ?? "").join(" "));
  const overlay = /Unhandled Runtime Error|Runtime TypeError|Build Error|Cannot read properties/i.test(overlayText) ? overlayText.match(/(Unhandled Runtime Error|Runtime TypeError|Build Error|Cannot read properties)[^.]{0,120}/i)?.[0] : null;
  const msgs = await page.evaluate(() => { try { return JSON.parse(localStorage.getItem("persona-onboarding-session")).state.messages.map((m) => `${m.id}:${m.content?.kind}`); } catch { return "n/a"; } });
  console.log(`${path} → error overlay: ${overlay ?? "none"} | stored messages: ${JSON.stringify(msgs)}`);
  if (overlay) errors.push(`${path}: overlay ${overlay}`);
  await page.close();
}
console.log("pageerrors:", errors.length ? errors : "none");
await browser.close();
process.exit(errors.length ? 1 : 0);
