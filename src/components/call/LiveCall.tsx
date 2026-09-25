"use client";

import { Grid3x3, MessageSquare, Mic, MicOff, PhoneOff, UserPlus, Video, Volume2 } from "lucide-react";
import { motion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { useMicLevel } from "@/lib/audio/useMicLevel";
import { subscribeRemoteLevel } from "@/lib/call/controller";
import type { CallInfo, CaptionLine } from "@/lib/session/types";
import { cn, formatDuration } from "@/lib/utils";
import { PersonaAvatar } from "@/components/imessage/Avatar";
import { AudioMeter } from "./AudioMeter";

export function LiveCall({
  callerName,
  call,
  captions,
  onHangUp,
  onToggleMute,
  onToggleSpeaker,
  onSwitchToText,
  onMicDenied,
}: {
  callerName: string;
  call: CallInfo;
  captions: CaptionLine[];
  onHangUp: () => void;
  onToggleMute: () => void;
  onToggleSpeaker: () => void;
  onSwitchToText: () => void;
  onMicDenied: () => void;
}) {
  const live = call.state === "live";
  const [now, setNow] = useState(() => Date.now());
  const [remoteLevel, setRemoteLevel] = useState(0);
  const { level: micLevel, permission } = useMicLevel(live || call.state === "connecting", call.muted);
  const captionsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const i = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(i);
  }, []);
  useEffect(() => subscribeRemoteLevel(setRemoteLevel), []);
  useEffect(() => {
    if (permission === "denied") onMicDenied();
  }, [permission, onMicDenied]);
  useEffect(() => {
    captionsRef.current?.scrollTo({ top: captionsRef.current.scrollHeight, behavior: "smooth" });
  }, [captions]);

  const assistantSpeaking = remoteLevel > 0.05;
  const status = call.state === "connecting" ? "connecting…" : live && call.startedAt ? formatDuration(now - call.startedAt) : "";

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="relative flex h-full w-full flex-col items-center bg-gradient-to-b from-[#2c2c2e] via-[#141416] to-black pb-[66px] pt-[80px] text-white"
    >
      {/* caller */}
      <div className="flex flex-col items-center">
        <motion.div
          animate={{ scale: assistantSpeaking ? 1 + remoteLevel * 0.08 : 1 }}
          transition={{ type: "spring", stiffness: 300, damping: 20 }}
          className={cn("rounded-full ring-4 transition-colors", assistantSpeaking ? "ring-ios-green/70" : "ring-white/10")}
        >
          <PersonaAvatar size={72} className="from-[#c7c7cc] to-[#8e8e93]" />
        </motion.div>
        <div className="mt-3 text-[26px] font-medium leading-tight">{callerName}</div>
        <div className="mt-0.5 h-5 text-[15px] tabular-nums text-white/65">{status}</div>
      </div>

      {/* meters */}
      <div className="mt-5 flex items-center gap-8 text-[11px] uppercase tracking-wide text-white/50">
        <div className="flex flex-col items-center gap-1">
          <AudioMeter level={remoteLevel} color="bg-ios-green" />
          <span>{callerName}</span>
        </div>
        <div className="flex flex-col items-center gap-1">
          <AudioMeter level={micLevel} color={call.muted ? "bg-white/30" : "bg-white"} />
          <span>{call.muted ? "muted" : permission === "denied" ? "no mic" : "you"}</span>
        </div>
      </div>

      {/* captions */}
      <div
        ref={captionsRef}
        className="no-scrollbar mt-5 w-full flex-1 space-y-2 overflow-y-auto px-6 [mask-image:linear-gradient(to_bottom,transparent,black_12%,black)]"
      >
        {captions.length === 0 && live && <div className="pt-6 text-center text-[13px] text-white/35">Live captions appear here</div>}
        {captions.map((c) => (
          <div key={c.id} className={cn("flex", c.speaker === "user" ? "justify-end" : "justify-start")}>
            <div
              className={cn(
                "max-w-[85%] rounded-2xl px-3 py-1.5 text-[15px] leading-snug",
                c.speaker === "user" ? "bg-imsg-blue/90" : "bg-white/12",
                !c.final && "text-white/80",
              )}
            >
              {c.text || "…"}
              {!c.final && <span className="ml-0.5 inline-block w-[2px] animate-pulse bg-white/70">&nbsp;</span>}
            </div>
          </div>
        ))}
      </div>

      {/* controls */}
      <div className="mt-4 grid w-full grid-cols-3 gap-y-5 px-9">
        <CallButton icon={call.muted ? MicOff : Mic} label="mute" active={call.muted} onClick={onToggleMute} />
        <CallButton icon={Grid3x3} label="keypad" disabled />
        <CallButton icon={Volume2} label="speaker" active={call.speaker} onClick={onToggleSpeaker} />
        <CallButton icon={UserPlus} label="add" disabled />
        <CallButton icon={Video} label="FaceTime" disabled />
        <CallButton icon={MessageSquare} label="messages" onClick={onSwitchToText} />
      </div>
      <button
        onClick={onHangUp}
        className="mt-6 flex h-[72px] w-[72px] items-center justify-center rounded-full bg-ios-red shadow-lg transition active:scale-95"
        aria-label="End call"
      >
        <PhoneOff className="h-8 w-8" strokeWidth={2.2} />
      </button>
    </motion.div>
  );
}

function CallButton({
  icon: Icon,
  label,
  onClick,
  active,
  disabled,
}: {
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  label: string;
  onClick?: () => void;
  active?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="flex flex-col items-center gap-1.5 disabled:opacity-35"
    >
      <span
        className={cn(
          "flex h-[68px] w-[68px] items-center justify-center rounded-full transition active:scale-95",
          active ? "bg-white text-black" : "bg-white/18 text-white",
        )}
      >
        <Icon className="h-7 w-7" strokeWidth={2} />
      </span>
      <span className="text-[12px] text-white/85">{label}</span>
    </button>
  );
}
