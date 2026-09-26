"use client";

import { backgroundResult, OpenAIRealtimeWebRTC, RealtimeAgent, RealtimeSession, tool, type TransportEvent } from "@openai/agents/realtime";
import type { CallEndReason, CaptionLine } from "@/lib/session/types";
import type {
  CallEventRequest,
  CallEventType,
  RealtimeTokenResponse,
  ToolResult,
  ToolRouteResponse,
  TranscriptRequest,
  TranscriptResponse,
  TranscriptTurn,
} from "@/lib/shared/types";
import { uid } from "@/lib/utils";
import { SilenceWatcher } from "./silence";
import type { VoiceTransport, VoiceTransportHandlers } from "./types";

/** Function tool definition as minted by /api/realtime/token (strict JSON schema). */
type ToolDef = {
  type: "function";
  name: string;
  description: string;
  parameters: { type: "object"; properties: Record<string, Record<string, unknown>>; required: string[]; additionalProperties: false };
};

type TokenResponse = RealtimeTokenResponse & {
  transcribe_model?: string;
  turn_detection?: { silence_duration_ms: number; prefix_padding_ms: number };
};

type RawEvent = { type: string; item_id?: string; delta?: string; transcript?: string; response_id?: string; error?: unknown };

const HEARTBEAT_MS = 5_000;
const GOODBYE_GRACE_MS = 3_000;
const END_GRACE_MS = 800;
const END_AFTER_AUDIO_MAX_MS = 6_000;
const SILENCE_HARD_END_MS = 4_000;
const METER_INTERVAL_MS = 66;

const TIER_NOTES: Record<1 | 2 | 3, string> = {
  1: "The user has been silent for a few seconds. Check in softly in one short sentence.",
  2: "Still silent. Offer to continue by text in one sentence.",
  3: "Say one short goodbye, mention the chat, then call end_call.",
};

async function postJson<T>(url: string, body: unknown, init: RequestInit = {}): Promise<T> {
  const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), ...init });
  if (!r.ok) throw new Error(`${url} → ${r.status}`);
  return (await r.json()) as T;
}

/**
 * OpenAI Realtime over browser WebRTC (DESIGN §10). Audio never touches our server: the browser
 * mints a short-lived key from /api/realtime/token and talks to OpenAI directly. Tools run here and
 * POST /api/tools/:name; transcripts, latency and lifecycle events go to /api/call/*.
 */
export class RealtimeWebRTCTransport implements VoiceTransport {
  readonly kind = "openai-realtime";
  readonly sessionId: string;
  onEnded?: (reason: CallEndReason) => void;

  private handlers: VoiceTransportHandlers | null = null;
  private session: RealtimeSession | null = null;
  private mic: MediaStream | null = null;
  private audioEl: HTMLAudioElement | null = null;
  private audioCtx: AudioContext | null = null;
  private readonly silence: SilenceWatcher;

  private alive = false;
  private ending = false;
  private assistantSpeaking = false;
  private userSpeaking = false;
  private speechStoppedAt: number | null = null;
  private endRequested = false;
  private endReason: CallEndReason = "bot_hangup";
  private silenceEnding = false;

  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private levelTimer: ReturnType<typeof setInterval> | null = null;
  private goodbyeTimer: ReturnType<typeof setTimeout> | null = null;
  private endTimer: ReturnType<typeof setTimeout> | null = null;
  private silenceEndTimer: ReturnType<typeof setTimeout> | null = null;

  /** Realtime item id → caption id */
  private captionIds = new Map<string, string>();
  private assistantText = new Map<string, string>();
  private readonly onPageHide = () => {
    if (!this.alive || this.ending) return;
    const body: CallEventRequest = { session_id: this.sessionId, type: "call_dropped" };
    navigator.sendBeacon("/api/call/event", JSON.stringify(body));
  };

  constructor(opts: { sessionId: string; gmailPending?: boolean }) {
    this.sessionId = opts.sessionId;
    this.silence = new SilenceWatcher({ onTier: (tier) => this.onSilenceTier(tier) });
    if (opts.gmailPending) this.silence.setGmailPending(true);
  }

  // ---------------------------------------------------------------------------
  // lifecycle
  // ---------------------------------------------------------------------------

  async connect(handlers: VoiceTransportHandlers): Promise<void> {
    this.handlers = handlers;
    this.alive = true;

    // 1. microphone first: denied → instant text fallback (DESIGN §10.7)
    try {
      this.mic = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      void this.postCallEvent("mic_denied");
      this.finish("mic_denied");
      return;
    }
    if (!this.alive) return;

    // 2. short-lived key + instructions + tools bound to this session
    let token: TokenResponse;
    try {
      token = await postJson<TokenResponse>("/api/realtime/token", { session_id: this.sessionId });
    } catch (e) {
      console.warn("[realtime] token failed", e);
      this.finish("dropped");
      return;
    }
    if (!this.alive) return;

    // 3. agent + session mirroring the minted config (the SDK's connect-time session.update replaces it)
    const agent = new RealtimeAgent({ name: "Persona", instructions: token.instructions, tools: this.buildTools(token.tools as ToolDef[]), voice: token.voice });
    this.audioEl = document.createElement("audio");
    this.audioEl.autoplay = true;
    const transport = new OpenAIRealtimeWebRTC({
      audioElement: this.audioEl,
      mediaStream: this.mic,
      changePeerConnection: (pc) => {
        pc.addEventListener("track", (ev) => this.attachMeter(ev.streams[0] ?? new MediaStream([ev.track])));
        return pc;
      },
    });
    const td = token.turn_detection ?? { silence_duration_ms: 500, prefix_padding_ms: 300 };
    const session = new RealtimeSession(agent, {
      transport,
      model: token.model,
      config: {
        outputModalities: ["audio"],
        audio: {
          input: {
            transcription: { model: token.transcribe_model ?? "gpt-4o-mini-transcribe" },
            turnDetection: {
              type: "server_vad",
              silenceDurationMs: td.silence_duration_ms,
              prefixPaddingMs: td.prefix_padding_ms,
              createResponse: true,
              interruptResponse: true,
            },
          },
          output: { voice: token.voice },
        },
      },
      historyStoreAudio: false,
    });
    this.session = session;
    session.on("transport_event", (e) => this.onTransportEvent(e));
    session.on("error", (e) => console.warn("[realtime] error", e.error));
    session.transport.on("connection_change", (status) => {
      if (status === "disconnected" && this.alive && !this.ending) this.finish("dropped");
    });

    try {
      await session.connect({ apiKey: token.client_secret });
    } catch (e) {
      console.warn("[realtime] connect failed", e);
      this.finish("dropped");
      return;
    }
    if (!this.alive) {
      this.teardown();
      return;
    }

    handlers.onConnected();
    void this.postCallEvent("call_started", undefined, { transport: this.kind });
    this.heartbeatTimer = setInterval(() => {
      void postJson("/api/call/heartbeat", { session_id: this.sessionId }, { keepalive: true }).catch(() => undefined);
    }, HEARTBEAT_MS);
    this.silence.start();
    window.addEventListener("pagehide", this.onPageHide);
    // the bot opens the call (server_vad only responds to user speech)
    this.sendEvent({ type: "response.create" });
  }

  disconnect(): void {
    if (this.ending) return;
    this.ending = true;
    this.alive = false;
    const handlers = this.handlers;
    this.handlers = null;
    this.teardown();
    handlers?.onDisconnected("local");
  }

  setMuted(muted: boolean): void {
    try {
      this.session?.mute(muted);
    } catch {
      /* not connected yet */
    }
  }

  setGmailPending(pending: boolean): void {
    this.silence.setGmailPending(pending);
  }

  /** Dev + tests: a user utterance without audio. Runs the full transcript/supervisor path. */
  injectUserSpeech(text: string): void {
    if (!this.alive || !this.session) return;
    const itemId = `local-${uid()}`;
    this.userFinal(itemId, text);
    this.sendEvent({ type: "conversation.item.create", item: { type: "message", role: "user", content: [{ type: "input_text", text }] } });
    this.sendEvent({ type: "response.create" });
  }

  /** Mid-call system note (Gmail connected, user texted, silence check-ins). */
  injectSystem(text: string): void {
    if (!this.alive || !this.session) return;
    this.sendEvent({ type: "conversation.item.create", item: { type: "message", role: "system", content: [{ type: "input_text", text }] } });
    this.sendEvent({ type: "response.create" });
  }

  // ---------------------------------------------------------------------------
  // tools
  // ---------------------------------------------------------------------------

  private buildTools(defs: ToolDef[]) {
    return defs.map((def) =>
      tool({
        name: def.name,
        description: def.description,
        parameters: def.parameters,
        execute: async (input: unknown) => {
          const result = await this.runTool(def.name, input);
          // end_call: don't trigger another response; we hang up once the current audio finishes
          return def.name === "end_call" ? backgroundResult(result) : result;
        },
      }),
    );
  }

  private async runTool(name: string, input: unknown): Promise<ToolResult | { ok: false; error: string }> {
    let res: ToolRouteResponse;
    try {
      res = await postJson<ToolRouteResponse>(`/api/tools/${encodeURIComponent(name)}`, { session_id: this.sessionId, input });
    } catch (e) {
      console.warn("[realtime] tool failed", name, e);
      return { ok: false, error: `${name} is unavailable right now` };
    }
    if (!this.alive) return res.result;
    if (res.instructions) this.applyInstructions(res.instructions);
    const gmail = res.result?.state?.gmail;
    if (gmail) this.silence.setGmailPending(gmail === "pending");
    if (res.end_call) this.requestEnd("bot_hangup");
    return res.result;
  }

  private applyInstructions(instructions: string) {
    this.sendEvent({ type: "session.update", session: { type: "realtime", instructions } });
  }

  private sendEvent(event: { type: string; [k: string]: unknown }) {
    try {
      this.session?.transport.sendEvent(event);
    } catch (e) {
      console.warn("[realtime] sendEvent failed", event.type, e);
    }
  }

  // ---------------------------------------------------------------------------
  // server events → captions, latency, silence, end-of-call
  // ---------------------------------------------------------------------------

  private onTransportEvent(raw: TransportEvent) {
    if (!this.alive) return;
    const e = raw as RawEvent;
    switch (e.type) {
      case "response.output_audio_transcript.delta":
        if (e.item_id && e.delta) this.appendAssistant(e.item_id, e.delta);
        break;
      case "response.output_audio_transcript.done":
        if (e.item_id) this.finishAssistant(e.item_id, e.transcript);
        break;
      case "conversation.item.input_audio_transcription.completed":
        if (e.item_id && e.transcript?.trim()) this.userFinal(e.item_id, e.transcript.trim());
        break;
      case "input_audio_buffer.speech_started":
        this.userSpeaking = true;
        this.speechStoppedAt = null;
        this.silence.onUserSpeechStart();
        this.handlers?.onUserSpeechStart?.();
        break;
      case "input_audio_buffer.speech_stopped":
        this.userSpeaking = false;
        this.speechStoppedAt = performance.now();
        break;
      case "output_audio_buffer.started":
        this.assistantSpeaking = true;
        if (this.speechStoppedAt != null) {
          const ms = Math.round(performance.now() - this.speechStoppedAt);
          this.speechStoppedAt = null;
          this.handlers?.onLatency?.(ms);
          void this.postCallEvent("latency", undefined, { ms });
        }
        break;
      case "output_audio_buffer.stopped":
      case "output_audio_buffer.cleared":
        this.assistantSpeaking = false;
        this.handlers?.onRemoteLevel(0);
        if (e.type === "output_audio_buffer.stopped" && !this.userSpeaking) this.silence.onAssistantAudioStopped();
        if (this.endRequested) this.finish(this.endReason);
        break;
      case "error":
        console.warn("[realtime] server error", e.error);
        break;
      default:
        break;
    }
  }

  private appendAssistant(itemId: string, delta: string) {
    let id = this.captionIds.get(itemId);
    if (!id) {
      id = uid();
      this.captionIds.set(itemId, id);
      this.assistantText.set(itemId, "");
      this.handlers?.onCaption({ id, speaker: "assistant", text: "", final: false, ts: Date.now() });
    }
    const text = (this.assistantText.get(itemId) ?? "") + delta;
    this.assistantText.set(itemId, text);
    this.handlers?.onCaptionUpdate(id, { text });
  }

  private finishAssistant(itemId: string, transcript?: string) {
    const text = (transcript ?? this.assistantText.get(itemId) ?? "").trim();
    let id = this.captionIds.get(itemId);
    if (!id) {
      id = uid();
      this.captionIds.set(itemId, id);
      const line: CaptionLine = { id, speaker: "assistant", text, final: true, ts: Date.now() };
      this.handlers?.onCaption(line);
    } else {
      this.handlers?.onCaptionUpdate(id, { text, final: true });
    }
    if (text) void this.postTranscript([{ item_id: itemId, role: "assistant", text, final: true }]);
  }

  private userFinal(itemId: string, text: string) {
    const id = uid();
    this.captionIds.set(itemId, id);
    // create, then finalise: the call controller forwards final user captions to the brain on update
    this.handlers?.onCaption({ id, speaker: "user", text, final: false, ts: Date.now() });
    this.handlers?.onCaptionUpdate(id, { text, final: true });
    this.silence.onUserSpeechStart();
    void this.postTranscript([{ item_id: itemId, role: "user", text, final: true }]);
  }

  private async postTranscript(turns: TranscriptTurn[]) {
    try {
      const body: TranscriptRequest = { session_id: this.sessionId, turns };
      const res = await postJson<TranscriptResponse>("/api/call/transcript", body);
      if (!this.alive) return;
      if (res.patched && res.instructions) this.applyInstructions(res.instructions);
      if (res.should_end && turns.some((t) => t.role === "assistant") && !this.endRequested) this.armGoodbyeTimer();
    } catch (e) {
      console.warn("[realtime] transcript post failed", e);
    }
  }

  /** The assistant said goodbye: end the call unless an end_call tool call lands within 3 s (DESIGN §8.9). */
  private armGoodbyeTimer() {
    if (this.goodbyeTimer) clearTimeout(this.goodbyeTimer);
    this.goodbyeTimer = setTimeout(() => {
      this.goodbyeTimer = null;
      if (this.alive && !this.endRequested) this.requestEnd("bot_hangup");
    }, GOODBYE_GRACE_MS);
  }

  /** Hang up once the model's current audio has finished (or after a short grace if it isn't talking). */
  private requestEnd(reason: CallEndReason) {
    if (this.endRequested || !this.alive) return;
    this.endRequested = true;
    this.endReason = this.silenceEnding ? "silence" : reason;
    if (this.goodbyeTimer) clearTimeout(this.goodbyeTimer);
    this.goodbyeTimer = null;
    this.endTimer = setTimeout(() => this.finish(this.endReason), this.assistantSpeaking ? END_AFTER_AUDIO_MAX_MS : END_GRACE_MS);
  }

  private onSilenceTier(tier: 1 | 2 | 3) {
    if (!this.alive) return;
    void this.postCallEvent("silence_tier", undefined, { tier });
    this.injectSystem(TIER_NOTES[tier]);
    if (tier === 3) {
      this.silenceEnding = true;
      this.silenceEndTimer = setTimeout(() => {
        if (this.alive && !this.ending) this.finish("silence");
      }, SILENCE_HARD_END_MS);
    }
  }

  // ---------------------------------------------------------------------------
  // audio level meter (remote stream)
  // ---------------------------------------------------------------------------

  private attachMeter(stream: MediaStream) {
    try {
      if (!this.audioCtx) this.audioCtx = new AudioContext();
      void this.audioCtx.resume();
      const source = this.audioCtx.createMediaStreamSource(stream);
      const analyser = this.audioCtx.createAnalyser();
      analyser.fftSize = 512;
      analyser.smoothingTimeConstant = 0.5;
      source.connect(analyser);
      const buf = new Float32Array(analyser.fftSize);
      if (this.levelTimer) clearInterval(this.levelTimer);
      this.levelTimer = setInterval(() => {
        if (!this.alive || !this.handlers || !this.assistantSpeaking) return;
        analyser.getFloatTimeDomainData(buf);
        let sum = 0;
        for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
        const rms = Math.sqrt(sum / buf.length);
        this.handlers.onRemoteLevel(Math.min(1, rms * 6));
      }, METER_INTERVAL_MS);
    } catch (e) {
      console.warn("[realtime] level meter unavailable", e);
    }
  }

  // ---------------------------------------------------------------------------
  // reporting + teardown
  // ---------------------------------------------------------------------------

  private async postCallEvent(type: CallEventType, reason?: string, payload?: Record<string, unknown>) {
    const body: CallEventRequest = { session_id: this.sessionId, type, reason, payload };
    try {
      await postJson("/api/call/event", body, { keepalive: true });
    } catch (e) {
      console.warn("[realtime] call event failed", type, e);
    }
  }

  private finish(reason: CallEndReason) {
    if (this.ending) return;
    this.ending = true;
    this.alive = false;
    const handlers = this.handlers;
    this.handlers = null;
    this.teardown();
    handlers?.onDisconnected(reason);
    this.onEnded?.(reason);
  }

  private teardown() {
    for (const t of [this.goodbyeTimer, this.endTimer, this.silenceEndTimer]) if (t) clearTimeout(t);
    this.goodbyeTimer = this.endTimer = this.silenceEndTimer = null;
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    if (this.levelTimer) clearInterval(this.levelTimer);
    this.heartbeatTimer = this.levelTimer = null;
    this.silence.stop();
    if (typeof window !== "undefined") window.removeEventListener("pagehide", this.onPageHide);
    try {
      this.session?.close();
    } catch {
      /* already closed */
    }
    this.session = null;
    this.mic?.getTracks().forEach((t) => t.stop());
    this.mic = null;
    void this.audioCtx?.close().catch(() => undefined);
    this.audioCtx = null;
    this.audioEl = null;
    this.assistantSpeaking = false;
  }
}
