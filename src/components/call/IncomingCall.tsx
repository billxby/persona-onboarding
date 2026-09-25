"use client";

import { Phone, PhoneOff } from "lucide-react";
import { motion } from "motion/react";
import { useEffect } from "react";
import { startRingtone } from "@/lib/audio/ringtone";
import { PersonaAvatar } from "@/components/imessage/Avatar";

export function IncomingCall({
  callerName,
  onAccept,
  onDecline,
  ringtone = true,
}: {
  callerName: string;
  onAccept: () => void;
  onDecline: () => void;
  ringtone?: boolean;
}) {
  useEffect(() => {
    if (!ringtone) return;
    const stop = startRingtone();
    return stop;
  }, [ringtone]);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="relative flex h-full w-full flex-col items-center justify-between bg-gradient-to-b from-[#3a3a3c] via-[#1c1c1e] to-black pb-[74px] pt-[110px] text-white"
    >
      <div className="flex flex-col items-center">
        <div className="ring-pulse relative">
          <PersonaAvatar size={96} className="from-[#c7c7cc] to-[#8e8e93]" />
        </div>
        <div className="mt-6 text-[32px] font-medium leading-tight">{callerName}</div>
        <div className="mt-1 text-[17px] text-white/70">incoming call</div>
      </div>

      <div className="flex w-full items-start justify-around px-10">
        <div className="flex flex-col items-center gap-2">
          <button
            onClick={onDecline}
            className="flex h-[76px] w-[76px] items-center justify-center rounded-full bg-ios-red shadow-lg transition active:scale-95"
            aria-label="Decline"
          >
            <PhoneOff className="h-8 w-8" strokeWidth={2.2} />
          </button>
          <span className="text-[13px] text-white/85">Decline</span>
        </div>
        <div className="flex flex-col items-center gap-2">
          <motion.button
            onClick={onAccept}
            animate={{ y: [0, -4, 0] }}
            transition={{ repeat: Infinity, duration: 1.2 }}
            className="flex h-[76px] w-[76px] items-center justify-center rounded-full bg-ios-green shadow-lg transition active:scale-95"
            aria-label="Accept"
          >
            <Phone className="h-8 w-8" strokeWidth={2.2} />
          </motion.button>
          <span className="text-[13px] text-white/85">Accept</span>
        </div>
      </div>
    </motion.div>
  );
}
