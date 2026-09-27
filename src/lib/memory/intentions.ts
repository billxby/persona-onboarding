/**
 * Intentions: what is on the agent's own mind (DESIGN.md §13b). A second
 * append-only ledger next to the facts ledger in ./ledger.ts. `intention_events`
 * are folded by a pure, deterministic function into one record per key: the
 * goal, whether it was raised, how the user took it each time (receptivity
 * 0–10), which angles were tried, and when it is eligible to come up again.
 *
 * Same discipline as beliefs: no IO, no React, no server imports; nothing is
 * deleted, only re-statused with a reason; replay is order-independent.
 *
 * Backoff (pure): the receptivity band of the latest reaction sets a base wait
 * in assistant turns and, for cold reactions, a wall-clock floor; every extra
 * nudge doubles both. Sticky intentions (the core product asks: name, need,
 * Gmail, agent name) are never dropped, only backed off further and further; a
 * straight no to Gmail means "much later, from another angle", not "never".
 * The one built-in that is not sticky is the call offer (`offer_call`): DESIGN
 * §1.7 makes a no final, so it settles on the first clear answer. Ad-hoc
 * follow-ups the agent opened itself can be dropped: 0/10 drops one outright,
 * three nudges averaging under 3/10 drop it too.
 */
import type { Intention, IntentionEvent, IntentionPayload, IntentionStatus, ReceptivitySignal, ServerChannel, SlotName } from "@/lib/shared/types";

export type IntentionRecord = Omit<Intention, "session_id">;
/** Keyed by intention key. */
export type Mind = Map<string, IntentionRecord>;

export const RECEPTIVITY_MAX = 10;
const MAX_APPROACHES = 6;
const MAX_HISTORY = 10;
const MAX_NOTES = 3;
const BOTH: ServerChannel[] = ["text", "call"];

export const DROP_SHUT_DOWN_REASON = "user shut it down (0/10)";
export const DROP_LOW_RECEPTIVITY_REASON = "three nudges, receptivity averaging under 3/10";
export const STICKY_DROP_REASON = "asked to drop; a core ask stays on the mind, snoozed instead";
export const STICKY_DROP_TURNS = 40;
export const EPOCH = "1970-01-01T00:00:00.000Z";

// ---------------------------------------------------------------------------
// built-in intentions (seeded per session) and the angles worth trying next
// ---------------------------------------------------------------------------

export interface BuiltinIntention {
  key: string;
  /** the session slot this ask fills; `null` for an ask that is not a slot (the call offer) */
  slot: SlotName | null;
  goal: string;
  priority: number;
  /** core product ask: never auto-dropped, only backed off */
  sticky: boolean;
  channels: ServerChannel[];
  /** a question bubble matching this means the agent raised it */
  cue: RegExp;
  /** angles in the order worth trying; the prompt suggests the first untried one */
  angles: string[];
}

export const BUILTIN_INTENTIONS: BuiltinIntention[] = [
  {
    key: "get_name",
    slot: "user_name",
    goal: "learn what to call them",
    priority: 1,
    sticky: true,
    channels: BOTH,
    cue: /what (should|do|can|shall) i call you|your (first )?name|who am i (talking|speaking|chatting) (to|with)|what do (people|friends) call you|go by/i,
    angles: ["ask plainly, once", "offer a choice: a first name, or I just go with friend", "tie it to the work: so the draft is signed right", "let it rest; once more after the first useful result"],
  },
  {
    key: "learn_need",
    slot: "need",
    goal: "the task they want handled this week",
    priority: 2,
    sticky: true,
    channels: BOTH,
    cue: /off your plate|one thing (you|to|i)|what (do|would|can) (you|i) (want|need|do|help)|help you (knock out|tackle|get done|sort out|handle)|which (one|of (these|those))|take care of|what'?s (bugging|nagging|on your list)|keep meaning to/i,
    angles: ["open question: one thing off their plate this week", "three concrete options: inbox cleanup, cancelling subscriptions, booking an appointment", "the smallest start: want me to begin with the inbox?"],
  },
  {
    // One first-time offer, once the need is known and only in text (DESIGN §7): a yes rings the phone, a no or a
    // hangup means text for good (§1.7), so this is the one built-in that settles instead of backing off.
    key: "offer_call",
    slot: null,
    goal: "offer one quick call to set up the rest",
    priority: 3,
    sticky: false,
    channels: ["text"],
    // never a bare "call you": "what should I call you?" is the name ask
    cue: /\b(want|like) me to (call|ring|phone) you\b|\bgive you a (quick |short )?call\b|\bhop on (a|the) (quick )?call\b|\bquick call\b|\bover the phone\b|\bby voice\b|\bwant (me to|a) call\b|\bcall you (back|now|to set)\b|\btwo.minute call\b/i,
    angles: ["light: want me to call you to set up the rest? two minutes, or we keep going here", "tie it to the task: faster to sort the details by voice, or here is fine too"],
  },
  {
    key: "connect_gmail",
    slot: "gmail",
    goal: "connect Gmail (read-only) as the way to do the task",
    priority: 4,
    sticky: true,
    channels: BOTH,
    cue: /\b(gmail|inbox|your email|read-?only|connect)\b/i,
    angles: [
      "as the means to THEIR task: so I can find the membership email",
      "one concrete thing I would find in the first minute",
      "reassurance: read-only, nothing sent without a yes",
      "the demo inbox instead, just to show what it looks like",
      "much later, and only when email is plainly the way to do what they just asked",
    ],
  },
  {
    key: "name_agent",
    slot: "agent_name",
    goal: "learn what they'd like to call me",
    priority: 5,
    sticky: true,
    channels: ["text"],
    cue: /what (should|would|do) you (like to |want to )?call me|name for me|give me a name|call me (something|anything|whatever)|rename me/i,
    angles: ["light: want to give me a name? Persona is fine too", "tie it to the contact card: that's how I'll show up in your contacts", "leave it at Persona"],
  },
];

export const builtinFor = (key: string) => BUILTIN_INTENTIONS.find((b) => b.key === key);
export const builtinForSlot = (slot: SlotName) => BUILTIN_INTENTIONS.find((b) => b.slot === slot);
export const OFFER_CALL_KEY = "offer_call";

/** The `open` payload that seeds a built-in. */
export function seedPayload(b: BuiltinIntention): IntentionPayload {
  return { goal: b.goal, slot: b.slot, sticky: b.sticky, priority: b.priority, channels: b.channels };
}

/** First angle not yet tried (by loose word overlap with recorded approaches), if the key is built in. */
export function nextAngle(rec: Pick<IntentionRecord, "key" | "approaches" | "nudges">): string | null {
  const b = builtinFor(rec.key);
  if (!b) return null;
  const tried = rec.approaches.map(normalize);
  const untried = b.angles.find((a) => !tried.some((t) => overlaps(t, normalize(a))));
  return untried ?? b.angles[Math.min(rec.nudges, b.angles.length - 1)] ?? null;
}

const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
function overlaps(a: string, b: string): boolean {
  const wa = new Set(a.split(" ").filter((w) => w.length >= 4));
  const wb = b.split(" ").filter((w) => w.length >= 4);
  if (!wa.size || !wb.length) return false;
  const hits = wb.filter((w) => wa.has(w)).length;
  return hits / wb.length >= 0.5;
}

// ---------------------------------------------------------------------------
// backoff
// ---------------------------------------------------------------------------

export const clampReceptivity = (r: number) => Math.max(0, Math.min(RECEPTIVITY_MAX, Math.round(Number.isFinite(r) ? r : 0)));

/** 0 shut down · 1 clear no · 2 ignored/deflected · 3 maybe later · 4 interested · 5 yes */
export function receptivityBand(r: number): 0 | 1 | 2 | 3 | 4 | 5 {
  const v = clampReceptivity(r);
  if (v === 0) return 0;
  if (v <= 2) return 1;
  if (v <= 4) return 2;
  if (v <= 6) return 3;
  if (v <= 8) return 4;
  return 5;
}

const HOUR = 60 * 60 * 1000;
const BASE_TURNS = [24, 12, 2, 6, 1, 0] as const;
const BASE_MS = [24 * HOUR, 2 * HOUR, 0, 0, 0, 0] as const;
const MAX_TURNS = 200;
const MAX_MS = 7 * 24 * HOUR;

/** How long to wait before raising it again, given the latest reaction and how many times it has been raised. */
export function backoff(receptivity: number, nudges: number): { turns: number; ms: number } {
  const band = receptivityBand(receptivity);
  const mult = 2 ** Math.max(0, nudges - 1);
  return { turns: Math.min(MAX_TURNS, BASE_TURNS[band] * mult), ms: Math.min(MAX_MS, BASE_MS[band] * mult) };
}

export function signalFor(receptivity: number): ReceptivitySignal {
  switch (receptivityBand(receptivity)) {
    case 0:
      return "shut_down";
    case 1:
      return "declined";
    case 2:
      return "ignored";
    case 3:
      return "deferred";
    default:
      return "accepted";
  }
}

// ---------------------------------------------------------------------------
// eligibility
// ---------------------------------------------------------------------------

export interface Eligibility {
  eligible: boolean;
  /** short human/model-readable state, e.g. "eligible now", "snoozed, 4 more turns" */
  why: string;
  turnsLeft: number;
  msLeft: number;
}

const fmtWait = (ms: number) => (ms >= 24 * HOUR ? `${Math.round(ms / (24 * HOUR))}d` : ms >= HOUR ? `${Math.round(ms / HOUR)}h` : `${Math.max(1, Math.ceil(ms / 60000))}min`);

export function eligibility(rec: Pick<IntentionRecord, "status" | "next_eligible_turn" | "next_eligible_at">, turn: number, nowMs: number): Eligibility {
  if (rec.status === "done" || rec.status === "dropped") return { eligible: false, why: rec.status, turnsLeft: 0, msLeft: 0 };
  if (rec.status === "asked") return { eligible: false, why: "asked, waiting for their reaction", turnsLeft: 0, msLeft: 0 };
  const turnsLeft = Math.max(0, rec.next_eligible_turn - turn);
  const msLeft = Math.max(0, Date.parse(rec.next_eligible_at) - nowMs);
  if (turnsLeft === 0 && msLeft === 0) return { eligible: true, why: "eligible now", turnsLeft, msLeft };
  const parts: string[] = [];
  if (turnsLeft > 0) parts.push(`${turnsLeft} more turn${turnsLeft === 1 ? "" : "s"}`);
  if (msLeft > 0) parts.push(`at least ${fmtWait(msLeft)}`);
  return { eligible: false, why: `snoozed, ${parts.join(" and ")}`, turnsLeft, msLeft };
}

export const isEligible = (rec: Pick<IntentionRecord, "status" | "next_eligible_turn" | "next_eligible_at">, turn: number, nowMs: number) => eligibility(rec, turn, nowMs).eligible;

export function intentionForSlot<T extends { slot: SlotName | null }>(mind: Iterable<T>, slot: SlotName): T | undefined {
  for (const r of mind) if (r.slot === slot) return r;
  return undefined;
}

// ---------------------------------------------------------------------------
// the fold
// ---------------------------------------------------------------------------

const round1 = (n: number) => Math.round(n * 10) / 10;
const mean = (xs: number[]) => (xs.length ? round1(xs.reduce((a, b) => a + b, 0) / xs.length) : null);
const last = <T>(xs: T[], n: number) => xs.slice(Math.max(0, xs.length - n));
const clean = (s: unknown, max: number) => (typeof s === "string" ? s.replace(/\s+/g, " ").trim().slice(0, max) : "");
const turnOf = (ev: IntentionEvent) => (typeof ev.turn === "number" && Number.isFinite(ev.turn) ? ev.turn : 0);

function opened(key: string, ev: IntentionEvent, existing?: IntentionRecord): IntentionRecord {
  const p = ev.payload ?? {};
  const b = builtinFor(key);
  return {
    key,
    goal: clean(p.goal, 140) || existing?.goal || b?.goal || key.replace(/[_-]+/g, " "),
    slot: p.slot ?? existing?.slot ?? b?.slot ?? null,
    sticky: typeof p.sticky === "boolean" ? p.sticky : (existing?.sticky ?? b?.sticky ?? false),
    priority: typeof p.priority === "number" ? p.priority : (existing?.priority ?? b?.priority ?? 5),
    channels: Array.isArray(p.channels) && p.channels.length ? p.channels : (existing?.channels ?? b?.channels ?? BOTH),
    status: "open",
    nudges: existing?.nudges ?? 0,
    last_nudge_turn: existing?.last_nudge_turn ?? null,
    last_nudge_at: existing?.last_nudge_at ?? null,
    last_approach: existing?.last_approach ?? null,
    approaches: existing?.approaches ?? [],
    receptivity: existing?.receptivity ?? null,
    receptivity_history: existing?.receptivity_history ?? [],
    receptivity_mean: existing?.receptivity_mean ?? null,
    last_outcome_turn: existing?.last_outcome_turn ?? null,
    notes: existing?.notes ?? [],
    next_eligible_turn: 0,
    next_eligible_at: EPOCH,
    reason: existing ? clean(p.reason, 160) || "reopened" : null,
    evidence_ids: [...(existing?.evidence_ids ?? []), ev.id],
    updated_at: ev.ts,
  };
}

function applyEvent(state: Mind, ev: IntentionEvent): Mind {
  const key = clean(ev.key, 60);
  if (!key) return state;
  const existing = state.get(key);
  const p = ev.payload ?? {};
  const next = new Map(state);
  const touch = (r: IntentionRecord): IntentionRecord => ({ ...r, evidence_ids: [...r.evidence_ids, ev.id], updated_at: ev.ts });

  switch (ev.op) {
    case "open": {
      if (!existing) {
        next.set(key, opened(key, ev));
      } else if (existing.status === "open" || existing.status === "asked") {
        // re-stating an open intention only refreshes the goal; history and backoff stay
        next.set(key, touch({ ...existing, goal: clean(p.goal, 140) || existing.goal }));
      } else {
        next.set(key, touch(existing)); // done/dropped: evidence logged, nothing moves (use reopen)
      }
      return next;
    }
    case "reopen": {
      if (!existing) return next.set(key, opened(key, ev)), next;
      next.set(key, opened(key, ev, existing));
      return next;
    }
    case "nudge": {
      if (!existing || existing.status === "done" || existing.status === "dropped") return existing ? (next.set(key, touch(existing)), next) : state;
      const approach = clean(p.approach, 140) || "(unrecorded)";
      const approaches = existing.approaches.some((a) => normalize(a) === normalize(approach)) ? existing.approaches : last([...existing.approaches, approach], MAX_APPROACHES);
      next.set(key, touch({ ...existing, status: "asked", nudges: existing.nudges + 1, last_nudge_turn: turnOf(ev), last_nudge_at: ev.ts, last_approach: approach, approaches }));
      return next;
    }
    case "outcome": {
      if (!existing || existing.status === "done" || existing.status === "dropped") return existing ? (next.set(key, touch(existing)), next) : state;
      const r = clampReceptivity(Number(p.receptivity));
      const turn = turnOf(ev);
      const history = last([...existing.receptivity_history, r], MAX_HISTORY);
      const avg = mean(history);
      const note = clean(p.note, 160);
      const notes = note ? last([...existing.notes, note], MAX_NOTES) : existing.notes;
      const wait = backoff(r, Math.max(1, existing.nudges));
      const base: IntentionRecord = {
        ...existing,
        status: "open",
        receptivity: r,
        receptivity_history: history,
        receptivity_mean: avg,
        last_outcome_turn: turn,
        notes,
        next_eligible_turn: turn + wait.turns,
        next_eligible_at: new Date(Date.parse(ev.ts) + wait.ms).toISOString(),
        reason: null,
      };
      if (!existing.sticky && r === 0) next.set(key, touch({ ...base, status: "dropped", reason: DROP_SHUT_DOWN_REASON }));
      else if (!existing.sticky && existing.nudges >= 3 && avg !== null && avg < 3) next.set(key, touch({ ...base, status: "dropped", reason: DROP_LOW_RECEPTIVITY_REASON }));
      else next.set(key, touch(base));
      return next;
    }
    case "defer": {
      if (!existing || existing.status === "done" || existing.status === "dropped") return existing ? (next.set(key, touch(existing)), next) : state;
      const turn = turnOf(ev);
      const turns = Math.max(0, Math.min(MAX_TURNS, Math.floor(Number(p.turns ?? 0)) || 0));
      const ms = Math.max(0, Math.min(MAX_MS, Number(p.ms ?? 0) || 0));
      next.set(
        key,
        touch({
          ...existing,
          status: "open",
          next_eligible_turn: Math.max(existing.next_eligible_turn, turn + turns),
          next_eligible_at: new Date(Math.max(Date.parse(existing.next_eligible_at), Date.parse(ev.ts) + ms)).toISOString(),
          reason: clean(p.reason, 160) || "deferred",
        }),
      );
      return next;
    }
    case "done":
    case "drop": {
      const status: IntentionStatus = ev.op === "done" ? "done" : "dropped";
      if (!existing) {
        const fresh = opened(key, ev);
        if (ev.op === "drop" && fresh.sticky) next.set(key, { ...fresh, next_eligible_turn: turnOf(ev) + STICKY_DROP_TURNS, reason: STICKY_DROP_REASON });
        else next.set(key, { ...fresh, status, reason: clean(p.reason, 160) || status });
        return next;
      }
      if (existing.status === "done" || existing.status === "dropped") return next.set(key, touch(existing)), next;
      if (ev.op === "drop" && existing.sticky) {
        // core asks are never dropped, not even on request: a drop becomes a long snooze
        next.set(key, touch({ ...existing, status: "open", next_eligible_turn: Math.max(existing.next_eligible_turn, turnOf(ev) + STICKY_DROP_TURNS), reason: STICKY_DROP_REASON }));
        return next;
      }
      next.set(key, touch({ ...existing, status, reason: clean(p.reason, 160) || status }));
      return next;
    }
    default:
      return state;
  }
}

/** Fold one event. Pure: returns a new Map; the input is never mutated. */
export function applyIntention(state: Mind, ev: IntentionEvent): Mind {
  return applyEvent(state, ev);
}

/** Replay the ledger. Events are sorted by id first, so input order never matters. */
export function replayMind(events: IntentionEvent[]): Mind {
  const sorted = [...events].sort((a, b) => a.id - b.id);
  let state: Mind = new Map();
  for (const ev of sorted) state = applyIntention(state, ev);
  return state;
}

export function toIntentionRows(session_id: string, state: Mind): Intention[] {
  return [...state.values()].map((r) => ({ session_id, ...r, approaches: [...r.approaches], receptivity_history: [...r.receptivity_history], notes: [...r.notes], evidence_ids: [...r.evidence_ids] }));
}

// ---------------------------------------------------------------------------
// what the model sees
// ---------------------------------------------------------------------------

export const ON_MY_MIND_MAX_CHARS = 720;

export const byPriority = (a: Pick<IntentionRecord, "priority" | "key">, b: Pick<IntentionRecord, "priority" | "key">) => a.priority - b.priority || a.key.localeCompare(b.key);

/**
 * The turn's decision, made once by next_best_ask (src/lib/server/state.ts) and shown here so the
 * two never disagree: `raise` is the one intention to bring up this turn; `holds` says, per key,
 * why an intention the ledger calls eligible still waits (one ask at a time, Gmail only after the
 * need, the agent's name after the first useful result, ...).
 */
export interface MindPlan {
  raise: string | null;
  holds: Record<string, string>;
}

/**
 * Open intentions this channel may raise: the one to raise first, then asked (short, and it stops
 * a re-ask), then eligible, then snoozed.
 */
export function openIntentions(mind: Iterable<IntentionRecord>, channel: ServerChannel, turn: number, nowMs: number, raise: string | null = null): { rec: IntentionRecord; state: Eligibility }[] {
  const rank = (e: Eligibility, r: IntentionRecord) => (raise !== null && r.key === raise ? 0 : r.status === "asked" ? 1 : e.eligible ? 2 : 3);
  return [...mind]
    .filter((r) => (r.status === "open" || r.status === "asked") && r.channels.includes(channel))
    .map((rec) => ({ rec, state: eligibility(rec, turn, nowMs) }))
    .sort((a, b) => rank(a.state, a.rec) - rank(b.state, b.rec) || byPriority(a.rec, b.rec));
}

/** The eligible open intention with the highest priority, if any. */
export function nextIntention(mind: Iterable<IntentionRecord>, channel: ServerChannel, turn: number, nowMs: number): IntentionRecord | null {
  return openIntentions(mind, channel, turn, nowMs).find((x) => x.state.eligible)?.rec ?? null;
}

/**
 * ON MY MIND block for the prompt. One line per open intention (capped), plus one line
 * summarising what is done or dropped so the model never re-raises those. With a `plan`
 * the block is the same decision as next_best_ask: exactly one line reads "raise now" and
 * every other eligible line says why it waits, so "eligible" never contradicts the ask.
 */
export function onMyMindBlock(mind: Iterable<IntentionRecord>, channel: ServerChannel, turn: number, nowMs: number, plan?: MindPlan): string {
  const all = [...mind];
  const head = plan
    ? 'ON MY MIND (my list. Raise only the item marked "raise now", one per reply, woven into the help)'
    : "ON MY MIND (my own list: raise at most one per turn, only when eligible now, only if it serves the task)";
  if (all.length === 0) return `${head}\n(nothing yet)`;
  const lines: string[] = [head];
  let used = head.length;
  let truncated = false;
  for (const { rec, state } of openIntentions(all, channel, turn, nowMs, plan?.raise ?? null)) {
    // the plan may raise a snoozed item on purpose (the need, when there is nothing to do without one): the block follows the plan
    const raising = !!plan && rec.key === plan.raise && rec.status !== "asked";
    const status = raising ? (state.eligible ? "raise now" : `raise now (${state.why}, but nothing to do without it: new angle)`) : !plan || !state.eligible ? state.why : `not now (${plan.holds[rec.key] ?? "one ask at a time"})`;
    const bits: string[] = [`- ${rec.key}: ${status}`];
    if (rec.status === "asked") {
      // short on purpose: the point is "do not ask again"; the scoring comes next turn
      bits.push(`raised ${rec.nudges}×`);
    } else if (rec.nudges > 0) {
      const score = rec.receptivity === null ? "no reaction yet" : `${rec.receptivity}/10${rec.notes.length ? ` "${rec.notes[rec.notes.length - 1]}"` : ""}`;
      const last = rec.last_approach ? (rec.last_approach.length > 90 ? `${rec.last_approach.slice(0, 89)}…` : rec.last_approach) : null;
      bits.push(`raised ${rec.nudges}×${last ? ` (last: ${last})` : ""} → ${score}`);
    } else {
      bits.push(rec.goal);
    }
    // the next untried angle, for the item being raised (or every eligible one when no plan was given)
    if (rec.nudges > 0 && (raising || (!plan && state.eligible))) {
      const angle = nextAngle(rec);
      if (angle) bits.push(`try a different angle: ${angle}`);
    }
    const line = bits.join(" · ");
    if (used + line.length + 1 > ON_MY_MIND_MAX_CHARS) {
      truncated = true;
      break;
    }
    lines.push(line);
    used += line.length + 1;
  }
  if (truncated) lines.push("- (more omitted)");
  const settled = all.filter((r) => r.status === "done" || r.status === "dropped").sort(byPriority);
  if (settled.length) {
    const done = settled.filter((r) => r.status === "done").map((r) => r.key);
    const dropped = settled.filter((r) => r.status === "dropped").map((r) => `${r.key}${r.receptivity_mean !== null ? ` (${r.receptivity_mean}/10)` : ""}`);
    const parts: string[] = [];
    if (done.length) parts.push(`done: ${done.join(", ")}`);
    if (dropped.length) parts.push(`dropped, never again: ${dropped.join(", ")}`);
    lines.push(`- ${parts.join(" · ")}`);
  }
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// detecting that the agent raised something, and how the user took it
// ---------------------------------------------------------------------------

export interface DetectedNudge {
  key: string;
  approach: string;
}

/** Bubbles (or utterances) that ask something, whitespace-normalised. */
const asking = (bubbles: string[]) => bubbles.map((b) => b.replace(/\s+/g, " ").trim()).filter((b) => b.includes("?"));

/**
 * Which open intentions did this reply raise? A bubble that asks something and matches the
 * intention's cue counts; so does the first asking bubble while next_best_ask pointed at the
 * intention's slot (the model was told to ask it, however it framed it). Gmail is the exception:
 * its ask is the link card (request_gmail_connect logs that nudge itself) or explicit words; any
 * other question while Gmail is next is task talk, and counting it would inflate the backoff.
 * The whole bubble is the approach (it carries the framing). One nudge per key. `raiseKey` is the
 * intention the plan told the model to raise this turn; a slot-less one (the call offer) gets the
 * credit the same way a slot does, so a question phrased outside its cue still counts.
 */
export function detectNudges(bubbles: string[], mind: Iterable<IntentionRecord>, nbaSlot: SlotName | null, channel: ServerChannel, raiseKey: string | null = null): DetectedNudge[] {
  const questions = asking(bubbles);
  if (questions.length === 0) return [];
  // a question that plainly asks for another built-in (the name, when the plan said need) belongs to that one, never to the plan's slot
  const cued = new Set(questions.filter((q) => BUILTIN_INTENTIONS.some((b) => b.cue.test(q))));
  const out: DetectedNudge[] = [];
  const seen = new Set<string>();
  for (const rec of mind) {
    if (rec.status === "done" || rec.status === "dropped" || !rec.channels.includes(channel)) continue;
    const b = builtinFor(rec.key);
    const hit = b ? questions.find((q) => b.cue.test(q)) : undefined;
    const viaNba = nbaSlot !== null && rec.slot === nbaSlot && rec.slot !== "gmail" && !cued.has(questions[0]) ? questions[0] : undefined;
    const viaRaise = raiseKey !== null && rec.key === raiseKey && rec.slot === null && !cued.has(questions[0]) ? questions[0] : undefined;
    const approach = hit ?? viaNba ?? viaRaise;
    if (!approach || seen.has(rec.key)) continue;
    seen.add(rec.key);
    out.push({ key: rec.key, approach: approach.slice(0, 140) });
  }
  return out;
}

export interface ReceptivityRead {
  receptivity: number;
  signal: ReceptivitySignal;
  note: string;
}

/**
 * A tapback on the agent's last ask, read as a reaction: a heart or thumbs-up is a yes, a thumbs-down a
 * no; the other glyphs (haha, !!, ?) and any other emoji say nothing about the ask and are not scored.
 */
export function tapbackReceptivity(kind: { tapback?: string | null; emoji?: string | null }): ReceptivityRead | null {
  const t = kind.tapback ?? "";
  const e = kind.emoji ?? "";
  if (t === "heart" || t === "thumbsUp" || /^(👍|❤️|❤|🔥|✅|🙌|💯|👌)/.test(e)) return { receptivity: 9, signal: "accepted", note: `tapback: ${t || e}` };
  if (t === "thumbsDown" || /^(👎|❌|🙅)/.test(e)) return { receptivity: 2, signal: "declined", note: `tapback: ${t || e}` };
  return null;
}

/** The glyph iMessage shows for a tapback kind, for transcripts the model reads. */
export function tapbackGlyph(kind: { tapback?: string | null; emoji?: string | null }): string {
  switch (kind.tapback) {
    case "heart":
      return "❤️";
    case "thumbsUp":
      return "👍";
    case "thumbsDown":
      return "👎";
    case "haha":
      return "😂";
    case "exclaim":
      return "‼️";
    case "question":
      return "❓";
    default:
      return kind.emoji ?? "👍";
  }
}

/** Model-free fallback read of a reply to something the agent raised. Coarse on purpose. */
export function heuristicReceptivity(reply: string): ReceptivityRead {
  const t = reply.toLowerCase().replace(/[^a-z0-9' ]+/g, " ").replace(/\s+/g, " ").trim();
  if (!t) return { receptivity: 3, signal: "ignored", note: "no reply" };
  if (/\b(stop asking|quit asking|don'?t ask( me)? again|leave (it|me) alone|never|drop it|enough)\b/.test(t)) return { receptivity: 0, signal: "shut_down", note: "told me to stop" };
  if (/^(no|nope|nah|not interested|no thanks|no thank you|pass|hard pass)\b/.test(t) || /\b(don'?t want|not (going to|gonna)|rather not|i'?m good without|no need)\b/.test(t)) {
    return { receptivity: 2, signal: "declined", note: "clear no" };
  }
  if (/\b(later|maybe|not now|not yet|another time|some other time|eventually|next week|tomorrow|we'?ll see|let me think)\b/.test(t)) return { receptivity: 5, signal: "deferred", note: "said maybe later" };
  if (/^(yes|yeah|yep|yup|sure|ok|okay|sounds good|let'?s do it|go ahead|do it|please|fine|alright|absolutely|of course)\b/.test(t) || /\b(connected|just did|i did|done|here you go|it'?s)\b/.test(t)) {
    return { receptivity: 9, signal: "accepted", note: "said yes" };
  }
  if (/\b(what|why|how|which|does|is it|can i|do i)\b.*$/.test(t) && /\?/.test(reply)) return { receptivity: 7, signal: "accepted", note: "asked a follow-up question" };
  return { receptivity: 3, signal: "ignored", note: "moved on to something else" };
}
