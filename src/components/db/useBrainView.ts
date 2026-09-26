"use client";

import { useEffect } from "react";
import { applySessionRow } from "@/lib/brain/mirror";
import { useSessionStore } from "@/lib/session/store";
import type { SessionView } from "@/lib/shared/types";

/**
 * The /db page has no brain of its own; it pulls the brain view (beliefs,
 * next ask, latency, session row) straight from the server every few seconds.
 * Messages are left to the phone tab so the two never fight over the thread.
 */
export function useBrainView(intervalMs = 3000) {
  const sessionId = useSessionStore((s) => s.sessionId);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    let cancelled = false;
    const tick = async () => {
      if (cancelled) return;
      if (document.visibilityState === "visible") {
        try {
          const after = useSessionStore.getState().lastServerMessageId || 0;
          const res = await fetch(`/api/session/${sessionId}?after=${Math.max(after, 1_000_000_000)}`, { cache: "no-store" });
          if (res.ok) {
            const view = (await res.json()) as SessionView;
            if (!cancelled && useSessionStore.getState().sessionId === sessionId) {
              applySessionRow(view.session);
              useSessionStore.getState().setBrainView({
                beliefs: view.beliefs,
                intentions: view.intentions ?? [],
                nextBestAsk: view.next_best_ask,
                latency: view.latency,
                promptVersion: view.session.prompt_version ?? null,
              });
            }
          }
        } catch {
          /* offline: keep whatever we have */
        }
      }
      if (!cancelled) timer = setTimeout(tick, intervalMs);
    };
    void tick();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [sessionId, intervalMs]);
}
