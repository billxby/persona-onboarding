"use client";

import { useEffect, useRef, useState } from "react";

export type MicPermission = "idle" | "requesting" | "granted" | "denied";

/**
 * Real microphone loudness (0..1) via getUserMedia + AnalyserNode.
 * No audio leaves the browser; this only powers the meter. The same stream
 * will later be handed to the WebRTC transport.
 */
export function useMicLevel(active: boolean, muted = false) {
  const [level, setLevel] = useState(0);
  const [permission, setPermission] = useState<MicPermission>("idle");
  const [error, setError] = useState<string | null>(null);
  const mutedRef = useRef(muted);
  useEffect(() => {
    mutedRef.current = muted;
  }, [muted]);

  useEffect(() => {
    if (!active) return;
    let stream: MediaStream | null = null;
    let ctx: AudioContext | null = null;
    let raf = 0;
    let cancelled = false;

    (async () => {
      setPermission("requesting");
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        setPermission("granted");
        ctx = new AudioContext();
        const src = ctx.createMediaStreamSource(stream);
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 512;
        src.connect(analyser);
        const buf = new Uint8Array(analyser.fftSize);
        const tick = () => {
          analyser.getByteTimeDomainData(buf);
          let sum = 0;
          for (let i = 0; i < buf.length; i++) {
            const v = (buf[i] - 128) / 128;
            sum += v * v;
          }
          const rms = Math.sqrt(sum / buf.length);
          setLevel(mutedRef.current ? 0 : Math.min(1, rms * 3.5));
          raf = requestAnimationFrame(tick);
        };
        tick();
      } catch (e) {
        if (cancelled) return;
        setPermission("denied");
        setError(e instanceof Error ? e.message : String(e));
      }
    })();

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      stream?.getTracks().forEach((t) => t.stop());
      void ctx?.close();
      setLevel(0);
    };
  }, [active]);

  return { level, permission, error };
}
