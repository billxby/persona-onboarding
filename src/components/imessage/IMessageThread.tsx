"use client";

import { AnimatePresence } from "motion/react";
import { useEffect, useMemo, useRef } from "react";
import type { ChatMessage } from "@/lib/session/types";
import { Composer } from "./Composer";
import { MessageBubble } from "./MessageBubble";
import { ThreadHeader } from "./ThreadHeader";
import { TypingIndicator } from "./TypingIndicator";

/**
 * The iMessage simulator. Pure presentation: give it messages and callbacks.
 * The future real iMessage integration replaces this component and nothing else.
 */
export function IMessageThread({
  contactName,
  messages,
  typing,
  onSend,
  onAction,
  composerDisabled,
}: {
  contactName: string;
  messages: ChatMessage[];
  typing: boolean;
  onSend: (text: string) => void;
  onAction: (actionId: string, messageId: string) => void;
  composerDisabled?: boolean;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [messages.length, typing]);

  const firstTs = messages[0]?.ts;
  const dayLabel = useMemo(() => {
    if (!firstTs) return "Today";
    const d = new Date(firstTs);
    return `${isToday(d) ? "Today" : d.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" })} ${d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`;
  }, [firstTs]);

  const lastOutgoing = [...messages].reverse().find((m) => m.role === "user");

  return (
    <div className="relative h-full w-full bg-white">
      <ThreadHeader name={contactName} />

      <div ref={scrollRef} className="no-scrollbar absolute inset-x-0 bottom-[78px] top-[116px] overflow-y-auto px-4 pt-3">
        <div className="flex min-h-full flex-col justify-end gap-[3px] pb-2">
          <div className="mb-2 text-center text-[11px] text-black/45">{dayLabel}</div>
          <AnimatePresence initial={false}>
            {messages.map((m, i) => {
              const next = messages[i + 1];
              const tail = !next || next.role !== m.role;
              const gapBefore = i > 0 && messages[i - 1].role !== m.role;
              return (
                <div key={m.id} className={gapBefore ? "mt-2" : ""}>
                  <MessageBubble message={m} tail={tail} onAction={onAction} />
                  {m.id === lastOutgoing?.id && m.status && (
                    <div className="mt-0.5 text-right text-[11px] text-black/45">{m.status === "read" ? "Read" : "Delivered"}</div>
                  )}
                </div>
              );
            })}
            {typing && (
              <div key="typing" className="mt-2 flex">
                <TypingIndicator />
              </div>
            )}
          </AnimatePresence>
        </div>
      </div>

      <Composer onSend={onSend} disabled={composerDisabled} />
    </div>
  );
}

function isToday(d: Date) {
  const n = new Date();
  return d.getDate() === n.getDate() && d.getMonth() === n.getMonth() && d.getFullYear() === n.getFullYear();
}
