"use client";

import { ArrowUp, Plus } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { useState } from "react";

export function Composer({ onSend, disabled }: { onSend: (text: string) => void; disabled?: boolean }) {
  const [text, setText] = useState("");
  const canSend = text.trim().length > 0 && !disabled;

  const submit = () => {
    if (!canSend) return;
    onSend(text.trim());
    setText("");
  };

  return (
    <div className="absolute inset-x-0 bottom-0 z-20 bg-white/85 px-3 pb-[30px] pt-2 backdrop-blur-xl">
      <div className="flex items-end gap-2">
        <button className="mb-0.5 flex h-[34px] w-[34px] items-center justify-center rounded-full bg-imsg-gray text-black/70" aria-label="More">
          <Plus className="h-5 w-5" strokeWidth={2.2} />
        </button>
        <div className="relative flex min-h-[36px] flex-1 items-end rounded-[18px] border border-black/15 bg-white pr-9">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
            }}
            rows={1}
            placeholder="iMessage"
            className="max-h-[110px] w-full resize-none bg-transparent px-3 py-[7px] text-[16px] leading-[20px] outline-none placeholder:text-black/35"
            style={{ height: "auto" }}
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
