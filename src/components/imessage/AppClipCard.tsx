"use client";

import { Bell, ChevronRight, X } from "lucide-react";
import { motion } from "motion/react";
import { useEffect, useState } from "react";
import type { LinkPreview } from "@/lib/session/types";
import { PersonaAvatar } from "./Avatar";

/** How long the "download" takes before the clip launches (iOS: one to three seconds for a small clip). */
const INSTALL_MS = 1600;

/**
 * The system App Clip card iOS presents when you tap an App Clip bubble (the same half sheet a QR
 * code or NFC tag brings up): header image, app icon, title, subtitle, the action verb, the
 * ephemeral-notifications note, and the "Powered by <app> · App Store" footer for the full app.
 * Tapping Open downloads the clip (a progress ring fills on the button), then it launches full screen.
 */
export function AppClipCard({ link, onOpen, onClose }: { link: LinkPreview; onOpen: () => void; onClose: () => void }) {
  const clip = link.appClip!;
  const [installing, setInstalling] = useState(false);

  useEffect(() => {
    if (!installing) return;
    const t = setTimeout(onOpen, INSTALL_MS);
    return () => clearTimeout(t);
  }, [installing, onOpen]);

  return (
    <div className="absolute inset-0 z-[70]" onClick={installing ? undefined : onClose} data-app-clip-card data-app-clip-installing={installing || undefined}>
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
          {!installing && (
            <button onClick={onClose} className="absolute right-4 top-4 flex h-8 w-8 items-center justify-center rounded-full bg-black/30 text-white backdrop-blur" aria-label="Close">
              <X className="h-4 w-4" strokeWidth={2.5} />
            </button>
          )}
        </div>
        <div className="px-6 pb-7 pt-5">
          <div className="flex items-center gap-3.5">
            <PersonaAvatar size={56} className="rounded-[14px]" />
            <div className="min-w-0 flex-1">
              <div className="line-clamp-2 text-[19px] font-semibold leading-[22px] tracking-[-0.2px]">{clip.title}</div>
              <div className="line-clamp-2 text-[13px] leading-[16px] text-screen-ink/55">{clip.subtitle}</div>
            </div>
            {installing ? (
              <InstallRing />
            ) : (
              <button onClick={() => setInstalling(true)} className="shrink-0 rounded-full bg-imsg-blue px-6 py-2 text-[15px] font-semibold text-white active:opacity-80">
                {clip.verb ?? "Open"}
              </button>
            )}
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

/** The App Store download ring that replaces the Open button while the clip comes down. */
function InstallRing() {
  const r = 12;
  const c = 2 * Math.PI * r;
  return (
    <span className="flex h-9 w-9 shrink-0 items-center justify-center" aria-label="Downloading" data-app-clip-ring>
      <svg viewBox="0 0 32 32" className="h-8 w-8 -rotate-90">
        <circle cx="16" cy="16" r={r} fill="none" stroke="currentColor" strokeWidth="2.5" className="text-imsg-blue/25" />
        <motion.circle
          cx="16"
          cy="16"
          r={r}
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          className="text-imsg-blue"
          strokeDasharray={c}
          initial={{ strokeDashoffset: c }}
          animate={{ strokeDashoffset: 0 }}
          transition={{ duration: INSTALL_MS / 1000, ease: [0.3, 0.1, 0.2, 1] }}
        />
        <rect x="12.5" y="12.5" width="7" height="7" rx="1.5" className="fill-imsg-blue" />
      </svg>
    </span>
  );
}
