import { describe, expect, it } from "vitest";
import { containsSlur, contentTokens, isProfane, validateName, validateNeed } from "@/lib/server/validators";
import { toolJsonSchemas, TOOL_NAMES } from "@/lib/server/tools/definitions";

describe("validateName", () => {
  it("accepts ordinary names and normalises casing", () => {
    expect(validateName("bill", "user_name")).toEqual({ ok: true, value: "Bill" });
    expect(validateName("  bill   xu ", "user_name")).toEqual({ ok: true, value: "Bill Xu" });
    expect(validateName("José", "user_name")).toEqual({ ok: true, value: "José" });
    expect(validateName("mary-ann", "user_name")).toEqual({ ok: true, value: "Mary-Ann" });
    expect(validateName("o'brien", "user_name")).toEqual({ ok: true, value: "O'Brien" });
    expect(validateName("McDonald", "user_name")).toEqual({ ok: true, value: "McDonald" });
    expect(validateName("Jarvis.", "agent_name")).toEqual({ ok: true, value: "Jarvis" });
    expect(validateName("小明", "user_name")).toEqual({ ok: true, value: "小明" });
  });

  it("rejects blocklisted values playfully", () => {
    const r = validateName("Admin", "user_name");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.severity).toBe("playful");
    expect(validateName("null", "user_name").ok).toBe(false);
    expect(validateName("assistant", "agent_name").ok).toBe(false);
  });

  it("rejects profanity playfully and slurs hard", () => {
    const p = validateName("Shithead", "user_name");
    expect(p.ok).toBe(false);
    if (!p.ok) expect(p.severity).toBe("playful");
    const s = validateName("nigger", "user_name");
    expect(s.ok).toBe(false);
    if (!s.ok) {
      expect(s.severity).toBe("hard");
      expect(s.reason).toBe("slur");
    }
    expect(containsSlur("call me f-a-g-g-o-t")).toBe(true);
    expect(containsSlur("spice girl")).toBe(false);
    expect(isProfane("what the fuck")).toBe(true);
    expect(isProfane("scunthorpe")).toBe(false);
    expect(isProfane("Hancock")).toBe(false);
    expect(validateName("Hancock", "user_name")).toEqual({ ok: true, value: "Hancock" });
  });

  it("rejects keyboard mash, numbers and long values", () => {
    expect(validateName("xkcdfg", "user_name").ok).toBe(false);
    expect(validateName("aaaaaa", "user_name").ok).toBe(false);
    expect(validateName("bill123", "user_name").ok).toBe(false);
    expect(validateName("a".repeat(41), "user_name").ok).toBe(false);
    expect(validateName("one two three four", "user_name").ok).toBe(false);
    expect(validateName("", "user_name").ok).toBe(false);
  });
});

describe("validateNeed", () => {
  it("accepts concrete tasks", () => {
    expect(validateNeed("cancel my gym membership")).toEqual({ ok: true, value: "cancel my gym membership" });
    expect(validateNeed("**Reply to my landlord**")).toEqual({ ok: true, value: "Reply to my landlord" });
  });
  it("rejects filler", () => {
    for (const f of ["idk", "nothing", "stuff", "…", "no", "help", "i don't know"]) expect(validateNeed(f).ok, f).toBe(false);
    expect(validateNeed("a".repeat(201)).ok).toBe(false);
  });
});

describe("contentTokens", () => {
  it("drops stopwords and short words", () => {
    expect(contentTokens("cancel my gym membership")).toEqual(["cancel", "gym", "membership"]);
  });
});

describe("toolJsonSchemas", () => {
  it("emits strict function schemas for the call channel without agent-text-only gaps", () => {
    const schemas = toolJsonSchemas("call");
    expect(schemas.map((s) => s.name)).toEqual([...TOOL_NAMES]);
    for (const s of schemas) {
      expect(s.type).toBe("function");
      expect(s.parameters.type).toBe("object");
      expect(s.parameters.additionalProperties).toBe(false);
      expect(s.parameters).not.toHaveProperty("$schema");
      const props = s.parameters.properties as Record<string, unknown>;
      expect(s.parameters.required).toEqual(Object.keys(props));
    }
    expect(toolJsonSchemas("text").map((s) => s.name)).not.toContain("end_call");
  });
});
