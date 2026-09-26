import type { TranscriptRequest, TranscriptResponse, TranscriptTurn } from "@/lib/shared/types";
import { detectNudges } from "@/lib/memory/intentions";
import { ensureMind, mindFor, recordNudge } from "@/lib/memory/mind";
import { GOODBYE_RE, itemUuid } from "@/lib/server/call";
import { assessReactions } from "@/lib/server/brain/receptivity";
import { superviseTurn } from "@/lib/server/brain/supervisor";
import { db } from "@/lib/server/db";
import { activeBeliefs, insertEvent, insertMessage } from "@/lib/server/messages";
import { buildPrompt } from "@/lib/server/prompt";
import { getSession, isUuid, patchSession, touchActivity } from "@/lib/server/session";
import { nextBestAsk, turnOf } from "@/lib/server/state";

export const maxDuration = 30;

const isTurn = (t: unknown): t is TranscriptTurn =>
  !!t &&
  typeof t === "object" &&
  typeof (t as TranscriptTurn).item_id === "string" &&
  ((t as TranscriptTurn).role === "user" || (t as TranscriptTurn).role === "assistant") &&
  typeof (t as TranscriptTurn).text === "string";

/**
 * Persist final call transcript turns (channel = call), run the supervisor on user turns, and keep
 * the agent's mind current: each final assistant utterance is a turn (and may have raised an
 * intention), each user reply to something raised gets a receptivity score.
 * Idempotent per item_id; re-posting a turn neither duplicates the row nor re-runs the supervisor.
 */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as Partial<TranscriptRequest>;
  if (!isUuid(body.session_id)) return Response.json({ error: "session_id required" }, { status: 400 });
  const turns = (Array.isArray(body.turns) ? body.turns : []).filter(isTurn).filter((t) => t.final && t.text.trim().length > 0);
  let session = await getSession(body.session_id);
  if (!session) return Response.json({ error: "session not found" }, { status: 404 });

  const newUserTurns: string[] = [];
  const newAssistantTurns: string[] = [];
  let should_end = false;
  for (const turn of turns) {
    const client_id = itemUuid(session.id, turn.item_id);
    const { data: existing } = await db().from("messages").select("id").eq("session_id", session.id).eq("client_id", client_id).maybeSingle();
    if (turn.role === "assistant" && GOODBYE_RE.test(turn.text)) should_end = true;
    if (existing) continue;
    await insertMessage({
      session_id: session.id,
      role: turn.role,
      kind: "text",
      channel: "call",
      content: turn.text.trim(),
      payload: { item_id: turn.item_id, final: true },
      client_id,
    });
    if (turn.role === "user") newUserTurns.push(turn.text.trim());
    else newAssistantTurns.push(turn.text.trim());
  }

  if (session.call_state === "live") {
    // the call is evidently alive; keep lazy drop detection quiet even if the heartbeat was throttled
    session = await patchSession(session.id, () => ({ last_heartbeat_at: new Date().toISOString() }));
  }

  let patched = false;
  let mindMoved = false;
  let mind = await ensureMind(session.id, turnOf(session)).catch(() => undefined);

  // The user reacted to something I raised: score it (off the audio path, like the supervisor).
  if (newUserTurns.length && mind?.some((r) => r.status === "asked")) {
    const r = await assessReactions({ session, mind, userText: newUserTurns.join(" "), channel: "call" });
    mind = r.mind;
    mindMoved = mindMoved || r.assessed.length > 0;
  }

  if (newUserTurns.length) {
    await touchActivity(session.id);
    for (const text of newUserTurns) {
      const r = await superviseTurn(session, text);
      session = r.session;
      patched = patched || r.patched;
    }
  }

  // Each final assistant utterance is a turn; did it raise one of my intentions?
  if (newAssistantTurns.length) {
    const before = turnOf(session);
    session = await patchSession(session.id, (s) => ({ turn: turnOf(s) + newAssistantTurns.length }));
    if (mind) {
      const nba = nextBestAsk({ ...session, turn: before }, "call", mind);
      const fresh = (await mindFor(session.id).catch(() => mind)) ?? mind;
      for (const n of detectNudges(newAssistantTurns, fresh, nba.slot, "call")) {
        if (fresh.find((r) => r.key === n.key)?.status === "asked") continue;
        try {
          await recordNudge(session.id, { key: n.key, approach: n.approach, channel: "call", turn: turnOf(session), actor: "agent", evidence_ref: "call:transcript" });
          await insertEvent(session.id, "intention", { op: "nudge", key: n.key, approach: n.approach, turn: turnOf(session), via: "detected", channel: "call" });
          mindMoved = true;
        } catch (e) {
          console.warn("[transcript] nudge not recorded:", e instanceof Error ? e.message : e);
        }
      }
    }
  }

  const res: TranscriptResponse = { patched: patched || mindMoved, should_end };
  if (patched || mindMoved) {
    const [beliefs, current] = await Promise.all([activeBeliefs(session.id), mindFor(session.id).catch(() => mind)]);
    res.instructions = buildPrompt(session, "call", beliefs, current ?? undefined);
  }
  return Response.json(res);
}
