"use client";

import { AppWindow, Database, Ellipsis, History, PhoneIncoming, RotateCcw, UserRoundPlus, UserRoundX, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { getBrain } from "@/lib/brain";
import { callController } from "@/lib/call/controller";
import { restartSimulation, restoreRun, useRunsStore } from "@/lib/session/runs";
import { session, useSessionStore } from "@/lib/session/store";
import { cn } from "@/lib/utils";

/** "Send App Clip card": the bot drops the Meet-your-Persona App Clip link into the thread. */
async function sendAppClipCard() {
  const st = session.get();
  st.logEvent("user.send_app_clip");
  try {
    const res = await fetch("/api/tools/send_app_clip", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ session_id: st.sessionId, input: { reason: "menu" } }),
    });
    if (!res.ok) session.get().logEvent("app_clip.send_failed", { status: res.status });
    await getBrain().refresh?.();
  } catch (e) {
    session.get().logEvent("app_clip.send_failed", { error: String(e) });
  }
}

/**
 * Bottom-right control: open the behind-the-scenes page, ring the phone, send the
 * App Clip card, toggle Contacts, restart, or pick up a previous run. Gmail is connected
 * from the App Clip's Google screen or the connect card, not from here.
 */
export function StageMenu() {
  const [open, setOpen] = useState(false);
  const runs = useRunsStore((s) => s.runs);
  const sessionId = useSessionStore((s) => s.sessionId);
  const phase = useSessionStore((s) => s.phase);
  const callState = useSessionStore((s) => s.call.state);
  const messageCount = useSessionStore((s) => s.messages.length);
  const senderInContacts = useSessionStore((s) => s.senderInContacts);
  const setSenderInContacts = useSessionStore((s) => s.setSenderInContacts);
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
                icon={AppWindow}
                label="Send App Clip card"
                hint={senderInContacts ? "the App Clip: Persona's onboarding, full screen" : "add Persona to Contacts first, or it renders as a plain link"}
                onClick={() => {
                  void sendAppClipCard();
                  setOpen(false);
                }}
              />
              <MenuButton
                icon={senderInContacts ? UserRoundX : UserRoundPlus}
                label={senderInContacts ? "Remove Persona from Contacts" : "Add Persona to Contacts"}
                hint={senderInContacts ? "iOS shows unknown senders a plain link that opens Safari" : "App Clip cards only render for senders in Contacts (default on)"}
                onClick={() => setSenderInContacts(!senderInContacts)}
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

            <div className="border-t border-line px-4 pt-2.5 pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-ink/40">
              <span className="flex items-center gap-1.5">
                <History className="h-3 w-3" /> Previous runs
              </span>
            </div>
            {/* three rows tall; the rest scrolls */}
            <div className="max-h-[168px] overflow-y-auto px-2 pb-2 [scrollbar-width:thin]" data-stage-runs>
              {runs.length === 0 && <div className="px-2 py-2 text-[12px] text-ink/40">None yet. Restart to archive this one.</div>}
              {runs.map((r) => (
                <button
                  key={r.id}
                  onClick={() => {
                    restoreRun(r.id);
                    setOpen(false);
                  }}
                  className="flex h-[52px] w-full items-center justify-between rounded-lg px-2 text-left hover:bg-ink/5"
                >
                  <div className="min-w-0">
                    <div className="truncate text-[13px]">
                      {r.slots.user_name.value ? `${r.slots.user_name.value}` : "Anonymous"} · {r.messages.length} msgs
                    </div>
                    <div className="text-[11px] text-ink/45">
                      {new Date(r.createdAt).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })} · {r.phase}
                    </div>
                  </div>
                  <span className="text-[11px] text-imsg-blue">Restore</span>
                </button>
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

function MenuLink({ href, icon: Icon, label, hint }: { href: string; icon: React.ComponentType<{ className?: string }>; label: string; hint?: string }) {
  return (
    <Link href={href} target="_blank" className="flex items-center gap-3 rounded-xl px-2 py-2 hover:bg-ink/5">
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
    <button onClick={onClick} disabled={disabled} className="flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left hover:bg-ink/5 disabled:opacity-40 disabled:hover:bg-transparent">
      <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-ink/5"><Icon className="h-4 w-4" /></span>
      <span className="min-w-0">
        <span className="block text-[13px] font-medium">{label}</span>
        {hint && <span className="block text-[11px] text-ink/45">{hint}</span>}
      </span>
    </button>
  );
}
