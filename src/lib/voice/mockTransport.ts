"use client";

import type { CaptionLine } from "@/lib/session/types";
import { sleep, uid } from "@/lib/utils";
import type { VoiceTransport, VoiceTransportHandlers } from "./types";

const OPENER =
  "Hey! This is your new assistant. Quick call, two minutes tops, and then I'll actually do something for you. What should I call you?";

export class MockVoiceTransport implements VoiceTransport {
  readonly kind = "mock";
  private handlers: VoiceTransportHandlers | null = null;
  private alive = false;
  private levelTimer: ReturnType<typeof setInterval> | null = null;

  async connect(handlers: VoiceTransportHandlers) {
    this.handlers = handlers;
    this.alive = true;
    await sleep(900);
    if (!this.alive) return;
    handlers.onConnected();
    void this.speak(OPENER);
  }

  disconnect() {
    this.alive = false;
    this.stopLevel();
    this.handlers?.onDisconnected("local");
    this.handlers = null;
  }

  setMuted() {
    /* no-op for the mock */
  }

  injectUserSpeech(text: string) {
    if (!this.alive || !this.handlers) return;
    const line: CaptionLine = { id: uid(), speaker: "user", text, final: true, ts: Date.now() };
    this.handlers.onCaption(line);
    void this.speak("(mock) Heard you. The real model will answer here.");
  }

  /** Streams a line word-by-word as a non-final caption, with a fake loudness curve. */
  private async speak(text: string) {
    if (!this.alive || !this.handlers) return;
    await sleep(500);
    if (!this.alive || !this.handlers) return;
    const id = uid();
    this.handlers.onCaption({ id, speaker: "assistant", text: "", final: false, ts: Date.now() });
    this.startLevel();
    const words = text.split(" ");
    let acc = "";
    for (const w of words) {
      if (!this.alive || !this.handlers) return;
      acc = acc ? `${acc} ${w}` : w;
      this.handlers.onCaptionUpdate(id, { text: acc });
      await sleep(120 + Math.random() * 90);
    }
    this.handlers?.onCaptionUpdate(id, { final: true });
    this.stopLevel();
  }

  private startLevel() {
    this.stopLevel();
    let t = 0;
    this.levelTimer = setInterval(() => {
      t += 0.35;
      const level = 0.35 + 0.3 * Math.abs(Math.sin(t)) + Math.random() * 0.25;
      this.handlers?.onRemoteLevel(Math.min(1, level));
    }, 70);
  }

  private stopLevel() {
    if (this.levelTimer) clearInterval(this.levelTimer);
    this.levelTimer = null;
    this.handlers?.onRemoteLevel(0);
  }
}
