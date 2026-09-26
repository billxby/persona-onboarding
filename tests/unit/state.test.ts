import { describe, expect, it } from "vitest";
import { isRepeatQuestion, nextBestAsk, pushQuestion, stateBlock } from "@/lib/server/state";
import type { SessionRow } from "@/lib/shared/types";

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
