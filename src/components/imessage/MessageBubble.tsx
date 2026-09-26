"use client";

import { motion, type MotionValue } from "motion/react";
import { useCallback, useRef } from "react";
import type { ChatMessage } from "@/lib/session/types";
import { cn, formatClock } from "@/lib/utils";
import { CardBubble } from "./CardBubble";
import { TapbackBadges } from "./Tapback";
import { useLongPress } from "./useLongPress";

export function MessageBubble({
  message,
  replyTo,
  tail,
  timeOpacity,
  onAction,
  onOpenActions,
}: {
  message: ChatMessage;
  replyTo?: ChatMessage;
  tail: boolean;
  /** 0..1 driven by the drag-to-reveal gesture */
  timeOpacity: MotionValue<number>;
  onAction: (actionId: string, messageId: string) => void;
  onOpenActions: (messageId: string, el: HTMLElement) => void;
}) {
  const out = message.role === "user";
  const bubbleRef = useRef<HTMLDivElement>(null);
  const open = useCallback(() => {
    if (bubbleRef.current) onOpenActions(message.id, bubbleRef.current);
  }, [message.id, onOpenActions]);
  const press = useLongPress(open);

  if (message.role === "system") {
    return <div className="my-1 self-center text-center text-[11px] text-black/45">{message.text}</div>;
  }

  const reactions = message.reactions ?? [];

  return (
    <motion.div
      layout="position"
      initial={{ opacity: 0, y: 14, scale: 0.92 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ type: "spring", stiffness: 420, damping: 30 }}
      className={cn("relative flex w-full flex-col", out ? "items-end" : "items-start", reactions.length > 0 && "mt-3")}
    >
      {/* drag-to-reveal timestamp */}
      <motion.span
        style={{ opacity: timeOpacity }}
        className="pointer-events-none absolute -right-[60px] top-1/2 w-[54px] -translate-y-1/2 text-right text-[11px] tabular-nums text-black/45"
      >
        {formatClock(new Date(message.ts))}
      </motion.span>

      {replyTo && <ReplyQuote quoted={replyTo} out={out} />}

      {message.text && (
        <div className="relative max-w-full">
          <div
            ref={bubbleRef}
            data-bubble={message.id}
            {...press}
            className={cn(
              "bubble select-none",
              out ? "bubble-out" : "bubble-in",
              tail && !message.card && "tail",
              "max-w-none", // width is constrained by the wrapper below
            )}
            style={{ maxWidth: "min(78vw, 300px)" }}
          >
            {message.text}
          </div>
          <TapbackBadges reactions={reactions} side={out ? "out" : "in"} />
        </div>
      )}
      {message.card && (
        <CardBubble card={message.card} messageId={message.id} onAction={onAction} className={message.text ? "mt-1" : ""} />
      )}
    </motion.div>
  );
}

/**
 * iOS inline reply: a smaller, faded copy of the quoted bubble on its sender's
 * side, joined to the reply by a thin hooked line.
 */
function ReplyQuote({ quoted, out }: { quoted: ChatMessage; out: boolean }) {
  const quotedOut = quoted.role === "user";
  const sameSide = quotedOut === out;
  return (
    <div className="mb-[2px] flex w-full flex-col">
      <div
        className={cn(
          "bubble max-w-[62%] px-2.5 py-1 text-[13px] leading-[17px] opacity-70",
          quotedOut ? "bubble-out self-end!" : "bubble-in self-start!",
        )}
      >
        <span className="line-clamp-2">{quoted.text}</span>
      </div>
      <div
        className={cn(
          "h-[16px] border-black/20",
          sameSide
            ? out
              ? "mr-4 w-[12px] self-end rounded-br-[10px] border-b-[1.5px] border-r-[1.5px]"
              : "ml-4 w-[12px] self-start rounded-bl-[10px] border-b-[1.5px] border-l-[1.5px]"
            : quotedOut
              ? "mr-4 w-[calc(100%-4.5rem)] self-end rounded-br-[12px] border-b-[1.5px] border-r-[1.5px]"
              : "ml-4 w-[calc(100%-4.5rem)] self-start rounded-bl-[12px] border-b-[1.5px] border-l-[1.5px]",
        )}
      />
    </div>
  );
}
