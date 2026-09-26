"use client";

import { ArrowUp, Plus, X } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { useEffect, useRef, useState } from "react";

export interface ReplyTarget {
  id: string;
  authorName: string;
  text: string;
}

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
    <div className="absolute inset-x-0 bottom-0 z-20 bg-white/85 px-3 pb-[30px] pt-2 backdrop-blur-xl">
      <AnimatePresence>
        {replyTo && (
          <motion.div
            initial={{ opacity: 0, y: 10, height: 0 }}
            animate={{ opacity: 1, y: 0, height: "auto" }}
            exit={{ opacity: 0, y: 10, height: 0 }}
            className="mb-2 overflow-hidden"
          >
            <div className="flex items-center justify-between rounded-2xl bg-imsg-gray/80 px-3 py-1.5 text-[13px]">
              <div className="min-w-0">
                <div className="font-semibold">Replying to {replyTo.authorName}</div>
                <div className="truncate text-black/55">{replyTo.text}</div>
              </div>
              <button onClick={onCancelReply} className="ml-2 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-black/10" aria-label="Cancel reply">
                <X className="h-3.5 w-3.5" strokeWidth={2.5} />
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      <div className="flex items-end gap-2">
        <button className="mb-0.5 flex h-[34px] w-[34px] items-center justify-center rounded-full bg-imsg-gray text-black/70" aria-label="More">
          <Plus className="h-5 w-5" strokeWidth={2.2} />
        </button>
        <div className="relative flex min-h-[36px] flex-1 items-end rounded-[18px] border border-black/15 bg-white pr-9">
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
            className="max-h-[110px] w-full resize-none bg-transparent px-3 py-[7px] text-[16px] leading-[20px] outline-none placeholder:text-black/35"
            onInput={(e) => {
              const el = e.currentTarget;
              el.style.height = "auto";
              el.style.height = `${Math.min(110, el.scrollHeight)}px`;
            }}
          />
          <AnimatePresence>
            {canSend && (
              <motion.button
                key="send"
                initial={{ scale: 0.4, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.4, opacity: 0 }}
                transition={{ type: "spring", stiffness: 500, damping: 28 }}
                onClick={submit}
                className="absolute bottom-[3px] right-[3px] flex h-[28px] w-[28px] items-center justify-center rounded-full bg-imsg-blue text-white"
                aria-label="Send"
              >
                <ArrowUp className="h-4 w-4" strokeWidth={3} />
              </motion.button>
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}
