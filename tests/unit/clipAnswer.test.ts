import { describe, expect, it } from "vitest";
import { clipCaptureFrom, clipClosedHint } from "@/lib/server/clipAnswer";
import { inLatestBurst, targetOf } from "@/lib/server/brain/tapback";
import { APP_CLIP_CARD, APP_CLIP_SUBTITLE_MAX, APP_CLIP_TITLE_MAX, callOfferAnswer, CLIP_SCREENS, CLIP_STEPS, ClipAnswerSchema, clipStateFrom } from "@/lib/shared/clip";
import type { EventRow, MessageRow, SessionRow } from "@/lib/shared/types";

const base = (patch: Partial<SessionRow> = {}): SessionRow => ({
  id: "00000000-0000-4000-8000-000000000009",
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
  created_at: "2026-09-27T00:00:00Z",
  updated_at: "2026-09-27T00:00:00Z",
  ...patch,
});

let eid = 1;
const ev = (type: string, payload: Record<string, unknown> = {}): EventRow => ({ id: eid++, session_id: "s", type, payload, created_at: "2026-09-27T00:00:00Z" });

describe("App Clip contract", () => {
  it("the card copy respects the HIG limits and the steps/screens are in order", () => {
    expect(APP_CLIP_CARD.title.length).toBeLessThanOrEqual(APP_CLIP_TITLE_MAX);
    expect(APP_CLIP_CARD.subtitle.length).toBeLessThanOrEqual(APP_CLIP_SUBTITLE_MAX);
    expect(CLIP_STEPS).toEqual(["user_name", "agent_name", "gmail", "call_offer"]);
    expect(CLIP_SCREENS[0]).toBe("welcome");
    expect(CLIP_SCREENS.at(-1)).toBe("done");
  });

  it("answers are session id + step + value; skip is a value", () => {
    expect(ClipAnswerSchema.safeParse({ session_id: base().id, step: "user_name", value: "Bill" }).success).toBe(true);
    expect(ClipAnswerSchema.safeParse({ session_id: base().id, step: "gmail", value: "skip" }).success).toBe(true);
    expect(ClipAnswerSchema.safeParse({ session_id: base().id, step: "need", value: "x" }).success).toBe(false);
    expect(ClipAnswerSchema.safeParse({ session_id: "nope", step: "user_name", value: "Bill" }).success).toBe(false);
    expect(ClipAnswerSchema.safeParse({ session_id: base().id, step: "user_name", value: "" }).success).toBe(false);
  });

  it("reads the call answer loosely", () => {
    expect(callOfferAnswer("yes")).toBe("yes");
    expect(callOfferAnswer("Call me now")).toBe("yes");
    expect(callOfferAnswer("no")).toBe("no");
    expect(callOfferAnswer("I'll text")).toBe("no");
    expect(callOfferAnswer("skip")).toBe("skip");
    expect(callOfferAnswer("maybe later")).toBe("skip");
  });

  it("clipStateFrom: filled, skipped and empty steps; the call offer follows channel_pref and the intention", () => {
    const empty = clipStateFrom(base(), [], false);
    expect(empty.steps).toEqual({ user_name: "empty", agent_name: "empty", gmail: "empty", call_offer: "empty" });
    expect(empty.call_offer).toBe("unasked");
    expect(empty.google_configured).toBe(false);
    const full = clipStateFrom(base({ user_name: "Bill", agent_name: "Jarvis", gmail_status: "connected", gmail_email: "b@x.com", channel_pref: "call" }), [{ key: "offer_call", status: "done" }], true);
    expect(full.steps).toEqual({ user_name: "filled", agent_name: "filled", gmail: "filled", call_offer: "filled" });
    expect(full.call_offer).toBe("yes");
    const skipped = clipStateFrom(base({ attempts: { user_name: 3 }, gmail_status: "declined", channel_pref: "text" }), [{ key: "offer_call", status: "done" }], true);
    expect(skipped.steps.user_name).toBe("skipped");
    expect(skipped.steps.gmail).toBe("skipped");
    expect(skipped.call_offer).toBe("no");
    // a hangup set channel_pref without the offer ever being answered
    expect(clipStateFrom(base({ channel_pref: "text" }), [{ key: "offer_call", status: "open" }], true).call_offer).toBe("prefers_text");
  });
});

describe("what the clip captured (for the relay)", () => {
  it("counts only answers since the clip was last opened, splits skips, keeps the call answer and Google", () => {
    const events = [
      ev("app_clip_opened"),
      ev("app_clip_answer", { step: "user_name", ok: true, skipped: false }),
      ev("app_clip_answer", { step: "call_offer", ok: true, skipped: false, answer: "no" }),
      ev("app_clip_opened"), // reopened: the earlier capture is history
      ev("app_clip_answer", { step: "agent_name", ok: false, skipped: false, error: "slur" }),
      ev("app_clip_answer", { step: "agent_name", ok: true, skipped: false }),
      ev("app_clip_answer", { step: "gmail", ok: true, skipped: true }),
      ev("oauth_started", { via: "clip" }),
      ev("app_clip_answer", { step: "call_offer", ok: true, skipped: false, answer: "yes" }),
    ];
    const cap = clipCaptureFrom(events);
    expect(cap.opened).toBe(true);
    expect(cap.answered).toEqual(["agent_name"]);
    expect(cap.skipped).toEqual(["gmail"]);
    expect(cap.call_offer).toBe("yes");
    expect(cap.gmail_started_in_clip).toBe(true);
    // Google finished from the clip counts as answered
    const connected = clipCaptureFrom([ev("app_clip_opened"), ev("oauth_started", { via: "clip" }), ev("oauth_success", { email: "b@x.com" })]);
    expect(connected.answered).toEqual(["gmail"]);
    // never opened: nothing
    expect(clipCaptureFrom([]).opened).toBe(false);
    expect(clipCaptureFrom([ev("oauth_started", { via: "chat" }), ev("oauth_success")]).answered).toEqual([]);
  });

  it("the relay hint is built from the session row, uses the name, and says what is missing", () => {
    const s = base({ user_name: "Bill", agent_name: "Jarvis", gmail_status: "connected", gmail_email: "bill@x.com", channel_pref: "text" });
    const done = clipClosedHint(s, { answered: ["user_name", "agent_name", "gmail"], skipped: [], call_offer: "no", gmail_started_in_clip: true, opened: true }, false);
    expect(done).toContain("name Bill");
    expect(done).toContain("what to call you Jarvis");
    expect(done).toContain("Google connected as bill@x.com");
    expect(done).toContain("call no, keep it in text and never offer again");
    expect(done).toContain("never re-ask any of it");
    expect(done).not.toContain("They left before the end");
    const partial = clipClosedHint(base({ user_name: "Bill" }), { answered: ["user_name"], skipped: [], gmail_started_in_clip: false, opened: true }, false);
    expect(partial).toContain("what to call you not given");
    expect(partial).toContain("Google not reached");
    expect(partial).toContain("call not asked");
    expect(partial).toContain("They left before the end");
    const ringing = clipClosedHint(base({ user_name: "Bill", channel_pref: "call" }), { answered: ["user_name"], skipped: ["agent_name"], call_offer: "yes", gmail_started_in_clip: false, opened: true }, true);
    expect(ringing).toContain("call yes, you are ringing them now");
    expect(ringing).toContain("No question this turn");
    expect(ringing).toContain("what to call you skipped (Persona is fine)");
  });
});

describe("tapbacks as answers", () => {
  const row = (over: Partial<MessageRow>): MessageRow => ({ id: 1, session_id: "s", client_id: null, channel: "text", role: "assistant", kind: "text", content: null, payload: {}, created_at: "2026-09-27T00:00:00Z", ...over });
  const thread = [
    row({ id: 1, role: "user", client_id: "u1", content: "hey" }),
    row({ id: 2, content: "Hey! What should I call you?" }),
    row({ id: 3, content: "Want me to call you to set up the rest?" }),
    row({ id: 4, role: "user", client_id: "u2", content: "hmm" }),
    row({ id: 5, content: "No rush. Want me to call you to set up the rest?" }),
  ];
  it("resolves the target by row id or client id, and only the assistant's latest burst counts", () => {
    expect(targetOf(thread, row({ id: 9, kind: "tapback", payload: { target_id: 5 } }))?.id).toBe(5);
    expect(targetOf(thread, row({ id: 9, kind: "tapback", payload: { target_client_id: "u2" } }))?.id).toBe(4);
    expect(targetOf(thread, row({ id: 9, kind: "tapback", payload: {} }))).toBeUndefined();
    expect(inLatestBurst(thread, thread[4])).toBe(true);
    expect(inLatestBurst(thread, thread[2])).toBe(false); // the user texted since
    expect(inLatestBurst(thread, thread[3])).toBe(false); // their own bubble
  });
});
