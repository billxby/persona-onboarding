import { beforeEach, describe, expect, it } from "vitest";
import { ToolBatch } from "@/lib/voice/toolBatch";

describe("ToolBatch", () => {
  let continued: number;
  let tb: ToolBatch;
  beforeEach(() => {
    continued = 0;
    tb = new ToolBatch(() => (continued += 1));
  });

  it("two tool calls in one response continue the turn once, after both have returned", () => {
    tb.announce();
    const a = tb.current;
    tb.announce();
    const b = tb.current;
    tb.close(2);
    tb.returned(a);
    expect(continued).toBe(0);
    tb.returned(b);
    expect(continued).toBe(1);
  });

  it("tools that return before response.done continue at response.done", () => {
    tb.announce();
    const a = tb.current;
    tb.returned(a);
    expect(continued).toBe(0);
    tb.close(1);
    expect(continued).toBe(1);
  });

  it("a response without tool calls does nothing", () => {
    tb.close(0);
    expect(continued).toBe(0);
  });

  it("a hang-up tool never continues the turn", () => {
    tb.announce();
    const a = tb.current;
    tb.close(1);
    tb.returned(a, { hangUp: true });
    expect(continued).toBe(0);
  });

  it("the user talking over the tools means server VAD answers, not us", () => {
    tb.announce();
    const a = tb.current;
    tb.close(1);
    tb.userSpoke();
    tb.returned(a);
    expect(continued).toBe(0);
    // and the next turn is clean
    tb.announce();
    const b = tb.current;
    tb.close(1);
    tb.returned(b);
    expect(continued).toBe(1);
  });

  it("user speech before any tool call is ordinary turn-taking, not an override", () => {
    tb.userSpoke();
    tb.announce();
    const a = tb.current;
    tb.close(1);
    tb.returned(a);
    expect(continued).toBe(1);
  });

  it("a late return from a superseded batch is ignored", () => {
    tb.announce();
    const stale = tb.current;
    tb.close(1);
    tb.announce(); // a new response's tool call while the old one is still out
    const fresh = tb.current;
    tb.close(1);
    tb.returned(stale);
    expect(continued).toBe(0);
    tb.returned(fresh);
    expect(continued).toBe(1);
  });

  it("consecutive batches each continue once", () => {
    for (let i = 0; i < 3; i++) {
      tb.announce();
      const t = tb.current;
      tb.close(1);
      tb.returned(t);
    }
    expect(continued).toBe(3);
  });
});
