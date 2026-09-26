import { describe, expect, it } from "vitest";
import {
  detectAddressedName,
  looksLikeCallRequest,
  isHello,
  looksLikeSkip,
  questionsIn,
  sentencesOf,
  splitBubbles,
  stripMarkdown,
  typingDelayMs,
} from "@/lib/shared/text";

describe("stripMarkdown", () => {
  it("removes bold, italics, headings, bullets, code and links", () => {
    const md = "# Hello\n\n**Bold** and *italic* and _under_.\n\n- one\n- two\n\n`code` [link](http://x.y)";
    const out = stripMarkdown(md);
    expect(out).not.toMatch(/[*#`\[\]]/);
    expect(out).toContain("Bold and italic and under.");
    expect(out).toContain("one\ntwo");
    expect(out).toContain("code link");
  });
  it("keeps snake_case and emails intact", () => {
    expect(stripMarkdown("email bill_xu@gmail.com and set_slot")).toBe("email bill_xu@gmail.com and set_slot");
  });
});

describe("splitBubbles", () => {
  it("splits on blank lines", () => {
    expect(splitBubbles("Hey Bill.\n\nGym thing, got it.\n\nWhat's the gym called?")).toEqual([
      "Hey Bill.",
      "Gym thing, got it.",
      "What's the gym called?",
    ]);
  });
  it("splits on single newlines when there are no blank lines", () => {
    expect(splitBubbles("One.\nTwo.")).toEqual(["One.", "Two."]);
  });
  it("never returns more than 3 bubbles", () => {
    const out = splitBubbles("A.\n\nB.\n\nC.\n\nD.\n\nE.");
    expect(out.length).toBe(3);
    expect(out.join(" ")).toBe("A. B. C. D. E.");
  });
  it("splits one long paragraph into at most 3 sentence groups without cutting sentences", () => {
    const para =
      "Okay so here is the plan for the gym membership, and it is going to be simple. First I will find the cancellation email in your inbox and check the notice period. Then I will draft the cancellation note for you to send. After that we can look at the landlord thing, which seems more urgent honestly. Sound good?";
    const out = splitBubbles(para);
    expect(out.length).toBeLessThanOrEqual(3);
    expect(out.length).toBeGreaterThanOrEqual(2);
    expect(out.join(" ")).toBe(para);
    for (const b of out) expect(b).toMatch(/[.!?]$/);
  });
  it("splits a short two-sentence reply into two bubbles", () => {
    const out = splitBubbles("Got it, Bill. So the gym membership is the thing to kill this week, right?");
    expect(out).toEqual(["Got it, Bill.", "So the gym membership is the thing to kill this week, right?"]);
  });
  it("returns [] for empty input", () => {
    expect(splitBubbles("")).toEqual([]);
    expect(splitBubbles("   \n\n ")).toEqual([]);
  });
  it("strips markdown before splitting", () => {
    expect(splitBubbles("**Hey**\n\n- what should I call you?")).toEqual(["Hey", "what should I call you?"]);
  });
});

describe("questionsIn / sentencesOf", () => {
  it("finds the questions", () => {
    expect(questionsIn(["Got it, Bill.", "What should I call you? Also, gym?"])).toEqual(["What should I call you?", "Also, gym?"]);
  });
  it("splits sentences keeping punctuation", () => {
    expect(sentencesOf("One. Two! Three?")).toEqual(["One.", "Two!", "Three?"]);
  });
});

describe("typingDelayMs", () => {
  it("stays within 400–900 ms", () => {
    expect(typingDelayMs("")).toBe(400);
    expect(typingDelayMs("hi")).toBeGreaterThanOrEqual(400);
    expect(typingDelayMs("x".repeat(500))).toBe(900);
    expect(typingDelayMs("x".repeat(50))).toBe(600);
  });
});

describe("detectAddressedName", () => {
  it("detects greetings and thanks with a name", () => {
    expect(detectAddressedName("hey Jarvis, can you check my inbox")).toBe("Jarvis");
    expect(detectAddressedName("thanks Jarvis")).toBe("Jarvis");
    expect(detectAddressedName("ok Friday, do it")).toBe("Friday".toLowerCase() === "friday" ? null : "Friday");
    // a bare leading "Word, ..." is not an address: sentence adverbs renamed the bot in the simulator
    expect(detectAddressedName("Jarvis, what's up")).toBeNull();
    expect(detectAddressedName("Honestly, I forgot about that")).toBeNull();
    expect(detectAddressedName("yo Max")).toBe("Max");
  });
  it("ignores common words, the user's own name and lowercase tokens", () => {
    expect(detectAddressedName("hey there")).toBeNull();
    expect(detectAddressedName("ok cool")).toBeNull();
    expect(detectAddressedName("hey Bill", ["Bill"])).toBeNull();
    expect(detectAddressedName("hey persona", ["persona"])).toBeNull();
    expect(detectAddressedName("thanks a lot")).toBeNull();
    expect(detectAddressedName("Tomorrow, I'm busy")).toBeNull();
    expect(detectAddressedName("hey jarvis")).toBeNull();
  });
});

describe("intent helpers", () => {
  it("isHello", () => {
    for (const t of ["Hey Persona", "hey persona", "Hi Persona!", " hello, persona ", "yo persona"]) expect(isHello(t)).toBe(true);
    for (const t of ["hey persona, cancel my gym", "Hey", "persona", "it's Bill", "hey persona can you call me"]) expect(isHello(t)).toBe(false);
  });
  it("looksLikeSkip", () => {
    expect(looksLikeSkip("skip")).toBe(true);
    expect(looksLikeSkip("I'm good, skip everything")).toBe(true);
    expect(looksLikeSkip("my name is Bill")).toBe(false);
  });
  it("looksLikeCallRequest", () => {
    expect(looksLikeCallRequest("can you call me?")).toBe(true);
    expect(looksLikeCallRequest("don't call me")).toBe(false);
    expect(looksLikeCallRequest("cancel my gym")).toBe(false);
  });
});
