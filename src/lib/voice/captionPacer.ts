/**
 * Paces assistant captions to the audio (DESIGN §10.6). The Realtime API streams a response's
 * transcript at generation speed, seconds ahead of the audio, which plays in real time. This reveals
 * the transcript word by word at the measured speaking rate, anchored to the audio buffer events, so
 * the caption tracks what is being said and only turns final once it has actually been said.
 *
 * Model: one clock that advances at `cps` characters per second while there is unrevealed text,
 * anchored at the audio start (or at the first delta when the audio event is late or never comes, so
 * captions still work without it). `audioEnded` flushes whatever is left (the audio is over, so it was
 * all said) and recalibrates the rate from that segment; `audioInterrupted` freezes every caption at
 * what was actually heard.
 */
export interface CaptionPacerOptions {
  onReveal: (itemId: string, text: string, final: boolean) => void;
  /** starting rate; ~14 characters per second is ordinary English speech */
  charsPerSecond?: number;
  tickMs?: number;
  now?: () => number;
}

interface Item {
  id: string;
  text: string;
  /** the transcript for this item is complete */
  complete: boolean;
  revealed: number;
  /** fully revealed and complete: the caption is final */
  done: boolean;
}

const MIN_CPS = 8;
const MAX_CPS = 30;
const CALIBRATE_MIN_MS = 1_500;
const CALIBRATE_MIN_CHARS = 30;

export class CaptionPacer {
  private readonly onReveal: CaptionPacerOptions["onReveal"];
  private readonly tickMs: number;
  private readonly now: () => number;
  private cps: number;

  private items: Item[] = [];
  private revealedTotal = 0;
  /** the reveal clock: when it started and how much had been revealed by then */
  private clockStartedAt: number | null = null;
  private revealedAtClockStart = 0;
  /** the audio segment, for calibration */
  private playing = false;
  private segmentStartedAt: number | null = null;
  private revealedAtSegmentStart = 0;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(opts: CaptionPacerOptions) {
    this.onReveal = opts.onReveal;
    this.cps = opts.charsPerSecond ?? 14;
    this.tickMs = opts.tickMs ?? 100;
    this.now = opts.now ?? (() => Date.now());
  }

  /** current speaking-rate estimate, characters per second */
  get rate() {
    return this.cps;
  }

  /** the text received so far for an item (what the model said, not what has been revealed) */
  textOf(itemId: string): string {
    return this.items.find((i) => i.id === itemId)?.text ?? "";
  }

  /** A transcript delta arrived. The first delta creates the (empty) caption. */
  push(itemId: string, delta: string) {
    const item = this.item(itemId);
    if (item.done) return;
    item.text += delta;
    this.ensureClock();
  }

  /** The transcript for an item is complete; `fullText` (from the done event) is authoritative. */
  complete(itemId: string, fullText?: string) {
    const item = this.item(itemId);
    if (fullText && fullText.trim()) item.text = fullText;
    item.complete = true;
    if (item.done) {
      // finalised earlier (flushed at the end of the audio); make sure the final text is the authoritative one
      if (item.revealed !== item.text.length) {
        item.revealed = item.text.length;
        this.onReveal(item.id, item.text, true);
      }
      this.prune();
      return;
    }
    this.ensureClock();
    this.tick();
  }

  /** The assistant's audio started streaming. Back-to-back responses share one audio buffer. */
  audioStarted() {
    if (this.playing) return;
    this.playing = true;
    this.segmentStartedAt = this.now();
    this.revealedAtSegmentStart = this.revealedTotal;
    // the clock may already be running for text that arrived just before the audio; keep its anchor
    if (this.clockStartedAt == null) this.startClock();
    this.ensureTicking();
  }

  /** The assistant's audio has finished playing: everything queued has been said. */
  audioEnded() {
    this.flush();
    if (this.segmentStartedAt != null) {
      const ms = this.now() - this.segmentStartedAt;
      const chars = this.revealedTotal - this.revealedAtSegmentStart;
      if (ms >= CALIBRATE_MIN_MS && chars >= CALIBRATE_MIN_CHARS) {
        const measured = (chars / ms) * 1000;
        this.cps = Math.min(MAX_CPS, Math.max(MIN_CPS, this.cps * 0.5 + measured * 0.5));
      }
    }
    this.playing = false;
    this.segmentStartedAt = null;
    this.stopClock();
  }

  /** The user barged in: the rest was never heard. Captions freeze at what was revealed. */
  audioInterrupted() {
    for (const item of this.items) {
      if (item.done) continue;
      item.text = item.text.slice(0, item.revealed).trimEnd();
      item.complete = true;
      this.finalize(item);
    }
    this.prune();
    this.playing = false;
    this.segmentStartedAt = null;
    this.stopClock();
  }

  dispose() {
    this.stopTicking();
    this.items = [];
    this.clockStartedAt = null;
    this.segmentStartedAt = null;
    this.playing = false;
  }

  // ---------------------------------------------------------------------------

  private item(itemId: string): Item {
    let item = this.items.find((i) => i.id === itemId);
    if (!item) {
      item = { id: itemId, text: "", complete: false, revealed: 0, done: false };
      this.items.push(item);
      this.onReveal(itemId, "", false);
    }
    return item;
  }

  private hasPending() {
    return this.items.some((i) => !i.done && (i.revealed < i.text.length || !i.complete));
  }

  private ensureClock() {
    if (this.clockStartedAt == null) this.startClock();
    this.ensureTicking();
  }

  private startClock() {
    this.clockStartedAt = this.now();
    this.revealedAtClockStart = this.revealedTotal;
  }

  private stopClock() {
    this.clockStartedAt = null;
    this.stopTicking();
  }

  private ensureTicking() {
    if (!this.timer) this.timer = setInterval(() => this.tick(), this.tickMs);
  }

  private stopTicking() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private tick() {
    if (this.clockStartedAt == null) return;
    // how many characters, over every item, may have been shown by now
    const allowedTotal = this.revealedAtClockStart + Math.floor(((this.now() - this.clockStartedAt) / 1000) * this.cps);
    for (const item of this.items) {
      if (item.done) continue;
      this.reveal(item, item.revealed + Math.max(0, allowedTotal - this.revealedTotal));
      // pacing continues into the next item only once this one is fully out
      if (item.revealed < item.text.length || !item.complete) break;
    }
    this.prune();
    // caught up: stop the clock so idle time is not banked against the next response
    if (!this.hasPending()) this.stopClock();
  }

  /** Reveal up to `upTo` characters of an item, whole words only. */
  private reveal(item: Item, upTo: number) {
    let cut = Math.min(upTo, item.text.length);
    if (cut < item.text.length) {
      const space = item.text.lastIndexOf(" ", cut);
      cut = space > item.revealed ? space : item.revealed;
    }
    if (cut > item.revealed) {
      this.revealedTotal += cut - item.revealed;
      item.revealed = cut;
      if (item.complete && cut >= item.text.length) this.finalize(item);
      else this.onReveal(item.id, item.text.slice(0, cut), false);
    } else if (item.complete && item.revealed >= item.text.length) {
      this.finalize(item);
    }
  }

  private flush() {
    for (const item of this.items) {
      if (item.done) continue;
      if (item.revealed < item.text.length) {
        this.revealedTotal += item.text.length - item.revealed;
        item.revealed = item.text.length;
      }
      if (item.complete) this.finalize(item);
      else this.onReveal(item.id, item.text, false);
    }
    this.prune();
  }

  private finalize(item: Item) {
    if (item.done) return;
    item.done = true;
    this.onReveal(item.id, item.text, true);
  }

  private prune() {
    if (this.items.some((i) => i.done)) this.items = this.items.filter((i) => !i.done);
  }
}
