"use client";

import { ArrowUp, AudioLines, Plus, X } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { GLASS } from "./Tapback";

export interface ReplyTarget {
  id: string;
  authorName: string;
  text: string;
}

/**
 * iOS 26 compose bar: "+" and the field are frosted glass over a fade. It sits in flow
 * under the thread (which shrinks as the field grows) and overlaps it by 10px so the
 * last messages scroll under the fade.
 */
export function Composer({
  onSend,
  disabled,
  replyTo,
  onCancelReply,
}: {
  onSend: (text: string) => void;
  disabled?: boolean;
  replyTo?: ReplyTarget | null;
  onCancelReply?: () => void;
}) {
  const [text, setText] = useState("");
  const ref = useRef<HTMLTextAreaElement>(null);
  const canSend = text.trim().length > 0 && !disabled;

  useEffect(() => {
    if (replyTo) ref.current?.focus();
  }, [replyTo]);

  const submit = () => {
    if (!canSend) return;
    onSend(text.trim());
    setText("");
    if (ref.current) ref.current.style.height = "auto";
  };

  return (
    <div className="relative z-20 -mt-[10px] shrink-0 bg-gradient-to-t from-screen via-screen/85 to-transparent px-3 pb-[30px] pt-6">
      <AnimatePresence>
        {replyTo && (
          <motion.div initial={{ opacity: 0, y: 10, height: 0 }} animate={{ opacity: 1, y: 0, height: "auto" }} exit={{ opacity: 0, y: 10, height: 0 }} className="mb-2 overflow-hidden">
            <div className={`flex items-center justify-between rounded-2xl px-3 py-1.5 text-[13px] ${GLASS}`}>
              <div className="min-w-0">
                <div className="font-semibold">Replying to {replyTo.authorName}</div>
                <div className="truncate text-screen-ink/55">{replyTo.text}</div>
              </div>
              <button onClick={onCancelReply} className="ml-2 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-screen-ink/10" aria-label="Cancel reply">
                <X className="h-3.5 w-3.5" strokeWidth={2.5} />
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      <div className="flex items-end gap-2">
        <button className={`mb-[1px] flex h-[38px] w-[38px] items-center justify-center rounded-full text-screen-ink/70 ${GLASS}`} aria-label="More">
          <Plus className="h-5 w-5" strokeWidth={2.2} />
        </button>
        <div className={`relative flex min-h-[40px] flex-1 items-end rounded-[20px] pr-10 ${GLASS}`}>
          <textarea
            ref={ref}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
              if (e.key === "Escape" && replyTo) onCancelReply?.();
            }}
            rows={1}
            placeholder="iMessage"
            className="max-h-[110px] w-full resize-none bg-transparent px-3.5 py-[9px] text-[16px] leading-[20px] outline-none placeholder:text-screen-ink/35"
            onInput={(e) => {
              const el = e.currentTarget;
              el.style.height = "auto";
              el.style.height = `${Math.min(110, el.scrollHeight)}px`;
            }}
          />
          <AnimatePresence mode="wait" initial={false}>
            {canSend ? (
              <motion.button
                key="send"
                initial={{ scale: 0.4, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.4, opacity: 0 }}
                transition={{ type: "spring", stiffness: 500, damping: 28 }}
                onClick={submit}
                className="absolute bottom-[4px] right-[4px] flex h-[31px] w-[31px] items-center justify-center rounded-full bg-imsg-blue text-white"
                aria-label="Send"
              >
                <ArrowUp className="h-4 w-4" strokeWidth={3} />
              </motion.button>
            ) : (
              <motion.span key="audio" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="absolute bottom-[9px] right-[11px] text-screen-ink/45" aria-label="Audio message">
                <AudioLines className="h-[21px] w-[21px]" strokeWidth={1.9} />
              </motion.span>
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}
