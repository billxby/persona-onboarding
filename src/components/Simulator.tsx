"use client";

import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState, useSyncExternalStore } from "react";
import { getBrain } from "@/lib/brain";
import { callController } from "@/lib/call/controller";
import { useSessionStore } from "@/lib/session/store";
import type { ReactionKind } from "@/lib/session/types";
import { useCrossTabSync } from "@/lib/session/useCrossTabSync";
import { CallScreen } from "@/components/call/CallScreen";
import { CallBanner } from "@/components/imessage/CallBanner";
import { IMessageThread } from "@/components/imessage/IMessageThread";
import { PhoneFrame } from "@/components/phone/PhoneFrame";
import { SafariSheet } from "@/components/phone/SafariSheet";
import { PHONE_H, PHONE_W, usePhoneScale } from "@/components/phone/usePhoneScale";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The phone: iMessage thread with the call screen overlaid when a call is
 * ringing or live. This is the only component that knows about both channels.
 */
export function Simulator() {
  const hydrated = useHydrated();
  useCrossTabSync();
  const scale = usePhoneScale();

  const messages = useSessionStore((s) => s.messages);
  const typing = useSessionStore((s) => s.assistantTyping);
  const call = useSessionStore((s) => s.call);
  const screen = useSessionStore((s) => s.screen);
  const agentName = useSessionStore((s) => s.slots.agent_name.value);
  const setScreen = useSessionStore((s) => s.setScreen);
  const appendMessage = useSessionStore((s) => s.appendMessage);
  const updateMessage = useSessionStore((s) => s.updateMessage);
  const toggleReaction = useSessionStore((s) => s.toggleReaction);
  const senderInContacts = useSessionStore((s) => s.senderInContacts);

  const [safariUrl, setSafariUrl] = useState<string | null>(null);

  const contactName = agentName || "Persona";
  const callActive = call.state === "connecting" || call.state === "live";
  const showCall = screen === "call" && call.state !== "idle";

  // `/?sid=<uuid>` resumes that server session (the App Clip's web fallback ends with "Start in Messages"
  // pointing here). Runs before the brain boots; the param is then dropped from the address bar.
  useEffect(() => {
    if (!hydrated || typeof window === "undefined") return;
    const url = new URL(window.location.href);
    const sid = url.searchParams.get("sid");
    const fromClip = url.searchParams.get("clip") === "closed";
    if (!sid) return;
    if (UUID.test(sid) && sid !== useSessionStore.getState().sessionId) {
      useSessionStore.getState().reset();
      useSessionStore.setState({ sessionId: sid });
    }
    url.searchParams.delete("sid");
    url.searchParams.delete("clip");
    window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
    if (fromClip) {
      // the web clip finished in a browser tab and sent the user here: the thread takes the relay
      void getBrain()
        .start()
        .then(() => {
          getBrain().onAppClipOpened?.();
          getBrain().postClientEvent?.("app_clip_closed", { via: "web" });
          getBrain().onAppClipClosed?.();
        });
    }
  }, [hydrated]);

  // The web fallback running in the in-phone Safari sheet reports back the way the runner does: close the
  // sheet and let the thread take the relay (a yes on the call screen rings the phone from that turn).
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      const d = e.data as { type?: string; event?: string; screen?: string; completed?: boolean; call?: string | null } | null;
      if (!d || d.type !== "persona:clip" || d.event !== "done" || e.origin !== window.location.origin) return;
      setSafariUrl(null);
      getBrain().postClientEvent?.("app_clip_closed", { via: "safari", screen: d.screen, completed: d.completed, call: d.call });
      getBrain().onAppClipClosed?.();
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  // On (re)load: a call that was live when the tab closed is a drop. An empty thread
  // shows the prefilled "Hey Persona" in the compose field; nothing is sent for you.
  useEffect(() => {
    if (!hydrated) return;
    // dev-only handle for browser walkthroughs (scripts/e2e.mjs)
    if (process.env.NODE_ENV !== "production") {
      (window as unknown as { __persona?: unknown }).__persona = { callController, getBrain, session: useSessionStore };
    }
    const st = useSessionStore.getState();
    useSessionStore.setState({ assistantTyping: false });
    if (st.call.state === "ringing" || st.call.state === "connecting" || st.call.state === "live") {
      st.endCall("dropped");
      st.setScreen("messages");
      void getBrain().onCallEnded("dropped");
    } else if (st.screen === "call") {
      st.setScreen("messages");
    }
  }, [hydrated]);

  // The brain bootstraps once per session id (idempotent): on load it (re)joins the
  // server session and mirrors it. The thread starts empty; your first send gets the opener.
  const sessionId = useSessionStore((s) => s.sessionId);
  const threadEmpty = messages.length === 0;
  useEffect(() => {
    if (hydrated) void getBrain().start();
  }, [hydrated, sessionId, threadEmpty]);

  const onSend = (text: string, replyToId?: string) => {
    const m = appendMessage({ role: "user", content: { kind: "text", text }, status: "sending", replyToId });
    setTimeout(() => {
      // don't downgrade a message the brain already marked as read
      const cur = useSessionStore.getState().messages.find((x) => x.id === m.id);
      if (cur?.status === "sending") updateMessage(m.id, { status: "delivered" });
    }, 500);
    void getBrain().onUserText(text);
  };

  const onOpenLink = (messageId: string, url: string) => void getBrain().onLinkOpen(messageId, url);
  // Plain links open in the in-phone Safari sheet, never in a browser tab. The brain still
  // records the tap (and the App Clip web fallback) without opening anything itself.
  const onOpenInSafari = (messageId: string, url: string) => {
    void getBrain().onLinkOpen(messageId, url);
    setSafariUrl(url);
  };
  // App Clip cards run inside the phone (AppClipRunner). The brain records the event, holds replies while the
  // clip is up, and takes the relay in the thread once it closes.
  const onOpenAppClip = (messageId: string, url: string) => {
    getBrain().postClientEvent?.("app_clip_opened", { messageId, url });
    getBrain().onAppClipOpened?.();
  };
  const onCloseAppClip = (messageId: string, url: string, detail?: Record<string, unknown>) => {
    getBrain().postClientEvent?.("app_clip_closed", { messageId, url, ...(detail ?? {}) });
    getBrain().onAppClipClosed?.();
  };

  const onReact = (messageId: string, kind: ReactionKind) => {
    const added = toggleReaction(messageId, kind, "user");
    void getBrain().onUserReaction(messageId, kind, added);
  };

  return (
    <div style={{ width: PHONE_W * scale, height: PHONE_H * scale }} className="relative">
      <div style={{ transform: `scale(${scale})`, transformOrigin: "top left" }} className="absolute left-0 top-0">
        <PhoneFrame dark={showCall}>
          {!hydrated ? null : (
            <AnimatePresence mode="wait" initial={false}>
              {showCall ? (
                <motion.div key="call" className="absolute inset-0" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                  <CallScreen callerName={contactName} />
                </motion.div>
              ) : (
                <motion.div key="messages" className="absolute inset-0" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                  {callActive && <CallBanner startedAt={call.startedAt} onReturn={() => setScreen("call")} />}
                  <IMessageThread
                    contactName={contactName}
                    senderInContacts={senderInContacts}
                    messages={messages}
                    typing={typing}
                    onSend={onSend}
                    onReact={onReact}
                    onOpenLink={onOpenLink}
                    onOpenAppClip={onOpenAppClip}
                    onCloseAppClip={onCloseAppClip}
                    onOpenInSafari={onOpenInSafari}
                  />
                  <AnimatePresence>{safariUrl && <SafariSheet key={safariUrl} url={safariUrl} onClose={() => setSafariUrl(null)} />}</AnimatePresence>
                </motion.div>
              )}
            </AnimatePresence>
          )}
        </PhoneFrame>
      </div>
    </div>
  );
}

/** Wait for zustand/persist to rehydrate before rendering persisted state. */
export function useHydrated() {
  return useSyncExternalStore(
    (cb) => useSessionStore.persist.onFinishHydration(cb),
    () => useSessionStore.persist.hasHydrated(),
    () => false,
  );
}
