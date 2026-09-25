"use client";

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { uid } from "@/lib/utils";
import {
  emptySlots,
  type CallEndReason,
  type CallInfo,
  type CallState,
  type CaptionLine,
  type Channel,
  type ChatMessage,
  type Phase,
  type Screen,
  type SessionEvent,
  type Slot,
  type SlotKey,
  type Slots,
} from "./types";

/**
 * Single source of truth for the simulator. Both the iMessage thread and the
 * call screen read and write here. When the backend exists this store becomes
 * a client mirror of the server `Session` record.
 */
export interface SessionState {
  sessionId: string;
  createdAt: number;

  slots: Slots;
  phase: Phase;
  channel: Channel;

  messages: ChatMessage[];
  assistantTyping: boolean;

  call: CallInfo;
  captions: CaptionLine[];

  events: SessionEvent[];
  screen: Screen;

  // ----- actions -----
  appendMessage: (m: Omit<ChatMessage, "id" | "ts"> & Partial<Pick<ChatMessage, "id" | "ts">>) => ChatMessage;
  updateMessage: (id: string, patch: Partial<ChatMessage>) => void;
  setTyping: (typing: boolean) => void;

  setSlot: (key: SlotKey, patch: Partial<Slot>) => void;
  setPhase: (phase: Phase) => void;
  setChannel: (channel: Channel) => void;

  setCallState: (state: CallState, extra?: Partial<Omit<CallInfo, "state">>) => void;
  endCall: (reason: CallEndReason) => void;
  toggleMuted: () => void;
  toggleSpeaker: () => void;

  addCaption: (line: Omit<CaptionLine, "id" | "ts"> & Partial<Pick<CaptionLine, "id" | "ts">>) => CaptionLine;
  updateCaption: (id: string, patch: Partial<CaptionLine>) => void;
  clearCaptions: () => void;

  logEvent: (type: string, payload?: Record<string, unknown>) => void;
  setScreen: (screen: Screen) => void;
  reset: () => void;
}

const initialCall = (): CallInfo => ({ state: "idle", muted: false, speaker: false });

const freshSession = () => ({
  sessionId: uid(),
  createdAt: Date.now(),
  slots: emptySlots(),
  phase: "warmup" as Phase,
  channel: "text" as Channel,
  messages: [] as ChatMessage[],
  assistantTyping: false,
  call: initialCall(),
  captions: [] as CaptionLine[],
  events: [] as SessionEvent[],
  screen: "messages" as Screen,
});

export const useSessionStore = create<SessionState>()(
  persist(
    (set, get) => ({
      ...freshSession(),

      appendMessage: (m) => {
        const msg: ChatMessage = { id: m.id ?? uid(), ts: m.ts ?? Date.now(), ...m } as ChatMessage;
        set((s) => ({ messages: [...s.messages, msg] }));
        return msg;
      },
      updateMessage: (id, patch) =>
        set((s) => ({ messages: s.messages.map((m) => (m.id === id ? { ...m, ...patch } : m)) })),
      setTyping: (assistantTyping) => set({ assistantTyping }),

      setSlot: (key, patch) => {
        set((s) => ({ slots: { ...s.slots, [key]: { ...s.slots[key], ...patch, updatedAt: Date.now() } } }));
        get().logEvent("slot.updated", { key, ...patch });
      },
      setPhase: (phase) => {
        set({ phase });
        get().logEvent("phase.changed", { phase });
      },
      setChannel: (channel) => {
        if (get().channel === channel) return;
        set({ channel });
        get().logEvent("channel.switched", { channel });
      },

      setCallState: (state, extra) => {
        set((s) => ({ call: { ...s.call, ...extra, state } }));
        get().logEvent(`call.${state}`, extra as Record<string, unknown> | undefined);
      },
      endCall: (reason) => {
        const { call } = get();
        if (call.state === "idle" || call.state === "ended") return;
        set((s) => ({ call: { ...s.call, state: "ended", endedAt: Date.now(), endReason: reason } }));
        get().logEvent("call.ended", { reason, durationMs: call.startedAt ? Date.now() - call.startedAt : 0 });
      },
      toggleMuted: () => set((s) => ({ call: { ...s.call, muted: !s.call.muted } })),
      toggleSpeaker: () => set((s) => ({ call: { ...s.call, speaker: !s.call.speaker } })),

      addCaption: (line) => {
        const cap: CaptionLine = { id: line.id ?? uid(), ts: line.ts ?? Date.now(), ...line } as CaptionLine;
        set((s) => ({ captions: [...s.captions, cap] }));
        return cap;
      },
      updateCaption: (id, patch) =>
        set((s) => ({ captions: s.captions.map((c) => (c.id === id ? { ...c, ...patch } : c)) })),
      clearCaptions: () => set({ captions: [] }),

      logEvent: (type, payload) =>
        set((s) => ({ events: [...s.events, { id: uid(), ts: Date.now(), type, payload }].slice(-500) })),
      setScreen: (screen) => set({ screen }),

      reset: () => set({ ...freshSession() }),
    }),
    {
      name: "persona-onboarding-session",
      storage: createJSONStorage(() => localStorage),
      // typing + captions are transient
      partialize: (s) => ({
        sessionId: s.sessionId,
        createdAt: s.createdAt,
        slots: s.slots,
        phase: s.phase,
        channel: s.channel,
        messages: s.messages,
        call: s.call,
        events: s.events,
        screen: s.screen,
      }),
    },
  ),
);

/** Non-hook accessor for imperative code (brain, transports). */
export const session = {
  get: () => useSessionStore.getState(),
  set: useSessionStore.setState,
  subscribe: useSessionStore.subscribe,
};
