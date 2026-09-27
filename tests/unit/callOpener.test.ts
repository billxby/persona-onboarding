import { describe, expect, it } from "vitest";
import { CALL_OPENER_UNKNOWN, callOpenerNote } from "@/lib/server/callOpener";

describe("callOpenerNote", () => {
  it("scripts the opener word for word when nothing is known", () => {
    const note = callOpenerNote({ user_name: null, need: null });
    expect(note).toContain(CALL_OPENER_UNKNOWN);
    expect(note).toMatch(/word for word/);
    expect(note).toMatch(/then stop/);
  });

  it("greets by name and asks for the task when only the name is known", () => {
    const note = callOpenerNote({ user_name: "Bill", need: null });
    expect(note).toContain("Hey Bill. What's one thing I can take off your plate this week?");
    expect(note).toMatch(/word for word/);
  });

  it("picks the task up when it is known", () => {
    expect(callOpenerNote({ user_name: "Bill", need: "cancel the gym membership" })).toContain("greet Bill by name and pick up their task (cancel the gym membership)");
    const nameless = callOpenerNote({ user_name: null, need: "cancel the gym membership" });
    expect(nameless).toContain("cancel the gym membership");
    expect(nameless).toMatch(/ask what to call them/);
  });

  it("treats blank values as unknown", () => {
    expect(callOpenerNote({ user_name: "  ", need: "" })).toContain(CALL_OPENER_UNKNOWN);
  });
});
