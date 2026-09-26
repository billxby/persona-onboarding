/**
 * Memory ledger: an append-only list of MemoryEvents folded into Beliefs by a
 * pure, deterministic function (DESIGN.md §13). No IO, no React, no server
 * imports: this file runs in unit tests, on the server and, if ever needed, in
 * the browser. Facts are never deleted, only re-statused with a reason.
 *
 * Trust ladder (fixed): oauth 1.0 → user_call / user_text 0.6 (+0.15 per
 * consistent restatement, cap 0.9) → agent_inference 0.3 (cap 0.5) →
 * gmail_body 0 (quarantined: candidate only until the user confirms).
 */
import type { Belief, BeliefStatus, MemoryActor, MemoryEvent, MemorySource } from "@/lib/shared/types";

export interface BeliefRecord {
  subject: string;
  predicate: string;
  object: string;
  confidence: number;
  status: BeliefStatus;
  reason: string | null;
  /** every memory_events.id that touched this belief, in order */
  evidence_ids: number[];
  /** trust of the strongest source that asserted this exact object */
  topTrust: number;
  topSource: MemorySource;
  /** actor of the strongest (most recent at that tier) evidence */
  actor: MemoryActor;
  /** ts of the last event that touched this record */
  updated_at: string;
  /** consistent restatements at the top-trust tier (drives the +0.15 steps) */
  restatements: number;
}

/** Keyed by `subject|predicate|object` (components with `|` or `\` are escaped). */
export type Beliefs = Map<string, BeliefRecord>;

const BASE: Record<MemorySource, number> = { oauth: 1.0, user_call: 0.6, user_text: 0.6, agent_inference: 0.3, gmail_body: 0 };
const CAP: Record<MemorySource, number> = { oauth: 1.0, user_call: 0.9, user_text: 0.9, agent_inference: 0.5, gmail_body: 0 };
const STEP = 0.15;

export const QUARANTINE_REASON = "untrusted email content; candidate only until the user confirms";
export const RETRACT_REASON = "user asked to forget";
export const RESOLVE_REASON = "user resolved";
export const PENDING_REASON = "conflicting equal-trust evidence; ask the user";

/** Base trust of a source. */
export function trust(source: MemorySource): number {
  return BASE[source] ?? 0;
}

export function trustCap(source: MemorySource): number {
  return CAP[source] ?? 0;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Confidence after `restatements` consistent restatements at the source's tier. */
export function confidenceFor(source: MemorySource, restatements: number): number {
  return round2(Math.min(trustCap(source), trust(source) + STEP * Math.max(0, restatements)));
}

const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/\|/g, "\\|");

export function beliefKey(subject: string, predicate: string, object: string): string {
  return `${esc(subject)}|${esc(predicate)}|${esc(object)}`;
}

const keyOf = (ev: Pick<MemoryEvent, "subject" | "predicate" | "object">) => beliefKey(ev.subject, ev.predicate, ev.object);

const sameTopic = (r: BeliefRecord, subject: string, predicate: string) => r.subject === subject && r.predicate === predicate;

/** The single active belief for (subject, predicate), if any. Insertion order is canonical. */
export function activeBelief(state: Beliefs, subject: string, predicate: string): BeliefRecord | undefined {
  for (const r of state.values()) if (r.status === "active" && sameTopic(r, subject, predicate)) return r;
  return undefined;
}

export function activeBeliefs(state: Beliefs): BeliefRecord[] {
  return [...state.values()].filter((r) => r.status === "active");
}

export function beliefsFor(state: Beliefs, subject: string, predicate: string): BeliefRecord[] {
  return [...state.values()].filter((r) => sameTopic(r, subject, predicate));
}

// ---------------------------------------------------------------------------
// merge helpers (all return new records; nothing is mutated)
// ---------------------------------------------------------------------------

type Core = Omit<BeliefRecord, "status" | "reason">;

/** A record (re)started by `ev`: top source is the event's, history is kept. */
function fresh(existing: BeliefRecord | undefined, ev: MemoryEvent): Core {
  return {
    subject: ev.subject,
    predicate: ev.predicate,
    object: ev.object,
    confidence: confidenceFor(ev.source, 0),
    evidence_ids: [...(existing?.evidence_ids ?? []), ev.id],
    topTrust: trust(ev.source),
    topSource: ev.source,
    actor: ev.actor,
    updated_at: ev.ts,
    restatements: 0,
  };
}

/** Consistent evidence added to an existing record: promote on higher trust, restate on equal, keep on lower. */
function accumulate(existing: BeliefRecord, ev: MemoryEvent): Core {
  const t = trust(ev.source);
  let { topTrust, topSource, restatements, actor } = existing;
  if (t > topTrust) {
    topTrust = t;
    topSource = ev.source;
    restatements = 0;
    actor = ev.actor;
  } else if (t === topTrust && t > 0) {
    restatements += 1;
  }
  return {
    subject: existing.subject,
    predicate: existing.predicate,
    object: existing.object,
    confidence: confidenceFor(topSource, restatements),
    evidence_ids: [...existing.evidence_ids, ev.id],
    topTrust,
    topSource,
    actor,
    updated_at: ev.ts,
    restatements,
  };
}

function quarantine(state: Beliefs, ev: MemoryEvent): Beliefs {
  const next = new Map(state);
  const key = keyOf(ev);
  const existing = state.get(key);
  if (!existing) {
    next.set(key, { ...fresh(undefined, ev), confidence: 0, topTrust: 0, status: "quarantined", reason: QUARANTINE_REASON });
  } else if (existing.status === "quarantined") {
    next.set(key, { ...existing, evidence_ids: [...existing.evidence_ids, ev.id], updated_at: ev.ts });
  } else {
    // never affects a belief the user or OAuth established: evidence is logged, nothing else moves
    next.set(key, { ...existing, evidence_ids: [...existing.evidence_ids, ev.id], updated_at: ev.ts });
  }
  return next;
}

function reinforce(state: Beliefs, ev: MemoryEvent, current: BeliefRecord | undefined): Beliefs {
  const next = new Map(state);
  const key = keyOf(ev);
  const existing = state.get(key);
  if (current && existing && current === existing) {
    next.set(key, { ...accumulate(existing, ev), status: "active", reason: null });
  } else {
    // no active belief on this topic: (re)start this object as the active one
    next.set(key, { ...fresh(existing, ev), status: "active", reason: null });
  }
  return next;
}

function supersede(state: Beliefs, current: BeliefRecord, ev: MemoryEvent, reason: string): Beliefs {
  const next = new Map(state);
  next.set(keyOf(current), { ...current, status: "superseded", reason, updated_at: ev.ts });
  const key = keyOf(ev);
  next.set(key, { ...fresh(state.get(key), ev), status: "active", reason: null });
  return next;
}

function contradict(state: Beliefs, ev: MemoryEvent, reason: string): Beliefs {
  const next = new Map(state);
  const key = keyOf(ev);
  const existing = state.get(key);
  const core = existing?.status === "contradicted" ? accumulate(existing, ev) : fresh(existing, ev);
  next.set(key, { ...core, status: "contradicted", reason });
  return next;
}

function markPending(state: Beliefs, current: BeliefRecord, ev: MemoryEvent): Beliefs {
  const next = new Map(state);
  next.set(keyOf(current), { ...current, status: "pending", reason: PENDING_REASON, updated_at: ev.ts });
  const key = keyOf(ev);
  next.set(key, { ...fresh(state.get(key), ev), status: "pending", reason: PENDING_REASON });
  return next;
}

function applyAssert(state: Beliefs, ev: MemoryEvent): Beliefs {
  if (ev.source === "gmail_body") return quarantine(state, ev);
  const current = activeBelief(state, ev.subject, ev.predicate);
  if (!current || current.object === ev.object) return reinforce(state, ev, current);
  const t = trust(ev.source);
  if (t > current.topTrust) return supersede(state, current, ev, `superseded by higher-trust evidence (${ev.source})`);
  if (t < current.topTrust) return contradict(state, ev, `conflicts with "${current.object}" (${current.topSource})`);
  if (ev.actor === current.actor) return supersede(state, current, ev, ev.actor === "user" ? "user changed their answer" : "restated");
  return markPending(state, current, ev);
}

function applyRetract(state: Beliefs, ev: MemoryEvent): Beliefs {
  const next = new Map(state);
  for (const [key, r] of state) {
    if (!sameTopic(r, ev.subject, ev.predicate)) continue;
    if (ev.object !== "*" && r.object !== ev.object) continue;
    next.set(key, { ...r, status: "retracted", reason: RETRACT_REASON, evidence_ids: [...r.evidence_ids, ev.id], updated_at: ev.ts });
  }
  return next;
}

function applyResolve(state: Beliefs, ev: MemoryEvent): Beliefs {
  const next = new Map(state);
  const chosenKey = keyOf(ev);
  for (const [key, r] of state) {
    if (!sameTopic(r, ev.subject, ev.predicate) || key === chosenKey || r.status === "retracted") continue;
    next.set(key, { ...r, status: "superseded", reason: RESOLVE_REASON, updated_at: ev.ts });
  }
  const chosen = state.get(chosenKey);
  if (chosen) {
    // the resolver's trust counts as evidence: a quarantined candidate the user picks becomes a user-level belief
    next.set(chosenKey, { ...accumulate(chosen, ev), status: "active", reason: null });
  } else {
    next.set(chosenKey, { ...fresh(undefined, ev), status: "active", reason: null });
  }
  return next;
}

/** Fold one event into the beliefs. Pure: returns a new Map; the input is never mutated. */
export function apply(state: Beliefs, ev: MemoryEvent): Beliefs {
  // Untrusted data never controls flow (CaMeL): email content can only ever add quarantined candidates.
  if (ev.source === "gmail_body" && ev.op !== "assert") return state;
  switch (ev.op) {
    case "assert":
      return applyAssert(state, ev);
    case "retract":
      return applyRetract(state, ev);
    case "resolve":
      return applyResolve(state, ev);
    default:
      return state;
  }
}

/** Replay the ledger. Events are sorted by id first, so input order never matters. */
export function replay(events: MemoryEvent[]): Beliefs {
  const sorted = [...events].sort((a, b) => a.id - b.id);
  let state: Beliefs = new Map();
  for (const ev of sorted) state = apply(state, ev);
  return state;
}

export interface ExplainStep {
  event: MemoryEvent;
  effect: string;
}

export interface Explanation {
  belief: BeliefRecord | null;
  candidates: BeliefRecord[];
  chain: ExplainStep[];
}

const describe = (r: BeliefRecord) => `"${r.object}" ${r.status}${r.status === "active" ? ` ${r.confidence}` : ""}`;

/** The evidence chain for (subject, predicate): every event that touched it and what it did. */
export function explain(state: Beliefs, events: MemoryEvent[], subject: string, predicate: string): Explanation {
  const sorted = [...events].sort((a, b) => a.id - b.id);
  const chain: ExplainStep[] = [];
  let cur: Beliefs = new Map();
  for (const ev of sorted) {
    const before = cur;
    cur = apply(cur, ev);
    if (ev.subject !== subject || ev.predicate !== predicate) continue;
    const changed: string[] = [];
    for (const [key, after] of cur) {
      if (!sameTopic(after, subject, predicate)) continue;
      const prev = before.get(key);
      if (!prev) changed.push(`+ ${describe(after)}${after.reason ? ` (${after.reason})` : ""}`);
      else if (prev.status !== after.status || prev.confidence !== after.confidence) changed.push(`${describe(prev)} → ${describe(after)}${after.reason ? ` (${after.reason})` : ""}`);
      else if (prev.evidence_ids.length !== after.evidence_ids.length) changed.push(`evidence logged on ${describe(after)}`);
    }
    chain.push({ event: ev, effect: `${ev.op} "${ev.object}" via ${ev.source}: ${changed.length ? changed.join("; ") : "no change"}` });
  }
  return {
    belief: activeBelief(state, subject, predicate) ?? null,
    candidates: beliefsFor(state, subject, predicate),
    chain,
  };
}

/** DB row projection of the beliefs (updated_at = ts of the last evidence event). */
export function toBeliefRows(session_id: string, state: Beliefs): Belief[] {
  return [...state.values()].map((r) => ({
    session_id,
    subject: r.subject,
    predicate: r.predicate,
    object: r.object,
    confidence: r.confidence,
    status: r.status,
    reason: r.reason,
    evidence_ids: [...r.evidence_ids],
    updated_at: r.updated_at,
  }));
}

/** Canonical actor for a source, for callers that don't track actors themselves. */
export function actorFor(source: MemorySource): MemoryActor {
  switch (source) {
    case "oauth":
      return "system";
    case "gmail_body":
      return "gmail";
    case "agent_inference":
      return "agent";
    default:
      return "user";
  }
}
