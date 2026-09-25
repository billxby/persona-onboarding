"use client";

import { cn } from "@/lib/utils";

/** Vertical bar meter. `level` is 0..1. */
export function AudioMeter({
  level,
  bars = 5,
  className,
  color = "bg-white",
}: {
  level: number;
  bars?: number;
  className?: string;
  color?: string;
}) {
  return (
    <div className={cn("flex h-6 items-end gap-[3px]", className)} aria-hidden>
      {Array.from({ length: bars }).map((_, i) => {
        // centre bars respond first, edges last, for a waveform look
        const centre = (bars - 1) / 2;
        const weight = 1 - Math.abs(i - centre) / (centre + 1);
        const h = Math.max(0.15, Math.min(1, level * (0.6 + weight)));
        return (
          <span
            key={i}
            className={cn("w-[4px] rounded-full transition-[height] duration-75", color)}
            style={{ height: `${h * 100}%` }}
          />
        );
      })}
    </div>
  );
}
