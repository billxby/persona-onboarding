"use client";

import { AnimatePresence, motion } from "motion/react";
import type { Reaction, ReactionKind, Tapback } from "@/lib/session/types";
import { cn } from "@/lib/utils";
import { TAPBACK_COLOR } from "./tapbackTheme";

const FONT = "-apple-system, BlinkMacSystemFont, Helvetica, Arial, sans-serif";

/** The six classic tapback glyphs, drawn as SVG so they centre exactly. */
export function TapbackGlyph({ kind, size = 16, color, className }: { kind: Tapback; size?: number; color?: string; className?: string }) {
  const fill = color ?? TAPBACK_COLOR[kind];
  const common = { width: size, height: size, viewBox: "0 0 24 24", className, "aria-hidden": true } as const;
  switch (kind) {
    case "heart":
      return (
        <svg {...common}>
          <path fill={fill} d="M12 21.35c-.4 0-.78-.14-1.08-.4C6.5 17 3 13.9 3 9.86 3 6.98 5.24 4.75 8.1 4.75c1.6 0 3.02.78 3.9 2.02.88-1.24 2.3-2.02 3.9-2.02C18.76 4.75 21 6.98 21 9.86c0 4.04-3.5 7.14-7.92 11.09-.3.26-.68.4-1.08.4Z" />
        </svg>
      );
    case "thumbsUp":
      return (
        <svg {...common}>
          <path fill={fill} d="M8.5 21H6a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h2.5V21Zm2-11.2V21h7.3a2.6 2.6 0 0 0 2.56-2.12l1.1-6A2.6 2.6 0 0 0 18.9 9.8h-4.3l.55-3.05a2.3 2.3 0 0 0-1.3-2.5l-.7-.3-2.65 5.85Z" />
        </svg>
      );
    case "thumbsDown":
      return (
        <svg {...common}>
          <path fill={fill} d="M15.5 3H18a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2h-2.5V3Zm-2 11.2V3H6.2a2.6 2.6 0 0 0-2.56 2.12l-1.1 6A2.6 2.6 0 0 0 5.1 14.2h4.3l-.55 3.05a2.3 2.3 0 0 0 1.3 2.5l.7.3 2.65-5.85Z" />
        </svg>
      );
    case "haha":
      return (
        <svg {...common}>
          <text x="12" y="8.6" textAnchor="middle" dominantBaseline="central" fontSize="8.2" fontWeight="900" fill={fill} fontFamily={FONT} letterSpacing="-0.2">HA</text>
          <text x="12" y="16.6" textAnchor="middle" dominantBaseline="central" fontSize="8.2" fontWeight="900" fill={fill} fontFamily={FONT} letterSpacing="-0.2">HA</text>
        </svg>
      );
    case "exclaim":
      return (
        <svg {...common}>
          <text x="12" y="12.4" textAnchor="middle" dominantBaseline="central" fontSize="17" fontWeight="900" fill={fill} fontFamily={FONT} letterSpacing="-1">!!</text>
        </svg>
      );
    case "question":
      return (
        <svg {...common}>
          <text x="12" y="12.4" textAnchor="middle" dominantBaseline="central" fontSize="17" fontWeight="900" fill={fill} fontFamily={FONT}>?</text>
        </svg>
      );
  }
}

/** Any reaction: classic glyph or emoji. */
export function ReactionGlyph({ kind, size = 16 }: { kind: ReactionKind; size?: number }) {
  if (kind.type === "emoji") {
    return (
      <span style={{ fontSize: size * 0.95, lineHeight: 1 }} aria-hidden>
        {kind.emoji}
      </span>
    );
  }
  return <TapbackGlyph kind={kind.tapback} size={size} />;
}

/** Frosted material shared by badges, picker and menu. */
export const GLASS =
  "bg-glass backdrop-blur-xl border border-glass-edge shadow-[0_1px_1.5px_rgba(0,0,0,0.10),0_6px_18px_-8px_rgba(0,0,0,0.18),inset_0_1px_0_var(--glass-hi)]";

/**
 * Tapback badges pinned to a bubble corner: top-right on received bubbles,
 * top-left on sent ones, with two tail dots toward the bubble.
 */
export function TapbackBadges({ reactions, side }: { reactions: Reaction[]; side: "in" | "out" }) {
  const sorted = [...reactions].sort((a, b) => a.ts - b.ts);
  return (
    <div className={cn("pointer-events-none absolute -top-[19px] z-10 flex", side === "in" ? "-right-[22px] flex-row" : "-left-[22px] flex-row-reverse")}>
      <AnimatePresence initial={false}>
        {sorted.map((r, i) => (
          <motion.div
            key={r.by}
            layout
            initial={{ scale: 0, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0, opacity: 0 }}
            transition={{ type: "spring", stiffness: 520, damping: 26 }}
            style={{ zIndex: sorted.length - i, transformOrigin: side === "in" ? "bottom left" : "bottom right" }}
            className={cn("relative", i > 0 && (side === "in" ? "-ml-2.5" : "-mr-2.5"))}
          >
            <div className={cn("flex h-[30px] min-w-[30px] items-center justify-center rounded-full px-[7px]", GLASS)}>
              <ReactionGlyph kind={r.kind} size={16} />
            </div>
            <span className={cn("absolute h-[9px] w-[9px] rounded-full", GLASS, side === "in" ? "bottom-[-2px] left-[-1px]" : "bottom-[-2px] right-[-1px]")} />
            <span className={cn("absolute h-[5px] w-[5px] rounded-full bg-white/85 shadow-[0_0.5px_1px_rgba(0,0,0,0.12)] dark:bg-[#3a3a3c]", side === "in" ? "bottom-[-6px] left-[-5px]" : "bottom-[-6px] right-[-5px]")} />
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
