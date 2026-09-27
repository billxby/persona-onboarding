import { describe, expect, it } from "vitest";
import { BUILTIN_INTENTIONS, replayMind, seedPayload } from "@/lib/memory/intentions";
import {
  AGENT_NAME_FLOOR_TURN,
  askPlan,
  CALL_OFFER_HINT,
  HOLD_AFTER_CALL_OFFER,
  HOLD_AFTER_NEED,
  HOLD_AFTER_VALUE,
  HOLD_CALL_OFFER_ASKED,
  HOLD_CHANNEL_CHOSEN,
  HOLD_ONE_AT_A_TIME,
  isRepeatQuestion,
  nextBestAsk,
  pushQuestion,
  stateBlock,
} from "@/lib/server/state";
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
    const s = base({ mode: "main", user_name: "Bill", need: "cancel gym", gmail_status: "declined", value_moment_at: "2026-09-26T11:00:00Z", agent_name: "Jarvis", channel_pref: "text" });
    // snoozed 12 turns and 2 hours from the outcome
    expect(nextBestAsk({ ...s, turn: 5 }, "text", declined, NOW).slot).toBeNull();
    expect(nextBestAsk({ ...s, turn: 5 }, "text", declined, NOW).hint).toMatch(/On hold: connect_gmail snoozed/);
    expect(nextBestAsk({ ...s, turn: 14 }, "text", declined, NOW + 3 * 3600_000).slot).toBe("gmail");
    expect(nextBestAsk({ ...s, turn: 14 }, "text", declined, NOW + 3 * 3600_000).hint).toMatch(/passed on Gmail before/);
    // never in onboarding, and never without a mind view
    expect(nextBestAsk({ ...s, mode: "onboarding", turn: 14 }, "text", declined, NOW + 3 * 3600_000).slot).toBeNull();
    expect(nextBestAsk({ ...s, turn: 14 }, "text").slot).toBeNull();
  });

  it("three misses never retire a slot: the ledger paces it (a skip scores 1/10), the placeholder covers the wait, and it comes back", () => {
    const HOUR = 3600_000;
    // legacy (no mind): attempts 3 → skipped for good
    expect(nextBestAsk(base({ attempts: { user_name: 3 } }), "text").slot).toBe("need");
    // with a mind the counter is ignored: still the name, never raised
    expect(nextBestAsk(base({ attempts: { user_name: 3 } }), "text", mindWith([]), NOW).slot).toBe("user_name");
    // the skip itself is scored 1/10 by set_slot: snoozed 12 turns and 2 h, "friend" meanwhile, then back in front
    const skipped = mindWith([{ id: 10, key: "get_name", op: "outcome", actor: "system", turn: 1, payload: { receptivity: 1, note: "asked to skip it" } }]);
    const s = base({ attempts: { user_name: 3 }, turn: 2 });
    expect(nextBestAsk(s, "text", skipped, NOW).slot).toBe("need");
    expect(stateBlock(s, "text", skipped, NOW)).toContain("user_name: (empty, resting: don't ask now, 'friend' if needed)");
    expect(nextBestAsk({ ...s, turn: 13 }, "text", skipped, NOW + 3 * HOUR).slot).toBe("user_name");
    expect(stateBlock({ ...s, turn: 13 }, "text", skipped, NOW + 3 * HOUR)).toContain("user_name: (empty) |");
    // same for Gmail: three attempts do not retire it
    expect(nextBestAsk(base({ user_name: "Bill", need: "gym", attempts: { gmail: 3 }, channel_pref: "text" }), "text", mindWith([]), NOW).slot).toBe("gmail");
  });

  it("onboarding never asks for Gmail before a need is known, and the need is never snoozed away after a mere non-answer", () => {
    const needIgnored = mindWith([
      { id: 10, key: "learn_need", op: "nudge", actor: "agent", turn: 1, payload: { approach: "what's one thing off your plate?" } },
      { id: 11, key: "learn_need", op: "outcome", actor: "system", turn: 1, payload: { receptivity: 3, note: "just said hm" } },
    ]);
    // nothing to do without a need: it is raised again anyway, from a new angle; Gmail keeps waiting for it
    const plan = askPlan(base({ user_name: "Bill", turn: 2 }), "text", needIgnored, NOW);
    expect(plan.pick.slot).toBe("need");
    expect(plan.raise).toBe("learn_need");
    expect(plan.pick.hint).toMatch(/let the question pass \(3\/10\).*new angle/);
    expect(plan.pick.hint).not.toMatch(/three concrete options/);
    expect(askPlan(base({ user_name: "Bill", turn: 2, attempts: { need: 2 } }), "text", needIgnored, NOW).pick.hint).toMatch(/three concrete options/);
    expect(plan.holds.connect_gmail).toBe(HOLD_AFTER_NEED);
    // warm but no task named ("ok", 7/10) is the same situation: ask again, concretely
    const needWarm = mindWith([
      { id: 10, key: "learn_need", op: "nudge", actor: "agent", turn: 2, payload: { approach: "what's one thing off your plate?" } },
      { id: 11, key: "learn_need", op: "outcome", actor: "system", turn: 2, payload: { receptivity: 7, note: "said ok" } },
    ]);
    const warm = askPlan(base({ user_name: "Bill", turn: 2 }), "text", needWarm, NOW);
    expect(warm.pick.slot).toBe("need");
    expect(warm.pick.hint).toMatch(/open \(7\/10\) but named no task/);
    // a bare "ok" scores neutral (5/10): still the need, as one light menu, and the model leaves it if they plainly said later
    const needNeutral = mindWith([
      { id: 10, key: "learn_need", op: "nudge", actor: "agent", turn: 2, payload: { approach: "what's one thing off your plate?" } },
      { id: 11, key: "learn_need", op: "outcome", actor: "system", turn: 2, payload: { receptivity: 5, note: "said ok" } },
    ]);
    const neutral = askPlan(base({ user_name: "Bill", turn: 2 }), "text", needNeutral, NOW);
    expect(neutral.pick.slot).toBe("need");
    expect(neutral.pick.hint).toMatch(/noncommittal or said later \(5\/10\)\. One light menu/);
    // but a "later" or a no is respected: no ask, help or graduate instead
    const needDeclined = mindWith([
      { id: 10, key: "learn_need", op: "nudge", actor: "agent", turn: 1, payload: { approach: "what's one thing off your plate?" } },
      { id: 11, key: "learn_need", op: "outcome", actor: "system", turn: 1, payload: { receptivity: 2, note: "not interested" } },
    ]);
    const declined = askPlan(base({ user_name: "Bill", turn: 2 }), "text", needDeclined, NOW);
    expect(declined.pick.slot).toBeNull();
    expect(declined.pick.hint).toMatch(/passed on stating one \(2\/10; snoozed, 11 more turns and at least 2h\)\. Don't ask now/);
    // and while the question is out, wait for the answer
    const needAsked = mindWith([{ id: 10, key: "learn_need", op: "nudge", actor: "agent", turn: 2, payload: { approach: "what's one thing off your plate?" } }]);
    expect(askPlan(base({ user_name: "Bill", turn: 2 }), "text", needAsked, NOW).pick.hint).toMatch(/wait for the answer/);
    // while the name is being asked, the others wait one at a time; the agent's name waits for value
    const first = askPlan(base(), "text", mindWith([]), NOW);
    expect(first.raise).toBe("get_name");
    expect(first.holds).toEqual({ learn_need: HOLD_ONE_AT_A_TIME, offer_call: HOLD_AFTER_NEED, connect_gmail: HOLD_AFTER_NEED, name_agent: `text only, ${HOLD_AFTER_VALUE}` });
  });

  it("main mode: a forgotten need comes back first, then Gmail as the means, then the name with no value gate, then the agent's name after value or the turn floor", () => {
    const open = mindWith([]);
    expect(nextBestAsk(base({ mode: "main", phase: "collecting", turn: 3 }), "text", open, NOW).slot).toBe("need");
    const s = base({ mode: "main", need: "cancel gym", phase: "collecting", turn: 3, channel_pref: "text" });
    expect(nextBestAsk(s, "text", open, NOW).slot).toBe("gmail");
    // Gmail got a verbal no (snoozed): the name is next, right away, not after some value moment
    const gmailNo = mindWith([
      { id: 10, key: "connect_gmail", op: "nudge", actor: "agent", turn: 2, payload: { approach: "connect Gmail so I can find the contract?" } },
      { id: 11, key: "connect_gmail", op: "outcome", actor: "system", turn: 2, payload: { receptivity: 2, note: "said no" } },
    ]);
    const declined = { ...s, gmail_status: "declined" as const };
    const p = askPlan(declined, "text", gmailNo, NOW);
    expect(p.pick.slot).toBe("user_name");
    expect(p.raise).toBe("get_name");
    expect(p.holds.name_agent).toBe(HOLD_AFTER_VALUE);
    // name known: the agent's name waits for the first useful result or the turn floor, and only in text
    const named = { ...declined, user_name: "Bill" };
    expect(nextBestAsk(named, "text", gmailNo, NOW).slot).toBeNull();
    expect(askPlan(named, "text", gmailNo, NOW).holds.name_agent).toBe(HOLD_AFTER_VALUE);
    expect(nextBestAsk({ ...named, turn: AGENT_NAME_FLOOR_TURN }, "text", gmailNo, NOW).slot).toBe("agent_name");
    expect(nextBestAsk({ ...named, value_moment_at: "2026-09-26T11:00:00Z" }, "text", gmailNo, NOW).slot).toBe("agent_name");
    expect(nextBestAsk({ ...named, turn: 9, value_moment_at: "2026-09-26T11:00:00Z" }, "call", gmailNo, NOW).slot).toBeNull();
  });

  it("an ad-hoc follow-up is the thing to raise only when nothing is to be collected, and the hint names it", () => {
    const m = mindWith([{ id: 10, key: "followup_landlord", op: "open", actor: "agent", turn: 3, payload: { goal: "ask if the landlord replied" } }]);
    const busy = askPlan(base({ turn: 3 }), "text", m, NOW);
    expect(busy.raise).toBe("get_name");
    expect(busy.holds.followup_landlord).toBe(HOLD_ONE_AT_A_TIME);
    expect(busy.pick.hint).not.toMatch(/followup_landlord/);
    const free = askPlan(base({ mode: "main", user_name: "Bill", need: "gym", gmail_status: "connected", gmail_email: "b@x.com", agent_name: "Pip", turn: 3, channel_pref: "text" }), "text", m, NOW);
    expect(free.pick.slot).toBeNull();
    expect(free.raise).toBe("followup_landlord");
    expect(free.pick.hint).toMatch(/On your mind: followup_landlord is eligible now; raise it if it fits\./);
  });

  it("the STATE block carries the turn and the receptivity note", () => {
    const m = mindWith([
      { id: 10, key: "connect_gmail", op: "nudge", actor: "agent", turn: 2, payload: { approach: "so I can find the membership email?" } },
      { id: 11, key: "connect_gmail", op: "outcome", actor: "system", turn: 2, payload: { receptivity: 8, note: "asked if it is read-only" } },
    ]);
    const block = stateBlock(base({ user_name: "Bill", need: "cancel gym", turn: 3, channel_pref: "text" }), "text", m, NOW);
    expect(block).toContain("| turn: 3");
    expect(block).toMatch(/next_best_ask: gmail — .*receptivity 8\/10 \("asked if it is read-only"\)\. Different angle this time: /);
  });
});

describe("the one call offer (offer_call, DESIGN §7)", () => {
  const NOW = Date.parse("2026-09-26T12:00:00Z");
  const seeded = () => BUILTIN_INTENTIONS.map((b, i) => ({ id: i + 1, session_id: "s", ts: "2026-09-26T11:00:00Z", key: b.key, op: "open" as const, actor: "system" as const, turn: 0, payload: seedPayload(b), evidence_ref: null }));
  const mindWith = (extra: Omit<IntentionEvent, "session_id" | "ts" | "evidence_ref">[]) => [...replayMind([...seeded(), ...extra.map((e) => ({ ...e, session_id: "s", ts: "2026-09-26T11:30:00Z", evidence_ref: null }))]).values()];
  const withNeed = (patch: Partial<SessionRow> = {}) => base({ mode: "main", user_name: "Bill", need: "cancel gym", phase: "collecting", turn: 3, ...patch });

  it("is raised right after the need and before Gmail, in text only, while nothing has chosen a channel", () => {
    const p = askPlan(withNeed(), "text", mindWith([]), NOW);
    expect(p.pick.slot).toBeNull();
    expect(p.raise).toBe("offer_call");
    expect(p.pick.hint).toContain(CALL_OFFER_HINT);
    expect(p.holds.connect_gmail).toBe(HOLD_AFTER_CALL_OFFER);
    // the same in onboarding mode with a need on file (legacy rows)
    expect(askPlan(base({ user_name: "Bill", need: "gym" }), "text", mindWith([]), NOW).raise).toBe("offer_call");
    // never on the call channel, never before a need
    expect(askPlan(withNeed(), "call", mindWith([]), NOW).raise).not.toBe("offer_call");
    const early = askPlan(base({ user_name: "Bill" }), "text", mindWith([]), NOW);
    expect(early.raise).toBe("learn_need");
    expect(early.holds.offer_call).toBe(HOLD_AFTER_NEED);
    expect(stateBlock(withNeed(), "text", mindWith([]), NOW)).toContain("next_best_ask: none — They just said what they want done. Offer ONE thing");
  });

  it("is settled by any chosen channel: a yes, a no, or a hangup (channel_pref) means Gmail is next and the offer is held", () => {
    for (const channel_pref of ["text", "call"] as const) {
      const p = askPlan(withNeed({ channel_pref }), "text", mindWith([]), NOW);
      expect(p.pick.slot).toBe("gmail");
      expect(p.holds.offer_call).toBe(HOLD_CHANNEL_CHOSEN);
    }
    expect(askPlan(withNeed({ call_state: "live" }), "text", mindWith([]), NOW).raise).not.toBe("offer_call");
    // answered no through the ledger (done): nothing to hold, Gmail is next
    const declined = mindWith([{ id: 10, key: "offer_call", op: "done", actor: "system", turn: 3, payload: { reason: "prefers text" } }]);
    const p = askPlan(withNeed({ channel_pref: "text" }), "text", declined, NOW);
    expect(p.pick.slot).toBe("gmail");
    expect(p.holds.offer_call).toBeUndefined();
  });

  it("waits while asked, then one more light try after a mere non-answer, and never a third", () => {
    const asked = mindWith([{ id: 10, key: "offer_call", op: "nudge", actor: "agent", turn: 3, payload: { approach: "want me to call you to set up the rest?" } }]);
    const waiting = askPlan(withNeed(), "text", asked, NOW);
    expect(waiting.pick.slot).toBeNull();
    expect(waiting.pick.hint).toMatch(/wait for their answer/);
    expect(waiting.holds.connect_gmail).toBe(HOLD_CALL_OFFER_ASKED);
    const ignoredOnce = mindWith([
      { id: 10, key: "offer_call", op: "nudge", actor: "agent", turn: 3, payload: { approach: "want me to call you to set up the rest?" } },
      { id: 11, key: "offer_call", op: "outcome", actor: "system", turn: 3, payload: { receptivity: 4, note: "talked about the gym instead" } },
    ]);
    // snoozed two turns, then back once
    expect(askPlan(withNeed({ turn: 4 }), "text", ignoredOnce, NOW).raise).toBe("connect_gmail");
    expect(askPlan(withNeed({ turn: 6 }), "text", ignoredOnce, NOW).raise).toBe("offer_call");
    const ignoredTwice = mindWith([
      { id: 10, key: "offer_call", op: "nudge", actor: "agent", turn: 3, payload: { approach: "want me to call you?" } },
      { id: 11, key: "offer_call", op: "outcome", actor: "system", turn: 3, payload: { receptivity: 4 } },
      { id: 12, key: "offer_call", op: "nudge", actor: "agent", turn: 6, payload: { approach: "faster by voice, or here is fine too?" } },
      { id: 13, key: "offer_call", op: "outcome", actor: "system", turn: 6, payload: { receptivity: 4 } },
    ]);
    const rest = askPlan(withNeed({ turn: 20 }), "text", ignoredTwice, NOW + 3 * 3600_000);
    expect(rest.raise).not.toBe("offer_call");
    expect(rest.holds.offer_call).toBe("offered twice, let it rest");
  });

  it("is never treated as an ad-hoc follow-up, and a text-only offer is invisible on a call", () => {
    const m = mindWith([{ id: 10, key: "followup_landlord", op: "open", actor: "agent", turn: 3, payload: { goal: "ask if the landlord replied" } }]);
    const done = askPlan(withNeed({ gmail_status: "connected", gmail_email: "b@x.com", agent_name: "Pip", channel_pref: "text" }), "text", m, NOW);
    expect(done.raise).toBe("followup_landlord");
    const onCall = askPlan(withNeed({ gmail_status: "connected", gmail_email: "b@x.com", agent_name: "Pip" }), "call", m, NOW);
    expect(onCall.raise).toBe("followup_landlord");
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
