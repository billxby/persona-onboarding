/**
 * Silence tiers for a live call (DESIGN §10.6): the clock starts when the assistant stops talking
 * and only user speech resets it. Check-ins (tier 1 and 2) do not reset the clock; three unanswered
 * check-ins end the call even if the wall clock says otherwise. Everything is ×3 while Gmail is pending.
 */
export type SilenceTier = 1 | 2 | 3;

export interface SilenceWatcherOptions {
  onTier: (tier: SilenceTier) => void;
  /** ms from the start of user silence to each tier; default 6 s / 12 s / 20 s */
  tiersMs?: [number, number, number];
  /** multiplier while a Gmail connect is pending; default 3 (→ 18 / 36 / 60 s) */
  pendingMultiplier?: number;
}

export class SilenceWatcher {
  private readonly tiersMs: [number, number, number];
  private readonly pendingMultiplier: number;
  private readonly onTier: (tier: SilenceTier) => void;
  private running = false;
  private pending = false;
  private silenceStartedAt: number | null = null;
  private timers: Array<ReturnType<typeof setTimeout>> = [];
  private fired = new Set<SilenceTier>();
  private noInputs = 0;

  constructor(opts: SilenceWatcherOptions) {
    this.onTier = opts.onTier;
    this.tiersMs = opts.tiersMs ?? [6_000, 12_000, 20_000];
    this.pendingMultiplier = opts.pendingMultiplier ?? 3;
  }

  get isSilent() {
    return this.silenceStartedAt != null;
  }

  get unansweredCheckIns() {
    return this.noInputs;
  }

  start() {
    this.running = true;
  }

  stop() {
    this.running = false;
    this.clearTimers();
    this.silenceStartedAt = null;
    this.fired.clear();
  }

  /** Assistant audio ended. Starts the clock unless it is already running (check-ins don't reset it). */
  onAssistantAudioStopped() {
    if (!this.running || this.silenceStartedAt != null) return;
    this.silenceStartedAt = Date.now();
    this.schedule();
  }

  /** Any user input (speech start or a transcript) resets everything. */
  onUserSpeechStart() {
    this.clearTimers();
    this.silenceStartedAt = null;
    this.fired.clear();
    this.noInputs = 0;
  }

  setGmailPending(pending: boolean) {
    if (this.pending === pending) return;
    this.pending = pending;
    if (this.silenceStartedAt != null) {
      this.clearTimers();
      this.schedule();
    }
  }

  private schedule() {
    if (this.silenceStartedAt == null) return;
    const mult = this.pending ? this.pendingMultiplier : 1;
    const elapsed = Date.now() - this.silenceStartedAt;
    for (const tier of [1, 2, 3] as SilenceTier[]) {
      if (this.fired.has(tier)) continue;
      const delay = Math.max(0, this.tiersMs[tier - 1] * mult - elapsed);
      this.timers.push(setTimeout(() => this.fire(tier), delay));
    }
  }

  private fire(tier: SilenceTier) {
    if (!this.running || this.fired.has(tier) || this.silenceStartedAt == null) return;
    this.fired.add(tier);
    this.noInputs += 1;
    this.onTier(tier);
    if (tier !== 3 && this.noInputs >= 3 && !this.fired.has(3)) {
      this.clearTimers();
      this.fire(3);
    }
  }

  private clearTimers() {
    this.timers.forEach((t) => clearTimeout(t));
    this.timers = [];
  }
}
