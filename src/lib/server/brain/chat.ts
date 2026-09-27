import { generateText, isStepCount, tool, type ModelMessage, type SystemModelMessage, type ToolSet } from "ai";
import { detectNudges, OFFER_CALL_KEY, tapbackGlyph } from "@/lib/memory/intentions";
import { ensureMind, mindFor, recordNudge } from "@/lib/memory/mind";
import type { Belief, ChatEvent, ChatTrigger, Intention, MessageRow, SessionRow, SlotName, ToolResult } from "@/lib/shared/types";
import { detectAddressedName, looksLikeCallRequest, looksLikeSkip, questionsIn, splitBubbles, stripMarkdown, typingDelayMs, isHello, OPENER_ASK, OPENER_CARD_LINE, OPENER_INTRO } from "@/lib/shared/text";
import { sleep } from "@/lib/utils";
import { recordCallOfferAnswer } from "../callOffer";
import { clipCapture, clipClosedHint } from "../clipAnswer";
import { env } from "../env";
import { markGmail } from "../gmail/oauth";
import { activeBeliefs, detectDrop, DROP_COPY, insertEvent, insertMessage, listEvents, listMessages, recentThread } from "../messages";
import * as promptMod from "../prompt";
import { fastModel, textModel } from "../providers";
import { acquireReplyLock, getSession, patchSession, releaseReplyLock } from "../session";
import { askPlan, bumpAttempt, isGraduated, nextBestAsk, pushQuestion, turnOf } from "../state";
import { assessReactions } from "./receptivity";
import { TOOL_DEFS } from "../tools/definitions";
import { insertAppClipCard, runTool } from "../tools/run";
import { insertVoicemail } from "../voicemail";
import { checkReply } from "./guard";

/**
 * The first text on a fresh thread is normally the prefilled "Hey Persona" (DESIGN §7.1): the
 * server answers it with the fixed opener, no model call: the intro line, the Meet your Persona
 * App Clip card, then the ask, with typing pauses. Any other first text goes to the model, which
 * introduces itself. Returns whether this handled the turn.
 */
async function landOpenerIfHello(session_id: string, emit: Emit): Promise<boolean> {
  const thread = await listMessages(session_id, { channel: "text" });
  if (thread.some((m) => m.role === "assistant")) return false;
  const last = [...thread].reverse().find((m) => m.role === "user" && m.kind === "text");
  if (!last?.content || !isHello(last.content)) return false;
  const land = async (content: string) => {
    await sleep(typingDelayMs(content));
    emit({ type: "message", message: await insertMessage({ session_id, role: "assistant", kind: "text", content, channel: "text" }) });
  };
  emit({ type: "typing", on: true });
  await land(OPENER_INTRO);
  await sleep(600);
  emit({ type: "message", message: await insertAppClipCard(session_id, "opener") });
  await land(OPENER_ASK);
  emit({ type: "typing", on: false });
  await insertEvent(session_id, "opener", { via: "hello" });
  return true;
}

export type Emit = (e: ChatEvent) => void;

const TURN_TIMEOUT_MS = 45_000;

/** Reasoning models (OpenAI gpt-5.x fallback) reject `temperature`; Claude takes it and we keep thinking off for latency. */
const samplingFor = (temperature: number) => (env.TEXT_PROVIDER === "openai" ? { reasoning: "low" as const } : { temperature });
const MAX_STEPS = 6;

// ---------------------------------------------------------------------------
// Prompt assembly
// ---------------------------------------------------------------------------

interface PromptParts {
  static: string;
  dynamic: string;
}

type PromptModule = typeof promptMod & {
  buildPromptParts?: (session: SessionRow, channel: "text" | "call", beliefs: Belief[], mind?: Intention[]) => PromptParts;
};

function buildParts(session: SessionRow, beliefs: Belief[], mind: Intention[]): PromptParts {
  const mod = promptMod as PromptModule;
  if (typeof mod.buildPromptParts === "function") return mod.buildPromptParts(session, "text", beliefs, mind);
  return { static: "", dynamic: mod.buildPrompt(session, "text", beliefs, mind) };
}

function systemMessages(parts: PromptParts, extra: string[]): SystemModelMessage[] {
  const out: SystemModelMessage[] = [];
  if (parts.static.trim()) {
    out.push(
      env.TEXT_PROVIDER === "anthropic"
        ? { role: "system", content: parts.static, providerOptions: { anthropic: { cacheControl: { type: "ephemeral" } } } }
        : { role: "system", content: parts.static },
    );
  }
  const dynamic = extra.length ? `${parts.dynamic}\n\nTHIS TURN\n${extra.map((h) => `- ${h}`).join("\n")}` : parts.dynamic;
  out.push({ role: "system", content: dynamic });
  return out;
}

function triggerHint(trigger: ChatTrigger, reason: string | undefined, session: SessionRow): string | null {
  switch (trigger) {
    case "call_ended": {
      const prefersText = reason === "user_hangup" || reason === "dropped" || reason === "silence" || reason === "mic_denied";
      return `The call just ended (reason: ${reason ?? "unknown"}). Continue here in ONE short message: what you took from the call and the next step. Nothing re-asked.${prefersText ? " They prefer text now: never offer a call again unless they ask." : ""}`;
    }
    case "gmail_connected":
      return `Gmail just connected${session.gmail_email ? ` as ${session.gmail_email}` : ""}. Call recent_emails(3) FIRST, then give one real observation (unread count, who needs a reply) and ask ONE question, e.g. offer to draft the most urgent reply.`;
    case "gmail_declined":
      return reason === "timeout"
        ? "The Gmail connect timed out. Acknowledge in one line, no guilt, and deliver one concrete plan for the need without Gmail (you may offer the demo inbox link once via request_gmail_connect only if they ask)."
        : "Gmail was declined. Acknowledge in one line, no guilt, and deliver one concrete plan for the need without Gmail.";
    case "welcome_back":
      return "The user came back after a while. Greet by name if known, recall the need in a few words, and offer to pick up where you left off. One question max.";
    case "silence_end":
      return "The call ended because the user went silent. One short line: no pressure, you're here in text, plus one easy next step. Never offer a call again unless asked.";
    case "clip_demo":
      return "Demo from the App Clip: the user has no name yet and this is a one-turn preview. Do the task on the demo inbox NOW (recent_emails / search_gmail / draft_reply), no questions about their name or Gmail, no card sending. End with one short line inviting them to continue in Messages.";
    case "tapback":
      return `They answered your last question with a tapback (the reaction is in the thread${reason ? `; it was read against ${reason}` : ""}). Treat it as their answer and act on it in ONE short bubble, no re-ask: a thumbs-up or heart on the call offer means call switch_channel("call") now and say you're calling; a thumbs-down means drop it and carry on here. On any other ask, a thumbs-up is a yes to what you proposed.`;
    // clip_closed: the hint is built from the capture by runTextTurn (see clipClosedHint)
    default:
      return null;
  }
}

function syntheticEvent(trigger: ChatTrigger, reason: string | undefined, session: SessionRow): string {
  switch (trigger) {
    case "call_ended":
      return `(system event: the call just ended — reason: ${reason ?? "unknown"}. Continue here.)`;
    case "gmail_connected":
      return `(system event: Gmail connected${session.gmail_email ? ` as ${session.gmail_email}` : ""}.)`;
    case "gmail_declined":
      return `(system event: the Gmail connection ${reason === "timeout" ? "timed out" : "was declined"}.)`;
    case "welcome_back":
      return "(system event: the user reopened the chat after a break.)";
    case "silence_end":
      return "(system event: the call ended after the user went silent.)";
    case "clip_closed":
      return `(system event: the user closed the Persona App Clip${reason === "ringing" ? "; you are ringing them now" : ""}. Continue here.)`;
    case "tapback":
      return "(system event: the user reacted to your last message.)";
    default:
      return "(system event: continue.)";
  }
}

// ---------------------------------------------------------------------------
// History → ModelMessage[]
// ---------------------------------------------------------------------------

function rowToText(row: MessageRow): { role: "user" | "assistant"; text: string } | null {
  const onCall = row.channel === "call" ? "(said on the call) " : "";
  switch (row.kind) {
    case "text":
      if (row.role === "user") return row.content ? { role: "user", text: `${onCall}${row.content}` } : null;
      if (row.role === "assistant") return row.content ? { role: "assistant", text: `${onCall}${row.content}` } : null;
      return null;
    case "link_card":
      return row.role === "assistant" ? { role: "assistant", text: "[sent the Connect Gmail link card]" } : null;
    case "summary_card":
      return { role: "assistant", text: "[sent the summary card]" };
    case "contact_card":
      return { role: "assistant", text: `[sent my contact card as ${row.content ?? row.payload?.name ?? "Persona"}]` };
    case "voicemail":
      return { role: "assistant", text: `[left a voicemail: ${row.payload?.transcript ?? row.content ?? ""}]` };
    case "call_log":
      return { role: "assistant", text: `[${row.content ?? "call ended"}]` };
    case "tapback": {
      // reactions reach the model as what they are: an answer without words (theirs) or a nod (ours)
      if (row.payload?.added === false) return null;
      const glyph = tapbackGlyph({ tapback: row.payload?.tapback, emoji: row.payload?.emoji });
      const by = row.payload?.by ?? (row.role === "user" ? "user" : "assistant");
      return by === "user" ? { role: "user", text: `[reacted ${glyph} to your last message]` } : { role: "assistant", text: `[reacted ${glyph} to their message]` };
    }
    default:
      return null;
  }
}

export function historyToMessages(thread: MessageRow[]): ModelMessage[] {
  const out: { role: "user" | "assistant"; text: string }[] = [];
  for (const row of thread) {
    const m = rowToText(row);
    if (!m) continue;
    const last = out[out.length - 1];
    if (last && last.role === m.role) last.text = `${last.text}\n\n${m.text}`;
    else out.push({ ...m });
  }
  if (out.length === 0 || out[0].role !== "user") out.unshift({ role: "user", text: "(joined the chat)" });
  return out.map((m) => ({ role: m.role, content: m.text }) as ModelMessage);
}

// ---------------------------------------------------------------------------
// The turn
// ---------------------------------------------------------------------------

/** Run one text-channel turn and stream ChatEvents to `emit`. Never throws (errors are emitted). */
export async function runTextTurn(session_id: string, trigger: ChatTrigger = "user", reason: string | undefined, emit: Emit): Promise<void> {
  const t0 = Date.now();
  const locked = await acquireReplyLock(session_id);
  if (!locked) {
    emit({ type: "busy" });
    return;
  }
  try {
    let session = await getSession(session_id);
    if (!session) {
      emit({ type: "error", message: "session_not_found" });
      return;
    }
    session = await detectDrop(session);

    const finish = async () => {
      const fresh = (await getSession(session_id)) ?? session!;
      emit({ type: "session", session: fresh });
      emit({ type: "beliefs", beliefs: await activeBeliefs(session_id) });
      const mind = await mindFor(session_id).catch(() => [] as Intention[]);
      emit({ type: "mind", intentions: mind });
      emit({ type: "done", latency_ms: Date.now() - t0, next_best_ask: nextBestAsk(fresh, "text", mind) });
    };

    // Deterministic triggers: no model call.
    // "open": nothing to seed. The thread starts empty; the browser prefills the compose field instead.
    if (trigger === "open") {
      await finish();
      return;
    }
    if (trigger === "dropped") {
      const thread = await listMessages(session_id, { channel: "text" });
      const lastAssistant = [...thread].reverse().find((m) => m.role === "assistant" && m.kind === "text");
      const copy = DROP_COPY(session.user_name);
      if (lastAssistant?.content !== copy) {
        const row = await insertMessage({ session_id, role: "assistant", kind: "text", content: copy, channel: "text" });
        await insertEvent(session_id, "resume", { reason: "dropped", via: "chat_trigger" });
        emit({ type: "message", message: row });
      }
      await finish();
      return;
    }
    if (trigger === "voicemail") {
      // /api/call/event (declined) already inserted the voicemail; only add one if it is missing
      const last = (await listMessages(session_id, { limit: 1000 })).at(-1);
      if (last?.kind !== "voicemail") {
        const row = await insertVoicemail(session);
        if (row) emit({ type: "message", message: row });
      }
      await finish();
      return;
    }

    if (trigger === "gmail_declined" && session.gmail_status === "pending") {
      await markGmail(session_id, reason === "timeout" ? "failed" : "declined");
      session = (await getSession(session_id)) ?? session;
    }

    if (trigger === "user" && (await landOpenerIfHello(session_id, emit))) {
      await finish();
      return;
    }

    // The App Clip closed: the thread takes the relay (DESIGN §19). Everything the clip captured is already on
    // the session (each answer was written the moment it was given); here we only tidy up and brief the model.
    if (trigger === "clip_closed") {
      const cap = await clipCapture(session_id);
      if (session.gmail_status === "pending" && cap.gmail_started_in_clip) {
        // Google consent started in the clip and never came back: don't freeze the plan on `pending`
        await markGmail(session_id, "failed", null, { reason: "clip_abandoned" });
        session = (await getSession(session_id)) ?? session;
      }
      const captured = cap.answered.length + cap.skipped.length > 0 || !!cap.call_offer || cap.gmail_started_in_clip;
      if (!captured) {
        // opened and closed, nothing set up: no spurious bubble; the opener's question stands
        await finish();
        return;
      }
      let ringing = false;
      if (cap.call_offer === "yes" && session.call_state === "idle" && session.channel_pref !== "text") {
        const r = await runTool({ session, channel: "text" }, "switch_channel", { to: "call" });
        session = r.session;
        ringing = !!r.effects.ring;
        emit({ type: "tool", name: "switch_channel", ok: r.result.ok, ring: r.effects.ring, next_best_ask: r.result.next_best_ask });
      }
      if (ringing) {
        // the call takes over from here: one fixed line, no model turn that could second-guess the ring
        const row = await insertMessage({ session_id, role: "assistant", kind: "text", content: `Calling you now${session.user_name ? `, ${session.user_name}` : ""}.`, channel: "text" });
        emit({ type: "message", message: row });
        await finish();
        return;
      }
      await llmTurn(session, trigger, undefined, emit, [clipClosedHint(session, cap, false)]);
      await finish();
      return;
    }

    await llmTurn(session, trigger, reason, emit);
    await finish();
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("[chat] turn failed:", message);
    await insertEvent(session_id, "error", { where: "chat", trigger, message: message.slice(0, 500) });
    emit({ type: "typing", on: false });
    emit({ type: "error", message });
  } finally {
    await releaseReplyLock(session_id);
  }
}

const slotEmpty = (s: SessionRow, slot: SlotName) =>
  slot === "user_name" ? !s.user_name : slot === "need" ? !s.need : slot === "gmail" ? s.gmail_status === "none" : !s.agent_name;

async function llmTurn(session: SessionRow, trigger: ChatTrigger, reason: string | undefined, emit: Emit, extraHints: string[] = []): Promise<void> {
  const session_id = session.id;
  const thread = await recentThread(session_id, { n: 14, channels: ["text", "call"] });
  const firstReply = !thread.some((m) => m.role === "assistant");

  // Nothing to answer (e.g. a retried debounce after the reply already landed): stay quiet.
  if (trigger === "user") {
    const lastThreadRow = [...thread].reverse().find((m) => m.channel === "text" && m.kind !== "tapback" && (m.role === "user" || m.role === "assistant"));
    if (!lastThreadRow || lastThreadRow.role === "assistant") return;
  }

  emit({ type: "typing", on: true });

  const lastUser = [...thread].reverse().find((m) => m.role === "user" && m.kind === "text" && m.channel === "text");
  const lastUserText = lastUser?.content ?? "";

  // What is on my mind, and how did they take what I raised last turn? (DESIGN §13b)
  let mind = await ensureMind(session_id, turnOf(session)).catch((e) => {
    console.warn("[chat] mind unavailable:", e instanceof Error ? e.message : e);
    return [] as Intention[];
  });
  const hints: string[] = [...extraHints];
  if (trigger === "user" && lastUserText && mind.some((r) => r.status === "asked")) {
    const offerWasAsked = mind.some((r) => r.key === OFFER_CALL_KEY && r.status === "asked");
    const assessed = await assessReactions({ session, mind, userText: lastUserText, channel: "text" });
    mind = assessed.mind;
    // the one call offer settles on its answer (DESIGN §1.7): a yes rings (the model calls switch_channel), a no is text for good
    const offerRead = offerWasAsked ? assessed.assessed.find((a) => a.key === OFFER_CALL_KEY) : undefined;
    if (offerRead && offerRead.read.receptivity >= 7 && !looksLikeCallRequest(lastUserText)) {
      hints.push('They said yes to the call you offered: call switch_channel("call") now and say you\'re calling, nothing else.');
    } else if (offerRead && offerRead.read.receptivity <= 2) {
      session = await recordCallOfferAnswer(session, "no", { via: "chat", turn: turnOf(session) + 1, evidence_ref: "assessor:text" });
      mind = await mindFor(session_id).catch(() => mind);
    }
  }

  const beliefs = await activeBeliefs(session_id);
  const planBefore = askPlan(session, "text", mind);
  const nbaBefore = planBefore.pick;
  const parts = buildParts(session, beliefs, mind);

  const hint = triggerHint(trigger, reason, session);
  if (hint) hints.push(hint);
  if (trigger === "user" && lastUserText) {
    const addressed = detectAddressedName(lastUserText, [session.user_name, session.agent_name, "persona"]);
    if (addressed) hints.push(`The user may be addressing you as "${addressed}". If so, call set_slot(agent_name, "${addressed}") and then use it.`);
    if (looksLikeCallRequest(lastUserText)) hints.push('The user asked for a call: call switch_channel("call") and say you\'re calling now.');
    if (looksLikeSkip(lastUserText)) hints.push('The user wants to skip: respect it immediately. If they want to skip everything, call graduate("skip_all").');
  }
  if (session.summary) hints.push(`EARLIER (summary): ${session.summary}`);

  const system = systemMessages(parts, hints);
  const messages = historyToMessages(thread);
  const last = messages[messages.length - 1];
  if (last.role !== "user") messages.push({ role: "user", content: syntheticEvent(trigger, reason, session) });

  // Tools: one implementation (runTool) for both channels.
  let current = session;
  let ring = false;
  let emailsReturned = false;
  let drafted = false;
  let toolMessages = 0;
  const toolLog: { name: string; result: ToolResult }[] = [];
  const tools: ToolSet = {};
  for (const [name, def] of Object.entries(TOOL_DEFS)) {
    if (def.channels && !def.channels.includes("text")) continue;
    tools[name] = tool({
      description: def.description,
      inputSchema: def.input,
      execute: async (input: unknown) => {
        const r = await runTool({ session: current, channel: "text" }, name, input);
        current = r.session;
        if (r.effects.ring) ring = true;
        if (r.effects.emails?.length) emailsReturned = true;
        if (name === "draft_reply" && r.result.ok) drafted = true;
        for (const m of r.effects.messages ?? []) {
          toolMessages++;
          emit({ type: "message", message: m });
        }
        emit({ type: "tool", name, ok: r.result.ok, ring: r.effects.ring, next_best_ask: r.result.next_best_ask });
        toolLog.push({ name, result: r.result });
        return r.result;
      },
    });
  }

  const result = await generateText({
    model: textModel(),
    instructions: system,
    messages,
    tools,
    stopWhen: isStepCount(MAX_STEPS),
    maxOutputTokens: 450,
    ...samplingFor(0.6),
    abortSignal: AbortSignal.timeout(TURN_TIMEOUT_MS),
  });

  let text = stripMarkdown(result.text ?? "");
  if (!text && toolMessages === 0) {
    // Ran out of steps mid-tool-loop or the model stayed silent: ask for the reply with the tool results as context.
    text = await replyFromToolResults(system, messages, toolLog);
  }
  let bubbles = splitBubbles(text);

  // Output guard: local checks, then Haiku. On a miss, rewrite once.
  const guard: Record<string, unknown> = { ok: true, regenerated: false, source: "none" };
  if (bubbles.length) {
    // the guard reads the mind as it is after the tools ran, so it judges against the same plan the reply should follow
    const verdict = await checkReply({ session: current, beliefs: await activeBeliefs(session_id), bubbles, mind: await mindFor(session_id).catch(() => mind) });
    guard.ok = verdict.ok;
    guard.source = verdict.source;
    if (!verdict.ok && verdict.issue) {
      guard.issue = verdict.issue;
      const rewritten = await rewriteReply(system, bubbles, verdict.issue);
      if (rewritten.length) {
        bubbles = rewritten;
        guard.regenerated = true;
      }
    }
  }
  await insertEvent(session_id, "guard", { ...guard, bubbles: bubbles.length, tool_calls: toolLog.map((t) => t.name) });

  // Land the bubbles with typing pauses.
  for (const b of bubbles) {
    await sleep(typingDelayMs(b));
    const row = await insertMessage({ session_id, role: "assistant", kind: "text", content: b, channel: "text" });
    emit({ type: "message", message: row });
  }
  // The App Clip card goes out in the first exchange however the thread started (DESIGN §7.1): a first
  // text that was not the hello skips the fixed opener, so the card follows the model's first reply,
  // unless it already went out (the model can call send_app_clip itself; a call may have sent it).
  if (firstReply && (await listEvents(session_id, ["app_clip_card_shown"])).length === 0) {
    await sleep(typingDelayMs(OPENER_CARD_LINE));
    emit({ type: "message", message: await insertMessage({ session_id, role: "assistant", kind: "text", content: OPENER_CARD_LINE, channel: "text" }) });
    emit({ type: "message", message: await insertAppClipCard(session_id, "first_reply") });
  }
  emit({ type: "typing", on: false });

  // Bookkeeping on the session row.
  const questions = questionsIn(bubbles);
  const asked = questions.length > 0;
  const valueNow = emailsReturned || drafted;
  await patchSession(session_id, (s) => {
    let patch: Partial<SessionRow> = {};
    let acc: SessionRow = s;
    for (const q of questions) {
      const p = pushQuestion(acc, q);
      patch = { ...patch, ...p };
      acc = { ...acc, ...p };
    }
    if (asked && nbaBefore.slot && slotEmpty(s, nbaBefore.slot)) patch = { ...patch, ...bumpAttempt(s, nbaBefore.slot) };
    if (s.phase === "warmup" && asked) patch.phase = "collecting";
    if (valueNow && !s.value_moment_at) {
      patch.value_moment_at = new Date().toISOString();
      if (!isGraduated(s)) patch.phase = "value";
    }
    if (ring && s.channel_pref !== "call") patch.channel_pref = "call";
    patch.prompt_version = promptMod.PROMPT_VERSION;
    patch.turn = turnOf(s) + 1;
    return patch;
  });
  if (valueNow && !session.value_moment_at) await insertEvent(session_id, "value_moment", { via: emailsReturned ? "emails" : "draft", trigger });
  if (asked && nbaBefore.slot) await insertEvent(session_id, "steer", { slot: nbaBefore.slot, question: questions[0], trigger });

  // Which of my intentions did this reply raise? Mark them asked so next turn's reply gets scored.
  const thisTurn = turnOf(session) + 1;
  const fresh = await mindFor(session_id).catch(() => mind);
  for (const n of detectNudges(bubbles, fresh, nbaBefore.slot, "text", planBefore.raise)) {
    if (fresh.find((r) => r.key === n.key)?.status === "asked") continue; // a tool (the link card) already logged it
    try {
      await recordNudge(session_id, { key: n.key, approach: n.approach, channel: "text", turn: thisTurn, actor: "agent", evidence_ref: "chat:bubbles" });
      await insertEvent(session_id, "intention", { op: "nudge", key: n.key, approach: n.approach, turn: thisTurn, via: "detected" });
    } catch (e) {
      console.warn("[chat] nudge not recorded:", e instanceof Error ? e.message : e);
    }
  }

  await maybeRewriteSummary(session_id);
}

/** Fallback when the model produced no text: re-ask for the reply with the tool results inlined (no tools). */
async function replyFromToolResults(system: SystemModelMessage[], messages: ModelMessage[], toolLog: { name: string; result: ToolResult }[]): Promise<string> {
  try {
    const compact = toolLog.map((t) => `${t.name}: ${JSON.stringify(t.result).slice(0, 400)}`).join("\n");
    const { text } = await generateText({
      model: textModel(),
      instructions: system,
      messages: [
        ...messages,
        {
          role: "user",
          content: `(system: you already ran your tools this turn. Results:\n${compact || "(none)"}\nNow write the reply: 2–3 short bubbles, no markdown.)`,
        },
      ],
      maxOutputTokens: 300,
      ...samplingFor(0.6),
      abortSignal: AbortSignal.timeout(20_000),
    });
    return stripMarkdown(text ?? "");
  } catch (e) {
    console.warn("[chat] fallback reply failed:", e instanceof Error ? e.message : e);
    return "";
  }
}

/** Guard miss: rewrite the draft once, fixing only the reported issue. */
async function rewriteReply(system: SystemModelMessage[], bubbles: string[], issue: string): Promise<string[]> {
  try {
    const { text } = await generateText({
      model: textModel(),
      instructions: system,
      prompt: `Your draft reply was:\n\n${bubbles.join("\n\n")}\n\nProblem: ${issue}\n\nRewrite the reply fixing only that problem. Keep the facts and the tone. 2–3 short bubbles separated by blank lines, no markdown, at most one question. Output the reply only.`,
      maxOutputTokens: 450,
      ...samplingFor(0.4),
      abortSignal: AbortSignal.timeout(20_000),
    });
    return splitBubbles(stripMarkdown(text ?? ""));
  } catch (e) {
    console.warn("[chat] rewrite failed; keeping the original:", e instanceof Error ? e.message : e);
    return [];
  }
}

/** Every 10 assistant turns, rewrite the rolling 5-line summary from the last 20 rows. */
async function maybeRewriteSummary(session_id: string): Promise<void> {
  try {
    const all = await listMessages(session_id, { channel: "text" });
    const assistantTurns = all.filter((m) => m.role === "assistant" && m.kind === "text").length;
    if (assistantTurns === 0 || assistantTurns % 10 !== 0) return;
    const transcript = all
      .slice(-20)
      .map(rowToText)
      .filter((m): m is { role: "user" | "assistant"; text: string } => !!m)
      .map((m) => `${m.role === "user" ? "User" : "Persona"}: ${m.text}`)
      .join("\n");
    const { text } = await generateText({
      model: fastModel(),
      instructions: "Summarise this chat for the assistant's own memory. At most 5 short lines: who the user is, what they want, what was done, what is pending, anything they asked to remember. Plain text, no markdown.",
      prompt: transcript,
      maxOutputTokens: 200,
      ...samplingFor(0.2),
      abortSignal: AbortSignal.timeout(10_000),
    });
    const summary = stripMarkdown(text ?? "").split("\n").filter(Boolean).slice(0, 5).join("\n");
    if (summary) await patchSession(session_id, () => ({ summary }));
  } catch (e) {
    console.warn("[chat] summary rewrite skipped:", e instanceof Error ? e.message : e);
  }
}
