import { eligibility, intentionForSlot, nextAngle, type IntentionRecord } from "@/lib/memory/intentions";
import type { Intention, NextBestAsk, ServerChannel, SessionRow, SlotName } from "@/lib/shared/types";

/** Pure helpers over the session row: what to ask next, the STATE block, attempts and question history. */

export const asks = (s: SessionRow, slot: SlotName) => s.attempts?.[slot] ?? 0;
export const isSkipped = (s: SessionRow, slot: SlotName) => asks(s, slot) >= 3;
export const isGraduated = (s: SessionRow) => s.phase === "graduated" || !!s.graduated_at;
export const turnOf = (s: SessionRow) => (typeof s.turn === "number" ? s.turn : 0);

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
 * What to ask next. `mind` (the intentions projection) makes it receptivity-aware: a slot whose
 * intention is snoozed, asked, dropped or done is never the next ask, and a Gmail that was declined
 * earlier can come back once its intention is eligible again (main mode only, as the way to do the task).
 */
export function nextBestAsk(s: SessionRow, channel: ServerChannel, mind?: MindView, now: number = Date.now()): NextBestAsk {
  if (s.gmail_status === "pending") {
    return { slot: null, hint: "Gmail connect is pending. Wait for it, do not re-ask. Keep helping with the need meanwhile." };
  }
  const gate = (slot: SlotName) => slotGate(s, slot, mind, now);
  const gName = gate("user_name");
  const gNeed = gate("need");
  const gGmail = gate("gmail");
  const gAgent = gate("agent_name");

  const nameMissing = !s.user_name && !isSkipped(s, "user_name") && !gName.blocked;
  const needMissing = !s.need && !gNeed.blocked;
  const gmailMissing = s.gmail_status === "none" && !isSkipped(s, "gmail") && !gGmail.blocked;
  /** declined or failed earlier, but the intention has come back around (only ever with a mind view) */
  const gmailRetry = !!mind && (s.gmail_status === "declined" || s.gmail_status === "failed") && !gGmail.blocked && !!gGmail.rec && gGmail.rec.status === "open";
  const agentMissing = !s.agent_name && !isSkipped(s, "agent_name") && !gAgent.blocked;
  const valueDone = !!s.value_moment_at || isGraduated(s);

  const onHold = (): string => {
    const notes = (["user_name", "need", "gmail", "agent_name"] as SlotName[])
      .map((slot) => ({ slot, g: gate(slot) }))
      .filter(({ slot, g }) => g.blocked && g.rec && (g.rec.status === "open" || g.rec.status === "asked") && (slot === "gmail" ? s.gmail_status !== "connected" : !s[slot]))
      .map(({ g }) => `${g.rec!.key} ${g.why}`);
    return notes.length ? ` On hold: ${notes.join("; ")}.` : "";
  };

  if (s.mode === "onboarding") {
    if (nameMissing) {
      return {
        slot: "user_name",
        hint:
          asks(s, "user_name") >= 2
            ? "Two misses on the name: offer a choice ('a first name, or I just go with friend?'), then move on."
            : `Ask what to call them, once, and use the name in your next sentence.${receptivityNote(gName.rec)}`,
      };
    }
    if (needMissing) {
      return {
        slot: "need",
        hint:
          asks(s, "need") >= 2
            ? "Two misses on the need: offer three concrete options (inbox cleanup, cancelling subscriptions, booking an appointment) and ask which."
            : `Ask for one thing to take off their plate this week. Paraphrase it back when they answer.${receptivityNote(gNeed.rec)}`,
      };
    }
    if (gmailMissing) {
      return { slot: "gmail", hint: `Frame Gmail as the way to do THAT task, call request_gmail_connect, then wait.${receptivityNote(gGmail.rec)}` };
    }
    return { slot: null, hint: `Deliver the value moment now; call graduate once the task is in motion.${onHold()}` };
  }

  // main mode: value before completeness; everything else is a soft nudge paced by receptivity
  const gmailSoft = mind ? gmailMissing || gmailRetry : gmailMissing && asks(s, "gmail") < 2 && !valueDone;
  if (gmailSoft) {
    return {
      slot: "gmail",
      hint: gmailRetry
        ? `They passed on Gmail before and enough time has gone by. Only if it is clearly the way to do what they are asking now: offer it once more, lightly, from a new angle; if they pass again, back off much further.${receptivityNote(gGmail.rec)}`
        : `Only as the way to do the stated task: offer Gmail once (request_gmail_connect), read-only, then wait.${receptivityNote(gGmail.rec)}`,
    };
  }
  const nameSoft = mind ? nameMissing && (valueDone || s.gmail_status !== "none") : nameMissing && asks(s, "user_name") < 2 && (valueDone || s.gmail_status !== "none");
  if (nameSoft) {
    return { slot: "user_name", hint: `Soft nudge, while doing the task: ask what to call them. 'friend' is fine if they pass.${receptivityNote(gName.rec)}` };
  }
  const agentSoft = mind ? agentMissing && valueDone : agentMissing && asks(s, "agent_name") < 1 && valueDone;
  if (channel === "text" && agentSoft) {
    return { slot: "agent_name", hint: `Ask what they'd like to call you. Default is Persona. Save it with set_slot(agent_name).${receptivityNote(gAgent.rec)}` };
  }
  return { slot: null, hint: `Help with the need. Do not ask for anything else unless it serves the task.${onHold()}` };
}

const fmt = (v: string | null | undefined, empty = "(empty)") => (v ? v : empty);

/** The STATE block from DESIGN.md §9. Re-injected every turn; the model never keeps state itself. */
export function stateBlock(s: SessionRow, channel: ServerChannel, mind?: MindView, now: number = Date.now()): string {
  const name = s.user_name
    ? `${s.user_name}${s.confirmed?.user_name ? " (confirmed)" : ""}`
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
  const nba = nextBestAsk(s, channel, mind, now);
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
