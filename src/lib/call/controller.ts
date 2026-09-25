"use client";

import { getBrain } from "@/lib/brain";
import { session } from "@/lib/session/store";
import type { CallEndReason } from "@/lib/session/types";
import { createVoiceTransport, type VoiceTransport } from "@/lib/voice";

/**
 * Imperative call lifecycle. The call UI calls these; they update the store,
 * drive the voice transport and notify the brain. Hangups, drops and declines
 * are all just `end(reason)` — state transitions, not failures.
 */
let transport: VoiceTransport | null = null;

export const callController = {
  /** Simulate an incoming call from the assistant. */
  ring() {
    const s = session.get();
    if (s.call.state !== "idle" && s.call.state !== "ended") return;
    s.clearCaptions();
    s.setCallState("ringing", { startedAt: undefined, endedAt: undefined, endReason: undefined });
    s.setScreen("call");
  },

  async answer() {
    const s = session.get();
    if (s.call.state !== "ringing") return;
    s.setCallState("connecting");
    transport?.disconnect();
    transport = createVoiceTransport();
    await transport.connect({
      onConnected: () => {
        const st = session.get();
        st.setCallState("live", { startedAt: Date.now(), muted: false });
        void getBrain().onCallAnswered();
      },
      onDisconnected: (reason) => {
        session.get().logEvent("voice.disconnected", { reason });
      },
      onCaption: (line) => session.get().addCaption(line),
      onCaptionUpdate: (id, patch) => {
        session.get().updateCaption(id, patch);
        if (patch.final) {
          const line = session.get().captions.find((c) => c.id === id);
          if (line?.speaker === "user") void getBrain().onUserSpeechFinal(line.text);
        }
      },
      onRemoteLevel: (level) => remoteLevelListeners.forEach((fn) => fn(level)),
    });
  },

  decline() {
    this.end("declined");
  },

  hangUp() {
    this.end("user_hangup");
  },

  /** Any way a call can stop funnels through here. */
  end(reason: CallEndReason) {
    const s = session.get();
    if (s.call.state === "idle" || s.call.state === "ended") return;
    transport?.disconnect();
    transport = null;
    s.endCall(reason);
    void getBrain().onCallEnded(reason);
  },

  setMuted(muted: boolean) {
    transport?.setMuted(muted);
  },

  /** Dev helper: fake a user utterance on the live call. */
  injectUserSpeech(text: string) {
    transport?.injectUserSpeech?.(text);
  },

  get transportKind() {
    return transport?.kind ?? null;
  },
};

// Tiny listener set so the call UI can subscribe to remote loudness without
// putting a 60fps value in the persisted store.
const remoteLevelListeners = new Set<(level: number) => void>();
export function subscribeRemoteLevel(fn: (level: number) => void) {
  remoteLevelListeners.add(fn);
  return () => {
    remoteLevelListeners.delete(fn);
  };
}
