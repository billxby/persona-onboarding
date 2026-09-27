"use client";

/**
 * iMessage sound effects: the one supplied clip at /sounds/sent.mp3 plays both when your bubble
 * leaves and when one of Persona's arrives (product decision 2026-09-27: same sound both ways).
 * Two independent elements so a fast reply never cuts the send sound short. Audio is unlocked by
 * the first send gesture (autoplay policy); every call is fire-and-forget and never throws.
 */
const CLIP_SRC = "/sounds/sent.mp3";

let sentEl: HTMLAudioElement | null = null;
let receivedEl: HTMLAudioElement | null = null;

function clip(which: "sent" | "received"): HTMLAudioElement | null {
  if (typeof window === "undefined") return null;
  const make = () => {
    const a = new Audio(CLIP_SRC);
    a.preload = "auto";
    a.volume = 0.7;
    return a;
  };
  if (which === "sent") return (sentEl ??= make());
  return (receivedEl ??= make());
}

function play(a: HTMLAudioElement | null): void {
  if (!a) return;
  try {
    a.currentTime = 0;
    void a.play().catch(() => undefined);
  } catch {
    /* no audio */
  }
}

/** Call from a user gesture (the send button) so later incoming sounds are allowed to play. */
export function unlockAudio(): void {
  clip("sent")?.load();
  clip("received")?.load();
}

/** Your bubble left. */
export function playSent(): void {
  play(clip("sent"));
}

/** One of Persona's bubbles arrived. Same clip as sending. */
export function playReceived(): void {
  play(clip("received"));
}
