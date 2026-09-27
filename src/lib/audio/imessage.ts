"use client";

/**
 * iMessage sound effects. "Sent" is the real clip at /sounds/sent.mp3 (the whoosh when your bubble
 * leaves); "received" is a two-note ding synthesized with WebAudio (same approach as the ringtone,
 * no asset needed). Audio is unlocked by the first send gesture (autoplay policy); every call is
 * fire-and-forget and never throws.
 */
const SENT_SRC = "/sounds/sent.mp3";

let ctx: AudioContext | null = null;
let sent: HTMLAudioElement | null = null;

function context(): AudioContext | null {
  if (typeof window === "undefined") return null;
  try {
    ctx ??= new AudioContext();
    if (ctx.state === "suspended") void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

function sentClip(): HTMLAudioElement | null {
  if (typeof window === "undefined") return null;
  if (!sent) {
    sent = new Audio(SENT_SRC);
    sent.preload = "auto";
    sent.volume = 0.7;
  }
  return sent;
}

/** Call from a user gesture (the send button) so later incoming dings are allowed to play. */
export function unlockAudio(): void {
  void context();
  sentClip()?.load();
}

/** The outgoing whoosh. */
export function playSent(): void {
  const a = sentClip();
  if (!a) return;
  try {
    a.currentTime = 0;
    void a.play().catch(() => undefined);
  } catch {
    /* no audio */
  }
}

/** The incoming ding: two quick sine notes with a soft tail. */
export function playReceived(): void {
  const c = context();
  if (!c) return;
  const t0 = c.currentTime + 0.005;
  const master = c.createGain();
  master.gain.value = 0.16;
  master.connect(c.destination);
  const note = (freq: number, at: number, len: number) => {
    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.type = "sine";
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(1, at + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + len);
    osc.connect(gain).connect(master);
    osc.start(at);
    osc.stop(at + len + 0.02);
  };
  note(1174.66, t0, 0.18); // D6
  note(1567.98, t0 + 0.11, 0.32); // G6
}
