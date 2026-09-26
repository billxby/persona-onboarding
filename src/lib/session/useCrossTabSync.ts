"use client";

import { useEffect } from "react";
import { useRunsStore, RUNS_STORAGE_KEY } from "./runs";
import { useSessionStore, SESSION_STORAGE_KEY } from "./store";

/**
 * Keeps every open tab on the same session. zustand/persist writes to
 * localStorage; the browser fires `storage` in *other* tabs, and we rehydrate
 * from it. This is how the /db page mirrors the phone in real time today.
 * When a backend exists this becomes a websocket / SSE subscription.
 */
export function useCrossTabSync() {
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === SESSION_STORAGE_KEY) void useSessionStore.persist.rehydrate();
      if (e.key === RUNS_STORAGE_KEY) void useRunsStore.persist.rehydrate();
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);
}
