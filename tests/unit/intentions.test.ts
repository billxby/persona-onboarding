import { beforeEach, describe, expect, it } from "vitest";
import {
  applyIntention,
  backoff,
  BUILTIN_INTENTIONS,
  detectNudges,
  DROP_LOW_RECEPTIVITY_REASON,
  DROP_SHUT_DOWN_REASON,
  eligibility,
  heuristicReceptivity,
  nextAngle,
  nextIntention,
  onMyMindBlock,
  ON_MY_MIND_MAX_CHARS,
  receptivityBand,
  replayMind,
  seedPayload,
  STICKY_DROP_REASON,
  STICKY_DROP_TURNS,
  toIntentionRows,
  type Mind,
} from "@/lib/memory/intentions";
import type { IntentionEvent, IntentionOp, IntentionPayload } from "@/lib/shared/types";

const SID = "00000000-0000-0000-0000-000000000002";
const T0 = Date.UTC(2026, 8, 26, 12, 0, 0);
const HOUR = 3600_000;
let nextId = 1;

function ev(partial: Partial<IntentionEvent> & { key: string; op: IntentionOp; payload?: IntentionPayload }): IntentionEvent {
  const id = partial.id ?? nextId++;
  return {
    id,
    session_id: SID,
    ts: partial.ts ?? new Date(T0 + id * 1000).toISOString(),
    key: partial.key,
    op: partial.op,
    actor: partial.actor ?? "system",
    turn: partial.turn ?? id,
    payload: partial.payload ?? {},
    evidence_ref: partial.evidence_ref ?? null,
  };
}

const seed = () => BUILTIN_INTENTIONS.map((b) => ev({ key: b.key, op: "open", turn: 0, payload: seedPayload(b) }));
const fold = (events: IntentionEvent[]): Mind => events.reduce((s, e) => applyIntention(s, e), new Map());

beforeEach(() => {
  nextId = 1;
});

describe("backoff", () => {
  it("bands the 0–10 scale and grows with every nudge", () => {
    expect(receptivityBand(0)).toBe(0);
    expect(receptivityBand(1)).toBe(1);
    expect(receptivityBand(3)).toBe(2);
    expect(receptivityBand(5)).toBe(3);
    expect(receptivityBand(8)).toBe(4);
    expect(receptivityBand(10)).toBe(5);
    expect(backoff(1, 1)).toEqual({ turns: 12, ms: 2 * HOUR });
    expect(backoff(1, 2)).toEqual({ turns: 24, ms: 4 * HOUR });
    expect(backoff(3, 1)).toEqual({ turns: 2, ms: 0 });
    expect(backoff(5, 1)).toEqual({ turns: 6, ms: 0 });
    expect(backoff(9, 1)).toEqual({ turns: 0, ms: 0 });
    expect(backoff(0, 1)).toEqual({ turns: 24, ms: 24 * HOUR });
    expect(backoff(0, 9).turns).toBe(200);
    expect(backoff(0, 9).ms).toBe(7 * 24 * HOUR);
  });
});

describe("seed and open", () => {
  it("seeds the four built-ins, all eligible now and priority-ordered", () => {
    const m = fold(seed());
    expect([...m.keys()]).toEqual(["get_name", "learn_need", "connect_gmail", "name_agent"]);
    for (const r of m.values()) {
      expect(r.status).toBe("open");
      expect(r.sticky).toBe(true);
      expect(eligibility(r, 0, T0).eligible).toBe(true);
    }
    expect(nextIntention(m.values(), "text", 0, T0)?.key).toBe("get_name");
    expect(nextIntention(m.values(), "call", 0, T0)?.key).toBe("get_name");
    expect(m.get("name_agent")!.channels).toEqual(["text"]);
  });
  it("a second open on an open key only refreshes the goal; an unknown key gets a plain record", () => {
    const m = fold([...seed(), ev({ key: "connect_gmail", op: "open", payload: { goal: "new goal" } }), ev({ key: "followup_landlord", op: "open", actor: "agent", payload: { goal: "ask if the landlord replied" } })]);
    expect(m.get("connect_gmail")!.goal).toBe("new goal");
    expect(m.get("connect_gmail")!.nudges).toBe(0);
    const f = m.get("followup_landlord")!;
    expect(f.sticky).toBe(false);
    expect(f.priority).toBe(5);
    expect(f.slot).toBeNull();
  });
});

describe("nudge → outcome", () => {
  it("a nudge marks it asked (not eligible); the outcome scores it and snoozes by receptivity", () => {
    let m = fold([...seed(), ev({ key: "connect_gmail", op: "nudge", turn: 3, actor: "agent", payload: { approach: "so I can find the membership email?" } })]);
    let g = m.get("connect_gmail")!;
    expect(g.status).toBe("asked");
    expect(g.nudges).toBe(1);
    expect(g.last_nudge_turn).toBe(3);
    expect(eligibility(g, 3, T0).why).toMatch(/waiting for their reaction/);

    m = applyIntention(m, ev({ key: "connect_gmail", op: "outcome", turn: 3, payload: { receptivity: 1, note: "said no thanks" } }));
    g = m.get("connect_gmail")!;
    expect(g.status).toBe("open");
    expect(g.receptivity).toBe(1);
    expect(g.receptivity_history).toEqual([1]);
    expect(g.notes).toEqual(["said no thanks"]);
    expect(g.next_eligible_turn).toBe(15);
    // both the turn wait and the wall-clock floor must pass
    expect(eligibility(g, 15, T0).eligible).toBe(false);
    expect(eligibility(g, 15, T0).why).toMatch(/at least 2h/);
    expect(eligibility(g, 14, T0 + 3 * HOUR).why).toMatch(/1 more turn/);
    expect(eligibility(g, 15, T0 + 3 * HOUR).eligible).toBe(true);
  });

  it("a warm reaction comes back next turn; an ignored one after two", () => {
    const yes = fold([...seed(), ev({ key: "get_name", op: "nudge", turn: 1, payload: { approach: "what should I call you?" } }), ev({ key: "get_name", op: "outcome", turn: 1, payload: { receptivity: 9 } })]).get("get_name")!;
    expect(eligibility(yes, 1, T0 + 60_000).eligible).toBe(true);
    const ignored = fold([...seed(), ev({ key: "get_name", op: "nudge", turn: 1, payload: { approach: "what should I call you?" } }), ev({ key: "get_name", op: "outcome", turn: 1, payload: { receptivity: 3 } })]).get("get_name")!;
    expect(ignored.next_eligible_turn).toBe(3);
    expect(eligibility(ignored, 2, T0 + 60_000).eligible).toBe(false);
    expect(eligibility(ignored, 3, T0 + 60_000).eligible).toBe(true);
  });

  it("every extra nudge doubles the wait and records the angle tried", () => {
    const events = [...seed()];
    let turn = 0;
    for (const [approach, r] of [
      ["so I can find the membership email?", 2],
      ["I'd spot the renewal date in a minute, connect Gmail?", 2],
    ] as const) {
      turn += 1;
      events.push(ev({ key: "connect_gmail", op: "nudge", turn, payload: { approach } }), ev({ key: "connect_gmail", op: "outcome", turn, payload: { receptivity: r } }));
    }
    const g = fold(events).get("connect_gmail")!;
    expect(g.nudges).toBe(2);
    expect(g.approaches).toHaveLength(2);
    expect(g.next_eligible_turn).toBe(2 + 24);
    expect(Date.parse(g.next_eligible_at) - Date.parse(events[events.length - 1].ts)).toBe(4 * HOUR);
    expect(g.receptivity_mean).toBe(2);
    // a suggestion for a new angle, not one already tried
    expect(nextAngle(g)).toMatch(/read-only|demo inbox|first minute/);
  });

  it("core asks are sticky: a straight 0/10 backs Gmail off a day, and even an explicit drop only snoozes it", () => {
    const g = fold([...seed(), ev({ key: "connect_gmail", op: "nudge", turn: 2 }), ev({ key: "connect_gmail", op: "outcome", turn: 2, payload: { receptivity: 0, note: "stop asking" } })]).get("connect_gmail")!;
    expect(g.status).toBe("open");
    expect(g.next_eligible_turn).toBe(26);
    expect(eligibility(g, 26, T0 + 23 * HOUR).eligible).toBe(false);
    expect(eligibility(g, 26, T0 + 25 * HOUR).eligible).toBe(true);
    const dropped = fold([...seed(), ev({ key: "connect_gmail", op: "drop", turn: 5, actor: "agent", payload: { reason: "they hate it" } })]).get("connect_gmail")!;
    expect(dropped.status).toBe("open");
    expect(dropped.reason).toBe(STICKY_DROP_REASON);
    expect(dropped.next_eligible_turn).toBe(5 + STICKY_DROP_TURNS);
  });

  it("an ad-hoc follow-up drops on 0/10, or after three cold nudges", () => {
    const open = ev({ key: "followup_landlord", op: "open", actor: "agent", payload: { goal: "ask about the landlord" } });
    const shut = fold([open, ev({ key: "followup_landlord", op: "nudge", turn: 1 }), ev({ key: "followup_landlord", op: "outcome", turn: 1, payload: { receptivity: 0 } })]).get("followup_landlord")!;
    expect(shut.status).toBe("dropped");
    expect(shut.reason).toBe(DROP_SHUT_DOWN_REASON);

    const events = [open];
    for (let t = 1; t <= 3; t++) events.push(ev({ key: "followup_landlord", op: "nudge", turn: t * 10 }), ev({ key: "followup_landlord", op: "outcome", turn: t * 10, payload: { receptivity: 2 } }));
    const cold = fold(events).get("followup_landlord")!;
    expect(cold.status).toBe("dropped");
    expect(cold.reason).toBe(DROP_LOW_RECEPTIVITY_REASON);
    // dropped is final for later nudges/outcomes: evidence logged, nothing moves
    const after = applyIntention(fold(events), ev({ key: "followup_landlord", op: "outcome", turn: 40, payload: { receptivity: 10 } })).get("followup_landlord")!;
    expect(after.status).toBe("dropped");
    expect(after.evidence_ids.length).toBe(cold.evidence_ids.length + 1);
  });

  it("an outcome without a prior nudge still counts (system-observed decline on the consent screen)", () => {
    const g = fold([...seed(), ev({ key: "connect_gmail", op: "outcome", turn: 4, payload: { receptivity: 2, note: "declined on the consent screen" } })]).get("connect_gmail")!;
    expect(g.status).toBe("open");
    expect(g.nudges).toBe(0);
    expect(g.next_eligible_turn).toBe(16);
  });
});

describe("defer, done, reopen", () => {
  it("defer pushes eligibility out without touching receptivity; done and reopen are terminal and reversible", () => {
    let m = fold([...seed(), ev({ key: "name_agent", op: "defer", turn: 5, actor: "agent", payload: { turns: 10, reason: "mid-task" } })]);
    let a = m.get("name_agent")!;
    expect(a.status).toBe("open");
    expect(a.next_eligible_turn).toBe(15);
    expect(a.receptivity).toBeNull();
    expect(a.reason).toBe("mid-task");

    m = applyIntention(m, ev({ key: "get_name", op: "done", turn: 6, payload: { reason: "user_name set" } }));
    expect(m.get("get_name")!.status).toBe("done");
    expect(eligibility(m.get("get_name")!, 99, T0 + 999 * HOUR).eligible).toBe(false);
    // nudging or scoring a done intention changes nothing but the evidence
    m = applyIntention(m, ev({ key: "get_name", op: "nudge", turn: 7 }));
    expect(m.get("get_name")!.status).toBe("done");
    expect(m.get("get_name")!.nudges).toBe(0);

    m = applyIntention(m, ev({ key: "get_name", op: "reopen", turn: 8, payload: { reason: "user asked to forget the name" } }));
    a = m.get("get_name")!;
    expect(a.status).toBe("open");
    expect(a.reason).toBe("user asked to forget the name");
    expect(eligibility(a, 8, T0).eligible).toBe(true);
  });
});

describe("determinism", () => {
  function mulberry32(seed: number) {
    return () => {
      seed |= 0;
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const KEYS = ["get_name", "connect_gmail", "followup_landlord", "name_agent"];
  const OPS: IntentionOp[] = ["open", "nudge", "nudge", "outcome", "outcome", "outcome", "defer", "done", "drop", "reopen"];

  it("replay(events) equals the step-wise fold, in any input order, and every invariant holds", () => {
    const rand = mulberry32(2026);
    for (let run = 0; run < 200; run++) {
      const n = 1 + Math.floor(rand() * 30);
      const events: IntentionEvent[] = [];
      for (let i = 0; i < n; i++) {
        const op = OPS[Math.floor(rand() * OPS.length)];
        events.push(
          ev({
            id: i + 1,
            turn: Math.floor(rand() * 40),
            key: KEYS[Math.floor(rand() * KEYS.length)],
            op,
            payload: op === "outcome" ? { receptivity: Math.floor(rand() * 11), note: rand() > 0.5 ? "said something" : undefined } : op === "defer" ? { turns: Math.floor(rand() * 20) } : op === "nudge" ? { approach: `angle ${Math.floor(rand() * 4)}` } : { goal: "g" },
          }),
        );
      }
      const a = fold(events);
      const b = replayMind(events);
      const shuffled = [...events].sort(() => rand() - 0.5);
      const c = replayMind(shuffled);
      expect(toIntentionRows(SID, b)).toEqual(toIntentionRows(SID, a));
      expect(toIntentionRows(SID, c)).toEqual(toIntentionRows(SID, a));
      for (const r of a.values()) {
        expect(r.receptivity_history.length).toBeLessThanOrEqual(10);
        expect(r.approaches.length).toBeLessThanOrEqual(6);
        expect(r.notes.length).toBeLessThanOrEqual(3);
        if (r.receptivity !== null) expect(r.receptivity).toBeGreaterThanOrEqual(0);
        if (r.receptivity !== null) expect(r.receptivity).toBeLessThanOrEqual(10);
        expect(r.next_eligible_turn).toBeGreaterThanOrEqual(0);
        expect(Number.isNaN(Date.parse(r.next_eligible_at))).toBe(false);
        if (r.sticky) expect(r.status).not.toBe("dropped");
        expect(r.evidence_ids).toEqual([...r.evidence_ids].sort((x, y) => x - y));
      }
    }
  });
});

describe("detecting a nudge in the reply", () => {
  const m = fold(seed());
  it("matches a question to the intention's cue, or to the slot next_best_ask pointed at", () => {
    expect(detectNudges(["Got it, the gym thing.", "If you connect Gmail I can find the membership email. Want me to?"], m.values(), null, "text")).toEqual([{ key: "connect_gmail", approach: "If you connect Gmail I can find the membership email. Want me to?" }]);
    expect(detectNudges(["Quick one so I know who I'm working for. Ready?"], m.values(), "user_name", "call")).toEqual([{ key: "get_name", approach: "Quick one so I know who I'm working for. Ready?" }]);
    expect(detectNudges(["On it. I'll start with the inbox."], m.values(), "gmail", "text")).toEqual([]);
    expect(detectNudges(["What should I call you?"], m.values(), null, "text").map((n) => n.key)).toEqual(["get_name"]);
  });
  it("never counts a text-only intention on a call, nor a settled one", () => {
    expect(detectNudges(["What would you like to call me?"], m.values(), null, "call")).toEqual([]);
    const done = applyIntention(m, ev({ key: "get_name", op: "done", turn: 1 }));
    expect(detectNudges(["What should I call you?"], done.values(), "user_name", "text")).toEqual([]);
  });
  it("a question that plainly asks for one built-in is never credited to the slot the plan named", () => {
    // the plan said need, the model asked the name anyway: that is a name nudge, not a need nudge
    expect(detectNudges(["No worries.", "What should I call you, by the way?"], m.values(), "need", "text").map((n) => n.key)).toEqual(["get_name"]);
    // a creatively framed ask for the plan's slot still counts for it
    expect(detectNudges(["Got it.", "So what's one thing I can actually help you knock out this week?"], m.values(), "need", "text").map((n) => n.key)).toEqual(["learn_need"]);
  });
  it("Gmail counts only by its own words (or the link card): task talk while Gmail is next is not a nudge", () => {
    expect(detectNudges(["Want me to draft a cancellation letter you can send yourself?"], m.values(), "gmail", "text")).toEqual([]);
    expect(detectNudges(["Want me to look through your inbox for the contract?"], m.values(), "gmail", "text").map((n) => n.key)).toEqual(["connect_gmail"]);
  });
});

describe("heuristic receptivity (fallback when the model is unavailable)", () => {
  it("maps plain replies onto the scale", () => {
    expect(heuristicReceptivity("stop asking me about gmail").receptivity).toBe(0);
    expect(heuristicReceptivity("no thanks").signal).toBe("declined");
    expect(heuristicReceptivity("maybe later, I'm busy").receptivity).toBe(5);
    expect(heuristicReceptivity("sure, go ahead").receptivity).toBe(9);
    expect(heuristicReceptivity("anyway can you also book my dentist").signal).toBe("ignored");
    expect(heuristicReceptivity("is it read-only?").receptivity).toBe(7);
  });
});

describe("ON MY MIND block", () => {
  it("lists eligible first with the angle to try, then asked, then snoozed, and summarises the settled ones", () => {
    const events = [
      ...seed(),
      ev({ key: "get_name", op: "done", turn: 1, payload: { reason: "user_name set" } }),
      ev({ key: "connect_gmail", op: "nudge", turn: 2, payload: { approach: "so I can find the membership email?" } }),
      ev({ key: "connect_gmail", op: "outcome", turn: 2, payload: { receptivity: 3, note: "changed the subject" } }),
      ev({ key: "name_agent", op: "nudge", turn: 3, payload: { approach: "want to give me a name?" } }),
      ev({ key: "followup_landlord", op: "open", actor: "agent", payload: { goal: "ask if the landlord replied" } }),
      ev({ key: "followup_landlord", op: "nudge", turn: 3 }),
      ev({ key: "followup_landlord", op: "outcome", turn: 3, payload: { receptivity: 0 } }),
    ];
    const m = fold(events);
    const block = onMyMindBlock(m.values(), "text", 4, T0 + 10 * 60_000);
    const lines = block.split("\n");
    expect(lines[0]).toMatch(/^ON MY MIND/);
    // asked first (short, and it stops a re-ask), then eligible by priority, then snoozed
    expect(lines[1]).toMatch(/^- name_agent: asked, waiting for their reaction/);
    expect(lines[2]).toMatch(/^- learn_need: eligible now · one concrete thing/);
    expect(lines[3]).toMatch(/^- connect_gmail: eligible now · raised 1× \(last: so I can find the membership email\?\) → 3\/10 "changed the subject" · try a different angle: /);
    expect(lines[4]).toMatch(/^- done: get_name · dropped, never again: followup_landlord \(0\/10\)$/);
    expect(block.length).toBeLessThanOrEqual(ON_MY_MIND_MAX_CHARS + 120);
    // on a call the text-only intention is not listed
    expect(onMyMindBlock(m.values(), "call", 4, T0)).not.toContain("name_agent");
    expect(onMyMindBlock([], "text", 0, T0)).toBe(`${lines[0]}\n(nothing yet)`);
  });
  it("with a plan, exactly one line says raise now and every other eligible line says why it waits", () => {
    const m = fold([...seed(), ev({ key: "followup_landlord", op: "open", actor: "agent", payload: { goal: "ask if the landlord replied" } })]);
    const block = onMyMindBlock(m.values(), "text", 1, T0, { raise: "get_name", holds: { connect_gmail: "after the need, as the means to it", name_agent: "text only, after the first useful result" } });
    const lines = block.split("\n");
    expect(lines[0]).toMatch(/"raise now"/);
    expect(lines[1]).toBe("- get_name: raise now · learn what to call them");
    expect(lines[2]).toBe("- learn_need: not now (one ask at a time) · one concrete thing to take off their plate");
    expect(lines[3]).toBe("- connect_gmail: not now (after the need, as the means to it) · connect Gmail (read-only) as the way to do the task");
    expect(lines[4]).toBe("- name_agent: not now (text only, after the first useful result) · learn what they'd like to call me");
    expect(lines[5]).toBe("- followup_landlord: not now (one ask at a time) · ask if the landlord replied");
    expect(block.match(/raise now/g)).toHaveLength(2);
    expect(block).not.toContain("eligible now");
    // the raised item carries the next angle; the ones that wait do not
    const nudged = fold([...seed(), ev({ key: "connect_gmail", op: "nudge", turn: 2, payload: { approach: "so I can find the membership email?" } }), ev({ key: "connect_gmail", op: "outcome", turn: 2, payload: { receptivity: 8 } })]);
    expect(onMyMindBlock(nudged.values(), "text", 3, T0 + 60_000, { raise: "connect_gmail", holds: {} })).toMatch(/connect_gmail: raise now · raised 1× .* → 8\/10 · try a different angle: /);
    expect(onMyMindBlock(nudged.values(), "text", 3, T0 + 60_000, { raise: "get_name", holds: {} })).not.toContain("try a different angle");
    // the plan may raise a snoozed item on purpose (the need, with nothing to do without one): the block says so instead of contradicting it
    const needSnoozed = fold([...seed(), ev({ key: "learn_need", op: "nudge", turn: 1, payload: { approach: "one thing off your plate?" } }), ev({ key: "learn_need", op: "outcome", turn: 1, payload: { receptivity: 3, note: "just said hm" } })]);
    const forced = onMyMindBlock(needSnoozed.values(), "text", 2, T0 + 60_000, { raise: "learn_need", holds: {} });
    expect(forced.split("\n")[1]).toMatch(/^- learn_need: raise now \(snoozed, 1 more turn, but nothing to do without it: new angle\) · raised 1× .* → 3\/10 "just said hm" · try a different angle: /);
  });
  it("shows a snooze in turns and wall-clock terms and never exceeds the cap", () => {
    const m = fold([...seed(), ev({ key: "connect_gmail", op: "nudge", turn: 2 }), ev({ key: "connect_gmail", op: "outcome", turn: 2, payload: { receptivity: 1, note: "no" } })]);
    const block = onMyMindBlock(m.values(), "text", 3, T0 + 5 * 60_000);
    expect(block).toMatch(/connect_gmail: snoozed, 11 more turns and at least 2h/);
    const many = new Map(m);
    for (let i = 0; i < 30; i++) many.set(`followup_${i}`, { ...m.get("learn_need")!, key: `followup_${i}`, goal: `a fairly long goal number ${i} to fill the block`, priority: 9 });
    const big = onMyMindBlock(many.values(), "text", 3, T0);
    expect(big).toContain("(more omitted)");
    expect(big.split("\n").filter((l) => l.startsWith("- ") && !l.startsWith("- (more")).join("\n").length).toBeLessThanOrEqual(ON_MY_MIND_MAX_CHARS);
  });
});
