import { describe, expect, it } from "vitest";
import { messageIdForRow, rowToMessage } from "@/lib/brain/mirror";
import type { MessageRow } from "@/lib/shared/types";

const base = (over: Partial<MessageRow>): MessageRow => ({
  id: 7,
  session_id: "s",
  client_id: null,
  channel: "text",
  role: "assistant",
  kind: "text",
  content: null,
  payload: {},
  created_at: "2026-09-26T04:00:00.000Z",
  ...over,
});

describe("rowToMessage", () => {
  it("text with effect", () => {
    const m = rowToMessage(base({ content: "Hey", payload: { effect: "slam" } }));
    expect(m).toMatchObject({ id: "srv-7", role: "assistant", serverId: 7, status: "delivered", content: { kind: "text", text: "Hey", effect: "slam" } });
    expect(m?.ts).toBe(Date.parse("2026-09-26T04:00:00.000Z"));
  });

  it("link card with app_clip → link with appClip metadata and image", () => {
    const m = rowToMessage(
      base({
        kind: "link_card",
        content: "http://localhost:3000/clip?sid=s",
        payload: {
          url: "http://localhost:3000/clip?sid=s",
          domain: "localhost:3000",
          title: "Meet your Persona",
          description: "What it does, the wristband, the products.",
          image_url: "http://localhost:3000/clip/og.svg",
          app_clip: { app_name: "Persona", title: "Meet your Persona", subtitle: "Features · wristband · products", verb: "Open" },
        },
      }),
    );
    expect(m?.content.kind).toBe("link");
    if (m?.content.kind !== "link") throw new Error("expected link");
    expect(m.content.link.appClip).toEqual({ appName: "Persona", title: "Meet your Persona", subtitle: "Features · wristband · products", verb: "Open" });
    expect(m.content.link.imageUrl).toBe("http://localhost:3000/clip/og.svg");
    expect(m.content.link.domain).toBe("localhost:3000");
  });

  it("link card without app_clip has no appClip", () => {
    const m = rowToMessage(base({ kind: "link_card", content: "http://x/connect", payload: { url: "http://x/connect", title: "Connect" } }));
    if (m?.content.kind !== "link") throw new Error("expected link");
    expect(m.content.link.appClip).toBeUndefined();
  });

  it("uses the client id when present", () => {
    const row = base({ role: "user", client_id: "abc-123", content: "hi" });
    expect(messageIdForRow(row)).toBe("abc-123");
    expect(rowToMessage(row)?.id).toBe("abc-123");
  });

  it("link_card → link", () => {
    const m = rowToMessage(base({ kind: "link_card", payload: { url: "http://localhost:3000/connect?sid=s", domain: "localhost:3000", title: "Connect Gmail", description: "Read-only." } }));
    expect(m?.content).toEqual({ kind: "link", link: { url: "http://localhost:3000/connect?sid=s", domain: "localhost:3000", title: "Connect Gmail", description: "Read-only.", imageUrl: undefined } });
  });

  it("summary_card → link with joined lines", () => {
    const m = rowToMessage(base({ kind: "summary_card", payload: { url: "http://localhost:3000/summary/s", title: "You're set up, Bill", lines: ["Task: gym", "Gmail: connected"] } }));
    expect(m?.content.kind).toBe("link");
    if (m?.content.kind === "link") {
      expect(m.content.link.title).toBe("You're set up, Bill");
      expect(m.content.link.description).toBe("Task: gym · Gmail: connected");
      expect(m.content.link.domain).toBe("localhost:3000");
    }
  });

  it("contact_card → contact", () => {
    const m = rowToMessage(base({ kind: "contact_card", payload: { name: "Jarvis", org: "Persona", note: "Your Persona" } }));
    expect(m?.content).toEqual({ kind: "contact", contact: { name: "Jarvis", org: "Persona", note: "Your Persona" } });
  });

  it("voicemail → audio with transcript", () => {
    const m = rowToMessage(base({ kind: "voicemail", payload: { duration_sec: 12, transcript: "It's your Persona.", audio_url: "https://x/v.mp3" } }));
    expect(m?.content).toEqual({ kind: "audio", audio: { durationSec: 12, transcript: "It's your Persona.", src: "https://x/v.mp3" } });
  });

  it("call_log → system call row", () => {
    const m = rowToMessage(base({ role: "system", kind: "call_log", content: "Call ended", payload: { reason: "user_hangup", duration_ms: 84000 } }));
    expect(m?.role).toBe("system");
    expect(m?.content).toEqual({ kind: "call", call: { reason: "user_hangup", durationMs: 84000 } });
  });

  it("tapback rows, call-channel rows and other system rows are not bubbles", () => {
    expect(rowToMessage(base({ kind: "tapback", role: "user", payload: { target_client_id: "x", tapback: "heart", by: "user", added: true } }))).toBeNull();
    expect(rowToMessage(base({ channel: "call", role: "user", content: "hello" }))).toBeNull();
    expect(rowToMessage(base({ role: "system", content: "internal" }))).toBeNull();
  });

  it("screenshot → image", () => {
    const m = rowToMessage(base({ kind: "screenshot", content: "inbox", payload: { url: "https://x/shot.png" } }));
    expect(m?.content).toEqual({ kind: "image", image: { src: "https://x/shot.png", alt: "inbox" } });
  });
});
