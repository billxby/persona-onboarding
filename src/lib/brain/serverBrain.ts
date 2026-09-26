"use client";

import { callController } from "@/lib/call/controller";
import { session } from "@/lib/session/store";
import type { CallEndReason, ReactionKind } from "@/lib/session/types";
import type { CallEventResponse, ChatEvent, ChatTrigger, PostMessageResponse, SessionView } from "@/lib/shared/types";
import { ensureAnonSession, subscribeSession } from "@/lib/supabase/client";
import { sleep } from "@/lib/utils";
import { applyMessageRow, applySessionRow, applyView, type GmailFlip } from "./mirror";
import type { OnboardingBrain } from "./types";

const DEBOUNCE_MS = 1500;
const POLL_FAST_MS = 2000;
const POLL_SLOW_MS = 6000;
const FULL_RESYNC_MS = 60_000;
const WELCOME_BACK_MS = 30 * 60 * 1000;
const GMAIL_TIMEOUT_MS = 90_000;
const GMAIL_DEDUPE_MS = 30_000;

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`${path} → ${res.status}`);
  return (await res.json()) as T;
}

/**
 * The real brain: a thin client of the Next.js backend. It never decides
 * anything. It sends what the user did, streams what the server replied,
 * and keeps the zustand store mirrored to the server session.
 */
export class ServerBrain implements OnboardingBrain {
  private bootedFor: string | null = null;
  private bootingFor: string | null = null;
  private booting: Promise<void> | null = null;
  private accessToken: string | null = null;
  private realtime = false;

  private unsubscribe: (() => void) | null = null;
  private pollTimer: ReturnType<typeof setTimeout> | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private pollMs = POLL_FAST_MS;
  private lastFullSyncAt = 0;
  private pollInFlight = false;

  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private queue: Promise<void> = Promise.resolve();

  private gmailTimer: ReturnType<typeof setTimeout> | null = null;
  private lastGmailReplyAt = 0;
  private welcomed = new Set<string>();

  constructor() {
    if (typeof window === "undefined") return;
    session.subscribe((s, prev) => {
      if (s.sessionId !== prev.sessionId) void this.start();
    });
    window.addEventListener("message", (e: MessageEvent) => {
      const d = e.data as { type?: string; status?: "connected" | "declined"; email?: string } | null;
      if (d && d.type === "persona:gmail" && d.status) this.notifyGmail(d.status, d.email);
    });
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible" && this.bootedFor) void this.poll(true);
    });
  }

  // ---------------------------------------------------------------------------
  // bootstrap + sync
  // ---------------------------------------------------------------------------

  async start(): Promise<void> {
    const sid = session.get().sessionId;
    if (this.bootedFor === sid) return;
    if (this.booting && this.bootingFor === sid) return this.booting;
    this.teardown();
    this.bootingFor = sid;
    this.booting = this.bootstrap(sid, 0).finally(() => {
      if (this.bootingFor === sid) {
        this.booting = null;
        this.bootingFor = null;
      }
    });
    return this.booting;
  }

  private async bootstrap(sid: string, attempt: number): Promise<void> {
    session.get().setTyping(false);
    if (this.accessToken == null) this.accessToken = await ensureAnonSession();
    let view: SessionView;
    try {
      view = await postJson<SessionView>("/api/session", { id: sid, access_token: this.accessToken ?? undefined });
    } catch (e) {
      const st = session.get();
      st.setConnection("offline");
      st.logEvent("server.unreachable", { error: String(e), attempt });
      const delay = Math.min(30_000, 3_000 * 2 ** attempt);
      this.retryTimer = setTimeout(() => {
        if (session.get().sessionId === sid && this.bootedFor !== sid) void this.bootstrap(sid, attempt + 1);
      }, delay);
      return;
    }
    if (session.get().sessionId !== sid) return; // the user restarted meanwhile
    this.bootedFor = sid;
    this.realtime = view.realtime;
    this.lastFullSyncAt = Date.now();
    const flip = applyView(view);
    this.handleGmailFlip(flip);
    this.connect(sid);
    this.maybeWelcomeBack(sid, view);
  }

  private connect(sid: string) {
    const st = session.get();
    if (this.realtime) {
      this.unsubscribe = subscribeSession(
        sid,
        {
          onMessage: (row) => {
            if (session.get().sessionId === sid) applyMessageRow(row);
          },
          onSession: (row) => {
            if (session.get().sessionId === sid) this.handleGmailFlip(applySessionRow(row));
          },
          onBeliefs: () => void this.poll(false),
          onStatus: (status) => {
            if (status === "SUBSCRIBED") {
              session.get().setConnection("realtime");
              this.pollMs = POLL_SLOW_MS;
            } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
              this.unsubscribe?.();
              this.unsubscribe = null;
              session.get().setConnection("polling");
              this.pollMs = POLL_FAST_MS;
            }
          },
        },
        this.accessToken,
      );
      st.setConnection("polling"); // until SUBSCRIBED confirms
    } else {
      st.setConnection("polling");
      this.pollMs = POLL_FAST_MS;
    }
    this.schedulePoll();
  }

  private schedulePoll() {
    if (this.pollTimer) clearTimeout(this.pollTimer);
    this.pollTimer = setTimeout(() => void this.poll(false), this.pollMs);
  }

  /** Catch-up poll. Always runs (slowly) even with Realtime, as a safety net for RLS or socket hiccups. */
  private async poll(force: boolean): Promise<void> {
    const sid = this.bootedFor;
    if (!sid) return;
    if (this.pollInFlight) return;
    if (!force && typeof document !== "undefined" && document.visibilityState !== "visible") {
      this.schedulePoll();
      return;
    }
    this.pollInFlight = true;
    try {
      const full = force || Date.now() - this.lastFullSyncAt > FULL_RESYNC_MS;
      const after = full ? 0 : session.get().lastServerMessageId;
      const res = await fetch(`/api/session/${sid}?after=${after}`, { cache: "no-store" });
      if (!res.ok) throw new Error(`GET /api/session → ${res.status}`);
      const view = (await res.json()) as SessionView;
      if (session.get().sessionId !== sid) return;
      if (full) this.lastFullSyncAt = Date.now();
      this.handleGmailFlip(applyView(view));
      const st = session.get();
      if (st.connection === "offline") st.setConnection(this.unsubscribe ? "realtime" : "polling");
    } catch (e) {
      session.get().setConnection("offline");
      session.get().logEvent("server.poll_failed", { error: String(e) });
    } finally {
      this.pollInFlight = false;
      if (this.bootedFor === sid) this.schedulePoll();
    }
  }

  private maybeWelcomeBack(sid: string, view: SessionView) {
    if (this.welcomed.has(sid)) return;
    const s = view.session;
    const last = Date.parse(s.last_user_activity_at ?? s.created_at);
    if (!Number.isFinite(last)) return;
    if (Date.now() - last > WELCOME_BACK_MS && view.messages.filter((m) => m.channel === "text").length >= 2) {
      this.welcomed.add(sid);
      void this.requestReply("welcome_back");
    }
  }

  private teardown() {
    this.unsubscribe?.();
    this.unsubscribe = null;
    if (this.pollTimer) clearTimeout(this.pollTimer);
    if (this.retryTimer) clearTimeout(this.retryTimer);
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    if (this.gmailTimer) clearTimeout(this.gmailTimer);
    this.pollTimer = this.retryTimer = this.debounceTimer = this.gmailTimer = null;
    this.bootedFor = null;
    this.lastFullSyncAt = 0;
  }

  // ---------------------------------------------------------------------------
  // replies
  // ---------------------------------------------------------------------------

  private scheduleReply() {
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      void this.requestReply("user");
    }, DEBOUNCE_MS);
  }

  /** Serialised: one /api/chat call at a time per tab. */
  requestReply(trigger: ChatTrigger, reason?: string): Promise<void> {
    const run = () => this.runReply(trigger, reason, true);
    this.queue = this.queue.then(run, run);
    return this.queue;
  }

  private async runReply(trigger: ChatTrigger, reason: string | undefined, retry: boolean): Promise<void> {
    const sid = session.get().sessionId;
    let res: Response;
    try {
      res = await fetch("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ session_id: sid, trigger, reason }),
      });
    } catch (e) {
      const st = session.get();
      st.setTyping(false);
      st.setConnection("offline");
      st.logEvent("chat.failed", { trigger, error: String(e) });
      return;
    }
    if (!res.ok || !res.body) {
      const st = session.get();
      st.setTyping(false);
      st.logEvent("chat.failed", { trigger, status: res.status });
      return;
    }
    let busy = false;
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    const handle = (line: string) => {
      const trimmed = line.trim();
      if (!trimmed) return;
      let ev: ChatEvent;
      try {
        ev = JSON.parse(trimmed) as ChatEvent;
      } catch {
        return;
      }
      if (session.get().sessionId !== sid) return;
      if (this.handleChatEvent(ev)) busy = true;
    };
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let nl: number;
        while ((nl = buf.indexOf("\n")) >= 0) {
          handle(buf.slice(0, nl));
          buf = buf.slice(nl + 1);
        }
      }
      buf += decoder.decode();
      if (buf.trim()) handle(buf);
    } catch (e) {
      session.get().logEvent("chat.stream_error", { trigger, error: String(e) });
    } finally {
      session.get().setTyping(false);
    }
    if (busy && retry) {
      await sleep(2000);
      return this.runReply(trigger, reason, false);
    }
  }

  /** @returns true when the server said it was busy */
  private handleChatEvent(ev: ChatEvent): boolean {
    const st = session.get();
    switch (ev.type) {
      case "typing":
        st.setTyping(ev.on);
        if (ev.on) st.markRead("user");
        return false;
      case "message":
        applyMessageRow(ev.message);
        return false;
      case "session":
        this.handleGmailFlip(applySessionRow(ev.session));
        return false;
      case "beliefs":
        st.setBrainView({ beliefs: ev.beliefs });
        return false;
      case "tool":
        st.setBrainView({ nextBestAsk: ev.next_best_ask });
        st.logEvent("brain.tool", { name: ev.name, ok: ev.ok, ring: ev.ring });
        if (ev.ring) setTimeout(() => callController.ring(), 1200 + Math.random() * 800);
        return false;
      case "done":
        st.setBrainView({ nextBestAsk: ev.next_best_ask });
        st.logEvent("brain.done", { latency_ms: ev.latency_ms });
        return false;
      case "busy":
        return true;
      case "error":
        st.setTyping(false);
        st.logEvent("brain.error", { message: ev.message });
        return false;
      default:
        return false;
    }
  }

  // ---------------------------------------------------------------------------
  // OnboardingBrain
  // ---------------------------------------------------------------------------

  async onUserText(text: string): Promise<void> {
    const st = session.get();
    st.logEvent("user.text", { text });
    const sid = st.sessionId;
    const local = [...st.messages]
      .reverse()
      .find((m) => m.role === "user" && m.content.kind === "text" && m.content.text === text && (m.status === "sending" || m.status === "delivered"));
    const clientId = local?.id ?? crypto.randomUUID();
    await this.start();
    try {
      const res = await postJson<PostMessageResponse>("/api/messages", { session_id: sid, client_id: clientId, text });
      if (session.get().sessionId !== sid) return;
      applyMessageRow(res.message);
      if (local) session.get().updateMessage(local.id, { status: "delivered", serverId: res.message.id });
      if (res.call_live) {
        session.get().logEvent("call.text_during_call", { text });
        callController.injectSystem(`The user just texted: "${text}". Say "got it, switching to text" in one short sentence and call end_call("user_texted").`);
        return;
      }
      this.scheduleReply();
    } catch (e) {
      if (local) session.get().updateMessage(local.id, { status: "failed" });
      session.get().setConnection("offline");
      session.get().logEvent("server.send_failed", { error: String(e) });
    }
  }

  async onLinkOpen(messageId: string, url: string): Promise<void> {
    const st = session.get();
    st.logEvent("user.link_open", { messageId, url });
    let u: URL | null = null;
    try {
      u = new URL(url, window.location.origin);
    } catch {
      u = null;
    }
    if (u && u.origin === window.location.origin && u.pathname === "/connect") {
      window.open(u.toString(), "persona-connect", "popup,width=520,height=720");
      if (this.gmailTimer) clearTimeout(this.gmailTimer);
      this.gmailTimer = setTimeout(() => {
        this.gmailTimer = null;
        if (session.get().slots.gmail.status === "pending") void this.requestReply("gmail_declined", "timeout");
      }, GMAIL_TIMEOUT_MS);
      return;
    }
    if (u && u.origin === window.location.origin && u.pathname === "/clip") {
      // Sender not in Contacts (or the card degraded): the App Clip URL is a normal web page.
      this.postClientEvent("app_clip_fallback_web", { messageId, url: u.toString() });
      window.open(u.toString(), "_blank", "noopener");
      return;
    }
    window.open(url, "_blank", "noopener");
  }

  /** Client-side UI events the server should know about (App Clip card, runner, CTAs). */
  postClientEvent(type: string, payload: Record<string, unknown> = {}): void {
    const st = session.get();
    st.logEvent(`ui.${type}`, payload);
    void postJson("/api/events", { session_id: st.sessionId, type, payload }).catch(() => undefined);
  }

  async onUserReaction(messageId: string, kind: ReactionKind, added: boolean): Promise<void> {
    const st = session.get();
    st.logEvent("user.reaction", { messageId, ...kind, added });
    const target = messageId.startsWith("srv-") ? { target_id: Number(messageId.slice(4)) } : { target_client_id: messageId };
    void postJson("/api/messages", {
      session_id: st.sessionId,
      client_id: crypto.randomUUID(),
      text: "",
      kind: "tapback",
      payload: { ...target, ...(kind.type === "tapback" ? { tapback: kind.tapback } : { emoji: kind.emoji }), by: "user", added },
    }).catch(() => undefined);
  }

  async onCallAnswered(): Promise<void> {
    const s = session.get();
    s.setChannel("call");
    if (s.phase === "warmup") s.setPhase("collecting");
  }

  async onCallEnded(reason: CallEndReason): Promise<void> {
    const st = session.get();
    const sid = st.sessionId;
    st.setChannel("text");
    const type = reason === "dropped" ? "call_dropped" : "call_ended";
    try {
      const res = await postJson<CallEventResponse>("/api/call/event", { session_id: sid, type, reason });
      if (session.get().sessionId !== sid) return;
      this.handleGmailFlip(applySessionRow(res.session));
      for (const m of res.messages ?? []) applyMessageRow(m);
      if (res.chat_trigger) await this.requestReply(res.chat_trigger, reason);
    } catch (e) {
      session.get().logEvent("call.event_failed", { type, reason, error: String(e) });
    }
  }

  async onUserSpeechFinal(text: string): Promise<void> {
    session.get().logEvent("user.speech_final", { text });
  }

  /** Pull the latest server state now. */
  async refresh(): Promise<void> {
    if (!this.bootedFor) {
      await this.start();
      return;
    }
    await this.poll(true);
  }

  /** Gmail connected/declined outside the thread (popup callback, demo-inbox toggle, mirror flip). */
  notifyGmail(status: "connected" | "declined", email?: string): void {
    if (this.gmailTimer) {
      clearTimeout(this.gmailTimer);
      this.gmailTimer = null;
    }
    const now = Date.now();
    if (now - this.lastGmailReplyAt < GMAIL_DEDUPE_MS) return;
    this.lastGmailReplyAt = now;
    const st = session.get();
    st.logEvent("gmail.notified", { status, email });
    if (st.call.state === "live") {
      callController.injectSystem(
        status === "connected"
          ? `Gmail just connected as ${email ?? "the user's account"}. Say so in one sentence, call recent_emails(3), then give one observation and ask one question.`
          : "The user declined the Gmail connection. Acknowledge in one sentence, do not ask again, and deliver value without it.",
      );
      return;
    }
    void this.requestReply(status === "connected" ? "gmail_connected" : "gmail_declined", email);
  }

  private handleGmailFlip(flip: GmailFlip) {
    if (flip.prev === flip.next) return;
    if (flip.prev === "pending" && flip.next === "filled") this.notifyGmail("connected", flip.email);
    else if (flip.prev === "pending" && (flip.next === "declined" || flip.next === "failed")) this.notifyGmail("declined");
  }
}
