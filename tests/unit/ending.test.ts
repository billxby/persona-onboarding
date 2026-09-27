import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CallEnder } from "@/lib/voice/ending";
import type { CallEndReason } from "@/lib/session/types";

describe("CallEnder", () => {
  let ended: CallEndReason[];
  let ender: CallEnder;
  beforeEach(() => {
    vi.useFakeTimers();
    ended = [];
    ender = new CallEnder({ finish: (r) => ended.push(r), tailMs: 500, maxMs: 15_000 });
  });
  afterEach(() => {
    ender.cancel();
    vi.useRealTimers();
  });

  it("requested mid-sentence: ends a beat after the audio has ended, not before", () => {
    ender.audioStarted();
    ender.request("bot_hangup");
    vi.advanceTimersByTime(8_000);
    expect(ended).toEqual([]);
    ender.audioEnded();
    vi.advanceTimersByTime(499);
    expect(ended).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(ended).toEqual(["bot_hangup"]);
  });

  it("requested in silence: waits for the goodbye to start, then for it to end", () => {
    ender.request("silence", { awaitAudioMs: 6_000 });
    vi.advanceTimersByTime(2_000);
    ender.audioStarted(); // the goodbye
    vi.advanceTimersByTime(10_000);
    expect(ended).toEqual([]);
    ender.audioEnded();
    vi.advanceTimersByTime(500);
    expect(ended).toEqual(["silence"]);
  });

  it("requested in silence with nothing forthcoming: ends after the await window", () => {
    ender.request("bot_hangup", { awaitAudioMs: 800 });
    vi.advanceTimersByTime(799);
    expect(ended).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(ended).toEqual(["bot_hangup"]);
  });

  it("a second response inside the tail keeps the line open until it ends too", () => {
    ender.audioStarted();
    ender.request("bot_hangup");
    ender.audioEnded();
    vi.advanceTimersByTime(300);
    ender.audioStarted(); // "I'm on it. Watch the chat."
    vi.advanceTimersByTime(3_000);
    expect(ended).toEqual([]);
    ender.audioEnded();
    vi.advanceTimersByTime(500);
    expect(ended).toEqual(["bot_hangup"]);
  });

  it("never hangs open: the cap ends the call even if the audio never ends", () => {
    ender.audioStarted();
    ender.request("bot_hangup");
    vi.advanceTimersByTime(15_000);
    expect(ended).toEqual(["bot_hangup"]);
  });

  it("the first request's reason wins; it ends exactly once", () => {
    ender.audioStarted();
    ender.request("silence");
    ender.request("bot_hangup");
    ender.audioEnded();
    vi.advanceTimersByTime(500);
    ender.audioEnded();
    vi.advanceTimersByTime(20_000);
    expect(ended).toEqual(["silence"]);
  });

  it("cancel drops a pending end", () => {
    ender.request("bot_hangup");
    ender.cancel();
    vi.advanceTimersByTime(20_000);
    expect(ended).toEqual([]);
  });
});
