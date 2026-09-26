"use client";

import { Copy, Reply } from "lucide-react";
import { motion } from "motion/react";
import { useState } from "react";
import { TAPBACKS, type ChatMessage, type Tapback } from "@/lib/session/types";
import { cn } from "@/lib/utils";
import { GLASS, TapbackGlyph } from "./Tapback";
import { TAPBACK_LABEL } from "./tapbackTheme";

export interface AnchorRect {
  top: number;
  left: number;
  width: number;
  height: number;
}

const BAR_H = 46;
const MENU_H = 2 * 44 + 2;
const HEADER_H = 116;
const COMPOSER_H = 80;

/**
 * The long-press overlay: thread blurs, the pressed bubble lifts, a tapback
 * bar appears on one side and the context menu on the other. Layout mirrors
 * iOS: bar above the bubble, menu below, flipping when there's no room.
 */
export function MessageActions({
  message,
  anchor,
  screenHeight,
  onClose,
  onTapback,
  onReply,
  onCopy,
}: {
  message: ChatMessage;
  anchor: AnchorRect;
  screenHeight: number;
  onClose: () => void;
  onTapback: (kind: Tapback) => void;
  onReply: () => void;
  onCopy: () => void;
}) {
  const out = message.role === "user";
  const mine = message.reactions?.find((r) => r.by === "user")?.kind;
  const [picked, setPicked] = useState<Tapback | null>(null);

  // iOS: the chosen glyph pops, then the whole overlay settles back down.
  const pick = (kind: Tapback) => {
    if (picked) return;
    setPicked(kind);
    setTimeout(() => onTapback(kind), 140);
  };

  // Vertical placement. Prefer: bar above, menu below.
  const roomAbove = anchor.top - HEADER_H;
  const roomBelow = screenHeight - COMPOSER_H - (anchor.top + anchor.height);
  let barTop = anchor.top - BAR_H - 10;
  let menuTop = anchor.top + anchor.height + 10;
  let bubbleTop = anchor.top;
  if (roomAbove < BAR_H + 14) {
    // slide the whole cluster down (iOS scrolls the message into view)
    bubbleTop = HEADER_H + BAR_H + 14;
    barTop = bubbleTop - BAR_H - 10;
    menuTop = bubbleTop + anchor.height + 10;
  } else if (roomBelow < MENU_H + 14) {
    // not enough space under the bubble: lift everything up
    const shift = MENU_H + 14 - roomBelow;
    bubbleTop = anchor.top - shift;
    barTop = bubbleTop - BAR_H - 10;
    menuTop = bubbleTop + anchor.height + 10;
  }

  const sideStyle = out ? { right: 390 - (anchor.left + anchor.width) } : { left: anchor.left };

  return (
    <div className="absolute inset-0 z-[60]" onClick={onClose}>
      <motion.div
        className="absolute inset-0 bg-white/55 backdrop-blur-[14px]"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0, transition: { duration: 0.16, delay: 0.06 } }}
        transition={{ duration: 0.18 }}
      />

      {/* lifted bubble clone */}
      <motion.div
        className={cn("bubble absolute", out ? "bubble-out" : "bubble-in", "tail")}
        style={{ top: bubbleTop, left: anchor.left, width: anchor.width, maxWidth: "none" }}
        initial={{ top: anchor.top, scale: 1, boxShadow: "0 0 0 rgba(0,0,0,0)" }}
        animate={{ top: bubbleTop, scale: 1.02, boxShadow: "0 8px 30px rgba(0,0,0,0.18)" }}
        exit={{ top: anchor.top, scale: 1, boxShadow: "0 0 0 rgba(0,0,0,0)", opacity: 0, transition: { duration: 0.22, ease: [0.2, 0.8, 0.2, 1] } }}
        transition={{ type: "spring", stiffness: 420, damping: 32 }}
        onClick={(e) => e.stopPropagation()}
      >
        {message.text}
      </motion.div>

      {/* tapback bar */}
      <motion.div
        className={cn("absolute flex h-[46px] items-center gap-[2px] rounded-full px-[7px]", GLASS)}
        style={{ top: barTop, ...sideStyle }}
        initial={{ opacity: 0, scale: 0.6, y: 12, transformOrigin: out ? "right bottom" : "left bottom" }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.7, y: 8, transition: { duration: 0.16 } }}
        transition={{ type: "spring", stiffness: 480, damping: 28 }}
        onClick={(e) => e.stopPropagation()}
      >
        {TAPBACKS.map((kind, i) => {
          const selected = mine === kind;
          const isPicked = picked === kind;
          return (
            <motion.button
              key={kind}
              initial={{ scale: 0, opacity: 0 }}
              animate={{ scale: isPicked ? 1.35 : 1, opacity: 1, y: isPicked ? -6 : 0 }}
              transition={isPicked ? { type: "spring", stiffness: 600, damping: 18 } : { delay: 0.03 * i, type: "spring", stiffness: 500, damping: 22 }}
              whileTap={{ scale: 0.85 }}
              onClick={() => pick(kind)}
              aria-label={kind}
              title={TAPBACK_LABEL[kind]}
              className={cn(
                "flex h-[36px] w-[36px] items-center justify-center rounded-full transition-colors",
                selected && !isPicked ? "bg-black/[0.08]" : "hover:bg-black/5",
              )}
            >
              <TapbackGlyph kind={kind} size={22} />
            </motion.button>
          );
        })}
      </motion.div>

      {/* context menu */}
      <motion.div
        className={cn("absolute w-[250px] overflow-hidden rounded-[14px]", GLASS)}
        style={{ top: menuTop, ...sideStyle }}
        initial={{ opacity: 0, scale: 0.7, transformOrigin: out ? "right top" : "left top" }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.85, transition: { duration: 0.14 } }}
        transition={{ type: "spring", stiffness: 480, damping: 30 }}
        onClick={(e) => e.stopPropagation()}
      >
        <MenuItem label="Reply" icon={Reply} onClick={onReply} />
        <div className="h-px bg-black/10" />
        <MenuItem label="Copy" icon={Copy} onClick={onCopy} />
      </motion.div>
    </div>
  );
}

function MenuItem({ label, icon: Icon, onClick }: { label: string; icon: React.ComponentType<{ className?: string }>; onClick: () => void }) {
  return (
    <button onClick={onClick} className="flex h-[44px] w-full items-center justify-between px-4 text-[17px] active:bg-black/5">
      <span>{label}</span>
      <Icon className="h-[19px] w-[19px] text-black/80" />
    </button>
  );
}
