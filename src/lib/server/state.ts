import { builtinFor, builtinForSlot, byPriority, eligibility, intentionForSlot, nextAngle, OFFER_CALL_KEY, receptivityBand, type IntentionRecord, type MindPlan } from "@/lib/memory/intentions";
import type { Intention, NextBestAsk, ServerChannel, SessionRow, SlotName } from "@/lib/shared/types";

/** Pure helpers over the session row: what to ask next, the STATE block, attempts and question history. */

export const asks = (s: SessionRow, slot: SlotName) => s.attempts?.[slot] ?? 0;
/** Legacy pacing (no mind view): three misses retire a slot. With a mind the ledger paces instead and nothing retires. */
export const isSkipped = (s: SessionRow, slot: SlotName) => asks(s, slot) >= 3;
export const isGraduated = (s: SessionRow) => s.phase === "graduated" || !!s.graduated_at;
export const turnOf = (s: SessionRow) => (typeof s.turn === "number" ? s.turn : 0);

/**
 * In main mode the agent's own name waits for the first useful result, or for this many assistant
 * turns, whichever comes first: a session that never connects Gmail never logs a value moment
 * (only the email tools do), and the ask must not be held hostage to that.
 */
export const AGENT_NAME_FLOOR_TURN = 6;

const SLOTS: SlotName[] = ["user_name", "need", "gmail", "agent_name"];

/** What is on the agent's mind; `Intention` rows or pure records both work. */
export type MindView = Iterable<IntentionRecord | Intention>;

interface SlotGate {
  /** the intention says: not now */
  blocked: boolean;
  /** why, in the intention's words ("snoozed, 4 more turns", "dropped") */
  why: string | null;
  rec: IntentionRecord | Intention | null;
}

/**
 * Whether the intention behind a slot allows raising it now. Without a mind view
 * (legacy callers, unit tests) nothing is blocked and the attempts counters rule.
 */
export function slotGate(s: SessionRow, slot: SlotName, mind: MindView | undefined, now: number): SlotGate {
  if (!mind) return { blocked: false, why: null, rec: null };
  const rec = intentionForSlot(mind, slot);
  if (!rec) return { blocked: false, why: null, rec: null };
  const e = eligibility(rec, turnOf(s), now);
  return { blocked: !e.eligible, why: e.eligible ? null : e.why, rec };
}

const receptivityNote = (rec: IntentionRecord | Intention | null) => {
  if (!rec || rec.nudges === 0) return "";
  const angle = nextAngle(rec);
  const score = rec.receptivity !== null ? `, receptivity ${rec.receptivity}/10` : "";
  const note = rec.notes.length ? ` ("${rec.notes[rec.notes.length - 1]}")` : "";
  return ` Raised ${rec.nudges}× before${score}${note}.${angle ? ` Different angle this time: ${angle}.` : ""}`;
};

/**
 * One decision per turn: what to ask (`pick` = next_best_ask) and why every other intention the
 * ledger calls eligible still waits (`holds`, by intention key). The ON MY MIND block renders the
 * same plan, so the model never sees "eligible now" next to "ask nothing".
 */
export interface AskPlan {
  pick: NextBestAsk;
  holds: Record<string, string>;
  /** the intention behind the pick, or the top eligible ad-hoc one when there is nothing to collect */
  raise: string | null;
}

export const HOLD_ONE_AT_A_TIME = "one ask at a time";
export const HOLD_AFTER_NEED = "after the need, as the means to it";
export const HOLD_AFTER_VALUE = "after the first useful result";
export const HOLD_GMAIL_PENDING = "Gmail link pending";
export const HOLD_AFTER_CALL_OFFER = "after the call offer";
export const HOLD_CALL_OFFER_ASKED = "waiting on the call offer";
export const HOLD_CHANNEL_CHOSEN = "they already chose a channel";
/** The call offer is made at most this many times (a second, lighter try only after the first was merely ignored). */
export const CALL_OFFER_MAX_NUDGES = 2;

/** The one first-time call offer (DESIGN §7): the pick's hint when it is the thing to raise. */
export const CALL_OFFER_HINT =
  'They just said what they want done. Offer ONE thing, lightly: a quick call to set up the rest by voice, or keep going here. One question, no pressure. Yes → call switch_channel("call") and say you\'re calling now. No → call intention(outcome, offer_call, 2) and carry on here.';

/**
 * What to ask next, and what waits. `mind` (the intentions projection) makes it receptivity-aware:
 * a slot whose intention is asked, snoozed or done is never the pick, nothing is ever retired by the
 * attempts counters, a forgotten need comes back in main mode, and a Gmail that was declined earlier
 * returns once its intention is eligible again (main mode only, as the way to do the task). The call
 * offer (`offer_call`, no slot) is raised once, right after the need and before Gmail, in text only,
 * and never once a channel is chosen (`channel_pref` set: a yes, a no, or a hangup).
 */
export function askPlan(s: SessionRow, channel: ServerChannel, mind?: MindView, now: number = Date.now()): AskPlan {
  const holds: Record<string, string> = {};
  const holdKey = (key: string, why: string) => {
    if (!(key in holds)) holds[key] = why;
  };
  const hold = (slot: SlotName, why: string) => {
    const key = builtinForSlot(slot)?.key;
    if (key) holdKey(key, why);
  };
  const finish = (pick: NextBestAsk, raise?: string): AskPlan => withAdHoc(s, channel, mind, now, pick, holds, raise);

  // the call offer: one built-in without a slot, paced like the others
  const offer = mind ? [...mind].find((r) => r.key === OFFER_CALL_KEY) : undefined;
  const offerLive = !!offer && (offer.status === "open" || offer.status === "asked");
  const channelChosen = s.channel_pref !== null || s.call_state !== "idle";
  const offerAsked = offerLive && offer!.status === "asked" && channel === "text" && !channelChosen;
  const offerNow =
    offerLive && offer!.status === "open" && channel === "text" && !!s.need && !channelChosen && offer!.nudges < CALL_OFFER_MAX_NUDGES && eligibility(offer!, turnOf(s), now).eligible;
  if (offerLive && !offerNow && !offerAsked) holdKey(OFFER_CALL_KEY, channelChosen ? HOLD_CHANNEL_CHOSEN : !s.need ? HOLD_AFTER_NEED : offer!.nudges >= CALL_OFFER_MAX_NUDGES ? "offered twice, let it rest" : eligibility(offer!, turnOf(s), now).why);

  if (s.gmail_status === "pending") {
    for (const slot of SLOTS) hold(slot, HOLD_GMAIL_PENDING);
    holdKey(OFFER_CALL_KEY, HOLD_GMAIL_PENDING);
    return finish({ slot: null, hint: "Gmail connect is pending. Wait for it, do not re-ask. Keep helping with the need meanwhile." });
  }
  if (offerAsked) {
    for (const slot of SLOTS) hold(slot, HOLD_CALL_OFFER_ASKED);
    return finish({ slot: null, hint: "You just offered a call; wait for their answer. A yes means switch_channel(\"call\"); a no means you carry on here and never offer again. Help with anything else they said meanwhile." });
  }
  const gate = (slot: SlotName) => slotGate(s, slot, mind, now);
  const gName = gate("user_name");
  const gNeed = gate("need");
  const gGmail = gate("gmail");
  const gAgent = gate("agent_name");

  // with a mind view the ledger paces every ask (core asks are sticky, they only back off); without one the counters retire a slot after three misses
  const retired = (slot: SlotName) => (mind ? false : isSkipped(s, slot));
  const nameMissing = !s.user_name && !retired("user_name") && !gName.blocked;
  const needMissing = !s.need && !gNeed.blocked;
  const gmailMissing = s.gmail_status === "none" && !retired("gmail") && !gGmail.blocked;
  /** declined or failed earlier, but the intention has come back around (only ever with a mind view) */
  const gmailRetry = !!mind && (s.gmail_status === "declined" || s.gmail_status === "failed") && !gGmail.blocked && !!gGmail.rec && gGmail.rec.status === "open";
  const agentMissing = !s.agent_name && !retired("agent_name") && !gAgent.blocked;
  const valueDone = !!s.value_moment_at || isGraduated(s);
  const inMotion = valueDone || turnOf(s) >= AGENT_NAME_FLOOR_TURN;

  const onHold = (): string => {
    const notes = SLOTS.map((slot) => ({ slot, g: gate(slot) }))
      .filter(({ slot, g }) => g.blocked && g.rec && (g.rec.status === "open" || g.rec.status === "asked") && (slot === "gmail" ? s.gmail_status !== "connected" : !s[slot]))
      .map(({ g }) => `${g.rec!.key} ${g.why}`);
    return notes.length ? ` On hold: ${notes.join("; ")}.` : "";
  };

  if (s.mode === "onboarding") {
    if (agentMissing) hold("agent_name", `text only, ${HOLD_AFTER_VALUE}`);
    if (nameMissing) {
      if (needMissing) hold("need", HOLD_ONE_AT_A_TIME);
      if (gmailMissing) hold("gmail", s.need ? HOLD_ONE_AT_A_TIME : HOLD_AFTER_NEED);
      return finish({
        slot: "user_name",
        hint:
          asks(s, "user_name") >= 2
            ? "Two misses on the name: offer a choice ('a first name, or I just go with friend?'), then move on."
            : `Get their name, once; from then on use it.${receptivityNote(gName.rec)}`,
      });
    }
    if (needMissing) {
      if (gmailMissing) hold("gmail", HOLD_AFTER_NEED);
      return finish({
        slot: "need",
        hint:
          asks(s, "need") >= 2
            ? "Two misses on the need: offer three concrete options (inbox cleanup, cancelling subscriptions, booking an appointment) and ask which."
            : `Get the task they want handled this week; when it comes, a few of their words back, then start.${receptivityNote(gNeed.rec)}`,
      });
    }
    // the need is known: one call offer before Gmail (text only, once)
    if (offerNow) {
      if (gmailMissing) hold("gmail", HOLD_AFTER_CALL_OFFER);
      return finish({ slot: null, hint: `${CALL_OFFER_HINT}${receptivityNote(offer!)}` }, OFFER_CALL_KEY);
    }
    // Gmail only as the way to do THEIR task: never before a need is known
    if (gmailMissing && (s.need || !mind)) {
      return finish({ slot: "gmail", hint: `Frame Gmail as the way to do THAT task, call request_gmail_connect, then wait.${receptivityNote(gGmail.rec)}` });
    }
    if (gmailMissing) hold("gmail", HOLD_AFTER_NEED);
    if (!s.need && gNeed.rec && (gNeed.rec.status === "open" || gNeed.rec.status === "asked")) {
      // No need, and nothing to do without one. The need is never skipped (DESIGN §6), so a snooze on it only shapes the framing:
      // let the question pass (3–4), noncommittal (5–6) or warm but no task named (7–8) → ask again from a new angle; a clear no → respect it.
      const r = gNeed.rec.receptivity;
      if (gNeed.rec.status === "asked") return finish({ slot: null, hint: "The task ask is out; wait for the answer and help with anything else they said." });
      const band = r === null ? null : receptivityBand(r);
      if (band !== null && band >= 2) {
        const menu = "three concrete options (inbox cleanup, cancelling a subscription, booking an appointment)";
        const options = asks(s, "need") >= 2 ? ` or offer ${menu} and ask which` : "";
        const hint =
          band === 3
            ? `Still no need and nothing to do without one: they were noncommittal or said later (${r}/10). One light menu, ${menu}, no pressure; if they plainly said later, say you'll check back and leave it there.`
            : `Still no need and nothing to do without one: ${band === 2 ? `they let the question pass (${r}/10)` : `they were open (${r}/10) but named no task`}, so bridge back and ask once more, concretely, from a new angle${options}.`;
        return finish({ slot: "need", hint: `${hint}${receptivityNote(gNeed.rec)}` });
      }
      return finish({ slot: null, hint: `No need yet and they passed on stating one (${r === null ? "no score" : `${r}/10`}; ${gNeed.why}). Don't ask now: help with whatever they raise, offer one thing you could start on, or graduate if they want to get going.` });
    }
    return finish({ slot: null, hint: `Deliver the value moment now; call graduate once the task is in motion.${onHold()}` });
  }

  // main mode: value before completeness; everything else is a soft nudge paced by receptivity
  const gmailSoft = mind ? gmailMissing || gmailRetry : gmailMissing && asks(s, "gmail") < 2 && !valueDone;
  const nameSoft = mind ? nameMissing : nameMissing && asks(s, "user_name") < 2 && (valueDone || s.gmail_status !== "none");
  const agentSoft = mind ? agentMissing && inMotion : agentMissing && asks(s, "agent_name") < 1 && valueDone;
  if (agentMissing && !inMotion) hold("agent_name", HOLD_AFTER_VALUE);

  // the need went missing again (forgotten): it is the whole point, so it comes back first (mind only; legacy callers never asked it here)
  if (mind && needMissing) {
    if (gmailSoft) hold("gmail", HOLD_AFTER_NEED);
    if (nameSoft) hold("user_name", HOLD_ONE_AT_A_TIME);
    if (agentSoft) hold("agent_name", HOLD_ONE_AT_A_TIME);
    return finish({ slot: "need", hint: `No task on file: ask what they want handled this week, then act on it.${receptivityNote(gNeed.rec)}` });
  }
  // right after the need, before Gmail: the one call offer (DESIGN §7)
  if (offerNow) {
    if (gmailSoft) hold("gmail", HOLD_AFTER_CALL_OFFER);
    if (nameSoft) hold("user_name", HOLD_ONE_AT_A_TIME);
    if (agentSoft) hold("agent_name", HOLD_ONE_AT_A_TIME);
    return finish({ slot: null, hint: `${CALL_OFFER_HINT}${receptivityNote(offer!)}` }, OFFER_CALL_KEY);
  }
  if (gmailSoft && (s.need || !mind)) {
    if (nameSoft) hold("user_name", HOLD_ONE_AT_A_TIME);
    if (agentSoft) hold("agent_name", HOLD_ONE_AT_A_TIME);
    return finish({
      slot: "gmail",
      hint: gmailRetry
        ? `They passed on Gmail before and enough time has gone by. Only if it is clearly the way to do what they are asking now: offer it once more, lightly, from a new angle; if they pass again, back off much further.${receptivityNote(gGmail.rec)}`
        : `Only as the way to do the stated task: offer Gmail once (request_gmail_connect), read-only, then wait.${receptivityNote(gGmail.rec)}`,
    });
  }
  if (gmailSoft) hold("gmail", HOLD_AFTER_NEED);
  if (nameSoft) {
    if (agentSoft) hold("agent_name", HOLD_ONE_AT_A_TIME);
    return finish({ slot: "user_name", hint: `Soft nudge, while doing the task: ask what to call them. 'friend' is fine if they pass.${receptivityNote(gName.rec)}` });
  }
  if (channel === "text" && agentSoft) {
    return finish({ slot: "agent_name", hint: `Ask what they'd like to call you. Default is Persona. Save it with set_slot(agent_name).${receptivityNote(gAgent.rec)}` });
  }
  return finish({ slot: null, hint: `Help with the need. Do not ask for anything else unless it serves the task.${onHold()}` });
}

/**
 * The agent's own follow-ups (intentions without a slot) join the plan last: raised only when
 * nothing is to be collected, one at a time, top priority first.
 */
function withAdHoc(s: SessionRow, channel: ServerChannel, mind: MindView | undefined, now: number, pick: NextBestAsk, holds: Record<string, string>, raiseKey?: string): AskPlan {
  let raise: string | null = raiseKey ?? (pick.slot ? (builtinForSlot(pick.slot)?.key ?? null) : null);
  if (mind) {
    // the built-in without a slot (the call offer) is paced by askPlan itself, never as an ad-hoc follow-up
    const adhoc = [...mind].filter((r) => r.slot === null && !builtinFor(r.key) && r.status === "open" && r.channels.includes(channel) && eligibility(r, turnOf(s), now).eligible).sort(byPriority);
    for (const r of adhoc) {
      if (raise === null) {
        raise = r.key;
        pick = { ...pick, hint: `${pick.hint} On your mind: ${r.key} is eligible now; raise it if it fits.` };
      } else if (!(r.key in holds)) {
        holds[r.key] = HOLD_ONE_AT_A_TIME;
      }
    }
  }
  return { pick, holds, raise };
}

/** What to ask next (the plan's pick). See askPlan. */
export function nextBestAsk(s: SessionRow, channel: ServerChannel, mind?: MindView, now: number = Date.now()): NextBestAsk {
  return askPlan(s, channel, mind, now).pick;
}

export const mindPlan = (plan: AskPlan): MindPlan => ({ raise: plan.raise, holds: plan.holds });

const fmt = (v: string | null | undefined, empty = "(empty)") => (v ? v : empty);

/** The STATE block from DESIGN.md §9. Re-injected every turn; the model never keeps state itself. */
export function stateBlock(s: SessionRow, channel: ServerChannel, mind?: MindView, now: number = Date.now(), plan: AskPlan = askPlan(s, channel, mind, now)): string {
  const name = s.user_name
    ? `${s.user_name}${s.confirmed?.user_name ? " (confirmed)" : ""}`
    : mind
      ? slotGate(s, "user_name", mind, now).blocked
        ? "(empty, resting: don't ask now, 'friend' if needed)"
        : "(empty)"
      : isSkipped(s, "user_name")
        ? "(skipped, use 'friend')"
        : "(empty)";
  const gmail = s.gmail_status === "connected" ? `connected as ${s.gmail_email ?? "?"}` : s.gmail_status;
  const agent = s.agent_name ? s.agent_name : channel === "call" ? "(empty, text only, never ask on a call)" : "(empty, text only)";
  const attempts = Object.entries(s.attempts ?? {})
    .filter(([, n]) => (n ?? 0) > 0)
    .map(([k, n]) => `${k}=${n}`)
    .join(", ");
  const last = JSON.stringify((s.last_questions ?? []).slice(-5));
  const nba = plan.pick;
  return [
    "STATE (never ask for a filled slot)",
    `user_name: ${name} | need: ${fmt(s.need)} | gmail: ${gmail} | agent_name: ${agent}`,
    `attempts: ${attempts || "none"} | last_questions: ${last} | channel: ${channel} | mode: ${s.mode} | phase: ${s.phase} | channel_pref: ${fmt(s.channel_pref, "none")} | call_state: ${s.call_state} | turn: ${turnOf(s)}`,
    `next_best_ask: ${nba.slot ?? "none"} — ${nba.hint}`,
  ].join("\n");
}

export function bumpAttempt(s: SessionRow, slot: SlotName): Partial<SessionRow> {
  return { attempts: { ...(s.attempts ?? {}), [slot]: asks(s, slot) + 1 } };
}

export function pushQuestion(s: SessionRow, q: string): Partial<SessionRow> {
  const trimmed = q.trim();
  if (!trimmed) return {};
  const next = [...(s.last_questions ?? []).filter((x) => x !== trimmed), trimmed].slice(-5);
  return { last_questions: next };
}

export const normalizeQuestion = (q: string) => q.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();

/** true when `q` repeats one of the last questions verbatim (after normalisation) */
export function isRepeatQuestion(s: SessionRow, q: string): boolean {
  const n = normalizeQuestion(q);
  return n.length > 0 && (s.last_questions ?? []).some((x) => normalizeQuestion(x) === n);
}
