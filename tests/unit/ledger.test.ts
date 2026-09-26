import { beforeEach, describe, expect, it } from "vitest";
import {
  activeBelief,
  activeBeliefs,
  apply,
  beliefKey,
  beliefsFor,
  confidenceFor,
  explain,
  PENDING_REASON,
  QUARANTINE_REASON,
  replay,
  RESOLVE_REASON,
  RETRACT_REASON,
  toBeliefRows,
  trust,
  trustCap,
  type Beliefs,
} from "@/lib/memory/ledger";
import type { MemoryActor, MemoryEvent, MemoryOp, MemorySource } from "@/lib/shared/types";

const SID = "00000000-0000-0000-0000-000000000001";
let nextId = 1;

const ACTOR_FOR: Record<MemorySource, MemoryActor> = { oauth: "system", user_call: "user", user_text: "user", agent_inference: "agent", gmail_body: "gmail" };

function ev(partial: Partial<MemoryEvent> & { object: string; source: MemorySource }): MemoryEvent {
  const id = partial.id ?? nextId++;
  return {
    id,
    session_id: SID,
    ts: partial.ts ?? new Date(Date.UTC(2026, 8, 26, 0, 0, id)).toISOString(),
    actor: partial.actor ?? ACTOR_FOR[partial.source],
    op: partial.op ?? "assert",
    subject: partial.subject ?? "user",
    predicate: partial.predicate ?? "name",
    object: partial.object,
    source: partial.source,
    evidence_ref: partial.evidence_ref ?? null,
  };
}

beforeEach(() => {
  nextId = 1;
});

const fold = (events: MemoryEvent[]): Beliefs => events.reduce((s, e) => apply(s, e), new Map());
const active = (s: Beliefs, predicate = "name") => activeBelief(s, "user", predicate);
const byObject = (s: Beliefs, object: string, predicate = "name") => s.get(beliefKey("user", predicate, object));

describe("trust ladder", () => {
  it("has the fixed base values", () => {
    expect(trust("oauth")).toBe(1.0);
    expect(trust("user_call")).toBe(0.6);
    expect(trust("user_text")).toBe(0.6);
    expect(trust("agent_inference")).toBe(0.3);
    expect(trust("gmail_body")).toBe(0);
  });
  it("caps consistent restatements", () => {
    expect(confidenceFor("user_text", 0)).toBe(0.6);
    expect(confidenceFor("user_text", 1)).toBe(0.75);
    expect(confidenceFor("user_text", 2)).toBe(0.9);
    expect(confidenceFor("user_text", 5)).toBe(0.9);
    expect(confidenceFor("agent_inference", 0)).toBe(0.3);
    expect(confidenceFor("agent_inference", 1)).toBe(0.45);
    expect(confidenceFor("agent_inference", 2)).toBe(0.5);
    expect(confidenceFor("oauth", 3)).toBe(1.0);
    expect(confidenceFor("gmail_body", 3)).toBe(0);
    expect(trustCap("user_call")).toBe(0.9);
  });
});

describe("reinforce", () => {
  it("first assert creates an active belief at base confidence", () => {
    const s = fold([ev({ object: "Bill", source: "user_text" })]);
    const b = active(s)!;
    expect(b.status).toBe("active");
    expect(b.confidence).toBe(0.6);
    expect(b.topSource).toBe("user_text");
    expect(b.evidence_ids).toEqual([1]);
  });
  it("consistent restatements add +0.15 up to the cap and keep the evidence chain", () => {
    const s = fold([
      ev({ object: "Bill", source: "user_text" }),
      ev({ object: "Bill", source: "user_call" }),
      ev({ object: "Bill", source: "user_text" }),
      ev({ object: "Bill", source: "user_text" }),
    ]);
    const b = active(s)!;
    expect(b.confidence).toBe(0.9);
    expect(b.evidence_ids.length).toBe(4);
    expect(s.size).toBe(1);
  });
  it("higher-trust consistent evidence promotes the source and resets to its base", () => {
    const s = fold([ev({ object: "Bill", source: "user_text" }), ev({ object: "Bill", source: "user_text" }), ev({ object: "Bill", source: "oauth" })]);
    const b = active(s)!;
    expect(b.topSource).toBe("oauth");
    expect(b.confidence).toBe(1.0);
  });
  it("lower-trust consistent evidence only adds evidence", () => {
    const s = fold([ev({ object: "Bill", source: "oauth" }), ev({ object: "Bill", source: "agent_inference" })]);
    const b = active(s)!;
    expect(b.confidence).toBe(1.0);
    expect(b.topSource).toBe("oauth");
    expect(b.evidence_ids).toEqual([1, 2]);
  });
});

describe("supersede / contradict / pending", () => {
  it("higher trust supersedes with a reason; the old fact is kept", () => {
    const s = fold([ev({ object: "Bill", source: "user_text" }), ev({ object: "William Xu", source: "oauth" })]);
    expect(active(s)!.object).toBe("William Xu");
    const old = byObject(s, "Bill")!;
    expect(old.status).toBe("superseded");
    expect(old.reason).toBe("superseded by higher-trust evidence (oauth)");
    expect(s.size).toBe(2);
  });
  it("lower trust is recorded as contradicted and leaves the active belief untouched", () => {
    const s = fold([ev({ object: "Bill", source: "oauth" }), ev({ object: "Robert", source: "agent_inference" })]);
    expect(active(s)!.object).toBe("Bill");
    const c = byObject(s, "Robert")!;
    expect(c.status).toBe("contradicted");
    expect(c.reason).toBe('conflicts with "Bill" (oauth)');
    expect(c.confidence).toBe(0.3);
  });
  it("the user changing their own answer supersedes (same actor, equal trust)", () => {
    const s = fold([ev({ object: "Bill", source: "user_call" }), ev({ object: "Will", source: "user_text" })]);
    expect(active(s)!.object).toBe("Will");
    expect(byObject(s, "Bill")!.status).toBe("superseded");
    expect(byObject(s, "Bill")!.reason).toBe("user changed their answer");
  });
  it("equal trust from different actors marks both pending until resolved", () => {
    const s = fold([ev({ object: "Bill", source: "oauth", actor: "system" }), ev({ object: "William", source: "oauth", actor: "user" })]);
    expect(active(s)).toBeUndefined();
    expect(byObject(s, "Bill")!.status).toBe("pending");
    expect(byObject(s, "William")!.status).toBe("pending");
    expect(byObject(s, "William")!.reason).toBe(PENDING_REASON);
  });
  it("a restatement of a pending value by the same actor makes it active again", () => {
    const s = fold([
      ev({ object: "Bill", source: "oauth", actor: "system" }),
      ev({ object: "William", source: "oauth", actor: "user" }),
      ev({ object: "Bill", source: "user_text" }),
    ]);
    expect(active(s)!.object).toBe("Bill");
    expect(byObject(s, "William")!.status).toBe("pending");
  });
});

describe("quarantine (poisoned email)", () => {
  it("gmail_body never becomes active and never changes an existing user belief", () => {
    const s = fold([ev({ object: "Bill", source: "user_text" }), ev({ object: "Admin", source: "gmail_body" })]);
    expect(active(s)!.object).toBe("Bill");
    expect(active(s)!.confidence).toBe(0.6);
    const q = byObject(s, "Admin")!;
    expect(q.status).toBe("quarantined");
    expect(q.confidence).toBe(0);
    expect(q.reason).toBe(QUARANTINE_REASON);
    expect(activeBeliefs(s).map((b) => b.object)).toEqual(["Bill"]);
  });
  it("gmail_body alone never creates an active belief, even repeated", () => {
    const s = fold([ev({ object: "Admin", source: "gmail_body" }), ev({ object: "Admin", source: "gmail_body" })]);
    expect(active(s)).toBeUndefined();
    expect(byObject(s, "Admin")!.status).toBe("quarantined");
    expect(byObject(s, "Admin")!.evidence_ids).toEqual([1, 2]);
  });
  it("gmail_body agreeing with an active belief only logs evidence", () => {
    const s = fold([ev({ object: "Bill", source: "user_text" }), ev({ object: "Bill", source: "gmail_body" })]);
    const b = active(s)!;
    expect(b.confidence).toBe(0.6);
    expect(b.status).toBe("active");
    expect(b.evidence_ids).toEqual([1, 2]);
  });
  it("a quarantined candidate becomes active once the user confirms it", () => {
    const s = fold([ev({ object: "Bill", source: "gmail_body" }), ev({ object: "Bill", source: "user_call" })]);
    const b = active(s)!;
    expect(b.object).toBe("Bill");
    expect(b.confidence).toBe(0.6);
    expect(b.topSource).toBe("user_call");
    expect(b.evidence_ids).toEqual([1, 2]);
  });
});

describe("retract and resolve", () => {
  it("retract by object", () => {
    const s = fold([ev({ object: "Bill", source: "user_text" }), ev({ op: "retract", object: "Bill", source: "user_text" })]);
    expect(active(s)).toBeUndefined();
    const r = byObject(s, "Bill")!;
    expect(r.status).toBe("retracted");
    expect(r.reason).toBe(RETRACT_REASON);
    expect(r.evidence_ids).toEqual([1, 2]);
  });
  it("retract with '*' forgets every belief on the topic and nothing else", () => {
    const s = fold([
      ev({ object: "Bill", source: "user_text" }),
      ev({ object: "William", source: "oauth" }),
      ev({ predicate: "need", object: "cancel gym", source: "user_text" }),
      ev({ op: "retract", object: "*", source: "user_text" }),
    ]);
    expect(beliefsFor(s, "user", "name").every((b) => b.status === "retracted")).toBe(true);
    expect(active(s, "need")!.object).toBe("cancel gym");
  });
  it("retract and resolve coming from email content are ignored", () => {
    const base = fold([ev({ object: "Bill", source: "user_text" })]);
    expect(apply(base, ev({ op: "retract", object: "*", source: "gmail_body" }))).toEqual(base);
    expect(apply(base, ev({ op: "resolve", object: "Admin", source: "gmail_body" }))).toEqual(base);
  });
  it("retracting an unknown fact is a no-op", () => {
    const base = fold([ev({ object: "Bill", source: "user_text" })]);
    const s = apply(base, ev({ op: "retract", object: "Nobody", source: "user_text" }));
    expect(s).toEqual(base);
  });
  it("resolve picks the named object and supersedes the rest", () => {
    const s = fold([
      ev({ object: "Bill", source: "oauth", actor: "system" }),
      ev({ object: "William", source: "oauth", actor: "user" }),
      ev({ op: "resolve", object: "William", source: "user_text" }),
    ]);
    const w = active(s)!;
    expect(w.object).toBe("William");
    expect(w.confidence).toBe(1.0);
    expect(byObject(s, "Bill")!.status).toBe("superseded");
    expect(byObject(s, "Bill")!.reason).toBe(RESOLVE_REASON);
  });
  it("resolving to a quarantined candidate confirms it at the resolver's trust", () => {
    const s = fold([ev({ object: "Bill", source: "user_text" }), ev({ object: "Admin", source: "gmail_body" }), ev({ op: "resolve", object: "Admin", source: "user_text" })]);
    const a = active(s)!;
    expect(a.object).toBe("Admin");
    expect(a.topSource).toBe("user_text");
    expect(a.confidence).toBe(0.6);
    expect(byObject(s, "Bill")!.status).toBe("superseded");
  });
  it("resolve to an object nobody asserted creates it from the resolve event", () => {
    const s = fold([ev({ object: "Bill", source: "user_text" }), ev({ op: "resolve", object: "Billy", source: "user_call" })]);
    expect(active(s)!.object).toBe("Billy");
    expect(active(s)!.confidence).toBe(0.6);
    expect(byObject(s, "Bill")!.status).toBe("superseded");
  });
  it("a fact re-asserted after being retracted becomes active again from scratch", () => {
    const s = fold([
      ev({ object: "Bill", source: "user_text" }),
      ev({ object: "Bill", source: "user_text" }),
      ev({ op: "retract", object: "*", source: "user_text" }),
      ev({ object: "Bill", source: "user_text" }),
    ]);
    expect(active(s)!.object).toBe("Bill");
    expect(active(s)!.confidence).toBe(0.6);
    expect(active(s)!.evidence_ids).toEqual([1, 2, 3, 4]);
  });
});

describe("invariants and explain", () => {
  it("apply never mutates its input", () => {
    const base = fold([ev({ object: "Bill", source: "user_text" })]);
    const snapshot = JSON.stringify([...base.entries()]);
    apply(base, ev({ object: "William", source: "oauth" }));
    apply(base, ev({ op: "retract", object: "*", source: "user_text" }));
    expect(JSON.stringify([...base.entries()])).toBe(snapshot);
  });
  it("never deletes a fact, only re-statuses it", () => {
    const events = [
      ev({ object: "Bill", source: "user_text" }),
      ev({ object: "William", source: "oauth" }),
      ev({ object: "Admin", source: "gmail_body" }),
      ev({ op: "retract", object: "*", source: "user_text" }),
    ];
    const s = replay(events);
    expect(s.size).toBe(3);
  });
  it("explain returns the evidence chain with effects", () => {
    const events = [
      ev({ object: "Bill", source: "user_text" }),
      ev({ object: "Admin", source: "gmail_body" }),
      ev({ object: "William Xu", source: "oauth" }),
      ev({ predicate: "need", object: "cancel gym", source: "user_call" }),
    ];
    const s = replay(events);
    const x = explain(s, events, "user", "name");
    expect(x.belief?.object).toBe("William Xu");
    expect(x.candidates.map((c) => c.object).sort()).toEqual(["Admin", "Bill", "William Xu"]);
    expect(x.chain.length).toBe(3);
    expect(x.chain[0].effect).toContain('"Bill" active 0.6');
    expect(x.chain[1].effect).toContain("quarantined");
    expect(x.chain[2].effect).toContain("superseded");
  });
  it("toBeliefRows produces DB rows with updated_at from the last evidence event", () => {
    const events = [ev({ object: "Bill", source: "user_text" }), ev({ object: "Bill", source: "user_text" })];
    const rows = toBeliefRows(SID, replay(events));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ session_id: SID, subject: "user", predicate: "name", object: "Bill", status: "active", confidence: 0.75, evidence_ids: [1, 2], reason: null });
    expect(rows[0].updated_at).toBe(events[1].ts);
  });
  it("keys escape separators so distinct triples never collide", () => {
    expect(beliefKey("a|b", "c", "d")).not.toBe(beliefKey("a", "b|c", "d"));
  });
});

// ---------------------------------------------------------------------------
// Determinism fuzz: same events → same beliefs, regardless of input order.
// ---------------------------------------------------------------------------

function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SOURCES: MemorySource[] = ["user_call", "user_text", "oauth", "gmail_body", "agent_inference"];
const ACTORS: MemoryActor[] = ["user", "system", "gmail", "agent"];
const OPS: MemoryOp[] = ["assert", "assert", "assert", "assert", "assert", "assert", "assert", "assert", "retract", "resolve"];
const SUBJECTS = ["user", "agent"];
const PREDICATES = ["name", "email", "need", "timezone"];
const OBJECTS = ["Bill", "William", "Admin", "bill@gmail.com", "cancel gym", "PST", "Jarvis", "*"];

function randomSequence(rand: () => number): MemoryEvent[] {
  const n = 1 + Math.floor(rand() * 30);
  const out: MemoryEvent[] = [];
  for (let i = 0; i < n; i++) {
    const id = i + 1;
    out.push({
      id,
      session_id: SID,
      ts: new Date(Date.UTC(2026, 8, 26, 0, 0, id)).toISOString(),
      actor: ACTORS[Math.floor(rand() * ACTORS.length)],
      op: OPS[Math.floor(rand() * OPS.length)],
      subject: SUBJECTS[Math.floor(rand() * SUBJECTS.length)],
      predicate: PREDICATES[Math.floor(rand() * PREDICATES.length)],
      object: OBJECTS[Math.floor(rand() * OBJECTS.length)],
      source: SOURCES[Math.floor(rand() * SOURCES.length)],
      evidence_ref: null,
    });
  }
  return out;
}

function shuffled<T>(arr: T[], rand: () => number): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

describe("determinism fuzz", () => {
  const rand = mulberry32(20260926);
  it("200 random sequences replay identically, equal the step-wise fold, and ignore input order", () => {
    for (let run = 0; run < 200; run++) {
      const seq = randomSequence(rand);
      const a = replay(seq);
      const b = replay(seq);
      const c = fold(seq);
      const d = replay(shuffled(seq, rand));
      expect([...a.entries()]).toEqual([...b.entries()]);
      expect([...a.entries()]).toEqual([...c.entries()]);
      expect([...a.entries()]).toEqual([...d.entries()]);
      // invariant: at most one active belief per (subject, predicate)
      const seen = new Set<string>();
      for (const r of a.values()) {
        if (r.status !== "active") continue;
        const k = `${r.subject}|${r.predicate}`;
        expect(seen.has(k)).toBe(false);
        seen.add(k);
        expect(r.topSource).not.toBe("gmail_body");
      }
      // invariant: quarantined records carry no confidence
      for (const r of a.values()) if (r.status === "quarantined") expect(r.confidence).toBe(0);
    }
  });
});
