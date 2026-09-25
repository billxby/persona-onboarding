"use client";

import { motion } from "motion/react";
import type { CallInfo } from "@/lib/session/types";
import { formatDuration } from "@/lib/utils";
import { PersonaAvatar } from "@/components/imessage/Avatar";

const REASON_LABEL: Record<NonNullable<CallInfo["endReason"]>, string> = {
  user_hangup: "Call Ended",
  bot_hangup: "Call Ended",
  declined: "Declined",
  dropped: "Call Failed",
  silence: "Call Ended",
  mic_denied: "Call Failed",
};

export function CallEnded({ callerName, call }: { callerName: string; call: CallInfo }) {
  const dur = call.startedAt && call.endedAt ? formatDuration(call.endedAt - call.startedAt) : null;
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="flex h-full w-full flex-col items-center justify-center gap-3 bg-black text-white"
    >
      <PersonaAvatar size={80} className="from-[#636366] to-[#3a3a3c] opacity-70" />
      <div className="text-[26px] font-medium">{callerName}</div>
      <div className="text-[17px] text-white/70">
        {call.endReason ? REASON_LABEL[call.endReason] : "Call Ended"}
        {dur ? ` · ${dur}` : ""}
      </div>
    </motion.div>
  );
}
