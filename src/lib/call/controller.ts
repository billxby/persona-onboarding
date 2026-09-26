"use client";

import { getBrain } from "@/lib/brain";
import { session } from "@/lib/session/store";
import type { CallEndReason } from "@/lib/session/types";
import { createVoiceTransport, type VoiceTransport, type VoiceTransportHandlers } from "@/lib/voice";

/**
 * Imperative call lifecycle. The call UI calls these; they update the store,
 * drive the voice transport and notify the brain. Hangups, drops and declines
 * are all just `end(reason)` — state transitions, not failures.
 */
type InjectableTransport = VoiceTransport & { injectSystem?: (text: string) => void };
type ExtendedHandlers = VoiceTransportHandlers & {
  onLatency?: (ms: number) => void;
  onUserSpeechStart?: () => void;
};
// Accepts both the Layer 1 signature (no args) and the voice layer's `{ sessionId }` option.
const transportFactory: (opts?: { sessionId: string }) => VoiceTransport = createVoiceTransport;

let transport: InjectableTransport | null = null;

function postCallEvent(body: Record<string, unknown>) {
  void fetch("/api/call/event", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).catch(() => undefined);
}

export const callController = {
  /** Simulate an incoming call from the assistant. */
  ring() {
    const s = session.get();
    if (s.call.state !== "idle" && s.call.state !== "ended") return;
    s.clearCaptions();
    s.setCallState("ringing", { startedAt: undefined, endedAt: undefined, endReason: undefined });
    s.setScreen("call");
    postCallEvent({ session_id: s.sessionId, type: "call_ringing" });
  },

  async answer() {
    const s = session.get();
    if (s.call.state !== "ringing") return;
    s.setCallState("connecting");
    transport?.disconnect();
    const t: InjectableTransport = transportFactory({ sessionId: s.sessionId });
    transport = t;
    // the realtime transport ends calls itself (end_call tool, goodbye fallback, silence tier 3, drops)
    t.onEnded = (reason) => {
      if (transport === t) callController.end(reason);
    };
    const handlers: ExtendedHandlers = {
      onConnected: () => {
        if (transport !== t) return;
        const st = session.get();
        st.setCallState("live", { startedAt: Date.now(), muted: false });
        void getBrain().onCallAnswered();
      },
      onDisconnected: (reason) => {
        session.get().logEvent("voice.disconnected", { reason });
        if (transport !== t) return;
        const state = session.get().call.state;
        if (state === "idle" || state === "ended") return;
        switch (reason) {
          case "mic_denied":
            callController.end("mic_denied");
            return;
          case "bot_hangup":
            callController.end("bot_hangup");
            return;
          case "silence":
            callController.end("silence");
            return;
          case "local":
            return;
          default:
            // remote failure while connecting/live: treat as a drop
            callController.end("dropped");
        }
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
      onLatency: (ms) => session.get().logEvent("voice.latency", { ms }),
      onUserSpeechStart: () => undefined,
    };
    try {
      await t.connect(handlers);
    } catch (e) {
      session.get().logEvent("voice.connect_failed", { error: String(e) });
      if (transport === t) callController.end("dropped");
    }
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
    const t = transport;
    transport = null;
    t?.disconnect();
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

  /** Push a system note into the live voice session (Gmail connected, user texted, ...). */
  injectSystem(text: string) {
    if (!transport?.injectSystem) {
      session.get().logEvent("voice.inject_unsupported", { text });
      return;
    }
    transport.injectSystem(text);
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
