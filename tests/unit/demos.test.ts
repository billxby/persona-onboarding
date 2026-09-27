import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

describe("DEMO sessions", () => {
  it("data/demo_sessions.json lists valid session ids with short labels", () => {
    const json = JSON.parse(fs.readFileSync(path.join(process.cwd(), "data", "demo_sessions.json"), "utf8")) as { sessions: { id: string; label?: string }[] };
    expect(Array.isArray(json.sessions)).toBe(true);
    expect(json.sessions.length).toBeGreaterThan(0);
    for (const s of json.sessions) {
      expect(s.id).toMatch(UUID);
      if (s.label) expect(s.label.length).toBeLessThanOrEqual(120);
    }
    expect(new Set(json.sessions.map((s) => s.id)).size).toBe(json.sessions.length);
  });
});
