"use client";

import { session } from "@/lib/session/store";
import { MockVoiceTransport } from "./mockTransport";
import { RealtimeWebRTCTransport } from "./realtimeTransport";
import type { VoiceTransport } from "./types";

/**
 * Factory. The OpenAI Realtime WebRTC transport is the default; set NEXT_PUBLIC_VOICE=mock to
 * keep the scripted mock (UI-only mode).
 */
export function createVoiceTransport(opts: { sessionId?: string } = {}): VoiceTransport {
  if (process.env.NEXT_PUBLIC_VOICE === "mock") return new MockVoiceTransport();
  return new RealtimeWebRTCTransport({ sessionId: opts.sessionId ?? session.get().sessionId });
}

export { MockVoiceTransport, RealtimeWebRTCTransport };
export type { VoiceTransport, VoiceTransportHandlers } from "./types";
