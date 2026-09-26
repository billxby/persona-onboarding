import { describe, expect, it } from "vitest";
import { BUILTIN_INTENTIONS, replayMind, seedPayload } from "@/lib/memory/intentions";
import { isRepeatQuestion, nextBestAsk, pushQuestion, stateBlock } from "@/lib/server/state";
import type { IntentionEvent, SessionRow } from "@/lib/shared/types";

const base = (patch: Partial<SessionRow> = {}): SessionRow => ({
  id: "00000000-0000-4000-8000-000000000001",
  owner_uid: null,
  mode: "onboarding",
  user_name: null,
  need: null,
  gmail_status: "none",
  gmail_email: null,
  agent_name: null,
  channel_pref: null,
  phase: "warmup",
  call_state: "idle",
  attempts: {},
  last_questions: [],
  summary: null,
  prompt_version: null,
  version: 0,
  confirmed: {},
  mock_inbox: false,
  responding_since: null,
  last_heartbeat_at: null,
  value_moment_at: null,
  graduated_at: null,
  last_user_activity_at: null,
  oauth_state: null,
  turn: 0,
  created_at: "2026-09-26T00:00:00Z",
  updated_at: "2026-09-26T00:00:00Z",
  ...patch,
});

describe("nextBestAsk (onboarding)", () => {
  it("asks user_name → need → gmail in order, on both channels", () => {
    expect(nextBestAsk(base(), "call").slot).toBe("user_name");
    expect(nextBestAsk(base(), "text").slot).toBe("user_name");
    expect(nextBestAsk(base({ user_name: "Bill" }), "call").slot).toBe("need");
    // a stated need flips mode to main in the tool layer; in onboarding with need set, gmail is next
    expect(nextBestAsk(base({ user_name: "Bill", need: "cancel gym" }), "call").slot).toBe("gmail");
  });
  it("never asks agent_name on a call", () => {
    const s = base({ user_name: "Bill", need: "gym", gmail_status: "declined", mode: "main", value_moment_at: "2026-09-26T00:00:00Z" });
    expect(nextBestAsk(s, "call").slot).not.toBe("agent_name");
    expect(nextBestAsk(s, "text").slot).toBe("agent_name");
  });
  it("waits while gmail is pending", () => {
    const r = nextBestAsk(base({ gmail_status: "pending" }), "text");
    expect(r.slot).toBeNull();
    expect(r.hint).toMatch(/pending|wait/i);
  });
  it("skips a slot after three misses", () => {
    expect(nextBestAsk(base({ attempts: { user_name: 3 } }), "call").slot).toBe("need");
    expect(nextBestAsk(base({ user_name: "Bill", attempts: { need: 5 } }), "call").slot).toBe("need"); // need is never skipped
    expect(nextBestAsk(base({ user_name: "Bill", need: "gym", attempts: { gmail: 3 } }), "text").slot).toBeNull();
  });
  it("offers choices after two misses", () => {
    expect(nextBestAsk(base({ attempts: { user_name: 2 } }), "call").hint).toMatch(/friend/i);
    expect(nextBestAsk(base({ user_name: "Bill", attempts: { need: 2 } }), "call").hint).toMatch(/three|options/i);
  });
});

describe("nextBestAsk (main mode)", () => {
  it("frames gmail as the way to do the task, once", () => {
    const s = base({ mode: "main", need: "cancel gym", phase: "collecting" });
    expect(nextBestAsk(s, "text").slot).toBe("gmail");
    expect(nextBestAsk({ ...s, attempts: { gmail: 2 } }, "text").slot).toBeNull();
  });
  it("nudges the name softly after value, then stops", () => {
    const s = base({ mode: "main", need: "cancel gym", gmail_status: "declined", value_moment_at: "2026-09-26T00:00:00Z" });
    expect(nextBestAsk(s, "call").slot).toBe("user_name");
    expect(nextBestAsk({ ...s, attempts: { user_name: 2 } }, "call").slot).toBeNull();
  });
  it("asks the agent name only in text after value", () => {
    const s = base({ mode: "main", user_name: "Bill", need: "gym", gmail_status: "connected", gmail_email: "b@x.com", value_moment_at: "2026-09-26T00:00:00Z" });
    expect(nextBestAsk(s, "text").slot).toBe("agent_name");
    expect(nextBestAsk(s, "call").slot).toBeNull();
    expect(nextBestAsk({ ...s, attempts: { agent_name: 1 } }, "text").slot).toBeNull();
  });
});

describe("nextBestAsk with the mind (intentions)", () => {
  const NOW = Date.parse("2026-09-26T12:00:00Z");
  const seeded = () => BUILTIN_INTENTIONS.map((b, i) => ({ id: i + 1, session_id: "s", ts: "2026-09-26T11:00:00Z", key: b.key, op: "open" as const, actor: "system" as const, turn: 0, payload: seedPayload(b), evidence_ref: null }));
  const mindWith = (extra: Omit<IntentionEvent, "session_id" | "ts" | "evidence_ref">[]) => [...replayMind([...seeded(), ...extra.map((e) => ({ ...e, session_id: "s", ts: "2026-09-26T11:30:00Z", evidence_ref: null }))]).values()];

  it("skips a slot whose intention is asked or snoozed and says why", () => {
    const asked = mindWith([{ id: 10, key: "get_name", op: "nudge", actor: "agent", turn: 1, payload: { approach: "what should I call you?" } }]);
    const r = nextBestAsk(base({ turn: 1 }), "text", asked, NOW);
    expect(r.slot).toBe("need");
    const snoozed = mindWith([
      { id: 10, key: "get_name", op: "nudge", actor: "agent", turn: 1, payload: { approach: "what should I call you?" } },
      { id: 11, key: "get_name", op: "outcome", actor: "system", turn: 1, payload: { receptivity: 3 } },
    ]);
    expect(nextBestAsk(base({ turn: 2 }), "text", snoozed, NOW).slot).toBe("need");
    // two turns later the name is back in front
    expect(nextBestAsk(base({ turn: 3 }), "text", snoozed, NOW).slot).toBe("user_name");
    expect(nextBestAsk(base({ turn: 3 }), "text", snoozed, NOW).hint).toMatch(/Raised 1× before, receptivity 3\/10/);
  });

  it("without a mind view nothing changes (legacy callers keep the attempts counters)", () => {
    expect(nextBestAsk(base(), "text").slot).toBe("user_name");
    expect(stateBlock(base(), "text")).not.toContain("ON MY MIND");
  });

  it("a declined Gmail comes back in main mode once its intention is eligible again, and only then", () => {
    const declined = mindWith([{ id: 10, key: "connect_gmail", op: "outcome", actor: "system", turn: 2, payload: { receptivity: 2, note: "declined on the consent screen" } }]);
    const s = base({ mode: "main", user_name: "Bill", need: "cancel gym", gmail_status: "declined", value_moment_at: "2026-09-26T11:00:00Z", agent_name: "Jarvis" });
    // snoozed 12 turns and 2 hours from the outcome
    expect(nextBestAsk({ ...s, turn: 5 }, "text", declined, NOW).slot).toBeNull();
    expect(nextBestAsk({ ...s, turn: 5 }, "text", declined, NOW).hint).toMatch(/On hold: connect_gmail snoozed/);
    expect(nextBestAsk({ ...s, turn: 14 }, "text", declined, NOW + 3 * 3600_000).slot).toBe("gmail");
    expect(nextBestAsk({ ...s, turn: 14 }, "text", declined, NOW + 3 * 3600_000).hint).toMatch(/passed on Gmail before/);
    // never in onboarding, and never without a mind view
    expect(nextBestAsk({ ...s, mode: "onboarding", turn: 14 }, "text", declined, NOW + 3 * 3600_000).slot).toBeNull();
    expect(nextBestAsk({ ...s, turn: 14 }, "text").slot).toBeNull();
  });

  it("the STATE block carries the turn and the receptivity note", () => {
    const m = mindWith([
      { id: 10, key: "connect_gmail", op: "nudge", actor: "agent", turn: 2, payload: { approach: "so I can find the membership email?" } },
      { id: 11, key: "connect_gmail", op: "outcome", actor: "system", turn: 2, payload: { receptivity: 8, note: "asked if it is read-only" } },
    ]);
    const block = stateBlock(base({ user_name: "Bill", need: "cancel gym", turn: 3 }), "text", m, NOW);
    expect(block).toContain("| turn: 3");
    expect(block).toMatch(/next_best_ask: gmail — .*receptivity 8\/10 \("asked if it is read-only"\)\. Different angle this time: /);
  });
});

describe("questions", () => {
  it("keeps the last five and detects repeats", () => {
    let s = base();
    for (const q of ["q1?", "q2?", "q3?", "q4?", "q5?", "q6?"]) s = { ...s, ...pushQuestion(s, q) };
    expect(s.last_questions).toEqual(["q2?", "q3?", "q4?", "q5?", "q6?"]);
    expect(isRepeatQuestion(s, "Q6")).toBe(true);
    expect(isRepeatQuestion(s, "What should I call you?")).toBe(false);
  });
  it("renders the STATE block", () => {
    const block = stateBlock(base({ user_name: "Bill", confirmed: { user_name: true } }), "call");
    expect(block).toContain("STATE (never ask for a filled slot)");
    expect(block).toContain("user_name: Bill (confirmed)");
    expect(block).toContain("never ask on a call");
    expect(block).toContain("next_best_ask: need");
  });
});
