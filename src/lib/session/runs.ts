"use client";

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { useSessionStore, type SessionState } from "./store";
import type { ChatMessage, Phase, SessionEvent, Slots } from "./types";

/**
 * Archive of previous simulation runs. Storage is still an open decision, so
 * this is deliberately a thin repository over localStorage with the same
 * shape a server table would have. Swap the storage adapter, keep the API.
 */
export interface RunSnapshot {
  id: string;
  createdAt: number;
  archivedAt: number;
  phase: Phase;
  slots: Slots;
  messages: ChatMessage[];
  events: SessionEvent[];
}

interface RunsState {
  runs: RunSnapshot[];
  archiveCurrent: () => RunSnapshot | null;
  remove: (id: string) => void;
  clear: () => void;
}

export const RUNS_STORAGE_KEY = "persona-onboarding-runs";
const MAX_RUNS = 25;

export const useRunsStore = create<RunsState>()(
  persist(
    (set) => ({
      runs: [],
      archiveCurrent: () => {
        const s = useSessionStore.getState();
        if (s.messages.length === 0 && s.events.length === 0) return null;
        const snap = snapshotOf(s);
        set((st) => ({ runs: [snap, ...st.runs.filter((r) => r.id !== snap.id)].slice(0, MAX_RUNS) }));
        return snap;
      },
      remove: (id) => set((st) => ({ runs: st.runs.filter((r) => r.id !== id) })),
      clear: () => set({ runs: [] }),
    }),
    { name: RUNS_STORAGE_KEY, storage: createJSONStorage(() => localStorage) },
  ),
);

export function snapshotOf(s: SessionState): RunSnapshot {
  return {
    id: s.sessionId,
    createdAt: s.createdAt,
    archivedAt: Date.now(),
    phase: s.phase,
    slots: s.slots,
    messages: s.messages,
    events: s.events,
  };
}

/** Archive the current session and start a fresh one. */
export function restartSimulation() {
  useRunsStore.getState().archiveCurrent();
  useSessionStore.getState().reset();
}

/** Load an archived run back into the live session (archives the current one first). */
export function restoreRun(id: string) {
  const run = useRunsStore.getState().runs.find((r) => r.id === id);
  if (!run) return;
  useRunsStore.getState().archiveCurrent();
  useSessionStore.setState({
    sessionId: run.id,
    createdAt: run.createdAt,
    phase: run.phase,
    slots: run.slots,
    messages: run.messages,
    events: run.events,
    channel: "text",
    assistantTyping: false,
    captions: [],
    call: { state: "idle", muted: false, speaker: false },
    screen: "messages",
  });
  useRunsStore.getState().remove(id);
}
