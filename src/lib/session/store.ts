"use client";

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { slotsFromSession, type Belief, type Intention, type LatencyStats, type NextBestAsk, type SessionRow } from "@/lib/shared/types";
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
  type ReactionKind,
  type Screen,
  type SessionEvent,
  type Slot,
  type SlotKey,
  type Slots,
  sameReaction,
} from "./types";

export type ConnectionMode = "realtime" | "polling" | "offline";

/**
 * Single source of truth for the simulator UI. Both the iMessage thread and the
 * call screen read and write here. With the backend in place this store is a
 * client mirror of the server `sessions` row plus its `messages`: the server
 * decides, the mirror renders. `sessionId` is the server session id.
 */
export interface SessionState {
  sessionId: string;
  createdAt: number;

  slots: Slots;
  phase: Phase;
  channel: Channel;
  mode: "onboarding" | "main";
  userNameConfirmed: boolean;

  messages: ChatMessage[];
  assistantTyping: boolean;

  call: CallInfo;
  captions: CaptionLine[];

  events: SessionEvent[];
  screen: Screen;
  /**
   * Whether the user saved Persona to Contacts. Gates App Clip cards and, on a
   * real device, link tappability. Starts false: Persona is a brand-new sender.
   */
  senderInContacts: boolean;

  // ----- server mirror (brain view) -----
  beliefs: Belief[];
  /** what is on the agent's mind (intentions projection) */
  intentions: Intention[];
  /** server-side assistant turn counter (drives intention backoff) */
  turn: number;
  nextBestAsk: NextBestAsk | null;
  latency: LatencyStats | null;
  connection: ConnectionMode;
  /** highest server message id applied so far (for catch-up polling) */
  lastServerMessageId: number;
  promptVersion: string | null;

  // ----- actions -----
  appendMessage: (m: Omit<ChatMessage, "id" | "ts"> & Partial<Pick<ChatMessage, "id" | "ts">>) => ChatMessage;
  updateMessage: (id: string, patch: Partial<ChatMessage>) => void;
  /** Insert or merge a message by id. Local `status`/`readAt`/`ts` win over the server copy once set. */
  upsertMessage: (m: ChatMessage) => void;
  /** Add or remove a tapback. Returns true if it was added. */
  toggleReaction: (messageId: string, kind: ReactionKind, by: "user" | "assistant") => boolean;
  /** Idempotent tapback set/unset, used when mirroring server rows. */
  setReaction: (messageId: string, kind: ReactionKind, by: "user" | "assistant", added: boolean) => void;
  /** Mark every delivered message from `role` as read (iMessage read receipts). */
  markRead: (role: "user" | "assistant") => void;
  setTyping: (typing: boolean) => void;

  setSlot: (key: SlotKey, patch: Partial<Slot>) => void;
  setPhase: (phase: Phase) => void;
  setChannel: (channel: Channel) => void;
  /** Mirror the server session row into slots / phase / mode / channel. */
  applyServerSession: (row: SessionRow) => void;
  setBrainView: (patch: Partial<Pick<SessionState, "beliefs" | "intentions" | "nextBestAsk" | "latency" | "promptVersion">>) => void;
  setConnection: (mode: ConnectionMode) => void;
  setLastServerMessageId: (id: number) => void;

  setCallState: (state: CallState, extra?: Partial<Omit<CallInfo, "state">>) => void;
  endCall: (reason: CallEndReason) => void;
  toggleMuted: () => void;
  toggleSpeaker: () => void;

  addCaption: (line: Omit<CaptionLine, "id" | "ts"> & Partial<Pick<CaptionLine, "id" | "ts">>) => CaptionLine;
  updateCaption: (id: string, patch: Partial<CaptionLine>) => void;
  removeCaption: (id: string) => void;
  clearCaptions: () => void;

  logEvent: (type: string, payload?: Record<string, unknown>) => void;
  setScreen: (screen: Screen) => void;
  setSenderInContacts: (v: boolean) => void;
  reset: () => void;
}

const initialCall = (): CallInfo => ({ state: "idle", muted: false, speaker: false });

const freshSession = () => ({
  sessionId: uid(),
  createdAt: Date.now(),
  slots: emptySlots(),
  phase: "warmup" as Phase,
  channel: "text" as Channel,
  mode: "onboarding" as const,
  userNameConfirmed: false,
  messages: [] as ChatMessage[],
  assistantTyping: false,
  call: initialCall(),
  captions: [] as CaptionLine[],
  events: [] as SessionEvent[],
  screen: "messages" as Screen,
  // Persona is in the recipient's Contacts by default, so the App Clip card renders (toggle off to see iOS's plain-link fallback)
  senderInContacts: true,
  beliefs: [] as Belief[],
  intentions: [] as Intention[],
  turn: 0,
  nextBestAsk: null as NextBestAsk | null,
  latency: null as LatencyStats | null,
  connection: "offline" as ConnectionMode,
  lastServerMessageId: 0,
  promptVersion: null as string | null,
});

/**
 * Repairs or drops persisted messages written by older store shapes (before the closed
 * `MessageContent` union, messages carried `text` directly), so a stale localStorage never
 * crashes the thread with "cannot read 'kind' of undefined".
 */
export function sanitizeMessages(list: unknown): ChatMessage[] {
  if (!Array.isArray(list)) return [];
  const out: ChatMessage[] = [];
  for (const raw of list) {
    if (!raw || typeof raw !== "object") continue;
    const m = raw as Partial<ChatMessage> & { text?: unknown };
    let content = m.content as ChatMessage["content"] | undefined;
    if (!content || typeof content !== "object" || typeof (content as { kind?: unknown }).kind !== "string") {
      if (typeof m.text === "string") content = { kind: "text", text: m.text };
      else continue;
    }
    if (typeof m.id !== "string" || (m.role !== "user" && m.role !== "assistant" && m.role !== "system")) continue;
    const reactions = Array.isArray(m.reactions)
      ? m.reactions.filter((r) => !!r && typeof r === "object" && !!r.kind && typeof r.kind === "object" && typeof (r.kind as { type?: unknown }).type === "string")
      : undefined;
    out.push({ ...(m as ChatMessage), content, reactions, ts: typeof m.ts === "number" ? m.ts : Date.now() });
  }
  return out;
}

export const SESSION_STORAGE_KEY = "persona-onboarding-session";

/** Insert `m` keeping server rows in ascending server-id order. */
function insertOrdered(list: ChatMessage[], m: ChatMessage): ChatMessage[] {
  if (m.serverId == null) return [...list, m];
  // walk back over server rows with a higher id; local-only rows (no serverId) stay where they are
  let i = list.length;
  while (i > 0) {
    const prev = list[i - 1];
    if (prev.serverId != null && prev.serverId > m.serverId) i--;
    else break;
  }
  return [...list.slice(0, i), m, ...list.slice(i)];
}

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
      upsertMessage: (m) => {
        const s = get();
        const existing = s.messages.find((x) => x.id === m.id);
        if (existing) {
          const merged: ChatMessage = {
            ...existing,
            ...m,
            // the local copy knows the delivery state and when it was sent from this device
            ts: existing.ts,
            status: existing.status === "read" ? "read" : (m.status ?? existing.status),
            readAt: existing.readAt ?? m.readAt,
            reactions: existing.reactions ?? m.reactions,
            replyToId: existing.replyToId ?? m.replyToId,
          };
          set({ messages: s.messages.map((x) => (x.id === m.id ? merged : x)) });
        } else {
          set({ messages: insertOrdered(s.messages, m) });
        }
        if (m.serverId != null && m.serverId > s.lastServerMessageId) set({ lastServerMessageId: m.serverId });
      },
      toggleReaction: (messageId, kind, by) => {
        let added = false;
        set((s) => ({
          messages: s.messages.map((m) => {
            if (m.id !== messageId) return m;
            const existing = (m.reactions ?? []).filter((r) => r.by !== by);
            const mine = (m.reactions ?? []).find((r) => r.by === by);
            // iOS: one tapback per person per message; tapping the same one removes it
            if (mine && sameReaction(mine.kind, kind)) return { ...m, reactions: existing };
            added = true;
            return { ...m, reactions: [...existing, { kind, by, ts: Date.now() }] };
          }),
        }));
        get().logEvent(added ? "reaction.added" : "reaction.removed", { messageId, ...kind, by });
        return added;
      },
      setReaction: (messageId, kind, by, added) =>
        set((s) => ({
          messages: s.messages.map((m) => {
            if (m.id !== messageId) return m;
            const others = (m.reactions ?? []).filter((r) => r.by !== by);
            const mine = (m.reactions ?? []).find((r) => r.by === by);
            if (!added) return mine && sameReaction(mine.kind, kind) ? { ...m, reactions: others } : m;
            if (mine && sameReaction(mine.kind, kind)) return m;
            return { ...m, reactions: [...others, { kind, by, ts: Date.now() }] };
          }),
        })),
      markRead: (role) => {
        const now = Date.now();
        set((s) => ({
          messages: s.messages.map((m) =>
            m.role === role && m.status !== "read" && m.status !== "failed" ? { ...m, status: "read", readAt: now } : m,
          ),
        }));
      },
      setTyping: (assistantTyping) => set({ assistantTyping }),

      setSlot: (key, patch) => {
        set((s) => ({ slots: { ...s.slots, [key]: { ...s.slots[key], ...patch, updatedAt: Date.now() } } }));
        get().logEvent("slot.updated", { key, ...patch });
      },
      setPhase: (phase) => {
        if (get().phase === phase) return;
        set({ phase });
        get().logEvent("phase.changed", { phase });
      },
      setChannel: (channel) => {
        if (get().channel === channel) return;
        set({ channel });
        get().logEvent("channel.switched", { channel });
      },
      applyServerSession: (row) => {
        const s = get();
        const next = slotsFromSession(row);
        const slots: Slots = { ...s.slots };
        let slotChanged = false;
        (Object.keys(next) as SlotKey[]).forEach((k) => {
          const cur = s.slots[k];
          const nv = next[k];
          if (cur.status !== nv.status || cur.value !== nv.value) {
            slots[k] = { status: nv.status, value: nv.value, updatedAt: Date.now() };
            slotChanged = true;
            get().logEvent("slot.synced", { key: k, status: nv.status, value: nv.value });
          }
        });
        const patch: Partial<SessionState> = {};
        if (slotChanged) patch.slots = slots;
        if (s.phase !== row.phase) patch.phase = row.phase;
        if (s.mode !== row.mode) patch.mode = row.mode;
        const confirmed = !!row.confirmed?.user_name;
        if (s.userNameConfirmed !== confirmed) patch.userNameConfirmed = confirmed;
        if (s.promptVersion !== (row.prompt_version ?? null)) patch.promptVersion = row.prompt_version ?? null;
        if (s.turn !== (row.turn ?? 0)) patch.turn = row.turn ?? 0;
        // the browser owns the live WebRTC call; only follow the server when no local call is in flight
        const localCallBusy = s.call.state === "ringing" || s.call.state === "connecting" || s.call.state === "live";
        if (!localCallBusy) {
          const channel: Channel = row.call_state === "live" ? "call" : "text";
          if (s.channel !== channel) patch.channel = channel;
        }
        if (Object.keys(patch).length) set(patch);
      },
      setBrainView: (patch) => set(patch),
      setConnection: (connection) => {
        if (get().connection === connection) return;
        set({ connection });
        get().logEvent("connection.changed", { connection });
      },
      setLastServerMessageId: (id) => set((s) => ({ lastServerMessageId: Math.max(s.lastServerMessageId, id) })),

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
      removeCaption: (id) => set((s) => ({ captions: s.captions.filter((c) => c.id !== id) })),
      clearCaptions: () => set({ captions: [] }),

      logEvent: (type, payload) =>
        set((s) => ({ events: [...s.events, { id: uid(), ts: Date.now(), type, payload }].slice(-500) })),
      setScreen: (screen) => set({ screen }),
      setSenderInContacts: (senderInContacts) => {
        set({ senderInContacts });
        get().logEvent(senderInContacts ? "contact.added" : "contact.removed");
      },

      reset: () => set({ ...freshSession() }),
    }),
    {
      name: SESSION_STORAGE_KEY,
      storage: createJSONStorage(() => localStorage),
      // v2: Persona in Contacts by default (earlier runs persisted `false`, which sent the App Clip link to Safari)
      version: 2,
      migrate: (persisted, version) => {
        const p = (persisted ?? {}) as Record<string, unknown>;
        return version < 2 ? { ...p, senderInContacts: true } : p;
      },
      partialize: (s) => ({
        sessionId: s.sessionId,
        createdAt: s.createdAt,
        slots: s.slots,
        phase: s.phase,
        channel: s.channel,
        mode: s.mode,
        userNameConfirmed: s.userNameConfirmed,
        messages: s.messages,
        assistantTyping: s.assistantTyping,
        call: s.call,
        captions: s.captions,
        events: s.events,
        screen: s.screen,
        senderInContacts: s.senderInContacts,
        nextBestAsk: s.nextBestAsk,
        latency: s.latency,
        connection: s.connection,
        lastServerMessageId: s.lastServerMessageId,
        promptVersion: s.promptVersion,
      }),
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<SessionState>;
        return {
          ...current,
          ...p,
          slots: { ...emptySlots(), ...(p.slots ?? {}) },
          messages: sanitizeMessages(p.messages),
          captions: Array.isArray(p.captions) ? p.captions : [],
          events: Array.isArray(p.events) ? p.events : [],
          call: p.call && typeof p.call === "object" ? { ...initialCall(), ...p.call } : initialCall(),
          beliefs: [],
          intentions: [],
        };
      },
    },
  ),
);

/** Non-hook accessor for imperative code (brain, transports). */
export const session = {
  get: () => useSessionStore.getState(),
  set: useSessionStore.setState,
  subscribe: useSessionStore.subscribe,
};
