"use client";

import { Phone } from "lucide-react";
import { useEffect, useState } from "react";
import { formatDuration } from "@/lib/utils";

/** Green "return to call" pill shown while a call is live and the user is viewing Messages. */
export function CallBanner({ startedAt, onReturn }: { startedAt?: number; onReturn: () => void }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const i = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(i);
  }, []);
  return (
    <button
      onClick={onReturn}
      className="absolute left-1/2 top-[14px] z-50 flex h-[29px] -translate-x-1/2 items-center gap-1.5 rounded-full bg-ios-green pl-3 pr-3.5 text-[13px] font-semibold text-white shadow"
    >
      <Phone className="h-3.5 w-3.5 fill-white" />
      <span className="tabular-nums">{startedAt ? formatDuration(now - startedAt) : "…"}</span>
    </button>
  );
}
