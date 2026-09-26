/**
 * Server-side persistence for the memory ledger: append events, replay them,
 * and keep the `beliefs` table as a projection cache. Everything goes through
 * the service-role client; callers validate inputs first.
 */
import { db } from "@/lib/server/db";
import type { Belief, MemoryActor, MemoryEvent, MemorySource } from "@/lib/shared/types";
import { actorFor, explain, replay, toBeliefRows, type Explanation } from "./ledger";

export type NewMemoryEvent = Omit<MemoryEvent, "id" | "ts">;

export async function appendMemoryEvent(ev: NewMemoryEvent): Promise<MemoryEvent> {
  const { data, error } = await db().from("memory_events").insert(ev).select().single();
  if (error) throw error;
  return data as MemoryEvent;
}

export async function loadMemoryEvents(session_id: string): Promise<MemoryEvent[]> {
  const { data, error } = await db().from("memory_events").select().eq("session_id", session_id).order("id", { ascending: true }).limit(5000);
  if (error) throw error;
  return (data ?? []) as MemoryEvent[];
}

/** replay(memory_events) → upsert into `beliefs`; rows that vanished from the projection are removed. */
export async function projectBeliefs(session_id: string): Promise<Belief[]> {
  const events = await loadMemoryEvents(session_id);
  const rows = toBeliefRows(session_id, replay(events));
  if (rows.length) {
    const { error } = await db().from("beliefs").upsert(rows, { onConflict: "session_id,subject,predicate,object" });
    if (error) throw error;
  }
  const { data: existing, error: selErr } = await db().from("beliefs").select("subject,predicate,object").eq("session_id", session_id);
  if (selErr) throw selErr;
  const keep = new Set(rows.map((r) => `${r.subject}\u0000${r.predicate}\u0000${r.object}`));
  const stale = ((existing ?? []) as Pick<Belief, "subject" | "predicate" | "object">[]).filter((r) => !keep.has(`${r.subject}\u0000${r.predicate}\u0000${r.object}`));
  for (const r of stale) {
    const { error } = await db().from("beliefs").delete().match({ session_id, subject: r.subject, predicate: r.predicate, object: r.object });
    if (error) throw error;
  }
  return rows;
}

export async function activeBeliefsFor(session_id: string): Promise<Belief[]> {
  const { data, error } = await db().from("beliefs").select().eq("session_id", session_id).eq("status", "active").order("updated_at", { ascending: true });
  if (error) throw error;
  return (data ?? []) as Belief[];
}

export async function allBeliefsFor(session_id: string): Promise<Belief[]> {
  const { data, error } = await db().from("beliefs").select().eq("session_id", session_id).order("updated_at", { ascending: true });
  if (error) throw error;
  return (data ?? []) as Belief[];
}

export async function explainBelief(session_id: string, subject: string, predicate: string): Promise<Explanation> {
  const events = await loadMemoryEvents(session_id);
  return explain(replay(events), events, subject, predicate);
}

export interface FactInput {
  predicate: string;
  object: string;
  source: MemorySource;
  actor?: MemoryActor;
  evidence_ref?: string | null;
  subject?: string;
}

/** Append an assert for the user and re-project. Returns the full projection. */
export async function assertFact(session_id: string, f: FactInput): Promise<Belief[]> {
  await appendMemoryEvent({
    session_id,
    actor: f.actor ?? actorFor(f.source),
    op: "assert",
    subject: f.subject ?? "user",
    predicate: f.predicate,
    object: f.object,
    source: f.source,
    evidence_ref: f.evidence_ref ?? null,
  });
  return projectBeliefs(session_id);
}

/** "Forget that": retract one object, or every belief on the predicate with object "*". */
export async function retractFact(session_id: string, f: { predicate: string; object?: string; source?: MemorySource; subject?: string; evidence_ref?: string | null }): Promise<Belief[]> {
  const source = f.source ?? "user_text";
  await appendMemoryEvent({
    session_id,
    actor: actorFor(source),
    op: "retract",
    subject: f.subject ?? "user",
    predicate: f.predicate,
    object: f.object ?? "*",
    source,
    evidence_ref: f.evidence_ref ?? null,
  });
  return projectBeliefs(session_id);
}

/** Settle an equal-trust conflict: the named object becomes the active belief. */
export async function resolveFact(session_id: string, f: { predicate: string; object: string; source?: MemorySource; subject?: string; evidence_ref?: string | null }): Promise<Belief[]> {
  const source = f.source ?? "user_text";
  await appendMemoryEvent({
    session_id,
    actor: actorFor(source),
    op: "resolve",
    subject: f.subject ?? "user",
    predicate: f.predicate,
    object: f.object,
    source,
    evidence_ref: f.evidence_ref ?? null,
  });
  return projectBeliefs(session_id);
}
