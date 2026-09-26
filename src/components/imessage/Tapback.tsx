"use client";

import { Heart, ThumbsDown, ThumbsUp } from "lucide-react";
import type { Reaction, Tapback } from "@/lib/session/types";
import { cn } from "@/lib/utils";

/** The six iMessage tapback glyphs. */
export function TapbackGlyph({ kind, className }: { kind: Tapback; className?: string }) {
  switch (kind) {
    case "heart":
      return <Heart className={cn("fill-current", className)} strokeWidth={0} />;
    case "thumbsUp":
      return <ThumbsUp className={cn("fill-current", className)} strokeWidth={0} />;
    case "thumbsDown":
      return <ThumbsDown className={cn("fill-current", className)} strokeWidth={0} />;
    case "haha":
      return (
        <span className={cn("text-center text-[9px] font-extrabold leading-[9px] tracking-tight", className)}>
          HA
          <br />
          HA
        </span>
      );
    case "exclaim":
      return <span className={cn("text-[15px] font-extrabold leading-none", className)}>!!</span>;
    case "question":
      return <span className={cn("text-[15px] font-extrabold leading-none", className)}>?</span>;
  }
}

/**
 * Tapback badges pinned to a bubble corner. iOS puts them top-right on
 * received bubbles and top-left on sent ones; your tapbacks are blue, theirs
 * are gray, each with a little "tail" dot toward the bubble.
 */
export function TapbackBadges({ reactions, side }: { reactions: Reaction[]; side: "in" | "out" }) {
  if (reactions.length === 0) return null;
  const sorted = [...reactions].sort((a, b) => a.ts - b.ts);
  return (
    <div
      className={cn(
        "pointer-events-none absolute -top-[19px] z-10 flex",
        side === "in" ? "-right-[22px] flex-row" : "-left-[22px] flex-row-reverse",
      )}
    >
      {sorted.map((r, i) => {
        const mine = r.by === "user";
        return (
          <div
            key={r.by}
            className={cn("relative", i > 0 && (side === "in" ? "-ml-2.5" : "-mr-2.5"))}
            style={{ zIndex: sorted.length - i }}
          >
            <div
              className={cn(
                "flex h-[29px] min-w-[29px] items-center justify-center rounded-full border-[1.5px] px-1.5 shadow-sm",
                mine ? "border-white bg-imsg-blue text-white" : "border-white bg-imsg-gray text-black/80",
              )}
            >
              <TapbackGlyph kind={r.kind} className="h-[14px] w-[14px]" />
            </div>
            {/* tail dots */}
            <span
              className={cn(
                "absolute h-[9px] w-[9px] rounded-full border border-white",
                mine ? "bg-imsg-blue" : "bg-imsg-gray",
                side === "in" ? "bottom-[-2px] left-[-1px]" : "bottom-[-2px] right-[-1px]",
              )}
            />
            <span
              className={cn(
                "absolute h-[5px] w-[5px] rounded-full",
                mine ? "bg-imsg-blue" : "bg-imsg-gray",
                side === "in" ? "bottom-[-6px] left-[-5px]" : "bottom-[-6px] right-[-5px]",
              )}
            />
          </div>
        );
      })}
    </div>
  );
}
