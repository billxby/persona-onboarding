import type { TranscriptRequest, TranscriptResponse, TranscriptTurn } from "@/lib/shared/types";
import { GOODBYE_RE, itemUuid } from "@/lib/server/call";
import { superviseTurn } from "@/lib/server/brain/supervisor";
import { db } from "@/lib/server/db";
import { activeBeliefs, insertMessage } from "@/lib/server/messages";
import { buildPrompt } from "@/lib/server/prompt";
import { getSession, isUuid, patchSession, touchActivity } from "@/lib/server/session";

export const maxDuration = 30;

const isTurn = (t: unknown): t is TranscriptTurn =>
  !!t &&
  typeof t === "object" &&
  typeof (t as TranscriptTurn).item_id === "string" &&
  ((t as TranscriptTurn).role === "user" || (t as TranscriptTurn).role === "assistant") &&
  typeof (t as TranscriptTurn).text === "string";

/**
 * Persist final call transcript turns (channel = call) and run the supervisor on user turns.
 * Idempotent per item_id; re-posting a turn neither duplicates the row nor re-runs the supervisor.
 */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as Partial<TranscriptRequest>;
  if (!isUuid(body.session_id)) return Response.json({ error: "session_id required" }, { status: 400 });
  const turns = (Array.isArray(body.turns) ? body.turns : []).filter(isTurn).filter((t) => t.final && t.text.trim().length > 0);
  let session = await getSession(body.session_id);
  if (!session) return Response.json({ error: "session not found" }, { status: 404 });

  const newUserTurns: string[] = [];
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
  }

  if (session.call_state === "live") {
    // the call is evidently alive; keep lazy drop detection quiet even if the heartbeat was throttled
    session = await patchSession(session.id, () => ({ last_heartbeat_at: new Date().toISOString() }));
  }

  let patched = false;
  if (newUserTurns.length) {
    await touchActivity(session.id);
    for (const text of newUserTurns) {
      const r = await superviseTurn(session, text);
      session = r.session;
      patched = patched || r.patched;
    }
  }

  const res: TranscriptResponse = { patched, should_end };
  if (patched) res.instructions = await buildPrompt(session, "call", await activeBeliefs(session.id));
  return Response.json(res);
}
