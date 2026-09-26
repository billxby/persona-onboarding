"use client";

import { Database, Ellipsis, History, PhoneIncoming, RotateCcw, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { callController } from "@/lib/call/controller";
import { restartSimulation, restoreRun, useRunsStore } from "@/lib/session/runs";
import { useSessionStore } from "@/lib/session/store";
import { cn } from "@/lib/utils";

/**
 * Bottom-right control: open the behind-the-scenes page, restart the
 * simulation, ring the phone, or pick up a previous run.
 */
export function StageMenu() {
  const [open, setOpen] = useState(false);
  const runs = useRunsStore((s) => s.runs);
  const sessionId = useSessionStore((s) => s.sessionId);
  const phase = useSessionStore((s) => s.phase);
  const callState = useSessionStore((s) => s.call.state);
  const messageCount = useSessionStore((s) => s.messages.length);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <div className="fixed bottom-5 right-5 z-50 flex flex-col items-end gap-3">
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: 12, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.96 }}
            transition={{ type: "spring", stiffness: 420, damping: 32 }}
            className="w-[300px] overflow-hidden rounded-2xl border border-black/10 bg-white/90 shadow-[0_20px_60px_-15px_rgba(0,0,0,0.35)] backdrop-blur-xl"
          >
            <div className="flex items-center justify-between px-4 pt-3.5 pb-2">
              <div>
                <div className="text-[13px] font-semibold">Simulation</div>
                <div className="font-mono text-[11px] text-black/45">
                  {sessionId.slice(0, 8)} · {phase} · {messageCount} msgs
                </div>
              </div>
              <span className="flex items-center gap-1.5 text-[11px] text-emerald-700">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" />
                live
              </span>
            </div>

            <div className="px-2 pb-2">
              <MenuLink href="/db" icon={Database} label="Behind the scenes" hint="opens in a new tab, syncs live" />
              <MenuButton
                icon={PhoneIncoming}
                label="Incoming call"
                hint="ring the phone now"
                disabled={callState !== "idle" && callState !== "ended"}
                onClick={() => {
                  callController.ring();
                  setOpen(false);
                }}
              />
              <MenuButton
                icon={RotateCcw}
                label="Restart simulation"
                hint="archives this run, starts fresh"
                onClick={() => {
                  callController.end("user_hangup");
                  restartSimulation();
                  setOpen(false);
                }}
              />
            </div>

            <div className="border-t border-black/10 px-4 pt-2.5 pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-black/40">
              <span className="flex items-center gap-1.5">
                <History className="h-3 w-3" /> Previous runs
              </span>
            </div>
            <div className="max-h-[200px] overflow-y-auto px-2 pb-2">
              {runs.length === 0 && <div className="px-2 py-2 text-[12px] text-black/40">None yet. Restart to archive this one.</div>}
              {runs.slice(0, 8).map((r) => (
                <button
                  key={r.id}
                  onClick={() => {
                    restoreRun(r.id);
                    setOpen(false);
                  }}
                  className="flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-left hover:bg-black/5"
                >
                  <div className="min-w-0">
                    <div className="truncate text-[13px]">
                      {r.slots.user_name.value ? `${r.slots.user_name.value}` : "Anonymous"} · {r.messages.length} msgs
                    </div>
                    <div className="text-[11px] text-black/45">
                      {new Date(r.createdAt).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })} · {r.phase}
                    </div>
                  </div>
                  <span className="text-[11px] text-imsg-blue">Restore</span>
                </button>
              ))}
              {runs.length > 8 && (
                <Link href="/db#runs" target="_blank" className="block px-2 py-1.5 text-[12px] text-imsg-blue">
                  See all {runs.length} runs
                </Link>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <button
        onClick={() => setOpen((o) => !o)}
        aria-label="Simulation menu"
        className={cn(
          "flex h-11 w-11 items-center justify-center rounded-full border border-black/10 bg-white/90 text-black/70 shadow-[0_8px_30px_-8px_rgba(0,0,0,0.35)] backdrop-blur-xl transition hover:bg-white",
          open && "bg-black text-white hover:bg-black",
        )}
      >
        {open ? <X className="h-5 w-5" /> : <Ellipsis className="h-5 w-5" />}
      </button>
    </div>
  );
}

function MenuLink({ href, icon: Icon, label, hint }: { href: string; icon: React.ComponentType<{ className?: string }>; label: string; hint?: string }) {
  return (
    <Link href={href} target="_blank" className="flex items-center gap-3 rounded-xl px-2 py-2 hover:bg-black/5">
      <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-black/5"><Icon className="h-4 w-4" /></span>
      <span className="min-w-0">
        <span className="block text-[13px] font-medium">{label}</span>
        {hint && <span className="block text-[11px] text-black/45">{hint}</span>}
      </span>
    </Link>
  );
}

function MenuButton({
  icon: Icon,
  label,
  hint,
  onClick,
  disabled,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  hint?: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button onClick={onClick} disabled={disabled} className="flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left hover:bg-black/5 disabled:opacity-40 disabled:hover:bg-transparent">
      <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-black/5"><Icon className="h-4 w-4" /></span>
      <span className="min-w-0">
        <span className="block text-[13px] font-medium">{label}</span>
        {hint && <span className="block text-[11px] text-black/45">{hint}</span>}
      </span>
    </button>
  );
}
