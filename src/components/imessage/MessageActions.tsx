"use client";

import { Copy, Reply, SmilePlus } from "lucide-react";
import { motion } from "motion/react";
import { useState } from "react";
import { TAPBACKS, messageText, sameReaction, type ChatMessage, type ReactionKind } from "@/lib/session/types";
import { cn } from "@/lib/utils";
import { GLASS, ReactionGlyph, TapbackGlyph } from "./Tapback";
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
const RECENT_EMOJI = ["😂", "😍", "🔥", "🙏", "👏", "😮", "😢", "🎉"];

/**
 * The long-press overlay: thread blurs, the pressed bubble lifts, the tapback
 * bar (six glyphs, then emoji) appears on one side and the context menu on the
 * other. Layout mirrors iOS: bar above, menu below, flipping when there's no room.
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
  onTapback: (kind: ReactionKind) => void;
  onReply: () => void;
  onCopy: () => void;
}) {
  const out = message.role === "user";
  const mine = message.reactions?.find((r) => r.by === "user")?.kind;
  const [picked, setPicked] = useState<ReactionKind | null>(null);
  const [emojiMode, setEmojiMode] = useState(false);
  const isText = message.content.kind === "text";

  const pick = (kind: ReactionKind) => {
    if (picked) return;
    setPicked(kind);
    setTimeout(() => onTapback(kind), 140);
  };

  const roomAbove = anchor.top - HEADER_H;
  const roomBelow = screenHeight - COMPOSER_H - (anchor.top + anchor.height);
  let barTop = anchor.top - BAR_H - 10;
  let menuTop = anchor.top + anchor.height + 10;
  let bubbleTop = anchor.top;
  if (roomAbove < BAR_H + 14) {
    bubbleTop = HEADER_H + BAR_H + 14;
    barTop = bubbleTop - BAR_H - 10;
    menuTop = bubbleTop + anchor.height + 10;
  } else if (roomBelow < MENU_H + 14) {
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

      {/* lifted clone (text bubbles get the real bubble look; media gets a plain lift) */}
      <motion.div
        className={cn(isText ? "bubble absolute" : "absolute rounded-[18px] bg-imsg-gray", isText && (out ? "bubble-out" : "bubble-in"), isText && "tail")}
        style={{ top: bubbleTop, left: anchor.left, width: anchor.width, height: isText ? undefined : anchor.height, maxWidth: "none" }}
        initial={{ top: anchor.top, scale: 1, boxShadow: "0 0 0 rgba(0,0,0,0)" }}
        animate={{ top: bubbleTop, scale: 1.02, boxShadow: "0 8px 30px rgba(0,0,0,0.18)" }}
        exit={{ top: anchor.top, scale: 1, boxShadow: "0 0 0 rgba(0,0,0,0)", opacity: 0, transition: { duration: 0.22, ease: [0.2, 0.8, 0.2, 1] } }}
        transition={{ type: "spring", stiffness: 420, damping: 32 }}
        onClick={(e) => e.stopPropagation()}
      >
        {isText ? messageText(message) : <span className="block px-3 py-2 text-[13px] text-black/55">{messageText(message)}</span>}
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
        {!emojiMode
          ? TAPBACKS.map((tapback, i) => {
              const kind: ReactionKind = { type: "tapback", tapback };
              const selected = !!mine && sameReaction(mine, kind);
              const isPicked = !!picked && sameReaction(picked, kind);
              return (
                <motion.button
                  key={tapback}
                  initial={{ scale: 0, opacity: 0 }}
                  animate={{ scale: isPicked ? 1.35 : 1, opacity: 1, y: isPicked ? -6 : 0 }}
                  transition={isPicked ? { type: "spring", stiffness: 600, damping: 18 } : { delay: 0.03 * i, type: "spring", stiffness: 500, damping: 22 }}
                  whileTap={{ scale: 0.85 }}
                  onClick={() => pick(kind)}
                  aria-label={tapback}
                  title={TAPBACK_LABEL[tapback]}
                  className={cn("flex h-[36px] w-[36px] items-center justify-center rounded-full transition-colors", selected && !isPicked ? "bg-black/[0.08]" : "hover:bg-black/5")}
                >
                  <TapbackGlyph kind={tapback} size={22} />
                </motion.button>
              );
            })
          : RECENT_EMOJI.map((emoji, i) => {
              const kind: ReactionKind = { type: "emoji", emoji };
              const selected = !!mine && sameReaction(mine, kind);
              const isPicked = !!picked && sameReaction(picked, kind);
              return (
                <motion.button
                  key={emoji}
                  initial={{ scale: 0, opacity: 0 }}
                  animate={{ scale: isPicked ? 1.35 : 1, opacity: 1, y: isPicked ? -6 : 0 }}
                  transition={isPicked ? { type: "spring", stiffness: 600, damping: 18 } : { delay: 0.025 * i, type: "spring", stiffness: 500, damping: 22 }}
                  whileTap={{ scale: 0.85 }}
                  onClick={() => pick(kind)}
                  aria-label={`emoji ${emoji}`}
                  className={cn("flex h-[36px] w-[34px] items-center justify-center rounded-full", selected && !isPicked ? "bg-black/[0.08]" : "hover:bg-black/5")}
                >
                  <ReactionGlyph kind={kind} size={22} />
                </motion.button>
              );
            })}
        <span className="mx-[3px] h-[22px] w-px bg-black/10" />
        <button
          onClick={() => setEmojiMode((m) => !m)}
          aria-label={emojiMode ? "Classic tapbacks" : "More emoji"}
          className={cn("flex h-[36px] w-[36px] items-center justify-center rounded-full text-black/45 hover:bg-black/5", emojiMode && "bg-black/[0.08]")}
        >
          <SmilePlus className="h-[21px] w-[21px]" strokeWidth={1.8} />
        </button>
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
