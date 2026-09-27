import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CaptionPacer } from "@/lib/voice/captionPacer";

type Reveal = { id: string; text: string; final: boolean };

describe("CaptionPacer", () => {
  let reveals: Reveal[];
  let pacer: CaptionPacer;
  const last = (id = "a") => [...reveals].reverse().find((r) => r.id === id);

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    reveals = [];
    pacer = new CaptionPacer({ onReveal: (id, text, final) => reveals.push({ id, text, final }), charsPerSecond: 10, tickMs: 100 });
  });
  afterEach(() => {
    pacer.dispose();
    vi.useRealTimers();
  });

  it("creates an empty caption on the first delta and reveals whole words at the speaking rate", () => {
    pacer.push("a", "Hello world ");
    pacer.push("a", "this is a test");
    pacer.complete("a");
    expect(reveals[0]).toEqual({ id: "a", text: "", final: false });
    pacer.audioStarted();
    vi.advanceTimersByTime(1_000); // budget 10 chars → only "Hello" is a whole word
    expect(last()?.text).toBe("Hello");
    expect(last()?.final).toBe(false);
    vi.advanceTimersByTime(1_000); // 20 chars → "Hello world this is" (19)
    expect(last()?.text).toBe("Hello world this is");
    vi.advanceTimersByTime(700); // 27 > 26: everything, and it is complete → final
    expect(last()).toEqual({ id: "a", text: "Hello world this is a test", final: true });
  });

  it("the transcript being complete early does not make the caption final early", () => {
    pacer.push("a", "One two three four five six seven eight nine ten");
    pacer.complete("a");
    pacer.audioStarted();
    vi.advanceTimersByTime(2_000);
    expect(last()?.final).toBe(false);
    expect(last()?.text.length).toBeLessThan(48);
  });

  it("audioEnded flushes what is left, makes it final, and recalibrates the rate", () => {
    const text = "x".repeat(29) + " " + "y".repeat(30); // 60 chars
    pacer.push("a", text);
    pacer.complete("a");
    pacer.audioStarted();
    vi.advanceTimersByTime(3_000); // at 10 cps only the first word (29) is out
    expect(last()?.text).toBe("x".repeat(29));
    pacer.audioEnded(); // the audio is over: it was all said, in 3 s → 20 cps measured
    expect(last()).toEqual({ id: "a", text, final: true });
    expect(pacer.rate).toBe(15); // EMA of 10 and 20
  });

  it("an interruption freezes the caption at what was heard", () => {
    pacer.push("a", "Hello world this is a test");
    pacer.complete("a");
    pacer.audioStarted();
    vi.advanceTimersByTime(1_000);
    pacer.audioInterrupted();
    expect(last()).toEqual({ id: "a", text: "Hello", final: true });
    vi.advanceTimersByTime(5_000);
    expect(last()).toEqual({ id: "a", text: "Hello", final: true });
  });

  it("back-to-back responses reveal in order, each after the previous one is out", () => {
    pacer.push("a", "First line here");
    pacer.complete("a");
    pacer.audioStarted();
    pacer.push("b", "Second line");
    pacer.complete("b");
    vi.advanceTimersByTime(1_000);
    expect(last("a")?.text).toBe("First line");
    expect(last("b")?.text).toBe("");
    vi.advanceTimersByTime(600); // 16 chars: a (15) done, b gets nothing yet (one word "Second" needs 6 more)
    expect(last("a")).toEqual({ id: "a", text: "First line here", final: true });
    vi.advanceTimersByTime(700); // 23: b has 8 → "Second"
    expect(last("b")?.text).toBe("Second");
    pacer.audioEnded();
    expect(last("b")).toEqual({ id: "b", text: "Second line", final: true });
  });

  it("still reveals and finalises when no audio events ever arrive", () => {
    pacer.push("a", "No audio events at all");
    pacer.complete("a");
    vi.advanceTimersByTime(2_300);
    expect(last()).toEqual({ id: "a", text: "No audio events at all", final: true });
  });

  it("idle time between responses is not banked: the next line starts from zero", () => {
    pacer.push("a", "Short.");
    pacer.complete("a");
    pacer.audioStarted();
    vi.advanceTimersByTime(700);
    pacer.audioEnded();
    vi.advanceTimersByTime(10_000); // a tool call, then the next response
    pacer.push("b", "Next response with several words in it");
    pacer.complete("b");
    pacer.audioStarted();
    vi.advanceTimersByTime(500);
    expect(last("b")?.text).toBe("Next");
  });

  it("the done event's transcript is authoritative", () => {
    pacer.push("a", "Hello wrld");
    pacer.audioStarted();
    pacer.complete("a", "Hello world");
    vi.advanceTimersByTime(1_200);
    expect(last()).toEqual({ id: "a", text: "Hello world", final: true });
  });
});
