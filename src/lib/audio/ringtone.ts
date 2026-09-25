"use client";

/**
 * Synthesized ringtone with WebAudio so we ship no audio assets.
 * A marimba-ish four-note phrase that repeats while ringing.
 */
export function startRingtone(): () => void {
  let ctx: AudioContext | null = null;
  try {
    ctx = new AudioContext();
  } catch {
    return () => {};
  }
  const master = ctx.createGain();
  master.gain.value = 0.18;
  master.connect(ctx.destination);

  const notes = [659.25, 783.99, 987.77, 783.99, 659.25, 523.25]; // E5 G5 B5 G5 E5 C5
  let stopped = false;

  const pluck = (freq: number, at: number) => {
    if (!ctx) return;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(1, at + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.45);
    osc.connect(gain).connect(master);
    osc.start(at);
    osc.stop(at + 0.5);
  };

  const phrase = () => {
    if (stopped || !ctx) return;
    const t0 = ctx.currentTime + 0.05;
    notes.forEach((n, i) => pluck(n, t0 + i * 0.16));
    timer = setTimeout(phrase, 2200);
  };
  let timer: ReturnType<typeof setTimeout> = setTimeout(phrase, 0);

  return () => {
    stopped = true;
    clearTimeout(timer);
    void ctx?.close();
    ctx = null;
  };
}
