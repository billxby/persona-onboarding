"use client";

import { Database, Ellipsis, History, PhoneIncoming, RotateCcw, Sparkles, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { callController } from "@/lib/call/controller";
import { demoLabel, loadDemoSession, useDemoSessions } from "@/lib/session/demos";
import { restartSimulation, restoreRun, useRunsStore } from "@/lib/session/runs";
import { useSessionStore } from "@/lib/session/store";
import { cn } from "@/lib/utils";

/**
 * Bottom-right control, kept short: behind the scenes, ring the phone, restart; then the DEMO
 * sessions and the last couple of runs. Everything else (Contacts toggle, sending the card,
 * Gmail) lives on /db or in the thread itself.
 */
export function StageMenu() {
  const [open, setOpen] = useState(false);
  const runs = useRunsStore((s) => s.runs);
  const demos = useDemoSessions();
  const sessionId = useSessionStore((s) => s.sessionId);
  const phase = useSessionStore((s) => s.phase);
  const callState = useSessionStore((s) => s.call.state);
  const messageCount = useSessionStore((s) => s.messages.length);
  const connection = useSessionStore((s) => s.connection);

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
            className="w-[300px] overflow-hidden rounded-2xl border border-line bg-panel/90 text-ink shadow-[0_20px_60px_-15px_rgba(0,0,0,0.35)] backdrop-blur-xl"
          >
            <div className="flex items-center justify-between px-4 pt-3.5 pb-2">
              <div>
                <div className="text-[13px] font-semibold">Simulation</div>
                <div className="font-mono text-[11px] text-ink/45">
                  {sessionId.slice(0, 8)} · {phase} · {messageCount} msgs
                </div>
              </div>
              <span className={cn("flex items-center gap-1.5 text-[11px]", connection === "realtime" ? "text-emerald-700" : connection === "polling" ? "text-amber-700" : "text-rose-700")}>
                <span className={cn("h-1.5 w-1.5 rounded-full", connection === "realtime" ? "animate-pulse bg-emerald-500" : connection === "polling" ? "bg-amber-400" : "bg-rose-500")} />
                {connection}
              </span>
            </div>

            <div className="px-2 pb-1.5">
              <MenuLink href="/db" icon={Database} label="Behind the scenes" hint="new tab, syncs live" />
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

            {demos.length > 0 && (
              <>
                <SectionHead icon={Sparkles}>Demo sessions</SectionHead>
                {/* prepared paths, on the server, loadable from any browser */}
                <div className="max-h-[104px] overflow-y-auto px-2 pb-1 [scrollbar-width:thin]" data-stage-demos>
                  {demos.map((d) => (
                    <Row
                      key={d.id}
                      testId={d.id}
                      disabled={d.id === sessionId}
                      onClick={() => {
                        callController.end("user_hangup");
                        loadDemoSession(d.id);
                        setOpen(false);
                      }}
                      title={
                        <>
                          <span className="rounded-[4px] bg-ink px-1 py-px font-mono text-[9px] font-bold uppercase tracking-wider text-panel">demo</span>
                          <span className="truncate">{demoLabel(d)}</span>
                        </>
                      }
                      sub={`${d.id.slice(0, 8)} · ${d.messages} msgs · ${d.gmail_status === "connected" ? "gmail" : d.phase}`}
                      action={d.id === sessionId ? "Loaded" : "Load"}
                    />
                  ))}
                </div>
              </>
            )}

            <SectionHead
              icon={History}
              right={
                runs.length > 0 ? (
                  <button onClick={() => useRunsStore.getState().clear()} className="normal-case tracking-normal text-ink/45 hover:text-ink" data-stage-clear-runs>
                    clear
                  </button>
                ) : null
              }
            >
              Previous runs
            </SectionHead>
            {/* two rows tall; the rest scrolls */}
            <div className="max-h-[104px] overflow-y-auto px-2 pb-2 [scrollbar-width:thin]" data-stage-runs>
              {runs.length === 0 && <div className="px-2 py-2 text-[12px] text-ink/40">None yet. Restart to archive this one.</div>}
              {runs.map((r) => (
                <Row
                  key={r.id}
                  onClick={() => {
                    restoreRun(r.id);
                    setOpen(false);
                  }}
                  title={<span className="truncate">{r.slots.user_name.value ? `${r.slots.user_name.value}` : "Anonymous"} · {r.messages.length} msgs</span>}
                  sub={`${new Date(r.createdAt).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })} · ${r.phase}`}
                  action="Restore"
                />
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <button
        onClick={() => setOpen((o) => !o)}
        aria-label="Simulation menu"
        className={cn(
          "flex h-11 w-11 items-center justify-center rounded-full border border-line bg-panel/90 text-ink/70 shadow-[0_8px_30px_-8px_rgba(0,0,0,0.35)] backdrop-blur-xl transition hover:bg-panel",
          open && "bg-ink text-panel hover:bg-ink",
        )}
      >
        {open ? <X className="h-5 w-5" /> : <Ellipsis className="h-5 w-5" />}
      </button>
    </div>
  );
}

function SectionHead({ icon: Icon, children, right }: { icon: React.ComponentType<{ className?: string }>; children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between border-t border-line px-4 pt-2 pb-1 text-[11px] font-semibold uppercase tracking-wider text-ink/40">
      <span className="flex items-center gap-1.5">
        <Icon className="h-3 w-3" /> {children}
      </span>
      {right}
    </div>
  );
}

/** One 52 px row: a title line, a small sub line, an action word on the right. */
function Row({ title, sub, action, onClick, disabled, testId }: { title: React.ReactNode; sub: string; action: string; onClick: () => void; disabled?: boolean; testId?: string }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      data-stage-demo={testId}
      className="flex h-[52px] w-full items-center justify-between gap-2 rounded-lg px-2 text-left hover:bg-ink/5 disabled:opacity-50 disabled:hover:bg-transparent"
    >
      <div className="min-w-0">
        <div className="flex items-center gap-1.5 text-[13px]">{title}</div>
        <div className="truncate font-mono text-[11px] text-ink/45">{sub}</div>
      </div>
      <span className="shrink-0 text-[11px] text-imsg-blue">{action}</span>
    </button>
  );
}

function MenuLink({ href, icon: Icon, label, hint }: { href: string; icon: React.ComponentType<{ className?: string }>; label: string; hint?: string }) {
  return (
    <Link href={href} target="_blank" className="flex items-center gap-3 rounded-xl px-2 py-1.5 hover:bg-ink/5">
      <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-ink/5"><Icon className="h-4 w-4" /></span>
      <span className="min-w-0">
        <span className="block text-[13px] font-medium">{label}</span>
        {hint && <span className="block text-[11px] text-ink/45">{hint}</span>}
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
    <button onClick={onClick} disabled={disabled} className="flex w-full items-center gap-3 rounded-xl px-2 py-1.5 text-left hover:bg-ink/5 disabled:opacity-40 disabled:hover:bg-transparent">
      <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-ink/5"><Icon className="h-4 w-4" /></span>
      <span className="min-w-0">
        <span className="block text-[13px] font-medium">{label}</span>
        {hint && <span className="block text-[11px] text-ink/45">{hint}</span>}
      </span>
    </button>
  );
}
