import type { CallEndReason, CaptionLine } from "@/lib/session/types";

/**
 * Abstracts the audio pipe of a call. The call UI only knows this interface.
 *
 * Today: MockVoiceTransport (fake connect + scripted captions) and
 * RealtimeWebRTCTransport (OpenAI gpt-realtime over WebRTC); both emit the same handler events.
 */
export interface VoiceTransportHandlers {
  onConnected(): void;
  onDisconnected(reason?: string): void;
  onCaption(line: CaptionLine): void;
  onCaptionUpdate(id: string, patch: Partial<CaptionLine>): void;
  /** a caption opened when the user started talking that never became a line (nothing intelligible) */
  onCaptionRemove?(id: string): void;
  /** 0..1 loudness of the remote (assistant) audio, for the speaking meter */
  onRemoteLevel(level: number): void;
  /** user-stop → first-assistant-audio latency for one turn, in ms */
  onLatency?(ms: number): void;
  /** the user started talking (barge-in signal) */
  onUserSpeechStart?(): void;
}

export interface VoiceTransport {
  readonly kind: string;
  /** server session id this transport reports to (real transports only) */
  readonly sessionId?: string;
  connect(handlers: VoiceTransportHandlers): Promise<void>;
  disconnect(): void;
  setMuted(muted: boolean): void;
  /** Dev-only: push a user utterance as if STT produced it. */
  injectUserSpeech?(text: string): void;
  /** Inject a system note mid-call (Gmail connected, user texted) and let the model react. */
  injectSystem?(text: string): void;
  /** Stretch the silence tiers while a Gmail connect is pending. */
  setGmailPending?(pending: boolean): void;
  /**
   * Set by the call controller. Fired when the transport itself decides the call is over
   * (model called end_call, said goodbye, silence tiers ran out, mic denied, connection dropped).
   * The controller should respond with `end(reason)`.
   */
  onEnded?: (reason: CallEndReason) => void;
}
