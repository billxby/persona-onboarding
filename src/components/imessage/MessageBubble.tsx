"use client";

import { motion } from "motion/react";
import type { ChatMessage } from "@/lib/session/types";
import { cn } from "@/lib/utils";
import { CardBubble } from "./CardBubble";

export function MessageBubble({
  message,
  tail,
  onAction,
}: {
  message: ChatMessage;
  tail: boolean;
  onAction: (actionId: string, messageId: string) => void;
}) {
  const out = message.role === "user";

  if (message.role === "system") {
    return (
      <div className="my-1 self-center text-center text-[11px] text-black/45">{message.text}</div>
    );
  }

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 14, scale: 0.92 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ type: "spring", stiffness: 420, damping: 30 }}
      className={cn("flex w-full flex-col", out ? "items-end" : "items-start")}
    >
      {message.text && <div className={cn("bubble", out ? "bubble-out" : "bubble-in", tail && !message.card && "tail")}>{message.text}</div>}
      {message.card && (
        <CardBubble card={message.card} messageId={message.id} onAction={onAction} className={message.text ? "mt-1" : ""} />
      )}
    </motion.div>
  );
}
