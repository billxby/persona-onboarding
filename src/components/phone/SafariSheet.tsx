"use client";

import { BookOpen, ChevronLeft, ChevronRight, Compass, ExternalLink, Lock, RotateCw, Share } from "lucide-react";
import { motion } from "motion/react";
import { useMemo, useState } from "react";

/**
 * In-app Safari (the SFSafariViewController look iOS uses when an app opens a
 * link): slides up inside the phone, "Done" on the left, the host in a grey URL
 * pill, the page in an iframe, and the decorative bottom toolbar. Same-origin
 * pages load fine; a cross-origin page that refuses framing gets an
 * "Open in browser" fallback, the only place a new tab is allowed.
 */
export function SafariSheet({ url, onClose }: { url: string; onClose: () => void }) {
  const [reloadKey, setReloadKey] = useState(0);
  const { src, host, sameOrigin } = useMemo(() => {
    try {
      const origin = typeof window !== "undefined" ? window.location.origin : "http://localhost";
      const u = new URL(url, origin);
      const same = u.origin === origin;
      return { src: same ? `${u.pathname}${u.search}${u.hash}` : u.toString(), host: u.host, sameOrigin: same };
    } catch {
      return { src: url, host: url, sameOrigin: false };
    }
  }, [url]);

  return (
    <motion.div
      data-safari-sheet
      initial={{ y: 844, opacity: 0.6 }}
      animate={{ y: 0, opacity: 1 }}
      exit={{ y: 844, opacity: 0.6 }}
      transition={{ type: "spring", stiffness: 300, damping: 34 }}
      // below the status bar (z-30) so the clock keeps showing, above everything in the thread
      className="absolute inset-0 z-[28] flex flex-col bg-[#f2f2f7]"
    >
      {/* room for the system status bar */}
      <div className="h-[54px] shrink-0 bg-[#f9f9f9]" />

      <div className="flex h-[48px] shrink-0 items-center gap-2 border-b border-black/[0.08] bg-[#f9f9f9]/95 px-2.5 backdrop-blur-xl">
        <button onClick={onClose} className="shrink-0 px-1.5 text-[17px] font-medium text-imsg-blue active:opacity-60" aria-label="Done">
          Done
        </button>
        <div className="flex min-w-0 flex-1 items-center justify-center gap-1.5 rounded-[10px] bg-black/[0.07] px-3 py-[7px]">
          <Lock className="h-3 w-3 shrink-0 text-black/60" strokeWidth={2.5} />
          <span className="truncate text-[15px] text-black">{host}</span>
        </div>
        <button
          onClick={() => setReloadKey((k) => k + 1)}
          className="flex h-8 w-8 shrink-0 items-center justify-center text-black/70 active:opacity-60"
          aria-label="Reload"
        >
          <RotateCw className="h-[17px] w-[17px]" strokeWidth={2.2} />
        </button>
      </div>

      <div className="relative flex-1 bg-white">
        <iframe
          key={reloadKey}
          title={host}
          src={src}
          className="absolute inset-0 h-full w-full border-0 bg-white"
          sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox"
        />
        {!sameOrigin && (
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => window.open(url, "_blank", "noopener")}
            className="absolute bottom-3 left-1/2 flex -translate-x-1/2 items-center gap-1.5 rounded-full bg-black/75 px-3.5 py-2 text-[12px] font-medium text-white backdrop-blur"
          >
            <ExternalLink className="h-3.5 w-3.5" /> Open in browser
          </a>
        )}
      </div>

      <div className="flex h-[78px] shrink-0 items-start justify-between border-t border-black/[0.08] bg-[#f9f9f9]/95 px-7 pt-3 text-imsg-blue backdrop-blur-xl">
        <ChevronLeft className="h-6 w-6" strokeWidth={2.2} />
        <ChevronRight className="h-6 w-6 text-black/25" strokeWidth={2.2} />
        <Share className="h-[22px] w-[22px]" strokeWidth={2} />
        <BookOpen className="h-[22px] w-[22px]" strokeWidth={2} />
        <Compass className="h-[22px] w-[22px]" strokeWidth={2} />
      </div>
    </motion.div>
  );
}
