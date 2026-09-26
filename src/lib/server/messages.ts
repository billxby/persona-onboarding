import type {
  EventRow,
  EventType,
  LatencyStats,
  MessageKind,
  MessagePayload,
  MessageRole,
  MessageRow,
  ServerChannel,
  SessionRow,
  SessionView,
} from "@/lib/shared/types";
import { mindFor } from "@/lib/memory/mind";
import { db, isUniqueViolation } from "./db";
import { getSession } from "./session";
import { nextBestAsk } from "./state";

export interface InsertMessageInput {
  session_id: string;
  role: MessageRole;
  kind?: MessageKind;
  content?: string | null;
  payload?: MessagePayload;
  channel?: ServerChannel;
  client_id?: string | null;
}

/** Insert a message. Idempotent on (session_id, client_id): a duplicate returns the existing row. */
export async function insertMessage(m: InsertMessageInput): Promise<MessageRow> {
  const row = {
    session_id: m.session_id,
    role: m.role,
    kind: m.kind ?? "text",
    content: m.content ?? null,
    payload: m.payload ?? {},
    channel: m.channel ?? "text",
    client_id: m.client_id ?? null,
  };
  const { data, error } = await db().from("messages").insert(row).select().single();
  if (!error) return data as MessageRow;
  if (isUniqueViolation(error) && m.client_id) {
    const { data: existing } = await db()
      .from("messages")
      .select()
      .eq("session_id", m.session_id)
      .eq("client_id", m.client_id)
      .single();
    if (existing) return existing as MessageRow;
  }
  throw error;
}

export async function listMessages(
  session_id: string,
  opts: { afterId?: number; channel?: ServerChannel; limit?: number } = {},
): Promise<MessageRow[]> {
  let q = db().from("messages").select().eq("session_id", session_id).order("id", { ascending: true }).limit(opts.limit ?? 500);
  if (opts.afterId) q = q.gt("id", opts.afterId);
  if (opts.channel) q = q.eq("channel", opts.channel);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as MessageRow[];
}

/**
 * Last N thread turns as the model should see them. Accepts a number (text channel only,
 * legacy) or `{ n, channels }` to include call transcript turns.
 */
export async function recentThread(
  session_id: string,
  opts: number | { n?: number; channels?: ServerChannel[] } = 12,
): Promise<MessageRow[]> {
  const n = typeof opts === "number" ? opts : (opts.n ?? 12);
  const channels = typeof opts === "number" ? ["text"] : (opts.channels ?? ["text"]);
  const { data, error } = await db()
    .from("messages")
    .select()
    .eq("session_id", session_id)
    .in("channel", channels)
    .in("role", ["user", "assistant", "system"])
    .order("id", { ascending: false })
    .limit(n);
  if (error) throw error;
  return ((data ?? []) as MessageRow[]).reverse();
}

export async function insertEvent(session_id: string, type: EventType | (string & {}), payload: Record<string, unknown> = {}): Promise<void> {
  const { error } = await db().from("events").insert({ session_id, type, payload });
  if (error) console.error("[events] insert failed", type, error.message);
}

export async function listEvents(session_id: string, types?: string[]): Promise<EventRow[]> {
  let q = db().from("events").select().eq("session_id", session_id).order("id", { ascending: true }).limit(2000);
  if (types?.length) q = q.in("type", types);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as EventRow[];
}

const pct = (sorted: number[], p: number) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))] : null);

/** Voice turn latency (user stop → first assistant audio) from `latency` events. */
export async function latencyStats(session_id: string): Promise<LatencyStats> {
  const rows = await listEvents(session_id, ["latency"]);
  const ms = rows.map((r) => Number((r.payload as { ms?: number }).ms)).filter((n) => Number.isFinite(n) && n >= 0).sort((a, b) => a - b);
  return { p50: pct(ms, 50), p95: pct(ms, 95), n: ms.length };
}

export const DROP_COPY = (name: string | null) => `Looks like we got cut off${name ? `, ${name}` : ""}. I kept everything. Want to keep going here?`;

/**
 * A live call whose heartbeat went quiet (or a beacon said so) is a drop: prefers text from now on,
 * gets a call_log row and the resume line within the same request. Idempotent.
 */
export async function markDropped(session: SessionRow, source: "beacon" | "heartbeat" | "reload" = "heartbeat"): Promise<{ session: SessionRow; messages: MessageRow[] }> {
  // Atomic flip: only the request that actually moves live/ringing → dropped inserts the follow-ups.
  const flip = async (version: number) => {
    const { data, error } = await db()
      .from("sessions")
      .update({ call_state: "dropped", channel_pref: "text", last_heartbeat_at: null, version: version + 1, updated_at: new Date().toISOString() })
      .eq("id", session.id)
      .eq("version", version)
      .in("call_state", ["live", "ringing"])
      .select()
      .maybeSingle();
    if (error) throw error;
    return (data as SessionRow | null) ?? null;
  };
  let updated = await flip(session.version);
  if (!updated) {
    const fresh = await getSession(session.id);
    if (!fresh) return { session, messages: [] };
    if (fresh.call_state !== "live" && fresh.call_state !== "ringing") return { session: fresh, messages: [] };
    updated = await flip(fresh.version);
    if (!updated) return { session: (await getSession(session.id)) ?? fresh, messages: [] };
  }
  await insertEvent(session.id, "hangup_detected", { source });
  const log = await insertMessage({ session_id: session.id, role: "system", kind: "call_log", content: "Call dropped", payload: { reason: "dropped" } });
  const resume = await insertMessage({ session_id: session.id, role: "assistant", kind: "text", content: DROP_COPY(updated.user_name) });
  await insertEvent(session.id, "resume", { reason: "dropped", ms_after_drop: 0 });
  return { session: updated, messages: [log, resume] };
}

const HEARTBEAT_GAP_MS = 10_000;

/** Lazy drop detection: called by any request that loads the session. */
export async function detectDrop(session: SessionRow): Promise<SessionRow> {
  if (session.call_state !== "live") return session;
  const last = session.last_heartbeat_at ? new Date(session.last_heartbeat_at).getTime() : 0;
  if (Date.now() - last <= HEARTBEAT_GAP_MS) return session;
  return (await markDropped(session, "heartbeat")).session;
}

export async function activeBeliefs(session_id: string) {
  const { data, error } = await db().from("beliefs").select().eq("session_id", session_id).eq("status", "active").order("updated_at", { ascending: true });
  if (error) throw error;
  return (data ?? []) as SessionView["beliefs"];
}

export async function allBeliefs(session_id: string) {
  const { data, error } = await db().from("beliefs").select().eq("session_id", session_id).order("updated_at", { ascending: true });
  if (error) throw error;
  return (data ?? []) as SessionView["beliefs"];
}

/** Everything the browser needs to (re)build its mirror. */
export async function sessionView(session_id: string, opts: { afterId?: number } = {}): Promise<SessionView | null> {
  let session = await getSession(session_id);
  if (!session) return null;
  session = await detectDrop(session);
  const [messages, beliefs, intentions, latency] = await Promise.all([listMessages(session_id, { afterId: opts.afterId }), allBeliefs(session_id), mindFor(session_id), latencyStats(session_id)]);
  return {
    session,
    messages,
    beliefs,
    intentions,
    next_best_ask: nextBestAsk(session, session.call_state === "live" ? "call" : "text", intentions),
    latency,
    realtime: !!session.owner_uid,
    now: new Date().toISOString(),
  };
}
