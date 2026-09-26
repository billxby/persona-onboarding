/**
 * Per-session metrics from the events/messages tables (DESIGN.md §16.2).
 *
 *   npx tsx scripts/metrics.ts <session_id...>
 *   npx tsx scripts/metrics.ts --last 5 [--json]
 */
import { config } from "dotenv";
config({ path: ".env.local", quiet: true });

import { mindFor } from "@/lib/memory/mind";
import { db } from "@/lib/server/db";
import { latencyStats, listEvents, listMessages } from "@/lib/server/messages";
import { getSession } from "@/lib/server/session";
import { normalizeQuestion } from "@/lib/server/state";
import type { EventRow, LatencyStats, MessageRow, SlotName } from "@/lib/shared/types";

export interface SlotMetric {
  filled: boolean;
  value: string | null;
  set_events: number;
  rejected: number;
}

export interface SessionMetrics {
  session_id: string;
  created_at: string;
  phase: string;
  mode: string;
  graduated: boolean;
  slots: Record<SlotName, SlotMetric>;
  user_turns: number;
  assistant_turns: number;
  turns_to_graduation: number | null;
  repeated_questions: { events: number; recomputed: number };
  steers: { max: number; mean: number };
  value_moment_s: number | null;
  resume_ms: number | null;
  latency: LatencyStats;
  tool_calls: number;
  tool_calls_by_name: Record<string, number>;
  rejected_slots: number;
  guard_regenerations: number;
  supervisor_patches: number;
  calls: number;
  /** what was on the agent's mind: per intention, how often it was raised and how it landed (DESIGN §13b) */
  intentions: Record<string, { status: string; nudges: number; receptivity: number | null; mean: number | null }>;
}

const SLOTS: SlotName[] = ["user_name", "need", "gmail", "agent_name"];

const sentences = (text: string) =>
  text
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter(Boolean);

const questionsIn = (text: string) => sentences(text).filter((s) => s.endsWith("?"));

/** Group consecutive same-role text rows into turns (a burst of bubbles is one turn). */
function turnGroups(messages: MessageRow[]): { role: string; rows: MessageRow[] }[] {
  const groups: { role: string; rows: MessageRow[] }[] = [];
  for (const m of messages) {
    if (m.kind !== "text" || (m.role !== "user" && m.role !== "assistant")) continue;
    const last = groups[groups.length - 1];
    if (last && last.role === m.role) last.rows.push(m);
    else groups.push({ role: m.role, rows: [m] });
  }
  return groups;
}

export async function metricsFor(session_id: string): Promise<SessionMetrics | null> {
  const session = await getSession(session_id);
  if (!session) return null;
  const [messages, events, latency] = await Promise.all([listMessages(session_id, { limit: 2000 }), listEvents(session_id), latencyStats(session_id)]);

  const byType = (t: string) => events.filter((e) => e.type === t);
  const groups = turnGroups(messages);
  const assistantGroups = groups.filter((g) => g.role === "assistant");
  const userGroups = groups.filter((g) => g.role === "user");

  const graduatedEv = byType("graduated")[0];
  const turnsToGrad = graduatedEv
    ? assistantGroups.filter((g) => new Date(g.rows[0].created_at).getTime() <= new Date(graduatedEv.created_at).getTime()).length
    : null;

  // questions per assistant turn (steers proxy) and repeated questions recomputed
  const perTurnQuestions = assistantGroups.map((g) => g.rows.reduce((n, r) => n + questionsIn(r.content ?? "").length, 0));
  const steerMax = perTurnQuestions.length ? Math.max(...perTurnQuestions) : 0;
  const steerMean = perTurnQuestions.length ? perTurnQuestions.reduce((a, b) => a + b, 0) / perTurnQuestions.length : 0;
  const seen = new Map<string, number>();
  for (const g of assistantGroups) for (const r of g.rows) for (const q of questionsIn(r.content ?? "")) {
    const k = normalizeQuestion(q);
    if (k) seen.set(k, (seen.get(k) ?? 0) + 1);
  }
  const recomputedRepeats = [...seen.values()].reduce((n, c) => n + Math.max(0, c - 1), 0);
  const guardRepeats = byType("guard").filter((e) => /repeat/i.test(String((e.payload as { issue?: string }).issue ?? ""))).length;
  const repeatEvents = byType("repeat_question").length + guardRepeats;

  const valueMomentS = session.value_moment_at ? (new Date(session.value_moment_at).getTime() - new Date(session.created_at).getTime()) / 1000 : null;

  const hangups = byType("hangup_detected");
  const resumes = byType("resume");
  let resumeMs: number | null = null;
  if (hangups.length) {
    const h = new Date(hangups[0].created_at).getTime();
    const r = resumes.find((e) => new Date(e.created_at).getTime() >= h);
    if (r) resumeMs = new Date(r.created_at).getTime() - h;
  }

  const toolEvents = byType("tool_call");
  const byName: Record<string, number> = {};
  for (const e of toolEvents) {
    const name = String((e.payload as { name?: string }).name ?? "?");
    byName[name] = (byName[name] ?? 0) + 1;
  }
  const slotSets = byType("slot_set");
  const slotRejected = byType("slot_rejected");
  const slotOf = (e: EventRow) => String((e.payload as { slot?: string }).slot ?? "");

  const slots = Object.fromEntries(
    SLOTS.map((slot) => {
      const value =
        slot === "gmail" ? (session.gmail_status === "connected" ? session.gmail_email ?? "connected" : null) : (session[slot] as string | null);
      return [
        slot,
        {
          filled: slot === "gmail" ? session.gmail_status === "connected" : !!session[slot],
          value,
          set_events: slotSets.filter((e) => slotOf(e) === slot).length,
          rejected: slotRejected.filter((e) => slotOf(e) === slot).length,
        } satisfies SlotMetric,
      ];
    }),
  ) as Record<SlotName, SlotMetric>;

  return {
    session_id,
    created_at: session.created_at,
    phase: session.phase,
    mode: session.mode,
    graduated: !!graduatedEv || session.phase === "graduated",
    slots,
    user_turns: userGroups.length,
    assistant_turns: assistantGroups.length,
    turns_to_graduation: turnsToGrad,
    repeated_questions: { events: repeatEvents, recomputed: recomputedRepeats },
    steers: { max: steerMax, mean: Number(steerMean.toFixed(2)) },
    value_moment_s: valueMomentS == null ? null : Number(valueMomentS.toFixed(1)),
    resume_ms: resumeMs,
    latency,
    tool_calls: toolEvents.length,
    tool_calls_by_name: byName,
    rejected_slots: slotRejected.length,
    guard_regenerations: byType("guard").filter((e) => !!(e.payload as { regenerated?: boolean }).regenerated).length,
    supervisor_patches: byType("supervisor").filter((e) => !!(e.payload as { patched?: boolean }).patched).length,
    calls: byType("call_started").length,
    intentions: Object.fromEntries((await mindFor(session_id).catch(() => [])).map((r) => [r.key, { status: r.status, nudges: r.nudges, receptivity: r.receptivity, mean: r.receptivity_mean }])),
  };
}

const tick = (b: boolean) => (b ? "✓" : "·");
const fmtNum = (n: number | null | undefined, suffix = "") => (n == null ? "—" : `${n}${suffix}`);

export function formatMetrics(m: SessionMetrics): string {
  const s = m.slots;
  return [
    `session ${m.session_id}  phase=${m.phase} mode=${m.mode} graduated=${m.graduated}`,
    `slots   name ${tick(s.user_name.filled)} ${s.user_name.value ?? ""} | need ${tick(s.need.filled)} ${s.need.value ?? ""} | gmail ${tick(s.gmail.filled)} ${s.gmail.value ?? ""} | agent ${tick(s.agent_name.filled)} ${s.agent_name.value ?? ""}`,
    `turns   user=${m.user_turns} assistant=${m.assistant_turns} to_graduation=${fmtNum(m.turns_to_graduation)}`,
    `steers  max=${m.steers.max} mean=${m.steers.mean}   repeated_questions events=${m.repeated_questions.events} recomputed=${m.repeated_questions.recomputed}`,
    `value   ${fmtNum(m.value_moment_s, "s")}   resume_after_hangup ${fmtNum(m.resume_ms, "ms")}   calls=${m.calls}`,
    `voice   latency p50=${fmtNum(m.latency.p50, "ms")} p95=${fmtNum(m.latency.p95, "ms")} n=${m.latency.n}`,
    `tools   ${m.tool_calls} calls ${JSON.stringify(m.tool_calls_by_name)}  rejected_slots=${m.rejected_slots} guard_regens=${m.guard_regenerations} supervisor_patches=${m.supervisor_patches}`,
    `mind    ${
      Object.entries(m.intentions)
        .map(([k, v]) => `${k}=${v.status}/${v.nudges}x${v.receptivity == null ? "" : ` ${v.receptivity}/10`}${v.mean != null && v.nudges > 1 ? ` avg ${v.mean}` : ""}`)
        .join(" | ") || "(no intentions)"
    }`,
  ].join("\n");
}

export function metricsTable(rows: SessionMetrics[]): string {
  const head = ["session", "phase", "N", "Nd", "G", "A", "turns", "grad", "rptQ", "steer", "value", "resume", "lat50", "tools", "rej"];
  const body = rows.map((m) => [
    m.session_id.slice(0, 8),
    m.phase,
    tick(m.slots.user_name.filled),
    tick(m.slots.need.filled),
    tick(m.slots.gmail.filled),
    tick(m.slots.agent_name.filled),
    String(m.assistant_turns),
    fmtNum(m.turns_to_graduation),
    String(m.repeated_questions.recomputed),
    `${m.steers.max}/${m.steers.mean}`,
    fmtNum(m.value_moment_s, "s"),
    fmtNum(m.resume_ms, "ms"),
    fmtNum(m.latency.p50),
    String(m.tool_calls),
    String(m.rejected_slots),
  ]);
  const widths = head.map((h, i) => Math.max(h.length, ...body.map((r) => r[i].length)));
  const line = (r: string[]) => r.map((c, i) => c.padEnd(widths[i])).join("  ");
  return [line(head), line(widths.map((w) => "-".repeat(w))), ...body.map(line)].join("\n");
}

async function main() {
  const args = process.argv.slice(2);
  const json = args.includes("--json");
  let ids = args.filter((a) => !a.startsWith("--") && !/^\d+$/.test(a));
  const lastIdx = args.indexOf("--last");
  if (lastIdx >= 0) {
    const n = Number(args[lastIdx + 1] ?? 5);
    const { data, error } = await db().from("sessions").select("id").order("created_at", { ascending: false }).limit(n);
    if (error) throw error;
    ids = (data ?? []).map((r) => r.id as string);
  }
  if (!ids.length) {
    console.error("usage: npx tsx scripts/metrics.ts <session_id...> | --last <n> [--json]");
    process.exit(1);
  }
  const rows = (await Promise.all(ids.map((id) => metricsFor(id)))).filter((m): m is SessionMetrics => !!m);
  if (json) console.log(JSON.stringify(rows, null, 2));
  else {
    console.log(metricsTable(rows));
    if (rows.length === 1) console.log("\n" + formatMetrics(rows[0]));
  }
}

const isMain = process.argv[1] && /metrics\.ts$/.test(process.argv[1]);
if (isMain) main().catch((e) => { console.error(e); process.exit(1); });
