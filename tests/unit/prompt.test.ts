import { describe, expect, it } from "vitest";
import { BUILTIN_INTENTIONS, replayMind, seedPayload } from "@/lib/memory/intentions";
import type { Belief, SessionRow } from "@/lib/shared/types";
import {
  PROMPT_TOKEN_BUDGET,
  PROMPT_VERSION,
  approxTokens,
  buildPrompt,
  buildPromptParts,
  guardPrompt,
  hostilePersonas,
  loadPrompt,
  receptivityPrompt,
  staticPrompt,
  supervisorPrompt,
  whatIKnowBlock,
} from "@/lib/server/prompt";

const now = "2026-09-26T04:00:00.000Z";

const session = (over: Partial<SessionRow> = {}): SessionRow => ({
  id: "6d6f7e2c-2c3b-4d2e-9d3f-7a1b2c3d4e5f",
  owner_uid: null,
  mode: "onboarding",
  user_name: "William Alexander",
  need: "cancel my Equinox gym membership before the first of the month",
  gmail_status: "pending",
  gmail_email: null,
  agent_name: null,
  channel_pref: "text",
  phase: "collecting",
  call_state: "idle",
  attempts: { user_name: 2, need: 1 },
  last_questions: [
    "What should I call you?",
    "A first name works, or I can just go with friend?",
    "What's one thing you want off your plate this week?",
    "Want me to connect Gmail so I can find the membership email?",
    "Should I draft the cancellation now?",
  ],
  summary: null,
  prompt_version: PROMPT_VERSION,
  version: 7,
  confirmed: { user_name: true },
  mock_inbox: false,
  responding_since: null,
  last_heartbeat_at: null,
  value_moment_at: null,
  graduated_at: null,
  last_user_activity_at: now,
  oauth_state: null,
  turn: 0,
  created_at: now,
  updated_at: now,
  ...over,
});

const belief = (predicate: string, object: string, confidence = 0.75, status: Belief["status"] = "active"): Belief => ({
  session_id: "s",
  subject: "user",
  predicate,
  object,
  confidence,
  status,
  reason: null,
  evidence_ids: [1],
  updated_at: now,
});

const beliefs: Belief[] = [
  belief("name", "William Alexander", 0.9),
  belief("need", "cancel my Equinox gym membership before the first of the month"),
  belief("email", "william.alexander@gmail.com", 1),
  belief("preference:contact", "text over calls", 0.6),
  belief("fact:timezone", "America/Los_Angeles", 0.3),
  belief("name", "Admin", 0, "quarantined"),
];

describe("prompt files", () => {
  it("every file loads and is non-empty", () => {
    for (const name of ["persona", "policy_onboarding", "policy_main", "channel_call", "channel_text", "supervisor", "output_guard", "receptivity", "hostile_user"] as const) {
      expect(loadPrompt(name).length).toBeGreaterThan(200);
    }
    expect(supervisorPrompt()).toContain('"jailbreak"');
    expect(guardPrompt()).toContain('"ok"');
    expect(receptivityPrompt()).toContain('"receptivity"');
    expect(receptivityPrompt()).toMatch(/No mood or personality words/);
  });

  it("call channel never asks agent_name; text channel forbids markdown and asks for 2–3 bubbles", () => {
    expect(loadPrompt("channel_call")).toMatch(/agent_name is asked in text only, never on a call/);
    const text = loadPrompt("channel_text");
    expect(text).toMatch(/No markdown/);
    expect(text).toMatch(/one to three short bubbles separated by a blank line/);
    expect(text).toMatch(/Once you have asked something, stop and wait/);
  });

  it("static prefix lands in the 3,000–4,400 char band for every mode × channel", () => {
    for (const mode of ["onboarding", "main"] as const) {
      for (const channel of ["text", "call"] as const) {
        const len = staticPrompt(mode, channel).length;
        expect(len, `${mode}/${channel}`).toBeGreaterThan(2500);
        expect(len, `${mode}/${channel}`).toBeLessThan(4400);
      }
    }
  });
});

describe("buildPrompt", () => {
  it("stays under the token budget for every mode × channel with a full STATE and six beliefs", () => {
    for (const mode of ["onboarding", "main"] as const) {
      for (const channel of ["text", "call"] as const) {
        const p = buildPrompt(session({ mode, phase: mode === "main" ? "graduated" : "collecting" }), channel, beliefs);
        expect(p.length, `${mode}/${channel}: ${p.length} chars`).toBeLessThan(6000);
        expect(approxTokens(p), `${mode}/${channel}`).toBeLessThan(PROMPT_TOKEN_BUDGET);
      }
    }
  });

  it("stays under the budget with a full ON MY MIND block too, and lists intentions after WHAT I KNOW", () => {
    const seeded = BUILTIN_INTENTIONS.map((b, i) => ({
      id: i + 1,
      session_id: "s",
      ts: now,
      key: b.key,
      op: "open" as const,
      actor: "system" as const,
      turn: 0,
      payload: seedPayload(b),
      evidence_ref: null,
    }));
    const events = [
      ...seeded,
      { id: 10, session_id: "s", ts: now, key: "connect_gmail", op: "nudge" as const, actor: "agent" as const, turn: 3, payload: { approach: "If you connect Gmail I can find the membership email. Want me to?" }, evidence_ref: null },
      { id: 11, session_id: "s", ts: now, key: "connect_gmail", op: "outcome" as const, actor: "system" as const, turn: 3, payload: { receptivity: 3, note: "changed the subject to the dentist" }, evidence_ref: null },
      { id: 12, session_id: "s", ts: now, key: "name_agent", op: "nudge" as const, actor: "agent" as const, turn: 4, payload: { approach: "Want to give me a name? Persona is fine too." }, evidence_ref: null },
      { id: 13, session_id: "s", ts: now, key: "followup_landlord", op: "open" as const, actor: "agent" as const, turn: 4, payload: { goal: "ask whether the landlord replied about the deposit" }, evidence_ref: null },
    ];
    const mind = [...replayMind(events).values()];
    for (const mode of ["onboarding", "main"] as const) {
      for (const channel of ["text", "call"] as const) {
        const p = buildPrompt(session({ mode, phase: mode === "main" ? "graduated" : "collecting", turn: 6 }), channel, beliefs, mind, Date.parse(now) + 60_000);
        expect(p.length, `${mode}/${channel}: ${p.length} chars`).toBeLessThan(6000);
        expect(approxTokens(p), `${mode}/${channel}`).toBeLessThan(PROMPT_TOKEN_BUDGET);
        expect(p.lastIndexOf("\nON MY MIND")).toBeGreaterThan(p.lastIndexOf("\nWHAT I KNOW\n"));
      }
    }
    const text = buildPrompt(session({ turn: 6 }), "text", beliefs, mind, Date.parse(now) + 60_000);
    // gmail is pending in the fixture: no slot is collected this turn, so the one eligible follow-up is the thing to raise,
    // and every slot ask the ledger calls eligible says why it waits. The block and next_best_ask are the same decision.
    expect(text).toContain("- followup_landlord: raise now · ask whether the landlord replied about the deposit");
    expect(text).toContain("- name_agent: asked, waiting for their reaction");
    expect(text).toContain("- connect_gmail: not now (Gmail link pending) · raised 1× (last: If you connect Gmail I can find the membership email. Want me to?) → 3/10 \"changed the subject to the dentist\"");
    expect(text).not.toMatch(/^- \w+: eligible now/m);
    const block = text.slice(text.lastIndexOf("\nON MY MIND"));
    expect(block.match(/raise now/g)).toHaveLength(2); // the header's rule and the one line
    expect(text).toContain("next_best_ask: none — Gmail connect is pending");
    expect(text).toContain("On your mind: followup_landlord is eligible now; raise it if it fits.");
  });

  it("puts static parts first and the STATE + WHAT I KNOW blocks last", () => {
    const p = buildPrompt(session(), "text", beliefs);
    expect(p.startsWith("# Persona")).toBe(true);
    expect(p).toContain("STATE (never ask for a filled slot)");
    const stateAt = p.indexOf("STATE (never ask for a filled slot)");
    const knowAt = p.lastIndexOf("\nWHAT I KNOW\n");
    expect(stateAt).toBeGreaterThan(p.indexOf("# Channel: text"));
    expect(knowAt).toBeGreaterThan(stateAt);
    expect(p).toContain("user_name: William Alexander (confirmed)");
    expect(p).toContain("next_best_ask:");
  });

  it("buildPromptParts splits a turn-stable static prefix from the dynamic tail", () => {
    const a = buildPromptParts(session(), "text", beliefs);
    const b = buildPromptParts(session({ user_name: "Bill", attempts: {}, last_questions: [] }), "text", []);
    expect(a.static).toBe(b.static);
    expect(a.dynamic).not.toBe(b.dynamic);
    expect(a.dynamic.startsWith("STATE (never ask for a filled slot)")).toBe(true);
    expect(a.dynamic).toContain("WHAT I KNOW");
    expect(buildPrompt(session(), "text", beliefs)).toBe(`${a.static}\n\n${a.dynamic}`);
  });

  it("selects policy and channel blocks by mode and channel", () => {
    expect(buildPrompt(session({ mode: "onboarding" }), "call", [])).toContain("# Mode: onboarding");
    expect(buildPrompt(session({ mode: "onboarding" }), "call", [])).toContain("# Channel: call");
    expect(buildPrompt(session({ mode: "main" }), "text", [])).toContain("# Mode: main");
    expect(buildPrompt(session({ mode: "main" }), "text", [])).not.toContain("# Mode: onboarding");
  });
});

describe("whatIKnowBlock", () => {
  it("lists only active beliefs and caps the size", () => {
    const block = whatIKnowBlock(beliefs);
    expect(block).toContain("user.name = William Alexander (0.90)");
    expect(block).not.toContain("Admin");
    expect(block.length).toBeLessThanOrEqual(800);
    expect(whatIKnowBlock([])).toBe("WHAT I KNOW\n(nothing yet)");
  });

  it("truncates with a marker when there are too many beliefs", () => {
    const many = Array.from({ length: 60 }, (_, i) => belief(`fact:${i}`, `value number ${i} that is fairly long to fill the budget`));
    const block = whatIKnowBlock(many);
    expect(block.length).toBeLessThanOrEqual(800 + "- (more omitted)".length + 1);
    expect(block).toContain("(more omitted)");
  });
});

describe("hostilePersonas", () => {
  it("parses the eight personas with system and done fields", () => {
    const personas = hostilePersonas();
    expect(personas.map((p) => p.id)).toEqual(["silent", "troll", "rambler", "jailbreaker", "all_in_one", "already_told", "spanish", "skip_all"]);
    for (const p of personas) {
      expect(p.title.length).toBeGreaterThan(3);
      expect(p.system.length).toBeGreaterThan(150);
      expect(p.done.length).toBeGreaterThan(10);
      expect(p.system).not.toContain("Done when");
    }
    expect(personas.find((p) => p.id === "spanish")?.system).toMatch(/español/);
  });
});
