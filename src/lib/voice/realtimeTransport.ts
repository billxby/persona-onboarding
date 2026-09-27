"use client";

import { backgroundResult, OpenAIRealtimeWebRTC, RealtimeAgent, RealtimeSession, tool, type TransportEvent } from "@openai/agents/realtime";
import type { CallEndReason } from "@/lib/session/types";
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
import { CaptionPacer } from "./captionPacer";
import { CallEnder } from "./ending";
import { SilenceWatcher } from "./silence";
import { ToolBatch } from "./toolBatch";
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

type RawEvent = {
  type: string;
  item_id?: string;
  delta?: string;
  transcript?: string;
  response_id?: string;
  error?: unknown;
  item?: { type?: string };
  response?: { id?: string; output?: Array<{ type?: string }> };
};

const HEARTBEAT_MS = 5_000;
/** the assistant said goodbye in words: end the call unless end_call lands within this (DESIGN §8.9) */
const GOODBYE_GRACE_MS = 3_000;
/** a beat between the goodbye's last word and the line dropping */
const END_TAIL_MS = 500;
/** an end was requested while nothing was playing: how long to wait for the goodbye audio to start */
const END_AWAIT_AUDIO_MS = 800;
const END_CALL_AWAIT_AUDIO_MS = 1_500;
const SILENCE_GOODBYE_AWAIT_MS = 6_000;
/** whatever happens, the call ends this long after the end was requested */
const END_MAX_MS = 15_000;
/** the server's output_audio_buffer.stopped is confirmed by the remote track actually going quiet */
const DRAIN_QUIET_LEVEL = 0.02;
const DRAIN_QUIET_MS = 250;
const DRAIN_MAX_MS = 1_500;
const DRAIN_NO_METER_MS = 300;
const METER_INTERVAL_MS = 66;
/** a response we asked for (a check-in, a tool continuation) that has not started playing when the user starts talking is dropped */
const INJECTED_RESPONSE_CANCEL_MS = 6_000;

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
 *
 * Timing is keyed to the audio, not the transcript (DESIGN §10.6): the transcript of a response
 * arrives seconds before its audio has played. Captions are paced to the speech (CaptionPacer), the
 * silence clock starts when the audio has actually ended (SilenceWatcher, confirmed by the remote
 * level meter), and the call drops only after the goodbye has been heard (CallEnder).
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
  private readonly pacer: CaptionPacer;
  private readonly ender: CallEnder;
  /** one spoken reply per batch of tool calls, not one per tool */
  private readonly tools = new ToolBatch(() => this.continueAfterTools());

  private alive = false;
  private ending = false;
  private assistantSpeaking = false;
  private userSpeaking = false;
  private speechStoppedAt: number | null = null;
  private silenceEnding = false;

  /** server said the output buffer drained; waiting for the track to go quiet before calling the audio ended */
  private drainingSince: number | null = null;
  private quietSince: number | null = null;
  private meterActive = false;
  /** when we last asked for a response ourselves (response.create); cleared once it starts playing */
  private injectedResponseAt: number | null = null;

  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private levelTimer: ReturnType<typeof setInterval> | null = null;
  private goodbyeTimer: ReturnType<typeof setTimeout> | null = null;
  private drainTimer: ReturnType<typeof setTimeout> | null = null;

  /** Realtime item id → caption id */
  private captionIds = new Map<string, string>();
  private assistantText = new Map<string, string>();
  /** user captions opened at speech start, waiting for their Realtime item id (FIFO) */
  private pendingUserCaptions: string[] = [];
  private readonly onPageHide = () => {
    if (!this.alive || this.ending) return;
    const body: CallEventRequest = { session_id: this.sessionId, type: "call_dropped" };
    navigator.sendBeacon("/api/call/event", JSON.stringify(body));
  };

  constructor(opts: { sessionId: string; gmailPending?: boolean }) {
    this.sessionId = opts.sessionId;
    this.silence = new SilenceWatcher({ onTier: (tier) => this.onSilenceTier(tier) });
    this.pacer = new CaptionPacer({ onReveal: (itemId, text, final) => this.revealAssistant(itemId, text, final) });
    this.ender = new CallEnder({ finish: (reason) => this.finish(reason), tailMs: END_TAIL_MS, maxMs: END_MAX_MS });
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
    // the bot opens the call (server_vad only responds to user speech), with the line the server chose from what is known
    if (token.opener_note) {
      this.sendEvent({ type: "conversation.item.create", item: { type: "message", role: "system", content: [{ type: "input_text", text: token.opener_note }] } });
    }
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
          const batch = this.tools.current;
          const { result, endCall } = await this.runTool(def.name, input);
          this.tools.returned(batch, { hangUp: endCall });
          // never a response per tool: the batch continues the turn once every call is back (not when hanging up)
          return backgroundResult(result);
        },
      }),
    );
  }

  private async runTool(name: string, input: unknown): Promise<{ result: ToolResult | { ok: false; error: string }; endCall: boolean }> {
    let res: ToolRouteResponse;
    try {
      res = await postJson<ToolRouteResponse>(`/api/tools/${encodeURIComponent(name)}`, { session_id: this.sessionId, input });
    } catch (e) {
      console.warn("[realtime] tool failed", name, e);
      return { result: { ok: false, error: `${name} is unavailable right now` }, endCall: false };
    }
    const endCall = !!res.end_call;
    if (!this.alive) return { result: res.result, endCall };
    if (res.instructions) this.applyInstructions(res.instructions);
    const gmail = res.result?.state?.gmail;
    if (gmail) this.silence.setGmailPending(gmail === "pending");
    // the goodbye is usually still playing (or about to start) when the tool call lands
    if (endCall) this.requestEnd("bot_hangup", END_CALL_AWAIT_AUDIO_MS);
    return { result: res.result, endCall };
  }

  /**
   * The whole batch of tool calls is back: one response, shaped by a one-line note (the saved value,
   * then the next ask, nothing about saving), so the continuation never narrates the tool work.
   */
  private continueAfterTools() {
    if (!this.alive || !this.session) return;
    this.sendEvent({
      type: "conversation.item.create",
      item: { type: "message", role: "system", content: [{ type: "input_text", text: "Tool results are in. One line: use what was just saved, then the one ask on your mind. Nothing about saving." }] },
    });
    this.sendEvent({ type: "response.create" });
  }

  private applyInstructions(instructions: string) {
    this.sendEvent({ type: "session.update", session: { type: "realtime", instructions } });
  }

  private sendEvent(event: { type: string; [k: string]: unknown }) {
    try {
      this.session?.transport.sendEvent(event);
      if (event.type === "response.create") this.injectedResponseAt = performance.now();
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
        if (e.item_id) this.userFinal(e.item_id, (e.transcript ?? "").trim());
        break;
      case "conversation.item.input_audio_transcription.failed":
        if (e.item_id) this.dropUserCaption(e.item_id);
        break;
      case "input_audio_buffer.speech_started":
        this.userSpeaking = true;
        this.speechStoppedAt = null;
        this.silence.onUserSpeechStart();
        this.tools.userSpoke();
        this.cancelPendingResponse();
        // whatever sounded like a goodbye, the user is talking: it wasn't one
        this.clearGoodbyeTimer();
        this.openUserCaption();
        this.handlers?.onUserSpeechStart?.();
        break;
      case "response.output_item.done":
        if (e.item?.type === "function_call") this.tools.announce();
        break;
      case "response.done":
        this.tools.close((e.response?.output ?? []).filter((i) => i.type === "function_call").length);
        break;
      case "input_audio_buffer.speech_stopped":
        this.userSpeaking = false;
        this.speechStoppedAt = performance.now();
        break;
      case "input_audio_buffer.committed":
        if (e.item_id) this.bindUserCaption(e.item_id);
        break;
      case "output_audio_buffer.started":
        this.onAudioStarted();
        break;
      case "output_audio_buffer.stopped":
        this.onAudioBufferStopped();
        break;
      case "output_audio_buffer.cleared":
        this.onAudioInterrupted();
        break;
      case "error":
        console.warn("[realtime] server error", e.error);
        break;
      default:
        break;
    }
  }

  /** The server began streaming a response's audio. Back-to-back responses share one buffer. */
  private onAudioStarted() {
    this.clearDrain();
    this.injectedResponseAt = null;
    const wasSpeaking = this.assistantSpeaking;
    this.assistantSpeaking = true;
    if (this.speechStoppedAt != null) {
      const ms = Math.round(performance.now() - this.speechStoppedAt);
      this.speechStoppedAt = null;
      this.handlers?.onLatency?.(ms);
      void this.postCallEvent("latency", undefined, { ms });
    }
    if (wasSpeaking) return;
    this.silence.onAssistantAudioStarted();
    this.pacer.audioStarted();
    this.ender.audioStarted();
  }

  /**
   * The server's output buffer drained. The audio the user hears lags it by the network jitter buffer,
   * so the end is called when the remote track has actually gone quiet (or shortly after, without a meter).
   */
  private onAudioBufferStopped() {
    // a stop with nothing playing (the SDK clears the buffer on every barge-in) is not the end of a line
    if (this.drainingSince != null || !this.assistantSpeaking) return;
    this.drainingSince = performance.now();
    this.quietSince = null;
    this.drainTimer = setTimeout(() => this.onAudioEnded(), this.meterActive ? DRAIN_MAX_MS : DRAIN_NO_METER_MS);
  }

  /** The assistant has finished talking, for real. The silence clock starts here, and a requested end proceeds. */
  private onAudioEnded() {
    this.clearDrain();
    if (!this.assistantSpeaking) return;
    this.assistantSpeaking = false;
    this.handlers?.onRemoteLevel(0);
    this.pacer.audioEnded();
    this.ender.audioEnded();
    if (!this.userSpeaking) this.silence.onAssistantAudioStopped();
  }

  /** The user barged in (server VAD cleared the buffer): the rest of the response was never heard. */
  private onAudioInterrupted() {
    this.clearDrain();
    if (!this.assistantSpeaking) return;
    this.assistantSpeaking = false;
    this.handlers?.onRemoteLevel(0);
    this.pacer.audioInterrupted();
    this.ender.audioEnded();
    if (!this.userSpeaking) this.silence.onAssistantAudioStopped();
  }

  private clearDrain() {
    if (this.drainTimer) clearTimeout(this.drainTimer);
    this.drainTimer = null;
    this.drainingSince = null;
    this.quietSince = null;
  }

  private appendAssistant(itemId: string, delta: string) {
    this.assistantText.set(itemId, (this.assistantText.get(itemId) ?? "") + delta);
    this.pacer.push(itemId, delta);
  }

  private finishAssistant(itemId: string, transcript?: string) {
    const text = (transcript ?? this.assistantText.get(itemId) ?? "").trim();
    this.pacer.complete(itemId, text);
    // the server gets the whole line now (goodbye detection, the mind); the caption catches up at speech pace
    if (text) void this.postTranscript([{ item_id: itemId, role: "assistant", text, final: true }]);
  }

  /** The pacer's view of an assistant line: as much as has been said so far, final once it has all been said. */
  private revealAssistant(itemId: string, text: string, final: boolean) {
    let id = this.captionIds.get(itemId);
    if (!id) {
      id = uid();
      this.captionIds.set(itemId, id);
      this.handlers?.onCaption({ id, speaker: "assistant", text, final, ts: Date.now() });
      return;
    }
    this.handlers?.onCaptionUpdate(id, { text, final });
  }

  /**
   * The user started talking: open their caption now, so it sits before the reply it gets. The
   * transcript arrives later, often after the reply has started, and fills it in.
   */
  private openUserCaption() {
    if (this.pendingUserCaptions.length) return; // a false start that was never committed: reuse it
    const id = uid();
    this.pendingUserCaptions.push(id);
    this.handlers?.onCaption({ id, speaker: "user", text: "", final: false, ts: Date.now() });
  }

  /** The server committed the user's audio as an item: tie the open caption to that item id. */
  private bindUserCaption(itemId: string) {
    if (this.captionIds.has(itemId)) return;
    const id = this.pendingUserCaptions.shift();
    if (id) this.captionIds.set(itemId, id);
  }

  /** Transcription failed: the open caption never becomes a line. */
  private dropUserCaption(itemId: string) {
    const id = this.captionIds.get(itemId) ?? this.pendingUserCaptions.shift();
    if (id) this.handlers?.onCaptionRemove?.(id);
    this.captionIds.delete(itemId);
  }

  /** A user line is final: fill the caption opened at speech start (spoken), or add a fresh one (typed). */
  private userFinal(itemId: string, text: string, opts: { spoken?: boolean } = {}) {
    let id = this.captionIds.get(itemId) ?? (opts.spoken ? this.pendingUserCaptions.shift() : undefined);
    if (!text) {
      // nothing intelligible (a cough, noise): no line
      if (id) this.handlers?.onCaptionRemove?.(id);
      this.captionIds.delete(itemId);
      return;
    }
    if (id) {
      this.captionIds.set(itemId, id);
      // the call controller forwards final user captions to the brain on update
      this.handlers?.onCaptionUpdate(id, { text, final: true });
    } else {
      id = uid();
      this.captionIds.set(itemId, id);
      // create, then finalise, for the same reason
      this.handlers?.onCaption({ id, speaker: "user", text, final: false, ts: Date.now() });
      this.handlers?.onCaptionUpdate(id, { text, final: true });
    }
    this.silence.onUserSpeechStart();
    void this.postTranscript([{ item_id: itemId, role: "user", text, final: true }]);
  }

  private async postTranscript(turns: TranscriptTurn[]) {
    try {
      const body: TranscriptRequest = { session_id: this.sessionId, turns };
      const res = await postJson<TranscriptResponse>("/api/call/transcript", body);
      if (!this.alive) return;
      if (res.patched && res.instructions) this.applyInstructions(res.instructions);
      if (res.should_end && turns.some((t) => t.role === "assistant") && !this.ender.isRequested) this.armGoodbyeTimer();
    } catch (e) {
      console.warn("[realtime] transcript post failed", e);
    }
  }

  /** The assistant said goodbye: end the call unless an end_call tool call lands within 3 s (DESIGN §8.9). */
  private armGoodbyeTimer() {
    this.clearGoodbyeTimer();
    this.goodbyeTimer = setTimeout(() => {
      this.goodbyeTimer = null;
      if (this.alive && !this.ender.isRequested) this.requestEnd("bot_hangup");
    }, GOODBYE_GRACE_MS);
  }

  private clearGoodbyeTimer() {
    if (this.goodbyeTimer) clearTimeout(this.goodbyeTimer);
    this.goodbyeTimer = null;
  }

  /**
   * Hang up once the assistant has been heard out: after the current audio ends, or, if nothing is
   * playing yet, once the goodbye that is on its way has played (`awaitAudioMs` bounds that wait).
   */
  private requestEnd(reason: CallEndReason, awaitAudioMs = END_AWAIT_AUDIO_MS) {
    if (!this.alive) return;
    this.clearGoodbyeTimer();
    this.ender.request(this.silenceEnding ? "silence" : reason, { awaitAudioMs });
  }

  /**
   * The user started talking before a response we asked for (a check-in, a tool continuation) began
   * playing: drop it, their turn wins. Server VAD only interrupts audio that is already playing.
   */
  private cancelPendingResponse() {
    if (this.injectedResponseAt == null || this.assistantSpeaking) return;
    if (performance.now() - this.injectedResponseAt < INJECTED_RESPONSE_CANCEL_MS) this.sendEvent({ type: "response.cancel" });
    this.injectedResponseAt = null;
  }

  private onSilenceTier(tier: 1 | 2 | 3) {
    if (!this.alive) return;
    void this.postCallEvent("silence_tier", undefined, { tier });
    this.injectSystem(TIER_NOTES[tier]);
    // tier 3: the goodbye is generated in response to the note; the call ends once it has been spoken
    if (tier === 3) {
      this.silenceEnding = true;
      this.requestEnd("silence", SILENCE_GOODBYE_AWAIT_MS);
    }
  }

  // ---------------------------------------------------------------------------
  // audio level meter (remote stream): the speaking indicator, and the proof that audio really ended
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
        if (!this.alive || !this.handlers) return;
        analyser.getFloatTimeDomainData(buf);
        let sum = 0;
        for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
        const level = Math.min(1, Math.sqrt(sum / buf.length) * 6);
        this.meterActive = true;
        if (this.assistantSpeaking) this.handlers.onRemoteLevel(level);
        if (this.drainingSince != null) {
          const now = performance.now();
          if (level < DRAIN_QUIET_LEVEL) {
            this.quietSince ??= now;
            if (now - this.quietSince >= DRAIN_QUIET_MS) this.onAudioEnded();
          } else {
            this.quietSince = null;
          }
        }
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
    this.clearGoodbyeTimer();
    this.clearDrain();
    this.ender.cancel();
    this.pacer.dispose();
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
