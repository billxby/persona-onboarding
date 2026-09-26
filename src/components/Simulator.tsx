"use client";

import { AnimatePresence, motion } from "motion/react";
import { useEffect, useSyncExternalStore } from "react";
import { getBrain } from "@/lib/brain";
import { callController } from "@/lib/call/controller";
import { useSessionStore } from "@/lib/session/store";
import type { ReactionKind } from "@/lib/session/types";
import { useCrossTabSync } from "@/lib/session/useCrossTabSync";
import { CallScreen } from "@/components/call/CallScreen";
import { CallBanner } from "@/components/imessage/CallBanner";
import { IMessageThread } from "@/components/imessage/IMessageThread";
import { PhoneFrame } from "@/components/phone/PhoneFrame";
import { PHONE_H, PHONE_W, usePhoneScale } from "@/components/phone/usePhoneScale";
import { ProgressBar } from "@/components/progress/ProgressBar";

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

  const contactName = agentName || "Persona";
  const callActive = call.state === "connecting" || call.state === "live";
  const showCall = screen === "call" && call.state !== "idle";

  // On (re)load: a call that was live when the tab closed is a drop; the brain
  // posts its opener if the thread is empty.
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
  // server session and mirrors it; on an empty thread the server inserts the opener.
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

  const onReact = (messageId: string, kind: ReactionKind) => {
    const added = toggleReaction(messageId, kind, "user");
    void getBrain().onUserReaction(messageId, kind, added);
  };

  return (
    <div style={{ width: PHONE_W * scale, height: PHONE_H * scale }} className="relative">
      {hydrated && <ProgressBar />}
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
                  />
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
