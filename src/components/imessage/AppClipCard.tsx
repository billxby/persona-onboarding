"use client";

import { Bell, ChevronRight, X } from "lucide-react";
import { motion } from "motion/react";
import type { LinkPreview } from "@/lib/session/types";
import { PersonaAvatar } from "./Avatar";

/**
 * The system App Clip card iOS presents when you tap an App Clip bubble (the same sheet a QR code
 * or NFC tag brings up): header image, app icon, title, subtitle, the action verb, the
 * ephemeral-notifications note, and the "Powered by <app> · App Store" footer for the full app.
 */
export function AppClipCard({ link, onOpen, onClose }: { link: LinkPreview; onOpen: () => void; onClose: () => void }) {
  const clip = link.appClip!;
  return (
    <div className="absolute inset-0 z-[70]" onClick={onClose} data-app-clip-card>
      <motion.div className="absolute inset-0 bg-black/40" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} />
      <motion.div
        onClick={(e) => e.stopPropagation()}
        initial={{ y: 560 }}
        animate={{ y: 0 }}
        exit={{ y: 560 }}
        transition={{ type: "spring", stiffness: 380, damping: 36 }}
        className="absolute inset-x-[10px] bottom-[10px] overflow-hidden rounded-[38px] bg-sheet shadow-2xl"
      >
        <div className="relative h-[224px] w-full bg-[#fffdfa] dark:bg-[#17171a]">
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
        <div className="px-6 pb-7 pt-5">
          <div className="flex items-center gap-3.5">
            <PersonaAvatar size={56} className="rounded-[14px]" />
            <div className="min-w-0 flex-1">
              <div className="line-clamp-2 text-[19px] font-semibold leading-[22px] tracking-[-0.2px]">{clip.title}</div>
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
          {/* iOS footer: who powers the clip, and the full app on the App Store */}
          <div className="mt-4 flex items-center justify-between border-t border-screen-ink/[0.08] pt-3.5">
            <div className="flex items-center gap-2.5">
              <PersonaAvatar size={22} className="rounded-[6px]" />
              <div className="leading-tight">
                <div className="text-[10px] uppercase tracking-[0.04em] text-screen-ink/45">Powered by</div>
                <div className="text-[13px] font-medium text-screen-ink/80">{clip.appName}</div>
              </div>
            </div>
            <div className="flex items-center gap-0.5 text-[13px] font-medium text-screen-ink/55">
              App Store
              <ChevronRight className="h-3.5 w-3.5" strokeWidth={2.5} />
            </div>
          </div>
        </div>
      </motion.div>
    </div>
  );
}
