import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { callLogContent, formatCallDuration, GOODBYE_RE, isCallEndReason, itemUuid } from "@/lib/server/call";
import { SilenceWatcher, type SilenceTier } from "@/lib/voice/silence";

describe("GOODBYE_RE", () => {
  it("matches goodbye lines", () => {
    for (const line of ["Bye for now!", "Talk soon, Bill.", "I'm on it. Watch the chat.", "Catch you later", "Goodbye!", "Im on it"]) {
      expect(GOODBYE_RE.test(line)).toBe(true);
    }
  });
  it("ignores ordinary lines", () => {
    for (const line of ["What should I call you?", "So the gym thing.", "Button's on your screen, read-only. I'll wait.", "Bygones aside"]) {
      expect(GOODBYE_RE.test(line)).toBe(false);
    }
  });
});

describe("call helpers", () => {
  it("formats durations", () => {
    expect(formatCallDuration(0)).toBe("0:00");
    expect(formatCallDuration(84_000)).toBe("1:24");
    expect(formatCallDuration(3_599_000)).toBe("59:59");
  });
  it("writes call log rows per reason", () => {
    expect(callLogContent("declined", 0)).toBe("Missed call");
    expect(callLogContent("dropped", 5_000)).toBe("Call dropped");
    expect(callLogContent("user_hangup", 84_000)).toBe("Call ended · 1:24");
    expect(callLogContent("mic_denied", 0)).toMatch(/no microphone/);
  });
  it("validates end reasons", () => {
    expect(isCallEndReason("silence")).toBe(true);
    expect(isCallEndReason("nope")).toBe(false);
  });
  it("derives a deterministic, well-formed uuid per item id", () => {
    const a = itemUuid("11111111-1111-4111-8111-111111111111", "item_abc");
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(itemUuid("11111111-1111-4111-8111-111111111111", "item_abc")).toBe(a);
    expect(itemUuid("11111111-1111-4111-8111-111111111111", "item_abd")).not.toBe(a);
    expect(itemUuid("22222222-1111-4111-8111-111111111111", "item_abc")).not.toBe(a);
  });
});

describe("SilenceWatcher", () => {
  let tiers: SilenceTier[];
  let w: SilenceWatcher;
  beforeEach(() => {
    vi.useFakeTimers();
    tiers = [];
    w = new SilenceWatcher({ onTier: (t) => tiers.push(t) });
    w.start();
  });
  afterEach(() => {
    w.stop();
    vi.useRealTimers();
  });

  it("fires 6 / 12 / 20 s tiers from the first assistant audio stop; check-ins do not reset the clock", () => {
    w.onAssistantAudioStopped();
    vi.advanceTimersByTime(5_999);
    expect(tiers).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(tiers).toEqual([1]);
    w.onAssistantAudioStopped(); // the check-in's own audio ended
    vi.advanceTimersByTime(6_000);
    expect(tiers).toEqual([1, 2]);
    w.onAssistantAudioStopped();
    vi.advanceTimersByTime(7_999);
    expect(tiers).toEqual([1, 2]);
    vi.advanceTimersByTime(1);
    expect(tiers).toEqual([1, 2, 3]);
    expect(w.unansweredCheckIns).toBe(3);
  });

  it("user speech resets everything", () => {
    w.onAssistantAudioStopped();
    vi.advanceTimersByTime(7_000);
    expect(tiers).toEqual([1]);
    w.onUserSpeechStart();
    expect(w.isSilent).toBe(false);
    vi.advanceTimersByTime(30_000);
    expect(tiers).toEqual([1]);
    w.onAssistantAudioStopped();
    vi.advanceTimersByTime(6_000);
    expect(tiers).toEqual([1, 1]);
  });

  it("stretches every tier ×3 while Gmail is pending, even mid-silence", () => {
    w.setGmailPending(true);
    w.onAssistantAudioStopped();
    vi.advanceTimersByTime(17_999);
    expect(tiers).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(tiers).toEqual([1]);
    vi.advanceTimersByTime(18_000);
    expect(tiers).toEqual([1, 2]);
    w.setGmailPending(false); // connect finished at t=36 s: tier 3 (20 s) is overdue → fires now
    vi.advanceTimersByTime(0);
    expect(tiers).toEqual([1, 2, 3]);
  });

  it("does nothing before start() or after stop()", () => {
    const quiet: SilenceTier[] = [];
    const idle = new SilenceWatcher({ onTier: (t) => quiet.push(t) });
    idle.onAssistantAudioStopped();
    vi.advanceTimersByTime(60_000);
    expect(quiet).toEqual([]);
    w.onAssistantAudioStopped();
    w.stop();
    vi.advanceTimersByTime(60_000);
    expect(tiers).toEqual([]);
  });
});
