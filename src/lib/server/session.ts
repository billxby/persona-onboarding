import type { SessionRow } from "@/lib/shared/types";
import { db, isUniqueViolation } from "./db";

export class SessionConflict extends Error {
  constructor(id: string) {
    super(`Session ${id} was modified concurrently`);
  }
}

export const SESSION_COOKIE = "persona_sid";
export const sessionCookie = () => ({ name: SESSION_COOKIE, maxAge: 60 * 60 * 24 * 30, httpOnly: true, sameSite: "lax" as const, path: "/" });

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (v: unknown): v is string => typeof v === "string" && UUID.test(v);

/** Create a session; idempotent when the client proposes the id. */
export async function createSession(input: { id?: string; owner_uid?: string | null } = {}): Promise<SessionRow> {
  const row: Record<string, unknown> = {};
  if (input.id) row.id = input.id;
  if (input.owner_uid) row.owner_uid = input.owner_uid;
  const { data, error } = await db().from("sessions").insert(row).select().single();
  if (!error) return data as SessionRow;
  if (isUniqueViolation(error) && input.id) {
    const existing = await getSession(input.id);
    if (!existing) throw error;
    // adopt the owner if the row was created before the browser had an anonymous user
    if (input.owner_uid && !existing.owner_uid) {
      return patchSession(existing.id, () => ({ owner_uid: input.owner_uid ?? null }));
    }
    return existing;
  }
  throw error;
}

export async function getSession(id: string): Promise<SessionRow | null> {
  if (!isUuid(id)) return null;
  const { data, error } = await db().from("sessions").select().eq("id", id).maybeSingle();
  if (error) throw error;
  return (data as SessionRow | null) ?? null;
}

/**
 * Optimistic-concurrency update: `update ... where id = $1 and version = $expected`.
 * On a miss the caller's patch is re-applied to the fresh row once, then we give up.
 */
export async function updateSession(id: string, expectedVersion: number, patch: Partial<SessionRow>): Promise<SessionRow> {
  const attempt = async (version: number) => {
    const { data, error } = await db()
      .from("sessions")
      .update({ ...patch, version: version + 1, updated_at: new Date().toISOString() })
      .eq("id", id)
      .eq("version", version)
      .select()
      .maybeSingle();
    if (error) throw error;
    return (data as SessionRow | null) ?? null;
  };
  const first = await attempt(expectedVersion);
  if (first) return first;
  const fresh = await getSession(id);
  if (!fresh) throw new Error(`Session ${id} not found`);
  const second = await attempt(fresh.version);
  if (second) return second;
  throw new SessionConflict(id);
}

/** Load → compute patch → optimistic update, with one automatic retry on conflict. Return null from fn to skip. */
export async function patchSession(id: string, fn: (s: SessionRow) => Partial<SessionRow> | null): Promise<SessionRow> {
  for (let i = 0; i < 2; i++) {
    const s = await getSession(id);
    if (!s) throw new Error(`Session ${id} not found`);
    const patch = fn(s);
    if (!patch || Object.keys(patch).length === 0) return s;
    try {
      return await updateSession(id, s.version, patch);
    } catch (e) {
      if (!(e instanceof SessionConflict) || i === 1) throw e;
    }
  }
  throw new SessionConflict(id);
}

/** Reply lock for /api/chat: one generation per session at a time. Stale locks are reclaimed. */
export async function acquireReplyLock(id: string, staleMs = 45_000): Promise<boolean> {
  const stale = new Date(Date.now() - staleMs).toISOString();
  const { data, error } = await db()
    .from("sessions")
    .update({ responding_since: new Date().toISOString() })
    .eq("id", id)
    .or(`responding_since.is.null,responding_since.lt.${stale}`)
    .select("id");
  if (error) throw error;
  return (data?.length ?? 0) === 1;
}

export async function releaseReplyLock(id: string): Promise<void> {
  await db().from("sessions").update({ responding_since: null }).eq("id", id);
}

export async function touchActivity(id: string): Promise<void> {
  await db().from("sessions").update({ last_user_activity_at: new Date().toISOString() }).eq("id", id);
}
