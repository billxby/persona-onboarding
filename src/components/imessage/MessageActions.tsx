"use client";

import { Copy, Reply } from "lucide-react";
import { motion } from "motion/react";
import { TAPBACKS, type ChatMessage, type Tapback } from "@/lib/session/types";
import { cn } from "@/lib/utils";
import { TapbackGlyph } from "./Tapback";

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
        exit={{ opacity: 0 }}
        transition={{ duration: 0.18 }}
      />

      {/* lifted bubble clone */}
      <motion.div
        className={cn("bubble absolute shadow-[0_8px_30px_rgba(0,0,0,0.18)]", out ? "bubble-out" : "bubble-in", "tail")}
        style={{ top: bubbleTop, left: anchor.left, width: anchor.width, maxWidth: "none" }}
        initial={{ top: anchor.top, scale: 1 }}
        animate={{ top: bubbleTop, scale: 1.02 }}
        transition={{ type: "spring", stiffness: 420, damping: 32 }}
        onClick={(e) => e.stopPropagation()}
      >
        {message.text}
      </motion.div>

      {/* tapback bar */}
      <motion.div
        className="absolute flex h-[46px] items-center gap-[2px] rounded-full bg-[#e9e9eb] px-[7px] shadow-[0_6px_24px_rgba(0,0,0,0.18)]"
        style={{ top: barTop, ...sideStyle }}
        initial={{ opacity: 0, scale: 0.6, y: 12, transformOrigin: out ? "right bottom" : "left bottom" }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.8 }}
        transition={{ type: "spring", stiffness: 480, damping: 28 }}
        onClick={(e) => e.stopPropagation()}
      >
        {TAPBACKS.map((kind, i) => {
          const selected = mine === kind;
          return (
            <motion.button
              key={kind}
              initial={{ scale: 0, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ delay: 0.03 * i, type: "spring", stiffness: 500, damping: 22 }}
              whileTap={{ scale: 0.85 }}
              onClick={() => onTapback(kind)}
              aria-label={kind}
              className={cn(
                "flex h-[36px] w-[36px] items-center justify-center rounded-full transition-colors",
                selected ? "bg-imsg-blue text-white" : "text-[#7d7d82] hover:bg-black/5",
              )}
            >
              <TapbackGlyph kind={kind} className="h-[19px] w-[19px]" />
            </motion.button>
          );
        })}
      </motion.div>

      {/* context menu */}
      <motion.div
        className="absolute w-[250px] overflow-hidden rounded-[13px] bg-[#f2f2f7]/95 shadow-[0_10px_40px_rgba(0,0,0,0.22)] backdrop-blur-xl"
        style={{ top: menuTop, ...sideStyle }}
        initial={{ opacity: 0, scale: 0.7, transformOrigin: out ? "right top" : "left top" }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.85 }}
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
