"use client";

import { X } from "lucide-react";
import { motion } from "motion/react";
import { useEffect, useMemo, useState } from "react";
import type { LinkPreview } from "@/lib/session/types";
import { PersonaAvatar } from "./Avatar";

const SPLASH_MS = 700;

/**
 * The App Clip *running* inside the phone (what iOS shows after the user taps
 * Open on the App Clip card): a launch splash, then the clip's UI under the
 * compact App Clip bar. The UI is the same /clip page the invocation URL serves,
 * embedded so the simulator and the web fallback never drift apart.
 */
export function AppClipRunner({ link, onClose }: { link: LinkPreview; onClose: () => void }) {
  const [phase, setPhase] = useState<"splash" | "running">("splash");
  const appName = link.appClip?.appName ?? "Persona";

  const src = useMemo(() => {
    try {
      const u = new URL(link.url, typeof window !== "undefined" ? window.location.origin : "http://localhost");
      u.searchParams.set("embed", "1");
      return `${u.pathname}${u.search}`;
    } catch {
      return "/clip?embed=1";
    }
  }, [link.url]);

  useEffect(() => {
    const t = setTimeout(() => setPhase("running"), SPLASH_MS);
    return () => clearTimeout(t);
  }, []);

  // CTA taps inside the clip: the hero "Start in Messages" closes the clip; everything else just reports.
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      const d = e.data as { type?: string; event?: string; action?: string } | null;
      if (!d || d.type !== "persona:clip") return;
      if (d.event === "cta" && d.action === "close") onClose();
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [onClose]);

  return (
    <motion.div
      data-app-clip-runner
      initial={{ y: 844, opacity: 0.6 }}
      animate={{ y: 0, opacity: 1 }}
      exit={{ y: 844, opacity: 0.6 }}
      transition={{ type: "spring", stiffness: 300, damping: 34 }}
      // below the status bar (z-30) so the clock keeps showing, above everything in the thread
      className="absolute inset-0 z-[28] flex flex-col bg-white"
    >
      {/* room for the system status bar */}
      <div className="h-[54px] shrink-0 bg-white" />

      {phase === "splash" ? (
        <motion.div
          key="splash"
          data-app-clip-splash
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="flex flex-1 flex-col items-center justify-center gap-4 bg-white"
        >
          <PersonaAvatar size={92} className="rounded-[24px] shadow-lg" />
          <div className="text-[20px] font-semibold tracking-tight">{appName}</div>
          <div className="text-[12px] font-medium uppercase tracking-[0.12em] text-black/40">App Clip</div>
        </motion.div>
      ) : (
        <>
          <div className="flex h-[44px] shrink-0 items-center gap-2.5 border-b border-black/[0.06] bg-white/85 px-3 backdrop-blur-xl">
            <PersonaAvatar size={26} className="rounded-[7px]" />
            <div className="min-w-0 flex-1 truncate text-[13px] font-semibold">
              {appName} <span className="font-normal text-black/40">· App Clip</span>
            </div>
            <button
              onClick={onClose}
              aria-label="Close App Clip"
              className="flex h-8 w-8 items-center justify-center rounded-full bg-black/[0.06] text-black/70 active:bg-black/10"
            >
              <X className="h-4 w-4" strokeWidth={2.5} />
            </button>
          </div>
          <iframe
            title={`${appName} App Clip`}
            src={src}
            className="w-full flex-1 border-0 bg-[#f2f2f7]"
            sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox"
          />
        </>
      )}
    </motion.div>
  );
}
