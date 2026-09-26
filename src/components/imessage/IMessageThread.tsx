"use client";

import { AnimatePresence, motion, useMotionValue, useTransform } from "motion/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ChatMessage, Tapback } from "@/lib/session/types";
import { cn, formatClock } from "@/lib/utils";
import { Composer, type ReplyTarget } from "./Composer";
import { MessageActions, type AnchorRect } from "./MessageActions";
import { MessageBubble } from "./MessageBubble";
import { ThreadHeader } from "./ThreadHeader";
import { TypingIndicator } from "./TypingIndicator";

const REVEAL_PX = 60;
const HOUR = 60 * 60 * 1000;

/**
 * The iMessage simulator. Pure presentation with the real iMessage gestures:
 * long-press / double-tap / right-click for tapbacks + menu, inline replies,
 * drag the thread left to reveal timestamps, hour-gap separators, read receipts.
 */
export function IMessageThread({
  contactName,
  messages,
  typing,
  onSend,
  onAction,
  onReact,
}: {
  contactName: string;
  messages: ChatMessage[];
  typing: boolean;
  onSend: (text: string, replyToId?: string) => void;
  onAction: (actionId: string, messageId: string) => void;
  onReact: (messageId: string, kind: Tapback) => void;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [actions, setActions] = useState<{ id: string; rect: AnchorRect; screenHeight: number } | null>(null);
  const [replyToId, setReplyToId] = useState<string | null>(null);

  // drag-to-reveal timestamps
  const x = useMotionValue(0);
  const timeOpacity = useTransform(x, [-REVEAL_PX, -REVEAL_PX / 3, 0], [1, 0.2, 0]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [messages.length, typing, replyToId]);

  const byId = useMemo(() => new Map(messages.map((m) => [m.id, m])), [messages]);
  const lastOutgoing = [...messages].reverse().find((m) => m.role === "user");
  const activeMessage = actions ? byId.get(actions.id) : undefined;

  const openActions = useCallback((id: string, el: HTMLElement) => {
    const root = rootRef.current;
    if (!root) return;
    const rr = root.getBoundingClientRect();
    const scale = rr.width / root.offsetWidth || 1;
    const er = el.getBoundingClientRect();
    setActions({
      id,
      rect: { top: (er.top - rr.top) / scale, left: (er.left - rr.left) / scale, width: er.width / scale, height: er.height / scale },
      screenHeight: root.offsetHeight,
    });
  }, []);

  const closeActions = () => setActions(null);

  const replyTarget: ReplyTarget | null = useMemo(() => {
    const m = replyToId ? byId.get(replyToId) : undefined;
    return m ? { id: m.id, authorName: m.role === "user" ? "yourself" : contactName, text: m.text } : null;
  }, [replyToId, byId, contactName]);

  return (
    <div ref={rootRef} className="relative h-full w-full select-none bg-white">
      <ThreadHeader name={contactName} />

      <div
        ref={scrollRef}
        className={cn("no-scrollbar absolute inset-x-0 top-[116px] overflow-x-hidden overflow-y-auto", replyTarget ? "bottom-[130px]" : "bottom-[78px]")}
      >
        <motion.div
          drag="x"
          dragDirectionLock
          dragConstraints={{ left: -REVEAL_PX, right: 0 }}
          dragElastic={0.04}
          dragMomentum={false}
          dragSnapToOrigin
          style={{ x }}
          className="flex min-h-full flex-col justify-end gap-[3px] px-4 pb-2 pt-3"
        >
          <AnimatePresence initial={false}>
            {messages.map((m, i) => {
              const prev = messages[i - 1];
              const next = messages[i + 1];
              const tail = !next || next.role !== m.role || next.ts - m.ts > HOUR;
              const gapBefore = prev && prev.role !== m.role;
              const separator = !prev || m.ts - prev.ts > HOUR;
              return (
                <div key={m.id} className={cn(gapBefore && !separator && "mt-2")}>
                  {separator && <div className={cn("mb-2 text-center text-[11px] text-black/45", prev && "mt-4")}>{formatSeparator(m.ts)}</div>}
                  <MessageBubble
                    message={m}
                    replyTo={m.replyToId ? byId.get(m.replyToId) : undefined}
                    tail={tail}
                    timeOpacity={timeOpacity}
                    onAction={onAction}
                    onOpenActions={openActions}
                  />
                  {m.id === lastOutgoing?.id && m.status && (
                    <div className="mt-0.5 text-right text-[11px] text-black/45">
                      {m.status === "read" ? `Read ${m.readAt ? formatClock(new Date(m.readAt)) : ""}`.trim() : m.status === "delivered" ? "Delivered" : ""}
                    </div>
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
        </motion.div>
      </div>

      <Composer
        onSend={(text) => {
          onSend(text, replyToId ?? undefined);
          setReplyToId(null);
        }}
        replyTo={replyTarget}
        onCancelReply={() => setReplyToId(null)}
      />

      <AnimatePresence>
        {actions && activeMessage && (
          <MessageActions
            key={actions.id}
            message={activeMessage}
            anchor={actions.rect}
            screenHeight={actions.screenHeight}
            onClose={closeActions}
            onTapback={(kind) => {
              onReact(activeMessage.id, kind);
              closeActions();
            }}
            onReply={() => {
              setReplyToId(activeMessage.id);
              closeActions();
            }}
            onCopy={() => {
              void navigator.clipboard?.writeText(activeMessage.text);
              closeActions();
            }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

/** iOS separator text: "Today 6:21 PM", "Yesterday 6:21 PM", "Mon, Sep 22 at 6:21 PM". */
function formatSeparator(ts: number) {
  const d = new Date(ts);
  const now = new Date();
  const time = formatClock(d);
  const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString();
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (sameDay(d, now)) return `Today ${time}`;
  if (sameDay(d, yesterday)) return `Yesterday ${time}`;
  return `${d.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" })} at ${time}`;
}
