"use client";

import { Bell, X } from "lucide-react";
import { motion } from "motion/react";
import type { LinkPreview } from "@/lib/session/types";
import { PersonaAvatar } from "./Avatar";

/**
 * The system App Clip card iOS presents when you tap an App Clip bubble:
 * header image, app icon, title, subtitle, the action verb, an App Store link
 * for the full app, and the ephemeral-notifications note.
 */
export function AppClipCard({ link, onOpen, onClose }: { link: LinkPreview; onOpen: () => void; onClose: () => void }) {
  const clip = link.appClip!;
  return (
    <div className="absolute inset-0 z-[70]" onClick={onClose}>
      <motion.div className="absolute inset-0 bg-black/40" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} />
      <motion.div
        onClick={(e) => e.stopPropagation()}
        initial={{ y: 520 }}
        animate={{ y: 0 }}
        exit={{ y: 520 }}
        transition={{ type: "spring", stiffness: 380, damping: 36 }}
        className="absolute inset-x-[10px] bottom-[10px] overflow-hidden rounded-[38px] bg-sheet shadow-2xl"
      >
        <div className="relative h-[210px] w-full bg-gradient-to-br from-[#e6e6ec] via-[#f3f3f7] to-[#d9d9e0] dark:from-[#2c2c2e] dark:via-[#3a3a3c] dark:to-[#1c1c1e]">
          {link.imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={link.imageUrl} alt="" className="h-full w-full object-cover" />
          ) : (
            <div className="flex h-full items-center justify-center">
              <PersonaAvatar size={72} />
            </div>
          )}
          <button onClick={onClose} className="absolute right-4 top-4 flex h-8 w-8 items-center justify-center rounded-full bg-black/30 text-white backdrop-blur" aria-label="Close">
            <X className="h-4 w-4" strokeWidth={2.5} />
          </button>
        </div>
        <div className="px-6 pb-8 pt-5">
          <div className="flex items-center gap-3.5">
            <PersonaAvatar size={56} className="rounded-[14px]" />
            <div className="min-w-0 flex-1">
              <div className="line-clamp-2 text-[18px] font-semibold leading-[21px]">{clip.title}</div>
              <div className="line-clamp-2 text-[13px] leading-[16px] text-screen-ink/55">{clip.subtitle}</div>
            </div>
            <button onClick={onOpen} className="shrink-0 rounded-full bg-imsg-blue px-6 py-2 text-[15px] font-semibold text-white active:opacity-80">
              {clip.verb ?? "Open"}
            </button>
          </div>
          <div className="mt-5 flex items-start gap-3 rounded-2xl bg-screen-ink/[0.04] px-3.5 py-3 text-[13px] text-screen-ink/60">
            <Bell className="mt-0.5 h-4 w-4 shrink-0" />
            <span>This App Clip can send you notifications for up to 8 hours.</span>
          </div>
          <div className="mt-4 text-center text-[12px] text-screen-ink/45">
            App Clip · <span className="font-medium text-screen-ink/70">{clip.appName}</span> · View in App Store
          </div>
        </div>
      </motion.div>
    </div>
  );
}
