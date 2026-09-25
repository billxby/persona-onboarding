"use client";

import { AnimatePresence } from "motion/react";
import { useCallback, useEffect } from "react";
import { callController } from "@/lib/call/controller";
import { useSessionStore } from "@/lib/session/store";
import { CallEnded } from "./CallEnded";
import { IncomingCall } from "./IncomingCall";
import { LiveCall } from "./LiveCall";

/**
 * Call simulator wrapper. Renders the right sub-screen for the current call
 * state and routes user actions through the call controller.
 */
export function CallScreen({ callerName }: { callerName: string }) {
  const call = useSessionStore((s) => s.call);
  const captions = useSessionStore((s) => s.captions);
  const toggleMuted = useSessionStore((s) => s.toggleMuted);
  const toggleSpeaker = useSessionStore((s) => s.toggleSpeaker);
  const setScreen = useSessionStore((s) => s.setScreen);

  // after "Call Ended" lingers for a moment, go back to Messages
  useEffect(() => {
    if (call.state !== "ended") return;
    const t = setTimeout(() => setScreen("messages"), 1400);
    return () => clearTimeout(t);
  }, [call.state, setScreen]);

  const onMicDenied = useCallback(() => callController.end("mic_denied"), []);

  return (
    <AnimatePresence mode="wait">
      {call.state === "ringing" && (
        <IncomingCall
          key="ringing"
          callerName={callerName}
          onAccept={() => void callController.answer()}
          onDecline={() => callController.decline()}
        />
      )}
      {(call.state === "connecting" || call.state === "live") && (
        <LiveCall
          key="live"
          callerName={callerName}
          call={call}
          captions={captions}
          onHangUp={() => callController.hangUp()}
          onToggleMute={() => {
            toggleMuted();
            callController.setMuted(!call.muted);
          }}
          onToggleSpeaker={toggleSpeaker}
          onSwitchToText={() => setScreen("messages")}
          onMicDenied={onMicDenied}
        />
      )}
      {call.state === "ended" && <CallEnded key="ended" callerName={callerName} call={call} />}
    </AnimatePresence>
  );
}
