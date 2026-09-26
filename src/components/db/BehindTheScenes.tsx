"use client";

import { ArrowUpRight, Pencil, PhoneIncoming, PhoneOff, Send, Trash2, Unplug } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { callController } from "@/lib/call/controller";
import { restartSimulation, restoreRun, useRunsStore } from "@/lib/session/runs";
import { SESSION_STORAGE_KEY, useSessionStore } from "@/lib/session/store";
import { SLOT_LABELS, SLOT_ORDER, callLogLabel, messageText, type SlotKey, type SlotStatus } from "@/lib/session/types";
import { useCrossTabSync } from "@/lib/session/useCrossTabSync";
import { eligibility } from "@/lib/memory/intentions";
import type { BeliefStatus, IntentionStatus } from "@/lib/shared/types";
import { cn, formatDuration } from "@/lib/utils";
import { useHydrated } from "@/components/Simulator";
import { SlotChips } from "@/components/progress/SlotChips";
import { editSlot } from "@/components/progress/slotEdit";
import { Button, Card, KV, Pill, fmtDateTime, fmtTime } from "./ui";
import { useBrainView } from "./useBrainView";

const SLOT_TONE: Record<SlotStatus, "neutral" | "green" | "amber" | "red" | "blue" | "violet"> = {
  empty: "neutral",
  pending: "amber",
  filled: "green",
  skipped: "neutral",
  declined: "red",
  failed: "red",
};

/**
 * "Behind the scenes": the session exactly as the backend will see it,
 * mirrored live from whatever the phone is doing in the other tab.
 */
export function BehindTheScenes() {
  useCrossTabSync();
  useBrainView();
  const hydrated = useHydrated();
  const s = useSessionStore();

  if (!hydrated) return <div className="p-10 text-black/40">Loading session…</div>;

  return (
    <main className="min-h-dvh bg-[#fafafa] text-[#111]">
      <TopBar />
      <div className="mx-auto max-w-[1180px] px-6 pb-16">
        <Hero />

        <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
          <div className="flex flex-col gap-5 lg:col-span-2">
            <SlotTracker />
            <BrainCard />
            <MindCard />
            <Transcript />
            <EventLog />
          </div>
          <div className="flex flex-col gap-5">
            <SessionCard />
            <CallCard />
            <RunsCard />
            <StorageCard />
          </div>
        </div>
      </div>
      <span hidden>{s.sessionId}</span>
    </main>
  );
}

function TopBar() {
  const connection = useSessionStore((st) => st.connection);
  return (
    <div className="sticky top-0 z-20 border-b border-black/[0.06] bg-[#fafafa]/85 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-[1180px] items-center justify-between px-6">
        <div className="flex items-center gap-3">
          <span className="text-[15px] font-semibold tracking-tight">Persona</span>
          <span className="text-black/25">/</span>
          <span className="text-[14px] text-black/70">Behind the scenes</span>
        </div>
        <div className="flex items-center gap-4">
          <span className="flex items-center gap-1.5 text-[12px] text-black/55">
            <span className={cn("h-1.5 w-1.5 rounded-full", connection === "realtime" ? "animate-pulse bg-emerald-500" : connection === "polling" ? "bg-amber-400" : "bg-rose-500")} />
            {connection === "realtime" ? "live · Supabase Realtime" : connection === "polling" ? "live · polling" : "offline · cached"}
          </span>
          <Link href="/" className="flex items-center gap-1 text-[13px] font-medium hover:underline">
            Open simulator <ArrowUpRight className="h-3.5 w-3.5" />
          </Link>
        </div>
      </div>
    </div>
  );
}

function Hero() {
  const sessionId = useSessionStore((st) => st.sessionId);
  const createdAt = useSessionStore((st) => st.createdAt);
  const phase = useSessionStore((st) => st.phase);
  const channel = useSessionStore((st) => st.channel);
  const slots = useSessionStore((st) => st.slots);
  const name = slots.user_name.value;
  return (
    <div className="py-10">
      <p className="font-mono text-[12px] text-black/45">session {sessionId}</p>
      <h1 className="mt-2 text-[34px] font-semibold leading-[1.1] tracking-tight">
        {name ? `${name}'s onboarding` : "A new onboarding"}
        <span className="text-black/35"> · {phase}</span>
      </h1>
      <p className="mt-2 text-[15px] text-black/55">
        Started {fmtDateTime(createdAt)} · currently on <span className="font-medium text-black/80">{channel}</span>. Everything below updates as the phone moves.
      </p>
      <div className="mt-5">
        <SlotChips slots={slots} editable />
      </div>
    </div>
  );
}

function SlotTracker() {
  const slots = useSessionStore((st) => st.slots);
  const confirmed = useSessionStore((st) => st.userNameConfirmed);
  return (
    <Card title="Slot tracker" subtitle="The four things onboarding collects. The server owns these; editing goes through the same validated set_slot tool the model uses.">
      <table className="w-full text-[13.5px]">
        <thead className="text-left text-[11px] uppercase tracking-wider text-black/40">
          <tr>
            <th className="pb-2 font-medium">Slot</th>
            <th className="pb-2 font-medium">Value</th>
            <th className="pb-2 font-medium">Status</th>
            <th className="pb-2 text-right font-medium">Updated</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-black/[0.06]">
          {SLOT_ORDER.map((key: SlotKey) => {
            const slot = slots[key];
            return (
              <tr key={key}>
                <td className="py-2.5 pr-4">
                  <div className="font-medium">{SLOT_LABELS[key]}</div>
                  <div className="font-mono text-[11px] text-black/40">{key}</div>
                </td>
                <td className="py-2.5 pr-4">
                  <button onClick={() => void editSlot(key)} className="group -mx-2 flex items-center gap-2 rounded-md px-2 py-1 text-left hover:bg-black/[0.04]" title="Edit via set_slot">
                    <span className={cn(!slot.value && "text-black/35")}>{slot.value ?? "—"}</span>
                    {key === "user_name" && confirmed && <Pill tone="green">confirmed</Pill>}
                    <Pencil className="h-3 w-3 text-black/30 opacity-0 transition group-hover:opacity-100" />
                  </button>
                </td>
                <td className="py-2.5 pr-4">
                  <Pill tone={SLOT_TONE[slot.status]}>{slot.status}</Pill>
                </td>
                <td className="py-2.5 text-right font-mono text-[11px] text-black/45">{slot.updatedAt ? fmtTime(slot.updatedAt) : "—"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </Card>
  );
}

const BELIEF_TONE: Record<BeliefStatus, "neutral" | "green" | "amber" | "red" | "blue" | "violet"> = {
  active: "green",
  superseded: "neutral",
  contradicted: "red",
  pending: "amber",
  quarantined: "red",
  retracted: "neutral",
};

function BrainCard() {
  const beliefs = useSessionStore((st) => st.beliefs);
  const nextBestAsk = useSessionStore((st) => st.nextBestAsk);
  const latency = useSessionStore((st) => st.latency);
  const connection = useSessionStore((st) => st.connection);
  const mode = useSessionStore((st) => st.mode);
  const promptVersion = useSessionStore((st) => st.promptVersion);
  const sorted = useMemo(() => [...beliefs].sort((a, b) => (a.status === "active" ? -1 : 1) - (b.status === "active" ? -1 : 1) || a.predicate.localeCompare(b.predicate)), [beliefs]);
  return (
    <Card
      title="Brain"
      subtitle="Memory ledger projection, what the server wants to ask next, and voice latency. Nothing here is stored in the model."
      right={<Pill tone={mode === "main" ? "blue" : "amber"}>mode: {mode}</Pill>}
    >
      <div className="grid grid-cols-2 gap-x-4 gap-y-4 sm:grid-cols-4">
        <KV label="next best ask">
          <span className="font-mono text-[12px]">{nextBestAsk ? (nextBestAsk.slot ?? "none") : "—"}</span>
        </KV>
        <KV label="latency p50 / p95">
          <span className="font-mono text-[12px]">
            {latency && latency.n > 0 ? `${latency.p50 ?? "—"} / ${latency.p95 ?? "—"} ms · n=${latency.n}` : "no voice turns yet"}
          </span>
        </KV>
        <KV label="connection"><Pill tone={connection === "realtime" ? "green" : connection === "polling" ? "amber" : "red"}>{connection}</Pill></KV>
        <KV label="prompt version"><span className="font-mono text-[12px]">{promptVersion ?? "—"}</span></KV>
      </div>
      {nextBestAsk?.hint && <p className="mt-3 rounded-xl bg-black/[0.03] px-3 py-2 text-[12.5px] text-black/60">{nextBestAsk.hint}</p>}

      <div className="mt-4">
        <div className="mb-1.5 text-[11px] uppercase tracking-wider text-black/40">Beliefs ({beliefs.length})</div>
        {sorted.length === 0 ? (
          <Empty>No beliefs yet. Say your name, or connect Gmail.</Empty>
        ) : (
          <div className="overflow-hidden rounded-xl border border-black/[0.06]">
            <table className="w-full text-[12.5px]">
              <thead className="bg-black/[0.02] text-left text-[11px] uppercase tracking-wider text-black/40">
                <tr>
                  <th className="px-3 py-1.5 font-medium">subject · predicate</th>
                  <th className="px-3 py-1.5 font-medium">object</th>
                  <th className="px-3 py-1.5 font-medium">confidence</th>
                  <th className="px-3 py-1.5 font-medium">status</th>
                  <th className="px-3 py-1.5 font-medium">reason</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-black/[0.05]">
                {sorted.map((b) => (
                  <tr key={`${b.subject}|${b.predicate}|${b.object}`} className={cn("align-top", b.status !== "active" && "text-black/50")}>
                    <td className="whitespace-nowrap px-3 py-1.5 font-mono text-[11.5px]">{b.subject} · {b.predicate}</td>
                    <td className="px-3 py-1.5 break-all">{b.object}</td>
                    <td className="px-3 py-1.5">
                      <div className="flex items-center gap-2">
                        <span className="h-1.5 w-16 overflow-hidden rounded-full bg-black/[0.06]">
                          <span className={cn("block h-full rounded-full", b.status === "active" ? "bg-emerald-500" : "bg-black/25")} style={{ width: `${Math.round(Math.max(0, Math.min(1, b.confidence)) * 100)}%` }} />
                        </span>
                        <span className="font-mono text-[11px] text-black/50">{b.confidence.toFixed(2)}</span>
                      </div>
                    </td>
                    <td className="px-3 py-1.5"><Pill tone={BELIEF_TONE[b.status] ?? "neutral"}>{b.status}</Pill></td>
                    <td className="px-3 py-1.5 text-[12px] text-black/55">{b.reason ?? ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Card>
  );
}

const INTENTION_TONE: Record<IntentionStatus, "neutral" | "green" | "amber" | "red" | "blue" | "violet"> = {
  open: "blue",
  asked: "amber",
  done: "green",
  dropped: "neutral",
};

const fmtWhen = (iso: string, now: number) => {
  const t = Date.parse(iso);
  return Number.isFinite(t) && t > now ? new Date(t).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : null;
};

/** Wall clock for eligibility countdowns, refreshed every 30 s (kept out of render for purity). */
function useNow(intervalMs = 30_000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}

/** What is on the agent's mind: the intentions projection, receptivity and when each may come up again. */
function MindCard() {
  const intentions = useSessionStore((st) => st.intentions);
  const turn = useSessionStore((st) => st.turn);
  const now = useNow();
  const rows = useMemo(() => {
    const rank = (s: IntentionStatus) => (s === "asked" ? 0 : s === "open" ? 1 : s === "done" ? 2 : 3);
    return [...intentions].sort((a, b) => rank(a.status) - rank(b.status) || a.priority - b.priority || a.key.localeCompare(b.key));
  }, [intentions]);
  return (
    <Card
      title="On my mind"
      subtitle="The agent's own intentions: what it still wants to bring up, how the user took it each time (0–10), and when it is allowed to try again. Core asks never drop; they back off."
      right={<span className="font-mono text-[11px] text-black/45">turn {turn}</span>}
    >
      {rows.length === 0 ? (
        <Empty>Nothing yet. The built-in intentions (name, need, Gmail, agent name) appear once the session exists on the server.</Empty>
      ) : (
        <div className="overflow-hidden rounded-xl border border-black/[0.06]">
          <table className="w-full text-[12.5px]">
            <thead className="bg-black/[0.02] text-left text-[11px] uppercase tracking-wider text-black/40">
              <tr>
                <th className="px-3 py-1.5 font-medium">intention</th>
                <th className="px-3 py-1.5 font-medium">status</th>
                <th className="px-3 py-1.5 font-medium">receptivity</th>
                <th className="px-3 py-1.5 font-medium">raised</th>
                <th className="px-3 py-1.5 font-medium">next</th>
                <th className="px-3 py-1.5 font-medium">last angle · note</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-black/[0.05]">
              {rows.map((r) => {
                const e = eligibility(r, turn, now);
                const settled = r.status === "done" || r.status === "dropped";
                const when = fmtWhen(r.next_eligible_at, now);
                return (
                  <tr key={r.key} className={cn("align-top", settled && "text-black/50")}>
                    <td className="px-3 py-1.5">
                      <div className="font-mono text-[11.5px]">{r.key}</div>
                      <div className="text-[11.5px] text-black/50">{r.goal}</div>
                    </td>
                    <td className="px-3 py-1.5"><Pill tone={INTENTION_TONE[r.status] ?? "neutral"}>{r.status}</Pill></td>
                    <td className="px-3 py-1.5">
                      {r.receptivity === null ? (
                        <span className="text-black/40">—</span>
                      ) : (
                        <div className="flex items-center gap-2">
                          <span className="h-1.5 w-16 overflow-hidden rounded-full bg-black/[0.06]">
                            <span className={cn("block h-full rounded-full", r.receptivity >= 7 ? "bg-emerald-500" : r.receptivity >= 4 ? "bg-amber-400" : "bg-rose-400")} style={{ width: `${r.receptivity * 10}%` }} />
                          </span>
                          <span className="font-mono text-[11px] text-black/60">
                            {r.receptivity}/10{r.receptivity_history.length > 1 && r.receptivity_mean !== null ? ` · avg ${r.receptivity_mean}` : ""}
                          </span>
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-1.5 font-mono text-[11.5px]">{r.nudges}×</td>
                    <td className="px-3 py-1.5 text-[12px]">
                      {settled ? r.reason ?? r.status : e.eligible ? <span className="text-emerald-700">eligible now</span> : <span className="text-black/60">{e.why}{when && e.msLeft > 0 ? ` (${when})` : ""}</span>}
                    </td>
                    <td className="px-3 py-1.5 text-[12px] text-black/55">
                      {r.last_approach && <div className="italic">“{r.last_approach}”</div>}
                      {r.notes.length > 0 && <div>{r.notes[r.notes.length - 1]}</div>}
                      {!settled && r.reason && <div className="text-black/40">{r.reason}</div>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

function SessionCard() {
  const s = useSessionStore();
  return (
    <Card title="Session">
      <div className="grid grid-cols-2 gap-x-4 gap-y-4">
        <KV label="phase"><Pill tone="blue">{s.phase}</Pill></KV>
        <KV label="mode"><Pill tone={s.mode === "main" ? "blue" : "amber"}>{s.mode}</Pill></KV>
        <KV label="channel"><Pill>{s.channel}</Pill></KV>
        <KV label="screen"><Pill>{s.screen}</Pill></KV>
        <KV label="assistant typing"><Pill tone={s.assistantTyping ? "violet" : "neutral"}>{String(s.assistantTyping)}</Pill></KV>
        <KV label="messages">{s.messages.length}</KV>
        <KV label="events">{s.events.length}</KV>
        <KV label="in contacts">
          <button
            onClick={() => s.setSenderInContacts(!s.senderInContacts)}
            className={cn("rounded-full px-2 py-0.5 font-mono text-[11px]", s.senderInContacts ? "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200" : "bg-black/[0.06] text-black/70")}
          >
            {String(s.senderInContacts)} · toggle
          </button>
        </KV>
      </div>
    </Card>
  );
}

function CallCard() {
  const call = useSessionStore((st) => st.call);
  const captions = useSessionStore((st) => st.captions);
  const [speech, setSpeech] = useState("");
  const [now, setNow] = useState(0);
  const inCall = call.state === "live" || call.state === "connecting";
  useEffect(() => {
    const tick = () => setNow(Date.now());
    const t = setTimeout(tick, 0);
    const i = setInterval(tick, 1000);
    return () => {
      clearTimeout(t);
      clearInterval(i);
    };
  }, []);
  const tone = call.state === "live" ? "green" : call.state === "ringing" ? "amber" : call.state === "ended" ? "neutral" : "neutral";
  return (
    <Card
      title="Call"
      subtitle="Drive the voice channel by hand."
      right={<Pill tone={tone}>{call.state}</Pill>}
    >
      <div className="grid grid-cols-2 gap-x-4 gap-y-3 text-[13px]">
        <KV label="started">{call.startedAt ? fmtTime(call.startedAt) : "—"}</KV>
        <KV label="duration">{call.startedAt ? formatDuration(Math.max(0, (call.endedAt ?? now) - call.startedAt)) : "—"}</KV>
        <KV label="end reason">{call.endReason ?? "—"}</KV>
        <KV label="transport">{callController.transportKind ?? "—"}</KV>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <Button onClick={() => callController.ring()} disabled={call.state === "ringing" || inCall}>
          <PhoneIncoming className="h-3.5 w-3.5" /> Ring
        </Button>
        <Button onClick={() => callController.end("dropped")} disabled={!inCall && call.state !== "ringing"}>
          <Unplug className="h-3.5 w-3.5" /> Drop
        </Button>
        <Button onClick={() => callController.end("silence")} disabled={!inCall}>
          <PhoneOff className="h-3.5 w-3.5" /> Silence timeout
        </Button>
      </div>

      <form
        className="mt-3 flex gap-2"
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
          placeholder={inCall ? "Inject user speech (mock STT)…" : "Answer a call on the phone to inject speech"}
          className="min-w-0 flex-1 rounded-lg border border-black/10 px-3 py-1.5 text-[13px] outline-none focus:border-black/30 disabled:bg-black/[0.03]"
        />
        <Button type="submit" disabled={!inCall || !speech.trim()}>
          <Send className="h-3.5 w-3.5" />
        </Button>
      </form>

      {captions.length > 0 && (
        <div className="mt-4">
          <div className="mb-1.5 text-[11px] uppercase tracking-wider text-black/40">Live captions</div>
          <div className="max-h-[180px] space-y-1.5 overflow-y-auto rounded-xl bg-black/[0.03] p-3 text-[13px]">
            {captions.map((c) => (
              <div key={c.id} className={cn("flex gap-2", !c.final && "text-black/50")}>
                <span className="w-16 shrink-0 font-mono text-[11px] text-black/40">{c.speaker}</span>
                <span>{c.text || "…"}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </Card>
  );
}

function Transcript() {
  const messages = useSessionStore((st) => st.messages);
  const byId = useMemo(() => new Map(messages.map((m) => [m.id, m])), [messages]);
  return (
    <Card title="Transcript" subtitle={`${messages.length} messages. Content is limited to what a real iMessage sender can put in a thread: text, links, images, contacts, audio, call rows.`}>
      {messages.length === 0 ? (
        <Empty>No messages yet.</Empty>
      ) : (
        <div className="divide-y divide-black/[0.06]">
          {messages.filter((m) => !!m.content).map((m) => (
            <div key={m.id} className="flex gap-4 py-2.5 text-[13.5px]">
              <span className="w-[62px] shrink-0 pt-0.5 font-mono text-[11px] text-black/40">{fmtTime(m.ts)}</span>
              <Pill tone={m.role === "user" ? "blue" : m.role === "assistant" ? "neutral" : "violet"} className="h-fit shrink-0">
                {m.role}
              </Pill>
              <div className="min-w-0 flex-1">
                {m.replyToId && byId.get(m.replyToId) && (
                  <div className="mb-0.5 truncate text-[12px] text-black/45">↩ {messageText(byId.get(m.replyToId)!)}</div>
                )}
                {m.content.kind === "text" && <div className="whitespace-pre-wrap">{m.content.text}</div>}
                {m.content.kind === "link" && (
                  <div>
                    <span className="text-blue-700 underline decoration-blue-300">{m.content.link.url}</span>
                    <div className="mt-0.5 text-[12px] text-black/50">
                      rich link · {m.content.link.title ?? m.content.link.domain}
                      {m.content.link.appClip && <> · App Clip “{m.content.link.appClip.title}”</>}
                    </div>
                  </div>
                )}
                {m.content.kind === "image" && <div className="text-black/60">🖼 {m.content.image.alt ?? "image"}</div>}
                {m.content.kind === "contact" && <div>👤 Contact card · {m.content.contact.name}{m.content.contact.org ? ` · ${m.content.contact.org}` : ""}</div>}
                {m.content.kind === "audio" && (
                  <div>
                    🎙 Audio message · {m.content.audio.durationSec}s
                    {m.content.audio.transcript && <div className="mt-0.5 text-[12px] text-black/55">“{m.content.audio.transcript}”</div>}
                  </div>
                )}
                {m.content.kind === "call" && <div className="text-black/60">📞 {callLogLabel(m.content.call)}</div>}
                <div className="mt-1 flex flex-wrap gap-1.5">
                  <Pill tone="violet">{m.content.kind}{m.content.kind === "text" && m.content.effect ? ` · ${m.content.effect}` : ""}</Pill>
                  {m.status && <Pill>{m.status}{m.readAt ? ` ${fmtTime(m.readAt)}` : ""}</Pill>}
                  {m.reactions?.map((r) => (
                    <Pill key={r.by} tone={r.by === "user" ? "blue" : "neutral"}>
                      {r.kind.type === "emoji" ? r.kind.emoji : r.kind.tapback} · {r.by}
                    </Pill>
                  ))}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

const FILTERS = ["all", "call.", "user.", "brain.", "server.", "gmail.", "slot.", "reaction.", "channel.", "phase.", "voice.", "mock."] as const;

function EventLog() {
  const events = useSessionStore((st) => st.events);
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>("all");
  const shown = useMemo(() => [...events].reverse().filter((e) => filter === "all" || e.type.startsWith(filter)), [events, filter]);
  return (
    <Card
      title="Event log"
      subtitle="Append-only. Newest first."
      right={
        <button onClick={() => useSessionStore.setState({ events: [] })} className="text-[12px] text-black/45 hover:text-black">
          clear
        </button>
      }
    >
      <div className="mb-3 flex flex-wrap gap-1.5">
        {FILTERS.map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={cn("rounded-full px-2.5 py-0.5 font-mono text-[11px] transition", filter === f ? "bg-black text-white" : "bg-black/[0.05] text-black/60 hover:bg-black/10")}
          >
            {f === "all" ? "all" : f.replace(".", "")}
          </button>
        ))}
      </div>
      {shown.length === 0 ? (
        <Empty>No events.</Empty>
      ) : (
        <div className="max-h-[420px] overflow-y-auto rounded-xl border border-black/[0.06]">
          <table className="w-full font-mono text-[11.5px]">
            <tbody className="divide-y divide-black/[0.05]">
              {shown.map((e) => (
                <tr key={e.id} className="align-top">
                  <td className="w-[74px] whitespace-nowrap px-3 py-1.5 text-black/40">{fmtTime(e.ts)}</td>
                  <td className="w-[190px] px-2 py-1.5">
                    <span
                      className={cn(
                        "font-semibold",
                        e.type.startsWith("call.") && "text-emerald-700",
                        e.type.startsWith("user.") && "text-blue-700",
                        e.type.startsWith("mock.") && "text-violet-700",
                        e.type.startsWith("slot.") && "text-amber-700",
                        e.type.startsWith("reaction.") && "text-pink-700",
                        e.type.startsWith("brain.") && "text-indigo-700",
                        e.type.startsWith("server.") && "text-rose-700",
                        e.type.startsWith("gmail.") && "text-teal-700",
                      )}
                    >
                      {e.type}
                    </span>
                  </td>
                  <td className="px-2 py-1.5 text-black/60 break-all">{e.payload ? JSON.stringify(e.payload) : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

function RunsCard() {
  const runs = useRunsStore((st) => st.runs);
  const remove = useRunsStore((st) => st.remove);
  return (
    <Card
      id="runs"
      title="Previous runs"
      subtitle="Archived when you restart the simulation."
      right={
        <Button
          onClick={() => {
            callController.end("user_hangup");
            restartSimulation();
          }}
        >
          Restart
        </Button>
      }
    >
      {runs.length === 0 ? (
        <Empty>No archived runs yet.</Empty>
      ) : (
        <div className="divide-y divide-black/[0.06]">
          {runs.map((r) => (
            <div key={r.id} className="flex items-center justify-between gap-3 py-2.5">
              <div className="min-w-0">
                <div className="truncate text-[13.5px]">
                  {r.slots.user_name.value ?? "Anonymous"} <span className="text-black/40">· {r.messages.length} msgs · {r.phase}</span>
                </div>
                <div className="font-mono text-[11px] text-black/40">
                  {r.id.slice(0, 8)} · {fmtDateTime(r.createdAt)}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <Button onClick={() => restoreRun(r.id)}>Restore</Button>
                <button onClick={() => remove(r.id)} className="rounded-lg p-1.5 text-black/40 hover:bg-rose-50 hover:text-rose-600" aria-label="Delete run">
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

function StorageCard() {
  return (
    <Card title="Storage" subtitle="Where this lives and how it gets here.">
      <ul className="space-y-2 text-[13px] text-black/70">
        <li>
          <span className="font-medium text-black">Source of truth:</span> Supabase Postgres (<code className="font-mono text-[11.5px]">sessions</code>, <code className="font-mono text-[11.5px]">messages</code>,{" "}
          <code className="font-mono text-[11.5px]">events</code>, <code className="font-mono text-[11.5px]">memory_events</code> → <code className="font-mono text-[11.5px]">beliefs</code>,{" "}
          <code className="font-mono text-[11.5px]">intention_events</code> → <code className="font-mono text-[11.5px]">intentions</code>). Only route handlers write.
        </li>
        <li>
          <span className="font-medium text-black">This browser:</span> a mirror fed by Supabase Realtime (anonymous auth + RLS) with catch-up polling as the fallback, cached in{" "}
          <code className="rounded bg-black/[0.05] px-1 py-0.5 font-mono text-[11.5px]">{SESSION_STORAGE_KEY}</code> so reloads are instant. Tabs sync through the storage event.
        </li>
        <li>
          <span className="font-medium text-black">The model:</span> keeps nothing. State is re-injected every turn and only changes through validated tools.
        </li>
      </ul>
    </Card>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <div className="rounded-xl border border-dashed border-black/10 py-6 text-center text-[13px] text-black/40">{children}</div>;
}
