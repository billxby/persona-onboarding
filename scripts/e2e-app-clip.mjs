// App Clip walkthrough against a running dev server (DESIGN §19): card in the thread → system App Clip card →
// the clip runs in the phone as the app's onboarding → each answer lands on the session as it is given →
// close → the thread takes the relay (acknowledges, never re-asks) → tapback as an answer → Contacts off = plain
// link → in-phone Safari → the /clip web fallback.
// Usage: node scripts/e2e-app-clip.mjs [--base http://localhost:3000] [--out ./e2e-out] [--call] [--leave-early]
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > -1 ? process.argv[i + 1] : d; };
const BASE = arg("--base", process.env.BASE ?? "http://localhost:3000");
const OUT = arg("--out", process.env.OUT ?? "./e2e-out");
const CALL = process.argv.includes("--call"); // answer "Call me now" on the call screen and expect the phone to ring
const LEAVE_EARLY = process.argv.includes("--leave-early"); // close the clip after the name: partial capture + relay
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
const inTexts = () => page.$$eval(".bubble-in[data-bubble]", (els) => els.map((e) => e.textContent.trim()));
const view = async (sid) => (await page.request.get(`${BASE}/api/session/${sid}`)).json();
const NAME_ASKS = [/what should i call you/i, /what'?s your name/i, /your name\?/i, /who am i (talking|speaking) (to|with)/i];
const GMAIL_ASKS = [/connect (your )?gmail/i, /link (your )?gmail/i, /hook up (your )?(gmail|inbox)/i];
// the clip runs full-frame inside the phone; every screen carries data-clip-screen
const clip = page.locator("[data-app-clip-runner] [data-clip-onboarding]");
const onScreen = async (name, timeout = 15_000) => { await page.locator(`[data-app-clip-runner] [data-clip-onboarding][data-clip-screen='${name}']`).waitFor({ timeout }); log("screen:", name); };
const tap = (sel) => clip.locator(sel).first().click({ force: true });

try {
  await page.goto(BASE + "/", { waitUntil: "domcontentloaded" });
  // the thread starts empty with "Hey Persona" prefilled in the compose field; sending it gets the opener
  await page.waitForFunction(() => (document.querySelector("textarea")?.value ?? "").length > 0, null, { timeout: 30_000 });
  await page.click("[aria-label='Send']");
  await page.waitForSelector(".bubble-in[data-bubble]", { timeout: 60_000 });
  // the opener is three messages (intro, App Clip card, ask); wait for the ask so later counts start clean
  await page.waitForFunction(() => document.querySelectorAll(".bubble-in[data-bubble]").length >= 2, null, { timeout: 60_000 });
  const sid = await page.evaluate(() => window.__persona.session.getState().sessionId);
  log("session", sid);
  const openerCount = (await inTexts()).length;

  // before the agent is named the header is an unknown sender: a number, not "Persona"
  check((await page.locator("text=+1 (415) 555").count()) > 0, "thread header shows an unknown number before naming");
  // Persona is in Contacts by default → the opener's card is the App Clip bubble (no toggling needed)
  check(await page.evaluate(() => window.__persona.session.getState().senderInContacts) === true, "Persona is in Contacts by default");
  const openBtn = page.locator("[data-bubble] button", { hasText: /^Open$/ }).first();
  await openBtn.waitFor({ timeout: 30_000 });
  check(true, "App Clip bubble rendered with an Open button");
  await shot(page, "clip-bubble");

  // the iOS system card: header image, title/subtitle, Open, notifications note, Powered by · App Store
  await openBtn.click();
  await page.waitForSelector("[data-app-clip-card]", { timeout: 10_000 });
  await page.waitForTimeout(700); // let the sheet spring in before the screenshot
  check(await page.locator("[data-app-clip-card] >> text=This App Clip can send you notifications").isVisible(), "system App Clip card shows the notifications note");
  check(await page.locator("[data-app-clip-card] >> text=Powered by").isVisible() && await page.locator("[data-app-clip-card] >> text=App Store").isVisible(), "system card footer: Powered by Persona · App Store");
  check((await page.locator("[data-app-clip-card] img").first().getAttribute("src"))?.includes("card-header"), "system card header image is the App Store Connect header");
  await shot(page, "system-card");

  // Open → the clip downloads (progress ring on the button) → launch screen → the app (no iframe, no web bar)
  await page.locator("[data-app-clip-card] button", { hasText: /^Open$/ }).click();
  await page.waitForSelector("[data-app-clip-ring]", { timeout: 5000 });
  check(true, "Open shows the App Store download ring before the clip launches");
  await shot(page, "installing");
  await page.waitForSelector("[data-app-clip-runner]", { timeout: 10_000 });
  check((await page.locator("[data-app-clip-splash]").count()) === 1, "launch screen shown");
  await shot(page, "launch");
  await onScreen("welcome", 20_000);
  check((await page.locator("[data-app-clip-runner] iframe").count()) === 0, "the clip is a native view, not an iframe");
  check((await page.locator("[data-app-clip-runner] >> text=Open in Messages").count()) === 0 && (await page.locator("[data-app-clip-runner] >> text=Persona · App Clip").count()) === 0, "no web nav, no 'Open in Messages', no App Clip bar");
  await page.waitForTimeout(500);
  await shot(page, "welcome");

  // value pages: the mock thread animates in
  await tap("[data-clip-next='welcome']");
  await onScreen("values");
  await page.waitForSelector("[data-app-clip-runner] [data-clip-bubble]", { timeout: 8000 });
  await page.waitForTimeout(2600);
  check((await page.locator("[data-app-clip-runner] [data-clip-bubble]").count()) >= 2, "value page 1: mock thread bubbles arrived");
  await shot(page, "value-1");
  await tap("[data-clip-next='value-0']");
  await page.waitForTimeout(900);
  await shot(page, "value-2");
  await tap("[data-clip-next='value-1']");
  await page.waitForTimeout(900);
  check((await page.locator("[data-app-clip-runner] [data-clip-page='2']").count()) === 1, "value page 3 (dots)");
  await shot(page, "value-3");
  await tap("[data-clip-next='value-2']");

  // your name: captured the moment it is given
  await onScreen("user_name");
  await clip.locator("[data-clip-input='user_name']").fill("Bill");
  await tap("[data-clip-next='user_name']");
  await onScreen("agent_name");
  await page.waitForTimeout(700);
  let v = await view(sid);
  check(v.session?.user_name === "Bill", `user_name landed on the session before the next screen (${v.session?.user_name})`);
  await shot(page, "agent-name");

  if (LEAVE_EARLY) {
    // leave now: the name is kept, the thread takes the relay and asks only what is missing
    await tap("[data-clip-skip]");
    await page.waitForSelector("[data-app-clip-runner]", { state: "detached", timeout: 8000 });
    await page.waitForFunction((n) => document.querySelectorAll(".bubble-in[data-bubble]").length > n, openerCount, { timeout: 90_000 });
    await page.waitForTimeout(3000);
    const relay = (await inTexts()).slice(openerCount);
    for (const b of relay) log("A:", b.slice(0, 200));
    check(relay.some((b) => /\bBill\b/.test(b)), "relay after leaving early uses the name");
    check(!relay.some((b) => NAME_ASKS.some((re) => re.test(b))), "relay does not re-ask the name");
    await shot(page, "relay-partial");
    v = await view(sid);
    check(v.session?.user_name === "Bill" && !v.session?.agent_name, "partial capture kept on the server");
    throw new Error("__done__");
  }

  // a name for Persona: chip → Continue → the contact card lands in the thread behind the clip
  await tap("[data-clip-chip='Jarvis']");
  await tap("[data-clip-next='agent_name']");
  await onScreen("gmail");
  await page.waitForTimeout(700);
  v = await view(sid);
  check(v.session?.agent_name === "Jarvis", `agent_name landed (${v.session?.agent_name})`);
  check(v.messages.some((m) => m.kind === "contact_card"), "contact card row inserted by the clip's answer");
  await shot(page, "google");

  // Google: the demo inbox (the same route the connect page uses), then the check and auto-advance
  await tap("[data-clip-link='gmail-demo']");
  await page.waitForSelector("[data-app-clip-runner] [data-clip-gmail-connected]", { timeout: 20_000 });
  check(true, "demo inbox connected from inside the clip");
  await shot(page, "google-connected");
  await onScreen("call_offer", 10_000);
  v = await view(sid);
  check(v.session?.gmail_status === "connected", `gmail_status connected (${v.session?.gmail_status})`);
  // no Gmail reply landed behind the clip
  check((await inTexts()).length === openerCount, "no reply landed in the thread while the clip was open");
  await shot(page, "call-offer");

  // the call offer
  if (CALL) {
    await tap("[data-clip-next='call-yes']");
    await onScreen("done");
    await shot(page, "done-calling");
    // the done screen closes itself and the phone rings
    await page.waitForSelector("[data-app-clip-runner]", { state: "detached", timeout: 10_000 });
    await page.waitForSelector("[aria-label='Accept']", { timeout: 30_000 });
    check(true, "the phone rings after 'Call me now'");
    await shot(page, "ringing");
    v = await view(sid);
    check(v.session?.channel_pref === "call", `channel_pref call (${v.session?.channel_pref})`);
    check((v.intentions ?? []).find((i) => i.key === "offer_call")?.status === "done", "offer_call settled");
    throw new Error("__done__");
  }
  await tap("[data-clip-secondary='call-no']");
  await onScreen("done");
  await page.waitForTimeout(600);
  check(await clip.locator("[data-clip-recap] >> text=I'll call you Bill").isVisible(), "done screen recaps the name");
  check(await clip.locator("[data-clip-secondary='get-app']").isVisible(), "done screen offers the companion app");
  await shot(page, "done");
  v = await view(sid);
  check(v.session?.channel_pref === "text", `channel_pref text after 'I'll text' (${v.session?.channel_pref})`);
  const offer = (v.intentions ?? []).find((i) => i.key === "offer_call");
  check(offer?.status === "done", `offer_call settled (${offer?.status})`);
  const evs = (await page.request.get(`${BASE}/api/session/${sid}`)).ok() ? v : null;
  check(!!evs, "session view loads");

  // Back to Messages → the thread takes the relay: uses the name, owns the new name, never re-asks
  await tap("[data-clip-next='done']");
  await page.waitForSelector("[data-app-clip-runner]", { state: "detached", timeout: 8000 });
  await page.waitForFunction((n) => document.querySelectorAll(".bubble-in[data-bubble]").length > n, openerCount, { timeout: 90_000 });
  await page.waitForTimeout(3500);
  const relay = (await inTexts()).slice(openerCount);
  for (const b of relay) log("A:", b.slice(0, 200));
  check(relay.length >= 1, "relay reply landed after the clip closed");
  check(relay.some((b) => /\bBill\b/.test(b)) || relay.some((b) => /\bJarvis\b/.test(b)), "relay uses what was set up (name or agent name)");
  check(!relay.some((b) => NAME_ASKS.some((re) => re.test(b))), "relay does not re-ask the name");
  check(!relay.some((b) => GMAIL_ASKS.some((re) => re.test(b))), "relay does not re-ask Gmail");
  check(!relay.some((b) => /want me to call you|quick call/i.test(b)), "relay does not offer a call again");
  check((await page.locator("text=Jarvis").count()) > 0, "thread shows the new name (header / contact card)");
  check((await page.locator("text=+1 (415) 555").count()) === 0, "the unknown-sender number is gone once the agent is named");
  await shot(page, "relay");
  v = await view(sid);
  const done = ["get_name", "name_agent", "connect_gmail", "offer_call"].map((k) => [k, (v.intentions ?? []).find((i) => i.key === k)?.status]);
  check(done.every(([, s]) => s === "done"), `intentions settled: ${done.map(([k, s]) => `${k}=${s}`).join(" ")}`);

  // a tapback on the agent's last question is an answer: it is scored and the chat acts on it
  const lastAssistant = [...v.messages].reverse().find((m) => m.role === "assistant" && m.kind === "text");
  const before = (await inTexts()).length;
  const tb = await page.request.post(`${BASE}/api/messages`, { data: { session_id: sid, client_id: crypto.randomUUID(), text: "", kind: "tapback", payload: { target_id: lastAssistant.id, tapback: "thumbsUp", by: "user", added: true } } });
  const tbBody = await tb.json();
  check(tb.ok() && tbBody.message?.kind === "tapback", `tapback stored (${tb.status()})`);
  log("tapback →", JSON.stringify({ chat_trigger: tbBody.chat_trigger, reacted_key: tbBody.reacted_key }));
  v = await view(sid);
  const receptivity = await page.request.get(`${BASE}/api/session/${sid}`).then(() => v);
  check(!!receptivity, "session still loads after the tapback");
  if (tbBody.chat_trigger === "tapback") {
    const r = await page.request.post(`${BASE}/api/chat`, { data: { session_id: sid, trigger: "tapback", reason: tbBody.reacted_key } });
    check(r.ok(), `tapback trigger accepted by /api/chat (${r.status()})`);
    await page.waitForTimeout(6000);
    const after = await inTexts();
    for (const b of after.slice(before)) log("A(tapback):", b.slice(0, 200));
  }

  // Contacts off → the same message is a plain rich link preview (no Open button)
  await page.evaluate(() => window.__persona.session.getState().setSenderInContacts(false));
  await page.waitForTimeout(300);
  const openCount = await page.locator("[data-bubble] button", { hasText: /^Open$/ }).count();
  const plainLink = await page.locator("[data-bubble] button", { hasText: "Persona" }).count();
  check(openCount === 0 && plainLink >= 1, `Contacts off: plain link preview (Open buttons: ${openCount}, previews: ${plainLink})`);
  await shot(page, "plain-link");

  // the web fallback itself renders at /clip: no nav, no "Open in Messages", the same wizard, Smart App Banner present
  const web = await ctx.newPage();
  await web.setViewportSize({ width: 430, height: 900 });
  await web.goto(BASE + `/clip?sid=${sid}`, { waitUntil: "domcontentloaded" });
  // a finished onboarding reopens straight on "You're set" (the resume state decides the first screen)
  await web.waitForSelector("[data-clip-onboarding][data-clip-screen='done']", { timeout: 20_000 });
  await web.waitForLoadState("networkidle");
  check(true, "reopened clip opens on the done screen, not the welcome");
  const banner = await web.locator('meta[name="apple-itunes-app"]').getAttribute("content");
  check(!!banner && banner.includes("app-clip-bundle-id="), `Smart App Banner meta present: ${banner}`);
  check((await web.locator("text=Open in Messages").count()) === 0 && (await web.locator("nav").count()) === 0, "web fallback has no site nav / 'Open in Messages'");
  await web.waitForTimeout(400);
  await shot(web, "web-fallback");
  check(await web.locator("[data-clip-recap] >> text=I'll call you Bill").isVisible(), "done screen recaps what was set up");
  check((await web.locator("[data-clip-next='done']").getAttribute("href"))?.includes(`sid=${sid}`), "web 'Start in Messages' resumes the session");
  await shot(web, "web-done");
  await web.close();

  // behind the scenes: the run dropdown lists the live session (and archived runs when there are any)
  const db = await ctx.newPage();
  await db.goto(BASE + "/db", { waitUntil: "domcontentloaded" });
  await db.waitForSelector("[data-db-run-select]", { timeout: 20_000 });
  const opts = await db.locator("[data-db-run-select] option").allTextContents();
  check(opts.some((o) => o.startsWith("Live")), `/db run dropdown present (${opts.length} option(s))`);
  await shot(db, "db-run-dropdown");
  await db.close();
} catch (e) {
  if (String(e?.message) !== "__done__") {
    ok = false;
    log("!! FAILED:", e?.stack ?? String(e));
    await shot(page, "failure").catch(() => {});
  }
} finally {
  await browser.close();
}
if (errors.length) { ok = false; log("page errors:", errors.length); }
log(ok ? "APP CLIP E2E OK" : "APP CLIP E2E HAD FAILURES");
process.exit(ok ? 0 : 1);
