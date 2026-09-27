"use client";

import { motion } from "motion/react";
import { useEffect, useMemo, useState } from "react";
import { ClipOnboarding, type ClipDoneDetail } from "@/app/clip/ClipOnboarding";
import type { LinkPreview } from "@/lib/session/types";
import type { ClipContent, ClipState, ClipStateResponse } from "@/lib/shared/clip";
import { PersonaAvatar } from "./Avatar";

const SPLASH_MS = 650;
const RESUME_MAX_MS = 8000;

/**
 * The App Clip *running* inside the phone (what iOS shows after the user taps Open on the App Clip
 * card): the clip's launch screen, then the app itself, full screen under the system status bar.
 * No web chrome, no iframe: the same `ClipOnboarding` component the /clip web fallback renders,
 * mounted directly, so the two never drift and the wizard can talk to the phone (closing, ringing).
 */
export function AppClipRunner({ link, onClose }: { link: LinkPreview; onClose: (detail?: Record<string, unknown>) => void }) {
  const [splashDone, setSplashDone] = useState(false);
  const [content, setContent] = useState<ClipContent | null>(null);
  const [failed, setFailed] = useState(false);
  /** what the session already has (undefined while loading; null when there is no session or it failed) */
  const [resume, setResume] = useState<ClipState | null | undefined>(undefined);
  const appName = link.appClip?.appName ?? "Persona";

  const sid = useMemo(() => {
    try {
      const u = new URL(link.url, typeof window !== "undefined" ? window.location.origin : "http://localhost");
      const v = u.searchParams.get("sid");
      return v && /^[0-9a-f-]{36}$/i.test(v) ? v : undefined;
    } catch {
      return undefined;
    }
  }, [link.url]);

  useEffect(() => {
    const t = setTimeout(() => setSplashDone(true), SPLASH_MS);
    return () => clearTimeout(t);
  }, []);

  // the clip's copy comes from the same endpoint the native clip reads
  useEffect(() => {
    let alive = true;
    fetch("/api/clip/content", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((c: ClipContent) => alive && setContent(c))
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, []);

  // what the session already has, fetched under the launch screen so the wizard opens on the right screen
  // (a finished onboarding opens on "You're set", never the welcome again); capped so a slow route can't hang the launch
  useEffect(() => {
    if (!sid) return; // nothing to resume without a session; the render below treats that as "known"
    let alive = true;
    const cap = setTimeout(() => alive && setResume((r) => (r === undefined ? null : r)), RESUME_MAX_MS);
    fetch(`/api/clip/state?sid=${encodeURIComponent(sid)}`, { cache: "no-store" })
      .then((r) => (r.ok ? (r.json() as Promise<ClipStateResponse>) : null))
      .then((d) => alive && setResume(d?.state ?? null))
      .catch(() => alive && setResume(null));
    return () => {
      alive = false;
      clearTimeout(cap);
    };
  }, [sid]);

  const done = (d: ClipDoneDetail) => onClose({ screen: d.screen, completed: d.completed, call: d.call });

  return (
    <motion.div
      data-app-clip-runner
      initial={{ y: 844, opacity: 0.6 }}
      animate={{ y: 0, opacity: 1 }}
      exit={{ y: 844, opacity: 0.6 }}
      transition={{ type: "spring", stiffness: 300, damping: 34 }}
      // below the status bar (z-30) so the clock keeps showing, above everything in the thread
      className="absolute inset-0 z-[28] flex flex-col bg-clip-bg text-clip-ink"
    >
      {/* room for the system status bar */}
      <div className="h-[54px] shrink-0" />

      {!splashDone || (!content && !failed) || (content && sid && resume === undefined) ? (
        <motion.div key="splash" data-app-clip-splash initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex flex-1 flex-col items-center justify-center gap-4">
          <PersonaAvatar size={92} className="rounded-[26px] shadow-lg" />
          <div className="text-[20px] font-semibold tracking-tight">{appName}</div>
        </motion.div>
      ) : failed || !content ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-4 px-8 text-center">
          <PersonaAvatar size={64} className="rounded-[18px]" />
          <div className="text-[17px] text-clip-ink/70">Couldn&apos;t load right now. Everything works in Messages too.</div>
          <button onClick={() => onClose({ screen: "welcome", completed: false, failed: true })} className="clip-btn-primary h-[48px] rounded-full px-6 text-[16px] font-semibold">
            Back to Messages
          </button>
        </div>
      ) : (
        <motion.div key="app" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.25 }} className="min-h-0 flex-1">
          <ClipOnboarding content={content} sid={sid} embed initialState={resume ?? null} onDone={done} />
        </motion.div>
      )}
    </motion.div>
  );
}
