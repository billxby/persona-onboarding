"use client";

import { MockVoiceTransport } from "./mockTransport";
import type { VoiceTransport } from "./types";

/** Factory: swap for the WebRTC transport when the voice layer lands. */
export function createVoiceTransport(): VoiceTransport {
  return new MockVoiceTransport();
}

export type { VoiceTransport, VoiceTransportHandlers } from "./types";
