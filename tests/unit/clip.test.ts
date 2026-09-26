import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { APP_CLIP_CARD, APP_CLIP_SUBTITLE_MAX, APP_CLIP_TITLE_MAX, CLIP_EVENT_TYPES, ClipContentSchema, clipUrl, DEMO_TASKS } from "@/lib/shared/clip";
import { validateNeed } from "@/lib/server/validators";

const json = JSON.parse(fs.readFileSync(path.join(process.cwd(), "data", "clip_content.json"), "utf8"));

describe("App Clip content", () => {
  it("data/clip_content.json validates against the schema", () => {
    const parsed = ClipContentSchema.parse(json);
    expect(parsed.version).toBeTruthy();
    expect(parsed.features.length).toBeGreaterThanOrEqual(5);
    expect(parsed.products.length).toBeGreaterThanOrEqual(1);
    expect(parsed.experience.steps.length).toBeGreaterThanOrEqual(3);
  });

  it("rejects a broken file", () => {
    expect(() => ClipContentSchema.parse({ ...json, features: [] })).toThrow();
    expect(() => ClipContentSchema.parse({ ...json, hero: { title: "", subtitle: "x", cta: { label: "a", url: "nope" } } })).toThrow();
  });

  it("the App Clip card respects the HIG length limits", () => {
    expect(APP_CLIP_CARD.title.length).toBeLessThanOrEqual(APP_CLIP_TITLE_MAX);
    expect(APP_CLIP_CARD.subtitle.length).toBeLessThanOrEqual(APP_CLIP_SUBTITLE_MAX);
    expect(APP_CLIP_CARD.verb).toBe("Open");
  });

  it("clipUrl builds the invocation URL with and without a session", () => {
    expect(clipUrl("http://localhost:3000")).toBe("http://localhost:3000/clip");
    expect(clipUrl("http://localhost:3000/")).toBe("http://localhost:3000/clip");
    expect(clipUrl("https://yourpersona.com", "abc-123")).toBe("https://yourpersona.com/clip?sid=abc-123");
  });

  it("client event types are allow-listed", () => {
    expect(CLIP_EVENT_TYPES).toContain("app_clip_opened");
    expect(CLIP_EVENT_TYPES).toHaveLength(6);
    expect(CLIP_EVENT_TYPES).toContain("app_clip_demo");
  });

  it("the demo tasks are short, concrete needs", () => {
    expect(DEMO_TASKS).toHaveLength(3);
    for (const t of DEMO_TASKS) {
      expect(t.length).toBeLessThanOrEqual(60);
      expect(validateNeed(t).ok).toBe(true);
    }
  });
});
