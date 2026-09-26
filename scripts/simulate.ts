/**
 * Hostile-user simulator (DESIGN.md §16.1). Haiku plays a persona from
 * prompts/hostile_user.md against the running text channel.
 *
 *   npx tsx scripts/simulate.ts --persona troll --turns 8
 *   npx tsx scripts/simulate.ts --persona all --turns 6 --tag
 *   options: --base http://localhost:3000  --tag (tag assistant turns ask/ack/value/repair/off-topic)
 *            --auto-gmail (default on) / --no-auto-gmail: the simulated user cannot tap the Gmail card, so once the
 *            link card appears the script connects the demo inbox and runs the gmail_connected turn; for the
 *            skip_all and troll personas a refusal right after the card exercises the gmail_declined path instead.
 */
import { config } from "dotenv";
config({ path: ".env.local", quiet: true });

import { generateText, Output } from "ai";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { hostilePersonas } from "@/lib/server/prompt";
import { env } from "@/lib/server/env";
import { fastModel } from "@/lib/server/providers";
import { connectDemoInbox, createSession, HttpError, postMessage, runChat, sleep, waitForServer, type ChatRun } from "./lib/http";
import { USER_HELLO } from "@/lib/shared/text";
import type { ChatTrigger } from "@/lib/shared/types";
import { formatMetrics, metricsFor } from "./metrics";

type Persona = { id: string; title: string; system: string; done: string };
type Line = { who: "bot" | "human"; text: string };

/** personas that get a chance to refuse the Gmail card before the script auto-connects */
const DECLINE_PERSONAS = new Set(["skip_all", "troll"]);
const DECLINE_RE = /\b(no|nah|nope|skip|don'?t)\b/i;

const FRAMING =
  "You are role-playing a human texting an assistant over iMessage. Reply with ONLY the next text message you would send: 1–3 sentences, no quotes, no narration, no stage directions. Stay in character no matter what the assistant says.";

function arg(name: string, fallback?: string) {
  const i = process.argv.indexOf(`--${name}`);
  if (i < 0) return fallback;
  const v = process.argv[i + 1];
  return v && !v.startsWith("--") ? v : fallback;
}
const has = (name: string) => process.argv.includes(`--${name}`);

const WORKSPACE_RE = /anthropic-workspace-id|not scoped to a workspace/i;
const CREDIT_RE = /credit balance is too low|insufficient.*credit|billing/i;

function blockerFor(e: unknown): { code: number; message: string } | null {
  const msg = e instanceof Error ? e.message : String(e);
  const body = (e as { responseBody?: string })?.responseBody ?? "";
  const all = msg + " " + body;
  if (WORKSPACE_RE.test(all)) return { code: 2, message: "BLOCKED: the Anthropic key is org-scoped; set ANTHROPIC_WORKSPACE_ID in .env.local." };
  if (CREDIT_RE.test(all)) return { code: 3, message: "BLOCKED: the Anthropic account has no credits (Plans & Billing). Nothing to simulate until it is funded." };
  return null;
}

/** Bot bubbles → user role, the human's texts → assistant role (the persona model speaks as the human). */
function toPersonaMessages(thread: Line[]) {
  const out: { role: "user" | "assistant"; content: string }[] = [];
  for (const l of thread) {
    const role = l.who === "bot" ? "user" : "assistant";
    const last = out[out.length - 1];
    if (last && last.role === role) last.content += "\n" + l.text;
    else out.push({ role, content: l.text });
  }
  if (out.length && out[0].role !== "user") out.unshift({ role: "user", content: "(the assistant opened the chat)" });
  return out;
}

async function playHuman(persona: Persona, thread: Line[]): Promise<string> {
  const { text } = await generateText({
    model: fastModel(),
    instructions: `${persona.system}\n\n${FRAMING}`,
    messages: toPersonaMessages(thread),
    ...(env.TEXT_PROVIDER === "anthropic" ? { temperature: 0.9 } : {}),
    maxOutputTokens: 120,
  });
  return text.trim().replace(/^["“”']+|["“”']+$/g, "") || "hm";
}

async function isDone(persona: Persona, thread: Line[]): Promise<boolean> {
  try {
    const { output } = await generateText({
      model: fastModel(),
      output: Output.object({ schema: z.object({ done: z.boolean() }) }),
      instructions: "You judge whether a role-play stop condition has been met. Answer with JSON only.",
      prompt: `Stop condition: ${persona.done}\n\nTranscript (H = the simulated human, A = the assistant):\n${thread.map((l) => `${l.who === "bot" ? "A" : "H"}: ${l.text}`).join("\n")}`,
      maxOutputTokens: 40,
    });
    return output.done;
  } catch {
    return false;
  }
}

async function tagTurn(bubbles: string[], previousHuman: string): Promise<string> {
  try {
    const { output } = await generateText({
      model: fastModel(),
      output: Output.choice({ options: ["ask", "ack", "value", "repair", "off-topic"] }),
      instructions:
        "Tag the assistant's reply: ask = asks for a missing detail; ack = acknowledges/paraphrases without asking; value = does or delivers something concrete (emails, draft, plan); repair = recovers from confusion, a refusal, a repeat or a jailbreak; off-topic = answers something unrelated.",
      prompt: `Human said: ${previousHuman}\nAssistant replied:\n${bubbles.join("\n")}`,
      maxOutputTokens: 10,
    });
    return output;
  } catch {
    return "?";
  }
}

function maybeBurst(persona: Persona, text: string): string[] {
  if (!["all_in_one", "rambler"].includes(persona.id) || Math.random() > 0.5) return [text];
  const parts = text.split(/(?<=[.!?])\s+/).filter(Boolean);
  if (parts.length < 2) return [text];
  const cut = Math.ceil(parts.length / 2);
  return [parts.slice(0, cut).join(" "), parts.slice(cut).join(" ")];
}

async function chatWithRetry(base: string, sid: string, trigger: ChatTrigger = "user", reason?: string): Promise<ChatRun> {
  let run = await runChat(base, sid, trigger, reason);
  if (run.busy) {
    await sleep(2000);
    run = await runChat(base, sid, trigger, reason);
  }
  return run;
}

/** Print one assistant turn (tools, cards, bubbles) and append it to the persona's view of the thread. */
async function printRun(run: ChatRun, thread: Line[], tag: boolean, previousHuman: string): Promise<boolean> {
  if (run.error) {
    console.error(`  ✖ chat error: ${run.error}`);
    const b = blockerFor(new Error(run.error));
    if (b) {
      console.error(b.message);
      process.exit(b.code);
    }
  }
  for (const t of run.toolEvents) console.log(`  ⚙ ${t.name} ${t.ok ? "ok" : "rejected"}${t.ring ? " (ring)" : ""} → next: ${t.next_best_ask.slot ?? "none"}`);
  for (const m of run.messages) if (m.kind !== "text") console.log(`  ▣ ${m.kind}${m.payload?.title ? `: ${m.payload.title}` : ""}`);
  for (const b of run.bubbles) console.log(`A: ${b}`);
  if (tag && run.bubbles.length) console.log(`  [${await tagTurn(run.bubbles, previousHuman)}]`);
  if (run.bubbles.length) thread.push({ who: "bot", text: run.bubbles.join("\n") });
  if (run.done) console.log(`  (${run.done.latency_ms} ms, next: ${run.done.next_best_ask.slot ?? "none"})`);
  return run.session?.phase === "graduated";
}

const sawGmailCard = (run: ChatRun) => run.messages.some((m) => m.kind === "link_card") || run.session?.gmail_status === "pending";

async function simulate(persona: Persona, base: string, turns: number, tag: boolean, autoGmail: boolean) {
  const sid = randomUUID();
  console.log(`\n=== ${persona.id} — ${persona.title} ===  session ${sid}`);
  await createSession(base, sid);
  const thread: Line[] = [];
  // The real flow: the compose field is prefilled with "Hey Persona"; sending it gets the opener.
  await postMessage(base, sid, USER_HELLO);
  console.log(`U: ${USER_HELLO}`);
  thread.push({ who: "human", text: USER_HELLO });
  await printRun(await chatWithRetry(base, sid), thread, tag, USER_HELLO);

  // --auto-gmail state: once per session
  let cardSeen = false; // the Gmail link card arrived (or gmail went pending)
  let gmailHandled = false; // demo inbox connected, or the decline path was taken
  let declineWindow = false; // decline personas: the very next human text may refuse the card

  const autoConnect = async () => {
    await sleep(1500);
    gmailHandled = true; // once per session, even if the route is missing
    try {
      const c = await connectDemoInbox(base, sid);
      console.log(`  ▣ demo inbox connected${c.email ? ` (${c.email})` : ""}`);
    } catch (e) {
      const why = e instanceof HttpError ? `HTTP ${e.status}` : e instanceof Error ? e.message : String(e);
      console.log(`  ▣ demo inbox NOT connected (${why}); continuing without Gmail`);
      return false;
    }
    const run = await chatWithRetry(base, sid, "gmail_connected");
    return printRun(run, thread, tag, "(connected the demo inbox)");
  };

  for (let turn = 1; turn <= turns; turn++) {
    if (autoGmail && cardSeen && !gmailHandled && !declineWindow) {
      if (await autoConnect()) {
        console.log("  ✓ graduated");
        break;
      }
    }

    const human = await playHuman(persona, thread);
    let trigger: ChatTrigger = "user";
    let reason: string | undefined;
    if (autoGmail && cardSeen && !gmailHandled && declineWindow) {
      declineWindow = false;
      if (DECLINE_RE.test(human)) {
        trigger = "gmail_declined";
        reason = "user";
        gmailHandled = true;
        console.log("  ▣ persona refused the Gmail card → gmail_declined path");
      }
    }
    for (const [i, part] of maybeBurst(persona, human).entries()) {
      if (i > 0) await sleep(400);
      await postMessage(base, sid, part);
      console.log(`U: ${part}`);
      thread.push({ who: "human", text: part });
    }
    await sleep(1600);

    const run = await chatWithRetry(base, sid, trigger, reason);
    const graduated = await printRun(run, thread, tag, human);
    if (autoGmail && !cardSeen && !gmailHandled && sawGmailCard(run)) {
      cardSeen = true;
      declineWindow = DECLINE_PERSONAS.has(persona.id);
    }

    if (graduated) {
      console.log("  ✓ graduated");
      break;
    }
    if (turn % 2 === 0 && (await isDone(persona, thread))) {
      console.log("  ✓ persona stop condition met");
      break;
    }
  }

  console.log(`\nsession ${sid}`);
  const m = await metricsFor(sid);
  if (m) console.log(formatMetrics(m));
  return sid;
}

async function main() {
  const base = (arg("base", "http://localhost:3000") as string).replace(/\/$/, "");
  const which = arg("persona", "all_in_one") as string;
  const turns = Number(arg("turns", "8"));
  const tag = has("tag");
  const autoGmail = !has("no-auto-gmail");
  const personas = hostilePersonas();
  const chosen = which === "all" ? personas : personas.filter((p) => p.id === which);
  if (!chosen.length) {
    console.error(`unknown persona "${which}". known: ${personas.map((p) => p.id).join(", ")}`);
    process.exit(1);
  }
  if (!(await waitForServer(base, 15_000, 3_000))) {
    console.error(`no server at ${base} (POST /api/session must answer 200)`);
    process.exit(1);
  }
  const ids: string[] = [];
  for (const p of chosen) ids.push(await simulate(p, base, turns, tag, autoGmail));
  if (ids.length > 1) console.log(`\nall sessions: ${ids.join(" ")}\n  npx tsx scripts/metrics.ts ${ids.join(" ")}`);
}

main().catch((e) => {
  if (e instanceof HttpError) {
    console.error(`HTTP ${e.status}: ${e.body}`);
    process.exit(1);
  }
  const b = blockerFor(e);
  if (b) {
    console.error(`${b.message} (the persona model call failed)`);
    process.exit(b.code);
  }
  console.error(e);
  process.exit(1);
});
