import type { CallEndReason } from "@/lib/session/types";

/**
 * Ends a call only after the assistant has finished talking (DESIGN §8.9, §10.6). Whoever asks for the
 * end (the end_call tool, the goodbye fallback, silence tier 3) usually does so while the goodbye is
 * still being generated or spoken; the call then drops `tailMs` after the audio has actually ended.
 * If nothing is playing when the end is requested, it waits up to `awaitAudioMs` for the goodbye to
 * start, then ends anyway. `maxMs` caps the whole wait so a call can never hang open.
 */
export interface CallEnderOptions {
  finish: (reason: CallEndReason) => void;
  /** a beat between the last word and the line dropping; default 500 ms */
  tailMs?: number;
  /** hard cap from the request to the end; default 15 s */
  maxMs?: number;
}

export class CallEnder {
  private readonly finish: (reason: CallEndReason) => void;
  private readonly tailMs: number;
  private readonly maxMs: number;
  private speaking = false;
  private requested = false;
  private finished = false;
  private reason: CallEndReason = "bot_hangup";
  private awaitTimer: ReturnType<typeof setTimeout> | null = null;
  private tailTimer: ReturnType<typeof setTimeout> | null = null;
  private maxTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(opts: CallEnderOptions) {
    this.finish = opts.finish;
    this.tailMs = opts.tailMs ?? 500;
    this.maxMs = opts.maxMs ?? 15_000;
  }

  get isRequested() {
    return this.requested;
  }

  get isSpeaking() {
    return this.speaking;
  }

  /** Assistant audio started (a new response, or the goodbye we were waiting for). */
  audioStarted() {
    this.speaking = true;
    if (!this.requested) return;
    this.clear("awaitTimer");
    this.clear("tailTimer");
  }

  /** Assistant audio has actually finished playing. */
  audioEnded() {
    this.speaking = false;
    if (!this.requested || this.finished) return;
    this.clear("awaitTimer");
    this.clear("tailTimer");
    this.tailTimer = setTimeout(() => this.done(), this.tailMs);
  }

  /** Ask for the call to end. The first request's reason wins; later ones are ignored. */
  request(reason: CallEndReason, opts: { awaitAudioMs?: number } = {}) {
    if (this.requested || this.finished) return;
    this.requested = true;
    this.reason = reason;
    this.maxTimer = setTimeout(() => this.done(), this.maxMs);
    if (!this.speaking) this.awaitTimer = setTimeout(() => this.done(), opts.awaitAudioMs ?? 800);
  }

  /** Teardown: no pending end will fire. */
  cancel() {
    this.clear("awaitTimer");
    this.clear("tailTimer");
    this.clear("maxTimer");
  }

  private done() {
    if (this.finished) return;
    this.finished = true;
    this.cancel();
    this.finish(this.reason);
  }

  private clear(name: "awaitTimer" | "tailTimer" | "maxTimer") {
    const t = this[name];
    if (t) clearTimeout(t);
    this[name] = null;
  }
}
