"use client";

import { ChevronRight, Pause, Phone, Play } from "lucide-react";
import { motion, type MotionValue } from "motion/react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { AudioMessage, BubbleEffect, ChatMessage, ContactCard } from "@/lib/session/types";
import { callLogLabel, messageText } from "@/lib/session/types";
import { cn, formatClock, formatDuration } from "@/lib/utils";
import { LinkBubble } from "./LinkBubble";
import { TapbackBadges } from "./Tapback";
import { useLongPress } from "./useLongPress";

export function MessageBubble({
  message,
  replyTo,
  tail,
  timeOpacity,
  senderInContacts,
  onOpenActions,
  onOpenLink,
  onOpenAppClip,
}: {
  message: ChatMessage;
  replyTo?: ChatMessage;
  tail: boolean;
  /** 0..1 driven by the drag-to-reveal gesture */
  timeOpacity: MotionValue<number>;
  senderInContacts: boolean;
  onOpenActions: (messageId: string, el: HTMLElement) => void;
  onOpenLink: (messageId: string) => void;
  onOpenAppClip: (messageId: string) => void;
}) {
  const out = message.role === "user";
  const bubbleRef = useRef<HTMLDivElement>(null);
  const open = useCallback(() => {
    if (bubbleRef.current) onOpenActions(message.id, bubbleRef.current);
  }, [message.id, onOpenActions]);
  const press = useLongPress(open);

  const reactions = message.reactions ?? [];
  const c = message.content;

  if (message.role === "system") {
    if (c.kind === "call") {
      // iOS puts call events inline in the thread as a quiet centred row
      return (
        <div className="my-1.5 flex items-center justify-center gap-1.5 text-[11px] text-black/45" data-call-log={c.call.reason}>
          <Phone className="h-3 w-3" strokeWidth={2.5} />
          <span>{callLogLabel(c.call)}</span>
          <span className="text-black/30">· {formatClock(new Date(message.ts))}</span>
        </div>
      );
    }
    return <div className="my-1 self-center text-center text-[11px] text-black/45">{messageText(message)}</div>;
  }

  return (
    <motion.div
      layout="position"
      initial={{ opacity: 0, y: 14, scale: 0.92 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ type: "spring", stiffness: 420, damping: 30 }}
      className={cn("relative flex w-full flex-col", out ? "items-end" : "items-start", reactions.length > 0 && "mt-3")}
    >
      {/* drag-to-reveal timestamp */}
      <motion.span
        style={{ opacity: timeOpacity }}
        className="pointer-events-none absolute -right-[60px] top-1/2 w-[54px] -translate-y-1/2 text-right text-[11px] tabular-nums text-black/45"
      >
        {formatClock(new Date(message.ts))}
      </motion.span>

      {replyTo && <ReplyQuote quoted={replyTo} out={out} />}

      <div className={cn("relative flex max-w-full flex-col", out ? "items-end" : "items-start")}>
        {c.kind === "text" && (
          <EffectBubble effect={c.effect}>
            <div
              ref={bubbleRef}
              data-bubble={message.id}
              {...press}
              className={cn("bubble select-none", out ? "bubble-out" : "bubble-in", tail && "tail", "max-w-none")}
              style={{ maxWidth: 300 }}
            >
              {c.text}
            </div>
          </EffectBubble>
        )}
        {c.kind === "link" && (
          <div ref={bubbleRef} data-bubble={message.id} {...press} className={cn("flex w-full", out ? "justify-end" : "justify-start")}>
            <LinkBubble
              link={c.link}
              senderInContacts={senderInContacts}
              onOpen={() => onOpenLink(message.id)}
              onOpenAppClip={() => onOpenAppClip(message.id)}
            />
          </div>
        )}
        {c.kind === "image" && (
          <div ref={bubbleRef} data-bubble={message.id} {...press} className="max-w-[78%] overflow-hidden rounded-[18px]">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={c.image.src} alt={c.image.alt ?? ""} className="block max-h-[300px] w-full object-cover" />
          </div>
        )}
        {c.kind === "contact" && (
          <div ref={bubbleRef} data-bubble={message.id} {...press}>
            <ContactBubble contact={c.contact} out={out} />
          </div>
        )}
        {c.kind === "audio" && (
          <div ref={bubbleRef} data-bubble={message.id} {...press} className={cn("flex w-full flex-col", out ? "items-end" : "items-start")}>
            <AudioBubble id={message.id} audio={c.audio} out={out} tail={tail} />
          </div>
        )}
        {c.kind === "call" && (
          <div ref={bubbleRef} data-bubble={message.id} {...press} className={cn("bubble", out ? "bubble-out" : "bubble-in", tail && "tail")}>
            {callLogLabel(c.call)}
          </div>
        )}
        <TapbackBadges reactions={reactions} side={out ? "out" : "in"} />
      </div>
    </motion.div>
  );
}

/** Shared contact (vCard) bubble: avatar with initials, name, "Contact" caption, chevron. */
function ContactBubble({ contact, out }: { contact: ContactCard; out: boolean }) {
  const initials = contact.name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join("");
  return (
    <div className={cn("flex w-[262px] items-center gap-3 rounded-[18px] px-3 py-2.5", out ? "bg-imsg-blue text-white" : "bg-imsg-gray text-black")} data-contact={contact.name}>
      <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[#a2a2a8] to-[#6e6e73] text-[16px] font-semibold text-white">
        {initials || "P"}
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[16px] font-semibold leading-tight">{contact.name}</div>
        <div className={cn("truncate text-[13px]", out ? "text-white/75" : "text-black/55")}>{contact.org ?? contact.note ?? "Contact"}</div>
      </div>
      <ChevronRight className={cn("h-4 w-4 shrink-0", out ? "text-white/60" : "text-black/35")} />
    </div>
  );
}

/** Deterministic pseudo-waveform so a bubble looks the same on every render. */
function waveHeights(seed: string, n = 28): number[] {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  return Array.from({ length: n }, (_, i) => {
    h = Math.imul(h ^ (i + 1), 16777619) >>> 0;
    return 0.25 + (h % 1000) / 1000 * 0.75;
  });
}

/** Audio (voicemail) bubble: play, waveform, duration, then the iOS transcription in grey. */
function AudioBubble({ id, audio, out, tail }: { id: string; audio: AudioMessage; out: boolean; tail: boolean }) {
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const el = useRef<HTMLAudioElement | null>(null);
  const bars = waveHeights(id);
  const durationMs = Math.max(0, Math.round(audio.durationSec * 1000));

  useEffect(() => {
    if (!audio.src) return;
    const a = new Audio(audio.src);
    el.current = a;
    const onTime = () => setProgress(a.duration ? a.currentTime / a.duration : 0);
    const onEnd = () => {
      setPlaying(false);
      setProgress(0);
    };
    a.addEventListener("timeupdate", onTime);
    a.addEventListener("ended", onEnd);
    return () => {
      a.pause();
      a.removeEventListener("timeupdate", onTime);
      a.removeEventListener("ended", onEnd);
      el.current = null;
    };
  }, [audio.src]);

  const toggle = () => {
    const a = el.current;
    if (!a) return;
    if (playing) {
      a.pause();
      setPlaying(false);
    } else {
      void a.play().then(() => setPlaying(true)).catch(() => setPlaying(false));
    }
  };

  return (
    <div className="flex max-w-[280px] flex-col" data-audio-message>
      <div className={cn("bubble flex items-center gap-2.5 py-2 pl-2.5 pr-3", out ? "bubble-out" : "bubble-in", tail && !audio.transcript && "tail")} style={{ maxWidth: "none" }}>
        <button
          onClick={toggle}
          disabled={!audio.src}
          aria-label={playing ? "Pause" : "Play"}
          className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-full", out ? "bg-white text-imsg-blue" : "bg-imsg-blue text-white", !audio.src && "opacity-60")}
        >
          {playing ? <Pause className="h-4 w-4 fill-current" /> : <Play className="ml-0.5 h-4 w-4 fill-current" />}
        </button>
        <div className="flex h-6 items-center gap-[2px]" aria-hidden>
          {bars.map((h, i) => (
            <span
              key={i}
              className={cn("w-[2.5px] rounded-full", out ? "bg-white" : "bg-black/70", i / bars.length > progress && "opacity-45")}
              style={{ height: `${Math.round(h * 100)}%` }}
            />
          ))}
        </div>
        <span className={cn("text-[13px] tabular-nums", out ? "text-white/85" : "text-black/60")}>{formatDuration(durationMs)}</span>
      </div>
      {audio.transcript && (
        <div className={cn("mt-1 max-w-[280px] px-1 text-[13px] leading-snug text-black/55", out ? "text-right" : "text-left")}>
          <span className="mr-1 text-[10px] uppercase tracking-wide text-black/35">Transcription</span>
          {audio.transcript}
        </div>
      )}
    </div>
  );
}

/**
 * Bubble effects (Slam, Loud, Gentle, Invisible Ink) with the iOS "Replay"
 * affordance underneath. Invisible ink hides the text until tapped.
 */
function EffectBubble({ effect, children }: { effect?: BubbleEffect; children: React.ReactNode }) {
  const [replay, setReplay] = useState(0);
  const [revealed, setRevealed] = useState(false);
  if (!effect) return <>{children}</>;

  if (effect === "invisibleInk") {
    return (
      <div className="relative" onClick={() => setRevealed((r) => !r)}>
        <div className={cn("transition-[filter] duration-500", revealed ? "" : "blur-[6px]")}>{children}</div>
        {!revealed && <div className="ink-dust pointer-events-none absolute inset-0 rounded-[18px]" />}
      </div>
    );
  }

  const anim =
    effect === "slam"
      ? { initial: { scale: 2.6, rotate: -6, opacity: 0 }, animate: { scale: 1, rotate: 0, opacity: 1 }, transition: { type: "spring" as const, stiffness: 800, damping: 22 } }
      : effect === "loud"
        ? { initial: { scale: 1.7, opacity: 0 }, animate: { scale: [1.7, 1.9, 1], opacity: 1 }, transition: { duration: 0.6, times: [0, 0.4, 1], ease: "easeOut" as const } }
        : { initial: { scale: 0.5, opacity: 0 }, animate: { scale: 1, opacity: 1 }, transition: { duration: 0.9, ease: [0.2, 0.7, 0.2, 1] as [number, number, number, number] } };

  return (
    <div className="flex flex-col items-inherit">
      <motion.div key={replay} {...anim} style={{ transformOrigin: "center" }}>
        {children}
      </motion.div>
      <button onClick={() => setReplay((n) => n + 1)} className="mt-0.5 self-start px-1 text-[11px] font-medium text-imsg-blue">
        Replay
      </button>
    </div>
  );
}

/**
 * iOS inline reply: a smaller, faded copy of the quoted bubble on its sender's
 * side, joined to the reply by a thin hooked line.
 */
function ReplyQuote({ quoted, out }: { quoted: ChatMessage; out: boolean }) {
  const quotedOut = quoted.role === "user";
  const sameSide = quotedOut === out;
  return (
    <div className="mb-[2px] flex w-full flex-col">
      <div className={cn("bubble max-w-[62%] px-2.5 py-1 text-[13px] leading-[17px] opacity-70", quotedOut ? "bubble-out self-end!" : "bubble-in self-start!")}>
        <span className="line-clamp-2">{messageText(quoted)}</span>
      </div>
      <div
        className={cn(
          "h-[16px] border-black/20",
          sameSide
            ? out
              ? "mr-4 w-[12px] self-end rounded-br-[10px] border-b-[1.5px] border-r-[1.5px]"
              : "ml-4 w-[12px] self-start rounded-bl-[10px] border-b-[1.5px] border-l-[1.5px]"
            : quotedOut
              ? "mr-4 w-[calc(100%-4.5rem)] self-end rounded-br-[12px] border-b-[1.5px] border-r-[1.5px]"
              : "ml-4 w-[calc(100%-4.5rem)] self-start rounded-bl-[12px] border-b-[1.5px] border-l-[1.5px]",
        )}
      />
    </div>
  );
}
