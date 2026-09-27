import { describe, expect, it } from "vitest";
import { BUILTIN_INTENTIONS, replayMind, seedPayload } from "@/lib/memory/intentions";
import { localChecks } from "@/lib/server/brain/guard";
import type { IntentionEvent, SessionRow } from "@/lib/shared/types";

const NOW = Date.parse("2026-09-26T12:00:00Z");

const base = (patch: Partial<SessionRow> = {}): SessionRow => ({
  id: "00000000-0000-4000-8000-000000000003",
  owner_uid: null,
  mode: "onboarding",
  user_name: null,
  need: null,
  gmail_status: "none",
  gmail_email: null,
  agent_name: null,
  channel_pref: null,
  phase: "collecting",
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
  turn: 2,
  created_at: "2026-09-26T00:00:00Z",
  updated_at: "2026-09-26T00:00:00Z",
  ...patch,
});

const seeded = () => BUILTIN_INTENTIONS.map((b, i) => ({ id: i + 1, session_id: "s", ts: "2026-09-26T11:00:00Z", key: b.key, op: "open" as const, actor: "system" as const, turn: 0, payload: seedPayload(b), evidence_ref: null }));
const mindWith = (extra: Omit<IntentionEvent, "session_id" | "ts" | "evidence_ref">[]) => [...replayMind([...seeded(), ...extra.map((e) => ({ ...e, session_id: "s", ts: "2026-09-26T11:30:00Z", evidence_ref: null }))]).values()];

/** The name was asked at turn 1 and the user let it pass (3/10): resting for two turns. */
const nameResting = () =>
  mindWith([
    { id: 10, key: "get_name", op: "nudge", actor: "agent", turn: 1, payload: { approach: "Before we dive in, what should I call you?" } },
    { id: 11, key: "get_name", op: "outcome", actor: "system", turn: 1, payload: { receptivity: 3, note: "just said hm" } },
  ]);

describe("output guard: pacing (the reply may ask only what the plan raises)", () => {
  it("rejects a question about an ask that is resting, and says why", () => {
    const v = localChecks({ session: base(), beliefs: [], bubbles: ["No worries, we can skip that for now.", "What should I call you, by the way?"], mind: nameResting(), now: NOW });
    expect(v?.ok).toBe(false);
    expect(v?.issue).toMatch(/asked for their name, but that ask is resting \(snoozed, 1 more turn\)/);
    expect(v?.source).toBe("local");
  });

  it("lets the plan's own pick through, even when its intention is snoozed on purpose (the need, with nothing to do without one)", () => {
    const needIgnored = mindWith([
      { id: 10, key: "learn_need", op: "nudge", actor: "agent", turn: 1, payload: { approach: "what's one thing off your plate?" } },
      { id: 11, key: "learn_need", op: "outcome", actor: "system", turn: 1, payload: { receptivity: 3 } },
    ]);
    expect(localChecks({ session: base({ user_name: "Maya" }), beliefs: [], bubbles: ["Maya, got it.", "So what's one thing I can actually help you knock out this week?"], mind: needIgnored, now: NOW })).toBeNull();
  });

  it("lets an eligible ask through, and skips the check without a mind (legacy) or for a filled slot", () => {
    expect(localChecks({ session: base(), beliefs: [], bubbles: ["Hey!", "What should I call you?"], mind: mindWith([]), now: NOW })).toBeNull();
    expect(localChecks({ session: base(), beliefs: [], bubbles: ["Hey!", "What should I call you?"] })).toBeNull();
    // the name is filled: the older "already known" check fires, not the pacing one
    const v = localChecks({ session: base({ user_name: "Maya" }), beliefs: [], bubbles: ["What should I call you?"], mind: nameResting(), now: NOW });
    expect(v?.issue).toMatch(/already Maya/);
  });

  it("a declined Gmail that is still resting is not offered again, and a settled agent name is not asked again", () => {
    const gmailNo = mindWith([
      { id: 10, key: "connect_gmail", op: "nudge", actor: "agent", turn: 1, payload: { approach: "sent the Connect Gmail link card" } },
      { id: 11, key: "connect_gmail", op: "outcome", actor: "system", turn: 1, payload: { receptivity: 2, note: "declined on the consent screen" } },
    ]);
    const s = base({ mode: "main", user_name: "Maya", need: "cancel gym", gmail_status: "declined" });
    const v = localChecks({ session: s, beliefs: [], bubbles: ["On it.", "Want me to look through your inbox for the contract?"], mind: gmailNo, now: NOW });
    expect(v?.issue).toMatch(/asked for Gmail, but that ask is resting/);
    expect(localChecks({ session: base({ agent_name: "Pip" }), beliefs: [], bubbles: ["What would you like to call me?"] })?.issue).toMatch(/already named you Pip/);
  });
});
