"use client";

import { motion, type MotionValue } from "motion/react";
import { useCallback, useRef, useState } from "react";
import type { BubbleEffect, ChatMessage } from "@/lib/session/types";
import { messageText } from "@/lib/session/types";
import { cn, formatClock } from "@/lib/utils";
import { LinkBubble } from "./LinkBubble";
import { TapbackBadges } from "./Tapback";
import { useLongPress } from "./useLongPress";

export function MessageBubble({
  message,
  replyTo,
  tail,
  timeOpacity,
  senderInContacts,
  onOpenActions,
  onOpenLink,
  onOpenAppClip,
}: {
  message: ChatMessage;
  replyTo?: ChatMessage;
  tail: boolean;
  /** 0..1 driven by the drag-to-reveal gesture */
  timeOpacity: MotionValue<number>;
  senderInContacts: boolean;
  onOpenActions: (messageId: string, el: HTMLElement) => void;
  onOpenLink: (messageId: string) => void;
  onOpenAppClip: (messageId: string) => void;
}) {
  const out = message.role === "user";
  const bubbleRef = useRef<HTMLDivElement>(null);
  const open = useCallback(() => {
    if (bubbleRef.current) onOpenActions(message.id, bubbleRef.current);
  }, [message.id, onOpenActions]);
  const press = useLongPress(open);

  if (message.role === "system") {
    return <div className="my-1 self-center text-center text-[11px] text-black/45">{messageText(message)}</div>;
  }

  const reactions = message.reactions ?? [];
  const c = message.content;

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

      <div className={cn("relative flex max-w-full flex-col", out ? "items-end" : "items-start")}>
        {c.kind === "text" && (
          <EffectBubble effect={c.effect}>
            <div
              ref={bubbleRef}
              data-bubble={message.id}
              {...press}
              className={cn("bubble select-none", out ? "bubble-out" : "bubble-in", tail && "tail", "max-w-none")}
              style={{ maxWidth: 300 }}
            >
              {c.text}
            </div>
          </EffectBubble>
        )}
        {c.kind === "link" && (
          <div ref={bubbleRef} data-bubble={message.id} {...press} className={cn("flex w-full", out ? "justify-end" : "justify-start")}>
            <LinkBubble
              link={c.link}
              senderInContacts={senderInContacts}
              onOpen={() => onOpenLink(message.id)}
              onOpenAppClip={() => onOpenAppClip(message.id)}
            />
          </div>
        )}
        {c.kind === "image" && (
          <div ref={bubbleRef} data-bubble={message.id} {...press} className="max-w-[78%] overflow-hidden rounded-[18px]">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={c.image.src} alt={c.image.alt ?? ""} className="block max-h-[300px] w-full object-cover" />
          </div>
        )}
        <TapbackBadges reactions={reactions} side={out ? "out" : "in"} />
      </div>
    </motion.div>
  );
}

/**
 * Bubble effects (Slam, Loud, Gentle, Invisible Ink) with the iOS "Replay"
 * affordance underneath. Invisible ink hides the text until tapped.
 */
function EffectBubble({ effect, children }: { effect?: BubbleEffect; children: React.ReactNode }) {
  const [replay, setReplay] = useState(0);
  const [revealed, setRevealed] = useState(false);
  if (!effect) return <>{children}</>;

  if (effect === "invisibleInk") {
    return (
      <div className="relative" onClick={() => setRevealed((r) => !r)}>
        <div className={cn("transition-[filter] duration-500", revealed ? "" : "blur-[6px]")}>{children}</div>
        {!revealed && <div className="ink-dust pointer-events-none absolute inset-0 rounded-[18px]" />}
      </div>
    );
  }

  const anim =
    effect === "slam"
      ? { initial: { scale: 2.6, rotate: -6, opacity: 0 }, animate: { scale: 1, rotate: 0, opacity: 1 }, transition: { type: "spring" as const, stiffness: 800, damping: 22 } }
      : effect === "loud"
        ? { initial: { scale: 1.7, opacity: 0 }, animate: { scale: [1.7, 1.9, 1], opacity: 1 }, transition: { duration: 0.6, times: [0, 0.4, 1], ease: "easeOut" as const } }
        : { initial: { scale: 0.5, opacity: 0 }, animate: { scale: 1, opacity: 1 }, transition: { duration: 0.9, ease: [0.2, 0.7, 0.2, 1] as [number, number, number, number] } };

  return (
    <div className="flex flex-col items-inherit">
      <motion.div key={replay} {...anim} style={{ transformOrigin: "center" }}>
        {children}
      </motion.div>
      <button onClick={() => setReplay((n) => n + 1)} className="mt-0.5 self-start px-1 text-[11px] font-medium text-imsg-blue">
        Replay
      </button>
    </div>
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
      <div className={cn("bubble max-w-[62%] px-2.5 py-1 text-[13px] leading-[17px] opacity-70", quotedOut ? "bubble-out self-end!" : "bubble-in self-start!")}>
        <span className="line-clamp-2">{messageText(quoted)}</span>
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
