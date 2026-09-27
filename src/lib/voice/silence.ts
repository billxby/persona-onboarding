/**
 * Silence tiers for a live call (DESIGN §10.6). The clock measures the user's silence: it starts when
 * the assistant's audio ends and only user speech resets it. Nothing fires while the assistant is
 * talking. A check-in (the response to a tier note) leaves the clock running, but the next tier waits
 * at least `minGapMs` after the check-in's audio ends, so the user always gets a real chance to answer.
 * Any other assistant turn (a follow-up after a tool call, a reaction to a system note) restarts the
 * clock: nobody was waiting on the user until that audio ended. Three unanswered check-ins end the
 * call even if the wall clock says otherwise. Everything is ×3 while Gmail is pending.
 */
export type SilenceTier = 1 | 2 | 3;

export interface SilenceWatcherOptions {
  onTier: (tier: SilenceTier) => void;
  /** ms from the start of user silence to each tier; default 6 s / 12 s / 20 s */
  tiersMs?: [number, number, number];
  /** multiplier while a Gmail connect is pending; default 3 (→ 18 / 36 / 60 s) */
  pendingMultiplier?: number;
  /** quiet time the user gets after a check-in's audio ends before the next tier may fire; default 5 s */
  minGapMs?: number;
  /** if no check-in audio follows a tier, the next tier fires this long after it at the latest; default 10 s */
  checkInFallbackMs?: number;
}

export class SilenceWatcher {
  private readonly tiersMs: [number, number, number];
  private readonly pendingMultiplier: number;
  private readonly minGapMs: number;
  private readonly checkInFallbackMs: number;
  private readonly onTier: (tier: SilenceTier) => void;
  private running = false;
  private pending = false;
  private speaking = false;
  private silenceStartedAt: number | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private fired = new Set<SilenceTier>();
  private noInputs = 0;
  /** a tier fired; the next assistant audio is its check-in, not a new turn */
  private checkInPending = false;

  constructor(opts: SilenceWatcherOptions) {
    this.onTier = opts.onTier;
    this.tiersMs = opts.tiersMs ?? [6_000, 12_000, 20_000];
    this.pendingMultiplier = opts.pendingMultiplier ?? 3;
    this.minGapMs = opts.minGapMs ?? 5_000;
    this.checkInFallbackMs = opts.checkInFallbackMs ?? 10_000;
  }

  get isSilent() {
    return this.silenceStartedAt != null;
  }

  get isSpeaking() {
    return this.speaking;
  }

  get unansweredCheckIns() {
    return this.noInputs;
  }

  start() {
    this.running = true;
  }

  stop() {
    this.running = false;
    this.clearTimer();
    this.silenceStartedAt = null;
    this.fired.clear();
    this.speaking = false;
    this.checkInPending = false;
  }

  /** Assistant audio started: nothing fires while it talks. */
  onAssistantAudioStarted() {
    if (!this.running) return;
    this.speaking = true;
    this.clearTimer();
  }

  /**
   * Assistant audio ended. A check-in leaves the clock running (the next tier waits `minGapMs` from
   * now at least); any other turn starts the clock here.
   */
  onAssistantAudioStopped() {
    if (!this.running) return;
    this.speaking = false;
    const checkIn = this.checkInPending;
    this.checkInPending = false;
    if (!checkIn || this.silenceStartedAt == null) {
      this.silenceStartedAt = Date.now();
      this.fired.clear();
    }
    this.schedule(checkIn ? this.minGapMs : 0);
  }

  /** Any user input (speech start or a transcript) resets everything. */
  onUserSpeechStart() {
    this.clearTimer();
    this.silenceStartedAt = null;
    this.fired.clear();
    this.noInputs = 0;
    this.checkInPending = false;
  }

  setGmailPending(pending: boolean) {
    if (this.pending === pending) return;
    this.pending = pending;
    if (this.silenceStartedAt != null && !this.speaking) this.schedule(0);
  }

  private nextTier(): SilenceTier | null {
    for (const tier of [1, 2, 3] as SilenceTier[]) if (!this.fired.has(tier)) return tier;
    return null;
  }

  /** Arm the next unfired tier: at its due time, or `minDelayMs` from now if that is later. */
  private schedule(minDelayMs: number) {
    this.clearTimer();
    if (this.silenceStartedAt == null || this.speaking) return;
    const tier = this.nextTier();
    if (!tier) return;
    const mult = this.pending ? this.pendingMultiplier : 1;
    const now = Date.now();
    const at = Math.max(this.silenceStartedAt + this.tiersMs[tier - 1] * mult, now + minDelayMs);
    this.timer = setTimeout(() => this.fire(tier), Math.max(0, at - now));
  }

  private fire(tier: SilenceTier) {
    this.timer = null;
    if (!this.running || this.fired.has(tier) || this.silenceStartedAt == null || this.speaking) return;
    // the third unanswered check-in is the goodbye, whatever the wall clock says
    const effective: SilenceTier = tier === 3 || this.noInputs + 1 >= 3 ? 3 : tier;
    for (const t of [1, 2, 3] as SilenceTier[]) if (t <= effective) this.fired.add(t);
    this.noInputs += 1;
    this.checkInPending = true;
    this.onTier(effective);
    // the check-in's audio reschedules this properly; if that audio never comes, don't stall
    if (effective !== 3) this.schedule(this.checkInFallbackMs);
  }

  private clearTimer() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }
}
