import { OFFER_CALL_KEY, tapbackReceptivity } from "@/lib/memory/intentions";
import { mindFor, recordOutcome } from "@/lib/memory/mind";
import type { ChatTrigger, MessageRow, SessionRow } from "@/lib/shared/types";
import { recordCallOfferAnswer } from "../callOffer";
import { insertEvent, listMessages } from "../messages";
import { turnOf } from "../state";

/**
 * A tapback as an answer (DESIGN §7.8, §13b). When the user reacts to the agent's most recent
 * question with a heart or a thumbs-up (yes) or a thumbs-down (no), the reaction is scored against
 * every intention currently `asked`, exactly as a spoken reply would be by the receptivity
 * assessor, and the chat is asked to act on it. Other glyphs, reactions on older bubbles and
 * reactions on the user's own messages are recorded but say nothing about an ask.
 */
const MAX_PER_TAPBACK = 2;

export interface TapbackReaction {
  chat_trigger?: ChatTrigger;
  reacted_key?: string;
}

export function targetOf(thread: MessageRow[], row: MessageRow): MessageRow | undefined {
  const p = row.payload ?? {};
  if (typeof p.target_id === "number") return thread.find((m) => m.id === p.target_id);
  if (typeof p.target_client_id === "string") return thread.find((m) => m.client_id === p.target_client_id);
  return undefined;
}

/** True when `target` is one of the assistant's bubbles in its latest burst (no user text since). */
export function inLatestBurst(thread: MessageRow[], target: MessageRow): boolean {
  if (target.role !== "assistant" || target.kind !== "text") return false;
  return !thread.some((m) => m.id > target.id && m.role === "user" && m.kind === "text" && m.channel === "text");
}

export async function reactToTapback(session: SessionRow, row: MessageRow): Promise<TapbackReaction> {
  const p = row.payload ?? {};
  if (p.by !== "user" || p.added === false) return {};
  const thread = await listMessages(session.id, { channel: "text" });
  const target = targetOf(thread, row);
  const read = tapbackReceptivity({ tapback: p.tapback, emoji: p.emoji });
  const onLatest = !!target && inLatestBurst(thread, target);
  if (!read || !onLatest) {
    await insertEvent(session.id, "receptivity", { source: "tapback", scored: false, tapback: p.tapback ?? p.emoji ?? null, on_latest: onLatest, key: null });
    return {};
  }
  const mind = await mindFor(session.id).catch(() => []);
  const asked = mind.filter((r) => r.status === "asked").slice(0, MAX_PER_TAPBACK);
  if (asked.length === 0) {
    await insertEvent(session.id, "receptivity", { source: "tapback", scored: false, tapback: p.tapback ?? p.emoji ?? null, on_latest: true, key: null, note: "nothing asked" });
    return {};
  }
  const turn = turnOf(session) + 1;
  for (const rec of asked) {
    try {
      if (rec.key === OFFER_CALL_KEY) {
        await recordCallOfferAnswer(session, read.receptivity >= 7 ? "yes" : "no", { via: "tapback", turn, evidence_ref: `tapback:${row.id}` });
      } else {
        await recordOutcome(session.id, { key: rec.key, receptivity: read.receptivity, signal: read.signal, note: read.note, turn, actor: "user", evidence_ref: `tapback:${row.id}` });
      }
      await insertEvent(session.id, "receptivity", { source: "tapback", scored: true, key: rec.key, receptivity: read.receptivity, signal: read.signal, note: read.note, approach: rec.last_approach, nudges: rec.nudges, channel: "text" });
    } catch (e) {
      console.warn("[tapback] outcome not recorded:", e instanceof Error ? e.message : e);
    }
  }
  return { chat_trigger: "tapback", reacted_key: asked[0].key };
}
