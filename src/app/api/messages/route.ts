import { z } from "zod";
import { reactToTapback } from "@/lib/server/brain/tapback";
import { detectDrop, insertEvent, insertMessage } from "@/lib/server/messages";
import { getSession, touchActivity } from "@/lib/server/session";
import type { MessagePayload, PostMessageResponse } from "@/lib/shared/types";

const Body = z.object({
  session_id: z.string().uuid(),
  client_id: z.string().uuid(),
  text: z.string().max(4000).default(""),
  kind: z.enum(["text", "tapback"]).default("text"),
  payload: z.record(z.string(), z.unknown()).optional(),
  reply_to_client_id: z.string().uuid().optional(),
});

/**
 * POST /api/messages — persist a user bubble (or tapback) immediately. The reply itself is
 * requested separately via POST /api/chat after the client-side debounce. A tapback on the
 * agent's last question is read as its answer (see brain/tapback.ts) and the response says so.
 */
export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "bad_request", issues: parsed.error.issues }, { status: 400 });
  const { session_id, client_id, kind, payload, reply_to_client_id } = parsed.data;
  const text = parsed.data.text.trim();
  if (kind === "text" && !text) return Response.json({ error: "empty_text" }, { status: 400 });

  let session = await getSession(session_id);
  if (!session) return Response.json({ error: "not_found" }, { status: 404 });

  if (kind === "tapback") {
    const message = await insertMessage({
      session_id,
      client_id,
      role: "user",
      kind: "tapback",
      content: text || null,
      payload: (payload ?? {}) as MessagePayload,
      channel: "text",
    });
    const reaction = await reactToTapback(session, message).catch((e) => {
      console.warn("[messages] tapback not read:", e instanceof Error ? e.message : e);
      return {};
    });
    const res: PostMessageResponse = { message, call_live: false, ...reaction };
    return Response.json(res);
  }

  const message = await insertMessage({
    session_id,
    client_id,
    role: "user",
    kind: "text",
    content: text,
    payload: reply_to_client_id ? { reply_to_client_id } : {},
    channel: "text",
  });
  await touchActivity(session_id);
  session = await detectDrop(session);
  const call_live = session.call_state === "live";
  if (call_live) await insertEvent(session_id, "text_during_call", { client_id, chars: text.length });

  const res: PostMessageResponse = { message, call_live };
  return Response.json(res);
}
