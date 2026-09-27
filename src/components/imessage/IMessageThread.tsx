"use client";

import { AnimatePresence, motion, useMotionValue, useTransform } from "motion/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { messageText, type ChatMessage, type ReactionKind } from "@/lib/session/types";
import { USER_HELLO } from "@/lib/shared/text";
import { cn, formatClock } from "@/lib/utils";
import { AppClipCard } from "./AppClipCard";
import { AppClipRunner } from "./AppClipRunner";
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
 * drag the thread left to reveal timestamps, hour-gap separators, read receipts,
 * rich links and App Clip cards (gated on the sender being in Contacts).
 */
export function IMessageThread({
  contactName,
  senderInContacts,
  messages,
  typing,
  onSend,
  onReact,
  onOpenLink,
  onOpenAppClip,
  onCloseAppClip,
  onOpenInSafari,
}: {
  contactName: string;
  senderInContacts: boolean;
  messages: ChatMessage[];
  typing: boolean;
  onSend: (text: string, replyToId?: string) => void;
  onReact: (messageId: string, kind: ReactionKind) => void;
  onOpenLink: (messageId: string, url: string) => void;
  /** The user tapped Open on an App Clip card: the clip now runs inside the phone. */
  onOpenAppClip?: (messageId: string, url: string) => void;
  /** The clip closed; `detail` says where (which screen) and whether it was finished. */
  onCloseAppClip?: (messageId: string, url: string, detail?: Record<string, unknown>) => void;
  /** A plain link (no App Clip card) was tapped: open it in the in-phone Safari sheet. */
  onOpenInSafari?: (messageId: string, url: string) => void;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [actions, setActions] = useState<{ id: string; rect: AnchorRect; screenHeight: number } | null>(null);
  const [replyToId, setReplyToId] = useState<string | null>(null);
  const [appClipFor, setAppClipFor] = useState<string | null>(null);
  const [runnerFor, setRunnerFor] = useState<string | null>(null);

  const x = useMotionValue(0);
  const timeOpacity = useTransform(x, [-REVEAL_PX, -REVEAL_PX / 3, 0], [1, 0.2, 0]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [messages.length, typing, replyToId]);

  // Keep the thread pinned to its end when the scroll area shrinks (the composer growing
  // with multi-line text, the reply card appearing) unless the reader has scrolled up.
  const atBottom = useRef(true);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onScroll = () => {
      atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 4;
    };
    const ro = new ResizeObserver(() => {
      if (atBottom.current) el.scrollTop = el.scrollHeight;
    });
    el.addEventListener("scroll", onScroll, { passive: true });
    ro.observe(el);
    return () => {
      el.removeEventListener("scroll", onScroll);
      ro.disconnect();
    };
  }, []);

  const byId = useMemo(() => new Map(messages.filter((m) => !!m.content).map((m) => [m.id, m])), [messages]);
  const lastOutgoing = [...messages].reverse().find((m) => m.role === "user");
  const activeMessage = actions ? byId.get(actions.id) : undefined;
  const appClipMessage = appClipFor ? byId.get(appClipFor) : undefined;
  const appClipLink = appClipMessage?.content?.kind === "link" && appClipMessage.content.link.appClip ? appClipMessage.content.link : undefined;
  const runnerMessage = runnerFor ? byId.get(runnerFor) : undefined;
  const runnerLink = runnerMessage?.content?.kind === "link" && runnerMessage.content.link.appClip ? runnerMessage.content.link : undefined;

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

  // Tap on a link bubble, the way iOS resolves it: the Gmail connect page is an OAuth popup
  // (Google refuses iframes); an App Clip link with the sender in Contacts shows the App Clip
  // card (handled by LinkBubble's Open button); everything else opens in the in-phone Safari.
  const openLink = useCallback(
    (id: string) => {
      const m = byId.get(id);
      if (m?.content?.kind !== "link") return;
      const url = m.content.link.url;
      if (isConnectUrl(url) || !onOpenInSafari) {
        onOpenLink(id, url);
        return;
      }
      if (m.content.link.appClip && senderInContacts) {
        setAppClipFor(id);
        return;
      }
      onOpenInSafari(id, url);
    },
    [byId, onOpenLink, onOpenInSafari, senderInContacts],
  );

  const replyTarget: ReplyTarget | null = useMemo(() => {
    const m = replyToId ? byId.get(replyToId) : undefined;
    return m ? { id: m.id, authorName: m.role === "user" ? "yourself" : contactName, text: messageText(m) } : null;
  }, [replyToId, byId, contactName]);

  return (
    <div ref={rootRef} className="relative h-full w-full select-none bg-screen">
      <ThreadHeader name={contactName} />

      {/* Thread and composer share the space under the header. The composer is in flow, so
          the thread shrinks as the field grows (multi-line text, reply card) instead of
          being covered by it. */}
      <div className="absolute inset-x-0 top-[100px] bottom-0 flex flex-col">
        <div ref={scrollRef} className="no-scrollbar min-h-0 flex-1 overflow-x-hidden overflow-y-auto">
          <motion.div
            drag="x"
            dragDirectionLock
            dragConstraints={{ left: -REVEAL_PX, right: 0 }}
            dragElastic={0.04}
            dragMomentum={false}
            dragSnapToOrigin
            style={{ x }}
            className="flex min-h-full flex-col justify-end gap-[3px] px-4 pb-2 pt-6"
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
                    {separator && <div className={cn("mb-2 text-center text-[11px] text-screen-ink/45", prev && "mt-4")}>{formatSeparator(m.ts)}</div>}
                    <MessageBubble
                      message={m}
                      replyTo={m.replyToId ? byId.get(m.replyToId) : undefined}
                      tail={tail}
                      timeOpacity={timeOpacity}
                      senderInContacts={senderInContacts}
                      onOpenActions={openActions}
                      onOpenLink={openLink}
                      onOpenAppClip={setAppClipFor}
                    />
                    {m.role === "user" && m.status === "failed" && (
                      <div className="mt-0.5 text-right text-[11px] font-medium text-ios-red">Not Delivered</div>
                    )}
                    {m.id === lastOutgoing?.id && m.status && m.status !== "failed" && (
                      <div className="mt-0.5 text-right text-[11px] text-screen-ink/45">
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
          draft={messages.length === 0 ? USER_HELLO : undefined}
        />
      </div>

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
              void navigator.clipboard?.writeText(messageText(activeMessage));
              closeActions();
            }}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {appClipMessage && appClipLink && (
          <AppClipCard
            key={appClipMessage.id}
            link={appClipLink}
            onClose={() => setAppClipFor(null)}
            onOpen={() => {
              // Open = launch the App Clip inside the phone, not the web page
              setAppClipFor(null);
              setRunnerFor(appClipMessage.id);
              onOpenAppClip?.(appClipMessage.id, appClipLink.url);
            }}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {runnerMessage && runnerLink && (
          <AppClipRunner
            key={`runner-${runnerMessage.id}`}
            link={runnerLink}
            onClose={(detail) => {
              setRunnerFor(null);
              onCloseAppClip?.(runnerMessage.id, runnerLink.url, detail);
            }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

function isConnectUrl(url: string) {
  try {
    return new URL(url, typeof window !== "undefined" ? window.location.origin : "http://localhost").pathname === "/connect";
  } catch {
    return false;
  }
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
