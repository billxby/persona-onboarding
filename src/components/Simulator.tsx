"use client";

import { AnimatePresence, motion } from "motion/react";
import { useEffect, useSyncExternalStore } from "react";
import { getBrain } from "@/lib/brain";
import { useSessionStore } from "@/lib/session/store";
import { CallScreen } from "@/components/call/CallScreen";
import { CallBanner } from "@/components/imessage/CallBanner";
import { IMessageThread } from "@/components/imessage/IMessageThread";
import { SessionInspector } from "@/components/inspector/SessionInspector";
import { PhoneFrame } from "@/components/phone/PhoneFrame";

/**
 * Composes the phone (iMessage thread + call overlay) with the inspector.
 * This is the only place that knows about both channels at once.
 */
export function Simulator() {
  const hydrated = useHydrated();
  const messages = useSessionStore((s) => s.messages);
  const typing = useSessionStore((s) => s.assistantTyping);
  const call = useSessionStore((s) => s.call);
  const screen = useSessionStore((s) => s.screen);
  const agentName = useSessionStore((s) => s.slots.agent_name.value);
  const setScreen = useSessionStore((s) => s.setScreen);
  const appendMessage = useSessionStore((s) => s.appendMessage);
  const updateMessage = useSessionStore((s) => s.updateMessage);

  const contactName = agentName || "Persona";
  const callActive = call.state === "connecting" || call.state === "live";
  const showCall = screen === "call" && call.state !== "idle";

  // On (re)load: a call that was live when the tab closed is a drop, and the
  // brain posts its opener if the thread is empty.
  useEffect(() => {
    if (!hydrated) return;
    const st = useSessionStore.getState();
    if (st.call.state === "ringing" || st.call.state === "connecting" || st.call.state === "live") {
      st.endCall("dropped");
      st.setScreen("messages");
      void getBrain().onCallEnded("dropped");
    } else if (st.screen === "call") {
      st.setScreen("messages");
    }
    void getBrain().start();
  }, [hydrated]);

  const onSend = (text: string) => {
    const m = appendMessage({ role: "user", text, status: "sending" });
    setTimeout(() => updateMessage(m.id, { status: "delivered" }), 500);
    void getBrain().onUserText(text);
  };

  const onAction = (actionId: string, messageId: string) => {
    void getBrain().onCardAction(actionId, messageId);
  };

  if (!hydrated) {
    return <div className="flex h-[844px] w-[390px] items-center justify-center text-black/40">Loading…</div>;
  }

  return (
    <div className="flex items-start gap-8">
      <PhoneFrame dark={showCall}>
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
                messages={messages}
                typing={typing}
                onSend={onSend}
                onAction={onAction}
              />
            </motion.div>
          )}
        </AnimatePresence>
      </PhoneFrame>

      <div className="h-[844px]">
        <SessionInspector />
      </div>
    </div>
  );
}

/** Wait for zustand/persist to rehydrate before rendering persisted state. */
function useHydrated() {
  return useSyncExternalStore(
    (cb) => useSessionStore.persist.onFinishHydration(cb),
    () => useSessionStore.persist.hasHydrated(),
    () => false,
  );
}
