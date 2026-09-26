import type { CallEventRequest, CallEventType } from "@/lib/shared/types";
import { handleCallEvent, SessionNotFound } from "@/lib/server/call";
import { isUuid } from "@/lib/server/session";

const TYPES: CallEventType[] = ["call_ringing", "call_started", "call_ended", "call_dropped", "silence_tier", "latency", "mic_denied"];

/** Call lifecycle events. Accepts JSON or a text/plain body (navigator.sendBeacon on pagehide). */
export async function POST(req: Request) {
  let body: Partial<CallEventRequest>;
  try {
    body = JSON.parse(await req.text()) as Partial<CallEventRequest>;
  } catch {
    return Response.json({ error: "invalid body" }, { status: 400 });
  }
  if (!isUuid(body.session_id)) return Response.json({ error: "session_id required" }, { status: 400 });
  if (!body.type || !TYPES.includes(body.type)) return Response.json({ error: "unknown event type" }, { status: 400 });
  try {
    const res = await handleCallEvent({
      session_id: body.session_id,
      type: body.type,
      reason: typeof body.reason === "string" ? body.reason : undefined,
      payload: body.payload && typeof body.payload === "object" ? body.payload : undefined,
    });
    return Response.json(res);
  } catch (e) {
    if (e instanceof SessionNotFound) return Response.json({ error: "session not found" }, { status: 404 });
    console.error("[call/event] failed", e);
    return Response.json({ error: e instanceof Error ? e.message : "call event failed" }, { status: 500 });
  }
}
