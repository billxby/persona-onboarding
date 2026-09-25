"use client";

import { Battery, Signal, Wifi } from "lucide-react";
import { useEffect, useState } from "react";
import { cn, formatClock } from "@/lib/utils";

export function StatusBar({ dark = false, className }: { dark?: boolean; className?: string }) {
  const [time, setTime] = useState<string>("");
  useEffect(() => {
    const tick = () => setTime(formatClock(new Date()));
    const t = setTimeout(tick, 0);
    const i = setInterval(tick, 15_000);
    return () => {
      clearTimeout(t);
      clearInterval(i);
    };
  }, []);

  return (
    <div
      className={cn(
        "pointer-events-none absolute inset-x-0 top-0 z-30 flex h-[54px] items-end justify-between px-8 pb-2 text-[15px] font-semibold",
        dark ? "text-white" : "text-black",
        className,
      )}
    >
      <span className="min-w-[54px] whitespace-nowrap tabular-nums">{time}</span>
      <div className="flex items-center gap-1.5">
        <Signal className="h-4 w-4" strokeWidth={2.5} />
        <Wifi className="h-4 w-4" strokeWidth={2.5} />
        <Battery className="h-5 w-5" strokeWidth={2} />
      </div>
    </div>
  );
}
