"use client";

import { useEffect, useState } from "react";
import type { DemoSession } from "@/lib/shared/types";
import { useRunsStore } from "./runs";
import { useSessionStore } from "./store";

/**
 * DEMO sessions: prepared server sessions pinned in data/demo_sessions.json, listed by
 * GET /api/sessions/demo, loadable from any browser. Loading one archives the current run
 * locally (as Restart does) and points the phone at the demo's session id; the brain then
 * rejoins that session on the server and the mirror fills the thread.
 */
let cache: DemoSession[] | null = null;
let inflight: Promise<DemoSession[]> | null = null;

export async function fetchDemoSessions(force = false): Promise<DemoSession[]> {
  if (cache && !force) return cache;
  inflight ??= fetch("/api/sessions/demo", { cache: "no-store" })
    .then((r) => (r.ok ? (r.json() as Promise<{ demos: DemoSession[] }>) : { demos: [] as DemoSession[] }))
    .then((d) => (cache = d.demos))
    .catch(() => cache ?? [])
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

export function useDemoSessions(): DemoSession[] {
  const [demos, setDemos] = useState<DemoSession[]>(cache ?? []);
  useEffect(() => {
    let alive = true;
    void fetchDemoSessions().then((d) => alive && setDemos(d));
    return () => {
      alive = false;
    };
  }, []);
  return demos;
}

/** Put a DEMO session in the phone. The current run is archived locally first, exactly as Restart does. */
export function loadDemoSession(id: string): void {
  const st = useSessionStore.getState();
  if (st.sessionId === id) return;
  useRunsStore.getState().archiveCurrent();
  st.reset();
  useSessionStore.setState({ sessionId: id });
  useSessionStore.getState().logEvent("demo.loaded", { id });
}

export const demoLabel = (d: DemoSession) =>
  d.label ?? `${d.user_name ?? "Anonymous"}${d.need ? ` · ${d.need}` : ""} · ${d.messages} msgs · ${d.phase}`;
