"use client";

import { PhoneIncoming, PhoneOff, RotateCcw, Send, Unplug } from "lucide-react";
import { useState } from "react";
import { callController } from "@/lib/call/controller";
import { useSessionStore } from "@/lib/session/store";
import { SLOT_LABELS, SLOT_ORDER, type SlotKey, type SlotStatus } from "@/lib/session/types";
import { cn } from "@/lib/utils";
import { SlotChips } from "@/components/progress/SlotChips";

/**
 * Developer side panel. Shows the session the way the backend will see it and
 * lets you poke every state transition by hand until the brain exists.
 */
export function SessionInspector() {
  const s = useSessionStore();
  const [speech, setSpeech] = useState("");
  const inCall = s.call.state === "live" || s.call.state === "connecting";

  return (
    <aside className="flex h-full w-[420px] shrink-0 flex-col gap-4 overflow-y-auto rounded-2xl border border-black/10 bg-white p-4 text-[13px] shadow-sm">
      <Section title="Progress">
        <SlotChips slots={s.slots} />
      </Section>

      <Section title="Slots">
        <div className="space-y-2">
          {SLOT_ORDER.map((key) => (
            <SlotRow key={key} slotKey={key} />
          ))}
        </div>
      </Section>

      <Section title="Session">
        <div className="grid grid-cols-3 gap-2">
          <Field label="phase" value={s.phase} />
          <Field label="channel" value={s.channel} />
          <Field label="call" value={s.call.state} />
          <Field label="screen" value={s.screen} />
          <Field label="end reason" value={s.call.endReason ?? "—"} />
          <Field label="voice" value={callController.transportKind ?? "—"} />
        </div>
      </Section>

      <Section title="Drive the call">
        <div className="flex flex-wrap gap-2">
          <Btn onClick={() => callController.ring()} disabled={s.call.state === "ringing" || inCall} icon={PhoneIncoming}>
            Incoming call
          </Btn>
          <Btn onClick={() => callController.end("dropped")} disabled={!inCall && s.call.state !== "ringing"} icon={Unplug} tone="warn">
            Simulate drop
          </Btn>
          <Btn onClick={() => callController.end("silence")} disabled={!inCall} icon={PhoneOff} tone="warn">
            Silence timeout
          </Btn>
        </div>
        <form
          className="mt-2 flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (!speech.trim()) return;
            callController.injectUserSpeech(speech.trim());
            setSpeech("");
          }}
        >
          <input
            value={speech}
            onChange={(e) => setSpeech(e.target.value)}
            disabled={!inCall}
            placeholder={inCall ? "Inject user speech (mock STT)…" : "Answer a call to inject speech"}
            className="flex-1 rounded-lg border border-black/15 px-2.5 py-1.5 outline-none focus:border-imsg-blue disabled:bg-black/5"
          />
          <Btn type="submit" disabled={!inCall || !speech.trim()} icon={Send}>
            Say
          </Btn>
        </form>
      </Section>

      <Section title={`Events (${s.events.length})`} right={<button onClick={() => useSessionStore.setState({ events: [] })} className="text-black/45 hover:text-black">clear</button>}>
        <div className="max-h-[260px] space-y-1 overflow-y-auto rounded-lg bg-[#f6f6f8] p-2 font-mono text-[11px]">
          {s.events.length === 0 && <div className="text-black/40">No events yet.</div>}
          {[...s.events].reverse().map((e) => (
            <div key={e.id} className="flex gap-2">
              <span className="shrink-0 text-black/40">{new Date(e.ts).toLocaleTimeString([], { hour12: false })}</span>
              <span className={cn("shrink-0 font-semibold", e.type.startsWith("call.") ? "text-emerald-700" : e.type.startsWith("mock.") ? "text-violet-700" : e.type.startsWith("user.") ? "text-imsg-blue" : "text-black/80")}>
                {e.type}
              </span>
              {e.payload && <span className="truncate text-black/60">{JSON.stringify(e.payload)}</span>}
            </div>
          ))}
        </div>
      </Section>

      <div className="mt-auto flex items-center justify-between pt-2 text-black/45">
        <span className="font-mono text-[11px]">session {s.sessionId.slice(0, 8)}</span>
        <Btn onClick={() => { callController.end("user_hangup"); s.reset(); }} icon={RotateCcw} tone="danger">
          Reset session
        </Btn>
      </div>
    </aside>
  );
}

function SlotRow({ slotKey }: { slotKey: SlotKey }) {
  const slot = useSessionStore((st) => st.slots[slotKey]);
  const setSlot = useSessionStore((st) => st.setSlot);
  const statuses: SlotStatus[] = ["empty", "pending", "filled", "skipped", "declined", "failed"];
  return (
    <div className="flex items-center gap-2">
      <span className="w-[76px] shrink-0 text-black/60">{SLOT_LABELS[slotKey]}</span>
      <input
        value={slot.value ?? ""}
        onChange={(e) => setSlot(slotKey, { value: e.target.value, status: e.target.value ? "filled" : slot.status === "filled" ? "empty" : slot.status })}
        placeholder="value"
        className="min-w-0 flex-1 rounded-lg border border-black/15 px-2 py-1 outline-none focus:border-imsg-blue"
      />
      <select
        value={slot.status}
        onChange={(e) => setSlot(slotKey, { status: e.target.value as SlotStatus })}
        className="rounded-lg border border-black/15 bg-white px-1.5 py-1"
      >
        {statuses.map((st) => (
          <option key={st}>{st}</option>
        ))}
      </select>
    </div>
  );
}

function Section({ title, children, right }: { title: string; children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <section>
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-[11px] font-semibold uppercase tracking-wider text-black/45">{title}</h3>
        {right}
      </div>
      {children}
    </section>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-[#f6f6f8] px-2.5 py-1.5">
      <div className="text-[10px] uppercase tracking-wide text-black/40">{label}</div>
      <div className="font-mono text-[12px]">{value}</div>
    </div>
  );
}

function Btn({
  children,
  icon: Icon,
  tone = "default",
  className,
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  icon?: React.ComponentType<{ className?: string }>;
  tone?: "default" | "warn" | "danger";
}) {
  return (
    <button
      {...rest}
      className={cn(
        "flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 font-medium transition active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40",
        tone === "default" && "border-black/15 bg-white hover:bg-black/5",
        tone === "warn" && "border-amber-300 bg-amber-50 text-amber-900 hover:bg-amber-100",
        tone === "danger" && "border-rose-200 bg-rose-50 text-rose-800 hover:bg-rose-100",
        className,
      )}
    >
      {Icon && <Icon className="h-3.5 w-3.5" />}
      {children}
    </button>
  );
}
