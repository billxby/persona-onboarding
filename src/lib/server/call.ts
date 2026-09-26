import { createHash } from "node:crypto";
import type { CallEventRequest, CallEventResponse, ChatTrigger, MessageRow, ServerCallState, SessionRow } from "@/lib/shared/types";
import { insertEvent, insertMessage, listEvents, markDropped } from "./messages";
import { getSession, patchSession } from "./session";
import { insertVoicemail } from "./voicemail";

/** Assistant transcript lines that mean "the call is over"; the client ends the call if no end_call follows within 3 s. */
export const GOODBYE_RE = /\b(bye|goodbye|talk soon|watch the chat|catch you later|i'?m on it)\b/i;

export type CallEndReason = "user_hangup" | "bot_hangup" | "declined" | "dropped" | "silence" | "mic_denied";
const END_REASONS: CallEndReason[] = ["user_hangup", "bot_hangup", "declined", "dropped", "silence", "mic_denied"];
export const isCallEndReason = (v: unknown): v is CallEndReason => typeof v === "string" && (END_REASONS as string[]).includes(v);

const OPEN_STATES: ServerCallState[] = ["ringing", "live"];
const isOpen = (s: SessionRow) => OPEN_STATES.includes(s.call_state);

export function formatCallDuration(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

export function callLogContent(reason: CallEndReason, durationMs: number): string {
  switch (reason) {
    case "declined":
      return "Missed call";
    case "dropped":
      return "Call dropped";
    case "mic_denied":
      return "Call failed · no microphone";
    case "silence":
    case "user_hangup":
    case "bot_hangup":
    default:
      return `Call ended · ${formatCallDuration(durationMs)}`;
  }
}

/** Deterministic uuid (v5-style layout) for a Realtime item id, so transcript turns upsert idempotently. */
export function itemUuid(session_id: string, item_id: string): string {
  const b = Buffer.from(createHash("sha1").update(`${session_id}:${item_id}`).digest().subarray(0, 16));
  b[6] = (b[6] & 0x0f) | 0x50;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = b.toString("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

const stateFor = (reason: CallEndReason): ServerCallState => (reason === "bot_hangup" ? "ended_by_bot" : "ended_by_user");
const prefersTextAfter = (reason: CallEndReason) => reason !== "bot_hangup";
const triggerFor = (reason: CallEndReason): ChatTrigger | undefined => {
  switch (reason) {
    case "declined":
      return "voicemail";
    case "silence":
      return "silence_end";
    case "dropped":
      return undefined; // markDropped already inserted the resume line
    default:
      return "call_ended";
  }
};

async function callDurationMs(session: SessionRow, hinted?: unknown): Promise<number> {
  if (typeof hinted === "number" && Number.isFinite(hinted) && hinted >= 0) return Math.round(hinted);
  const started = await listEvents(session.id, ["call_started"]);
  const last = started[started.length - 1];
  return last ? Math.max(0, Date.now() - new Date(last.created_at).getTime()) : 0;
}

async function endCall(session: SessionRow, reason: CallEndReason, payload: Record<string, unknown>): Promise<CallEventResponse> {
  if (reason === "dropped") {
    const r = await markDropped(session, "reload");
    return { session: r.session, messages: r.messages };
  }
  // Decline and mic-denied can arrive before a ring/start was recorded; other reasons need an open call.
  const lenient = reason === "declined" || reason === "mic_denied";
  const updated = await patchSession(session.id, (s) => {
    if (!isOpen(s) && !(lenient && s.call_state === "idle")) return null;
    return { call_state: stateFor(reason), channel_pref: prefersTextAfter(reason) ? "text" : s.channel_pref, last_heartbeat_at: null };
  });
  if (updated.call_state !== stateFor(reason) || updated.version === session.version) {
    // nothing changed: the call was already closed by an earlier request
    return { session: updated, messages: [] };
  }
  const duration_ms = reason === "declined" || reason === "mic_denied" ? 0 : await callDurationMs(session, payload.duration_ms);
  await insertEvent(session.id, "call_ended", { reason, duration_ms });
  const messages: MessageRow[] = [
    await insertMessage({ session_id: session.id, role: "system", kind: "call_log", content: callLogContent(reason, duration_ms), payload: { reason, duration_ms } }),
  ];
  if (reason === "declined") {
    const vm = await insertVoicemail(updated);
    if (vm) messages.push(vm);
  }
  return { session: updated, messages, chat_trigger: triggerFor(reason) };
}

export class SessionNotFound extends Error {
  constructor(id: string) {
    super(`Session ${id} not found`);
  }
}

/** Every call lifecycle event from the browser lands here (JSON or a pagehide beacon). */
export async function handleCallEvent(req: CallEventRequest): Promise<CallEventResponse> {
  const session = await getSession(req.session_id);
  if (!session) throw new SessionNotFound(req.session_id);
  const payload = req.payload ?? {};

  switch (req.type) {
    case "call_ringing": {
      const updated = await patchSession(session.id, (s) => (isOpen(s) ? null : { call_state: "ringing" }));
      if (updated.version !== session.version) await insertEvent(session.id, "call_ringing", {});
      return { session: updated, messages: [] };
    }
    case "call_started": {
      const updated = await patchSession(session.id, (s) => (s.call_state === "live" ? null : { call_state: "live", last_heartbeat_at: new Date().toISOString() }));
      if (updated.version !== session.version) await insertEvent(session.id, "call_started", { transport: payload.transport ?? "openai-realtime" });
      return { session: updated, messages: [] };
    }
    case "call_ended": {
      const reason = isCallEndReason(req.reason) ? req.reason : "user_hangup";
      return endCall(session, reason, payload);
    }
    case "call_dropped": {
      const r = await markDropped(session, "beacon");
      return { session: r.session, messages: r.messages };
    }
    case "silence_tier": {
      await insertEvent(session.id, "silence_tier", payload);
      return { session, messages: [] };
    }
    case "latency": {
      const ms = Number(payload.ms);
      if (Number.isFinite(ms) && ms >= 0) await insertEvent(session.id, "latency", { ms: Math.round(ms) });
      return { session, messages: [] };
    }
    case "mic_denied": {
      await insertEvent(session.id, "mic_denied", {});
      const updated = await patchSession(session.id, (s) => (s.channel_pref === "text" ? null : { channel_pref: "text" }));
      return { session: updated, messages: [] };
    }
    default:
      return { session, messages: [] };
  }
}

/** Heartbeat from a live call; lazy drop detection compares against this. */
export async function heartbeat(session_id: string): Promise<{ ok: boolean; call_state: ServerCallState | null }> {
  const session = await getSession(session_id);
  if (!session) return { ok: false, call_state: null };
  if (session.call_state !== "live") return { ok: true, call_state: session.call_state };
  await patchSession(session.id, () => ({ last_heartbeat_at: new Date().toISOString() }));
  return { ok: true, call_state: "live" };
}
