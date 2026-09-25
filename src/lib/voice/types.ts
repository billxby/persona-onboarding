import type { CaptionLine } from "@/lib/session/types";

/**
 * Abstracts the audio pipe of a call. The call UI only knows this interface.
 *
 * Today: MockVoiceTransport (fake connect + scripted captions).
 * Later: RealtimeWebRTCTransport (OpenAI gpt-realtime over WebRTC) or a Vapi
 * transport; both just need to emit the same handler events.
 */
export interface VoiceTransportHandlers {
  onConnected(): void;
  onDisconnected(reason?: string): void;
  onCaption(line: CaptionLine): void;
  onCaptionUpdate(id: string, patch: Partial<CaptionLine>): void;
  /** 0..1 loudness of the remote (assistant) audio, for the speaking meter */
  onRemoteLevel(level: number): void;
}

export interface VoiceTransport {
  readonly kind: string;
  connect(handlers: VoiceTransportHandlers): Promise<void>;
  disconnect(): void;
  setMuted(muted: boolean): void;
  /** Dev-only: push a user utterance as if STT produced it. */
  injectUserSpeech?(text: string): void;
}
