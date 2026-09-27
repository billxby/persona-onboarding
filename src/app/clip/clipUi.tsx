"use client";

import { Check, ChevronRight, X } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

/**
 * The App Clip's design system (DESIGN §19): a warm canvas, a display serif for the one headline
 * per screen, system text for everything else, hairline borders, 20px cards, and a single dark
 * pill. iMessage blue appears only inside chat mockups. Tokens live in globals.css (`clip-*`).
 */

export function Headline({ children, className }: { children: React.ReactNode; className?: string }) {
  return <h1 className={cn("font-display text-[40px] leading-[1.02] tracking-[-0.01em] text-clip-ink", className)}>{children}</h1>;
}

export function Sub({ children, className }: { children: React.ReactNode; className?: string }) {
  return <p className={cn("text-[17px] leading-[24px] text-clip-ink/60", className)}>{children}</p>;
}

export function Eyebrow({ children }: { children: React.ReactNode }) {
  return <div className="text-[12px] font-semibold uppercase tracking-[0.12em] text-clip-ink/45">{children}</div>;
}

export function PrimaryButton({
  children,
  onClick,
  disabled,
  busy,
  testId,
  type = "button",
}: {
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  busy?: boolean;
  testId?: string;
  type?: "button" | "submit";
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled || busy}
      data-clip-next={testId ?? "primary"}
      className="clip-btn-primary relative flex h-[52px] w-full items-center justify-center rounded-full text-[17px] font-semibold tracking-[-0.1px] transition-[filter,opacity] disabled:cursor-default"
    >
      <span className={cn(busy && "opacity-0")}>{children}</span>
      {busy && (
        <span className="absolute inset-0 flex items-center justify-center" aria-label="Saving">
          <span className="h-[18px] w-[18px] animate-spin rounded-full border-2 border-white/30 border-t-white dark:border-black/20 dark:border-t-black" />
        </span>
      )}
    </button>
  );
}

export function SecondaryButton({ children, onClick, disabled, testId, icon }: { children: React.ReactNode; onClick?: () => void; disabled?: boolean; testId?: string; icon?: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      data-clip-secondary={testId ?? "secondary"}
      className="flex h-[52px] w-full items-center justify-center gap-2.5 rounded-full border border-clip-line bg-clip-card text-[17px] font-semibold tracking-[-0.1px] text-clip-ink active:bg-clip-ink/[0.04] disabled:opacity-40"
    >
      {icon}
      {children}
    </button>
  );
}

export function TextLink({ children, onClick, testId, className }: { children: React.ReactNode; onClick?: () => void; testId?: string; className?: string }) {
  return (
    <button type="button" onClick={onClick} data-clip-link={testId ?? "link"} className={cn("mx-auto block px-3 py-2 text-[15px] font-medium text-clip-ink/55 active:text-clip-ink", className)}>
      {children}
    </button>
  );
}

export function GhostClose({ onClick, label = "Close" }: { onClick: () => void; label?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      data-clip-skip
      className="flex h-[34px] min-w-[34px] items-center justify-center rounded-full bg-clip-ink/[0.06] px-2 text-[14px] font-medium text-clip-ink/70 active:bg-clip-ink/10"
    >
      {label === "Close" ? <X className="h-4 w-4" strokeWidth={2.5} /> : label}
    </button>
  );
}

export function Dots({ count, index }: { count: number; index: number }) {
  return (
    <div className="flex items-center gap-1.5" data-clip-page={index}>
      {Array.from({ length: count }).map((_, i) => (
        <span key={i} className={cn("h-[6px] rounded-full transition-all duration-300", i === index ? "w-[18px] bg-clip-ink" : "w-[6px] bg-clip-ink/20")} />
      ))}
    </div>
  );
}

export function Field({
  value,
  onChange,
  placeholder,
  autoFocus,
  onSubmit,
  error,
  testId,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  autoFocus?: boolean;
  onSubmit?: () => void;
  error?: string | null;
  testId?: string;
}) {
  return (
    <div>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoFocus={autoFocus}
        autoComplete="off"
        autoCapitalize="words"
        enterKeyHint="next"
        data-clip-input={testId ?? "field"}
        onKeyDown={(e) => {
          if (e.key === "Enter" && onSubmit) {
            e.preventDefault();
            onSubmit();
          }
        }}
        className={cn(
          "h-[60px] w-full rounded-[18px] border bg-clip-card px-5 text-[24px] tracking-[-0.2px] text-clip-ink outline-none placeholder:text-clip-ink/30 focus:border-clip-ink/40",
          error ? "border-ios-red" : "border-clip-line",
        )}
      />
      <AnimatePresence initial={false}>
        {error && (
          <motion.p initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="mt-2 px-1 text-[14px] leading-snug text-ios-red" data-clip-error>
            {error}
          </motion.p>
        )}
      </AnimatePresence>
    </div>
  );
}

export function Chip({ children, onClick, selected, testId }: { children: React.ReactNode; onClick: () => void; selected?: boolean; testId?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-clip-chip={testId ?? String(children)}
      className={cn(
        "h-[38px] rounded-full border px-4 text-[15px] font-medium transition-colors",
        selected ? "border-clip-ink bg-clip-ink text-clip-bg" : "border-clip-line bg-clip-card text-clip-ink active:bg-clip-ink/[0.04]",
      )}
    >
      {children}
    </button>
  );
}

export function CheckRow({ children, done = true }: { children: React.ReactNode; done?: boolean }) {
  return (
    <li className="flex items-start gap-3 py-3 text-[16px] leading-[22px] text-clip-ink/85">
      <span className={cn("mt-[3px] flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full", done ? "bg-clip-ink text-clip-bg" : "border border-clip-line")}>{done && <Check className="h-3 w-3" strokeWidth={3} />}</span>
      <span>{children}</span>
    </li>
  );
}

/** Springy check for a step that just completed (Google connected, you're set). */
export function BigCheck() {
  const reduce = useReducedMotion();
  return (
    <motion.div
      initial={reduce ? false : { scale: 0.6, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      transition={{ type: "spring", stiffness: 420, damping: 22 }}
      className="flex h-[72px] w-[72px] items-center justify-center rounded-full bg-ios-green text-white"
      data-clip-check
    >
      <Check className="h-9 w-9" strokeWidth={3} />
    </motion.div>
  );
}

/** Google's four-colour G, for the Continue with Google button. */
export function GoogleG({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 48 48" className={cn("h-5 w-5", className)} aria-hidden>
      <path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.5l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.5 5.4 2.6 13.3l7.9 6.1C12.4 13.6 17.7 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v8.5h12.7c-.6 3-2.3 5.5-4.8 7.2l7.5 5.8c4.4-4.1 7.1-10.1 7.1-17z" />
      <path fill="#FBBC05" d="M10.5 28.6A14.5 14.5 0 0 1 9.5 24c0-1.6.3-3.2.8-4.6l-7.9-6.1A24 24 0 0 0 0 24c0 3.9.9 7.5 2.6 10.7l7.9-6.1z" />
      <path fill="#34A853" d="M24 48c6.3 0 11.7-2.1 15.6-5.7l-7.5-5.8c-2.1 1.4-4.8 2.3-8.1 2.3-6.3 0-11.6-4.1-13.5-9.9l-7.9 6.1C6.5 42.6 14.6 48 24 48z" />
    </svg>
  );
}

/** "Get the Persona app" hairline strip under the screens (SKOverlay in the native clip). */
export function GetAppStrip({ label, onTap, onDismiss }: { label: string; onTap: () => void; onDismiss: () => void }) {
  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 8 }} className="flex items-center gap-2 border-t border-clip-line px-5 pb-[10px] pt-[10px]" data-clip-get-app-strip>
      <button type="button" onClick={onTap} className="flex min-w-0 flex-1 items-center gap-3 text-left active:opacity-70" data-clip-get-app>
        <span className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-[9px] bg-white ring-1 ring-black/[0.08]">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/persona-icon-512.png" alt="" className="h-full w-full object-cover" draggable={false} />
        </span>
        <span className="min-w-0 flex-1 truncate text-[14px] font-medium text-clip-ink/80">{label}</span>
        <span className="flex shrink-0 items-center text-[13px] font-medium text-clip-ink/45">
          App Store
          <ChevronRight className="h-3.5 w-3.5" strokeWidth={2.5} />
        </span>
      </button>
      <button type="button" onClick={onDismiss} aria-label="Dismiss" className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-clip-ink/35 active:bg-clip-ink/[0.06]">
        <X className="h-3.5 w-3.5" strokeWidth={2.5} />
      </button>
    </motion.div>
  );
}

// ---------------------------------------------------------------------------
// the mock iMessage thread on the value screens: bubbles arrive one by one
// ---------------------------------------------------------------------------

export interface MockBubble {
  from: "user" | "persona";
  text: string;
}

const BUBBLE_MS = 700;
const TYPING_MS = 650;

/** Mount it with a `key` per page: the reveal restarts by remounting, never by resetting state in an effect. */
export function MockThread({ thread, active = true }: { thread: MockBubble[]; active?: boolean }) {
  const reduce = useReducedMotion();
  const [shown, setShown] = useState(0);
  const [typing, setTyping] = useState(false);
  const visible = reduce ? thread.length : shown;

  useEffect(() => {
    if (reduce || !active) return;
    let i = 0;
    let t: ReturnType<typeof setTimeout>;
    const step = () => {
      if (i >= thread.length) return;
      const next = thread[i];
      if (next.from === "persona") {
        setTyping(true);
        t = setTimeout(() => {
          setTyping(false);
          i += 1;
          setShown(i);
          t = setTimeout(step, BUBBLE_MS);
        }, TYPING_MS);
      } else {
        i += 1;
        setShown(i);
        t = setTimeout(step, BUBBLE_MS);
      }
    };
    t = setTimeout(step, 350);
    return () => clearTimeout(t);
  }, [thread, active, reduce]);

  return (
    <div className="clip-card clip-thread flex min-h-[210px] flex-col gap-[6px] px-4 py-4" data-clip-thread>
      {thread.slice(0, visible).map((b, i) => (
        <motion.div
          key={i}
          initial={reduce ? false : { opacity: 0, y: 10, scale: 0.96 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ type: "spring", stiffness: 420, damping: 30 }}
          className={cn("bubble", b.from === "user" ? "bubble-out" : "bubble-in")}
          data-clip-bubble={b.from}
        >
          {b.text}
        </motion.div>
      ))}
      <AnimatePresence>
        {typing && (
          <motion.div key="typing" initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.8 }} className="bubble bubble-in flex items-center gap-1 px-3.5 py-3" aria-hidden>
            <span className="typing-dot" />
            <span className="typing-dot" />
            <span className="typing-dot" />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/** Persona's mark on its tile, the way iOS shows an app icon. */
export function Mark({ size = 96, className }: { size?: number; className?: string }) {
  return (
    <div className={cn("flex items-center justify-center overflow-hidden rounded-[28%] bg-white shadow-[0_8px_30px_-12px_rgba(0,0,0,0.25)] ring-1 ring-black/[0.06]", className)} style={{ width: size, height: size }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/brand/persona-icon-512.png" alt="Persona" width={size} height={size} className="h-full w-full object-cover" draggable={false} />
    </div>
  );
}

export function Wordmark({ className }: { className?: string }) {
  // the SVG uses currentColor, which an <img> renders black: invert it on the dark canvas
  // eslint-disable-next-line @next/next/no-img-element
  return <img src="/brand/persona-wordmark.svg" alt="Persona" className={cn("h-[22px] w-auto dark:invert", className)} draggable={false} />;
}
