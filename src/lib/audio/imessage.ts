"use client";

/**
 * iMessage-style sound effects, synthesized with WebAudio so we ship no audio assets (same
 * approach as the ringtone). "Sent" is the short whoosh you hear when your bubble leaves;
 * "received" is the two-note ding of an incoming message. One shared context, created on the
 * first user gesture (autoplay policy); every call is fire-and-forget and never throws.
 */
let ctx: AudioContext | null = null;

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

/** Call from a user gesture (the send button) so later incoming dings are allowed to play. */
export function unlockAudio(): void {
  void context();
}

/** The outgoing whoosh: a short burst of filtered noise whose pitch rises and fades. */
export function playSent(): void {
  const c = context();
  if (!c) return;
  const t0 = c.currentTime + 0.005;
  const dur = 0.22;
  const buffer = c.createBuffer(1, Math.ceil(c.sampleRate * dur), c.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
  const src = c.createBufferSource();
  src.buffer = buffer;
  const filter = c.createBiquadFilter();
  filter.type = "bandpass";
  filter.Q.value = 1.4;
  filter.frequency.setValueAtTime(900, t0);
  filter.frequency.exponentialRampToValueAtTime(3200, t0 + dur);
  const gain = c.createGain();
  gain.gain.setValueAtTime(0.0001, t0);
  gain.gain.exponentialRampToValueAtTime(0.22, t0 + 0.03);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  src.connect(filter).connect(gain).connect(c.destination);
  src.start(t0);
  src.stop(t0 + dur + 0.02);
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
