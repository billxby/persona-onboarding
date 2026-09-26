/**
 * Server-side persistence for the intentions ledger (DESIGN.md §13b): append
 * `intention_events`, replay them, keep `intentions` as the projection cache.
 * Mirrors ./store.ts for beliefs. Callers validate inputs first.
 */
import { db } from "@/lib/server/db";
import type { Intention, IntentionActor, IntentionEvent, IntentionPayload, ReceptivitySignal, ServerChannel } from "@/lib/shared/types";
import { BUILTIN_INTENTIONS, replayMind, seedPayload, toIntentionRows } from "./intentions";

export type NewIntentionEvent = Omit<IntentionEvent, "id" | "ts">;

export async function appendIntentionEvent(ev: NewIntentionEvent): Promise<IntentionEvent> {
  const { data, error } = await db().from("intention_events").insert(ev).select().single();
  if (error) throw error;
  return data as IntentionEvent;
}

export async function loadIntentionEvents(session_id: string): Promise<IntentionEvent[]> {
  const { data, error } = await db().from("intention_events").select().eq("session_id", session_id).order("id", { ascending: true }).limit(5000);
  if (error) throw error;
  return (data ?? []) as IntentionEvent[];
}

/** replay(intention_events) → upsert into `intentions`. Rows never vanish from this projection. */
export async function projectMind(session_id: string): Promise<Intention[]> {
  const events = await loadIntentionEvents(session_id);
  const rows = toIntentionRows(session_id, replayMind(events));
  if (rows.length) {
    const { error } = await db().from("intentions").upsert(rows, { onConflict: "session_id,key" });
    if (error) throw error;
  }
  return rows;
}

/** The projection, priority order. */
export async function mindFor(session_id: string): Promise<Intention[]> {
  const { data, error } = await db().from("intentions").select().eq("session_id", session_id).order("priority", { ascending: true }).order("key", { ascending: true });
  if (error) throw error;
  return (data ?? []) as Intention[];
}

/** Seed the built-in intentions once per session (idempotent: a second `open` on an open key changes nothing). */
export async function ensureMind(session_id: string, turn = 0): Promise<Intention[]> {
  const existing = await mindFor(session_id);
  const have = new Set(existing.map((r) => r.key));
  const missing = BUILTIN_INTENTIONS.filter((b) => !have.has(b.key));
  if (missing.length === 0) return existing;
  const { error } = await db()
    .from("intention_events")
    .insert(missing.map((b) => ({ session_id, key: b.key, op: "open", actor: "system", turn, payload: seedPayload(b), evidence_ref: "seed" })));
  if (error) throw error;
  return projectMind(session_id);
}

interface Write {
  key: string;
  actor?: IntentionActor;
  turn: number;
  evidence_ref?: string | null;
}

async function write(session_id: string, op: IntentionEvent["op"], w: Write, payload: IntentionPayload): Promise<Intention[]> {
  await appendIntentionEvent({ session_id, key: w.key, op, actor: w.actor ?? "system", turn: w.turn, payload, evidence_ref: w.evidence_ref ?? null });
  return projectMind(session_id);
}

/** The agent brought it up (a question in the reply, the link card, ...). */
export const recordNudge = (session_id: string, w: Write & { approach: string; channel: ServerChannel }) => write(session_id, "nudge", w, { approach: w.approach, channel: w.channel });

/** How the user took it: 0 shut it down … 10 yes. Skipped when this turn already has an outcome for the key. */
export async function recordOutcome(session_id: string, w: Write & { receptivity: number; signal?: ReceptivitySignal; note?: string }): Promise<Intention[]> {
  const current = (await mindFor(session_id)).find((r) => r.key === w.key);
  if (current && current.last_outcome_turn === w.turn && current.status !== "asked") return mindFor(session_id);
  return write(session_id, "outcome", w, { receptivity: w.receptivity, signal: w.signal, note: w.note });
}

export const openIntention = (session_id: string, w: Write & IntentionPayload) => write(session_id, "open", w, { goal: w.goal, slot: w.slot, sticky: w.sticky, priority: w.priority, channels: w.channels });
export const deferIntention = (session_id: string, w: Write & { turns?: number; ms?: number; reason?: string }) => write(session_id, "defer", w, { turns: w.turns, ms: w.ms, reason: w.reason });
export const completeIntention = (session_id: string, w: Write & { reason?: string }) => write(session_id, "done", w, { reason: w.reason });
export const dropIntention = (session_id: string, w: Write & { reason?: string }) => write(session_id, "drop", w, { reason: w.reason });
export const reopenIntention = (session_id: string, w: Write & { reason?: string }) => write(session_id, "reopen", w, { reason: w.reason });

/** Idempotent "this is settled now": no-op when already done. */
export async function settleIfOpen(session_id: string, w: Write & { reason?: string }): Promise<Intention[]> {
  const rows = await mindFor(session_id);
  const cur = rows.find((r) => r.key === w.key);
  if (cur && (cur.status === "done" || cur.status === "dropped")) return rows;
  return completeIntention(session_id, w);
}
