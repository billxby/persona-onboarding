import { mindFor } from "@/lib/memory/mind";
import { callOfferAnswer, CLIP_SKIP, clipStateFrom, type CallOfferAnswer, type ClipState, type ClipStep } from "@/lib/shared/clip";
import type { EventRow, SessionRow } from "@/lib/shared/types";
import { recordCallOfferAnswer } from "./callOffer";
import { googleConfigured } from "./env";
import { insertEvent, listEvents } from "./messages";
import { runTool } from "./tools/run";

/**
 * The App Clip's onboarding writes each answer the moment it is given (DESIGN §19): the session id
 * in the invocation URL is the attribution (our stand-in for "launched with the phone number").
 * Everything goes through the same tools the chat uses (`set_slot` validates, records provenance
 * as `clip`, settles the intention, posts the contact card), so nothing here is a second path.
 */

export interface ClipAnswerResult {
  session: SessionRow;
  ok: boolean;
  error?: string;
  state: ClipState;
}

export async function clipState(session: SessionRow): Promise<ClipState> {
  const mind = await mindFor(session.id).catch(() => []);
  return clipStateFrom(session, mind, googleConfigured());
}

export async function recordClipAnswer(session: SessionRow, step: ClipStep, value: string): Promise<ClipAnswerResult> {
  const v = value.trim();
  let out: { session: SessionRow; ok: boolean; error?: string };
  let answer: CallOfferAnswer | undefined;
  switch (step) {
    case "user_name":
    case "agent_name": {
      const r = await runTool({ session, channel: "text", source: "clip" }, "set_slot", { slot: step, value: v });
      out = { session: r.session, ok: r.result.ok, error: r.result.error };
      break;
    }
    case "gmail": {
      // only the skip comes this way; OAuth and the demo inbox write the rest through markGmail
      if (v.toLowerCase() !== CLIP_SKIP) {
        out = { session, ok: false, error: "Google connects through the Continue with Google button, not here" };
        break;
      }
      const r = await runTool({ session, channel: "text", source: "clip" }, "set_slot", { slot: "gmail", value: CLIP_SKIP });
      out = { session: r.session, ok: r.result.ok, error: r.result.error };
      break;
    }
    case "call_offer": {
      answer = callOfferAnswer(v);
      out = { session: await recordCallOfferAnswer(session, answer, { via: "clip" }), ok: true };
      break;
    }
  }
  // the name itself is already in slot_set; here only what the step did (never the text twice)
  await insertEvent(out.session.id, "app_clip_answer", { step, ok: out.ok, skipped: v.toLowerCase() === CLIP_SKIP, ...(answer ? { answer } : {}), ...(out.error ? { error: out.error } : {}) });
  return { ...out, state: await clipState(out.session) };
}

/** What the clip captured since it was last opened, for the relay hint when it closes. */
export interface ClipCapture {
  answered: ClipStep[];
  skipped: ClipStep[];
  call_offer?: CallOfferAnswer;
  /** the Google consent flow was started from the clip (a `pending` left behind is the clip's) */
  gmail_started_in_clip: boolean;
  /** the clip was opened at least once */
  opened: boolean;
}

export function clipCaptureFrom(events: EventRow[]): ClipCapture {
  let lastOpened = -1;
  events.forEach((e, i) => {
    if (e.type === "app_clip_opened") lastOpened = i;
  });
  const since = events.slice(Math.max(0, lastOpened));
  const cap: ClipCapture = { answered: [], skipped: [], gmail_started_in_clip: false, opened: lastOpened >= 0 };
  for (const e of since) {
    const p = e.payload ?? {};
    if (e.type === "app_clip_answer") {
      const step = p.step as ClipStep;
      if (p.ok === false) continue;
      if (step === "call_offer") {
        cap.call_offer = (p.answer as CallOfferAnswer) ?? "skip";
        continue;
      }
      if (p.skipped) {
        if (!cap.skipped.includes(step)) cap.skipped.push(step);
      } else if (!cap.answered.includes(step)) cap.answered.push(step);
    } else if (e.type === "oauth_started" && p.via === "clip") {
      cap.gmail_started_in_clip = true;
    } else if (e.type === "oauth_success" && cap.gmail_started_in_clip && !cap.answered.includes("gmail")) {
      cap.answered.push("gmail");
    }
  }
  return cap;
}

export async function clipCapture(session_id: string): Promise<ClipCapture> {
  const events = await listEvents(session_id, ["app_clip_opened", "app_clip_answer", "oauth_started", "oauth_success"]);
  return clipCaptureFrom(events);
}

/**
 * The relay hint for the chat turn after the clip closes (DESIGN §19): built from the session row and the
 * capture, never from anything the client claims. `ringing` = the server already rang the phone.
 */
export function clipClosedHint(s: SessionRow, cap: ClipCapture, ringing: boolean): string {
  const bits: string[] = [];
  bits.push(`name ${s.user_name ? s.user_name : cap.skipped.includes("user_name") ? "skipped" : "not given"}`);
  bits.push(`what to call you ${s.agent_name ? s.agent_name : cap.skipped.includes("agent_name") ? "skipped (Persona is fine)" : "not given"}`);
  bits.push(
    `Google ${s.gmail_status === "connected" ? `connected as ${s.gmail_email ?? "?"}` : s.gmail_status === "declined" ? "skipped for now" : s.gmail_status === "failed" ? "started but not finished" : "not reached"}`,
  );
  bits.push(`call ${cap.call_offer === "yes" ? (ringing ? "yes, you are ringing them now" : "yes") : cap.call_offer === "no" ? "no, keep it in text and never offer again" : cap.call_offer === "skip" ? "left unanswered" : "not asked"}`);
  const partial = cap.answered.length + cap.skipped.length === 0 || !cap.call_offer;
  const lines = [
    `Back from the Persona App Clip (the app's setup screens). Set up there: ${bits.join("; ")}.`,
    ringing
      ? "No question this turn: one short line saying you're calling now, then stop."
      : "In one or two short bubbles: acknowledge what they set up (use their name; if they named you, own the name), never re-ask any of it, then continue with next_best_ask.",
  ];
  if (partial && !ringing) lines.push("They left before the end; what is missing is still on your mind. Ask only what next_best_ask names, or nothing.");
  if (!ringing && (s.gmail_status === "declined" || s.gmail_status === "failed")) {
    lines.push(
      s.need
        ? `Google was passed on: give ONE concrete plan for "${s.need}" without it (your exact steps, what you need from them, the first thing you do now). No Gmail talk unless they ask.`
        : "Google was passed on: no Gmail talk; once they name what they want done, plan it without Gmail.",
    );
  }
  return lines.join(" ");
}
