"use client";

import { useSessionStore } from "@/lib/session/store";
import { cn } from "@/lib/utils";
import { SlotChips } from "./SlotChips";

/**
 * Progress chips above the phone (DESIGN §15.3): filled live from the server
 * mirror, tappable to edit, never a form. The dot shows how the mirror is fed.
 */
export function ProgressBar() {
  const slots = useSessionStore((s) => s.slots);
  const connection = useSessionStore((s) => s.connection);
  const mode = useSessionStore((s) => s.mode);
  return (
    <div className="pointer-events-auto fixed left-1/2 top-4 z-40 flex -translate-x-1/2 items-center gap-3 rounded-full border border-black/10 bg-white/80 px-3 py-1.5 shadow-[0_8px_30px_-12px_rgba(0,0,0,0.35)] backdrop-blur-xl">
      <SlotChips slots={slots} editable compact />
      <span className="flex items-center gap-1.5 pr-1 text-[11px] text-black/50" title={`connection: ${connection}`}>
        <span
          className={cn(
            "h-1.5 w-1.5 rounded-full",
            connection === "realtime" && "animate-pulse bg-emerald-500",
            connection === "polling" && "bg-amber-400",
            connection === "offline" && "bg-rose-500",
          )}
        />
        {mode === "main" ? "main" : "onboarding"}
      </span>
    </div>
  );
}
