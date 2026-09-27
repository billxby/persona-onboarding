import { OFFER_CALL_KEY } from "@/lib/memory/intentions";
import { recordNudge, recordOutcome, settleIfOpen } from "@/lib/memory/mind";
import type { CallOfferAnswer } from "@/lib/shared/clip";
import type { SessionRow } from "@/lib/shared/types";
import { insertEvent } from "./messages";
import { patchSession } from "./session";
import { turnOf } from "./state";

/**
 * The one first-time call offer (DESIGN §7): "want me to call you to set up the rest?". Asked once in
 * text right after the need, or on the App Clip's call screen after Google. It is the one built-in
 * intention that settles instead of backing off: a yes rings the phone (`channel_pref = call`), a no
 * means text for good (`channel_pref = text`, DESIGN §1.7), a skip leaves it open for one more light
 * try in the chat. No column of its own: the intention row plus `channel_pref` carry it.
 */
export type CallOfferVia = "clip" | "chat" | "tapback";

export interface RecordCallOfferOpts {
  via: CallOfferVia;
  /** the assistant turn being produced (defaults to the next one) */
  turn?: number;
  evidence_ref?: string;
}

const quietly = async (what: string, p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    console.warn(`[call offer] mind: ${what} failed:`, e instanceof Error ? e.message : e);
  }
};

export async function recordCallOfferAnswer(session: SessionRow, answer: CallOfferAnswer, opts: RecordCallOfferOpts): Promise<SessionRow> {
  const turn = opts.turn ?? turnOf(session) + 1;
  const evidence_ref = opts.evidence_ref ?? `call_offer:${opts.via}`;
  // the clip asked the question itself: the ledger should know the offer was raised once
  if (opts.via === "clip") await quietly("nudge", recordNudge(session.id, { key: OFFER_CALL_KEY, approach: "the App Clip's call screen: want me to call you to set up the rest?", channel: "text", turn, actor: "agent", evidence_ref }));
  let out = session;
  switch (answer) {
    case "yes":
      await quietly("outcome", recordOutcome(session.id, { key: OFFER_CALL_KEY, receptivity: 9, signal: "accepted", note: "wants the call", turn, actor: "user", evidence_ref }));
      await quietly("settle", settleIfOpen(session.id, { key: OFFER_CALL_KEY, reason: "accepted a call", turn, actor: "system", evidence_ref }));
      out = await patchSession(session.id, () => ({ channel_pref: "call" }));
      break;
    case "no":
      await quietly("outcome", recordOutcome(session.id, { key: OFFER_CALL_KEY, receptivity: 2, signal: "declined", note: "prefers text", turn, actor: "user", evidence_ref }));
      await quietly("settle", settleIfOpen(session.id, { key: OFFER_CALL_KEY, reason: "prefers text", turn, actor: "system", evidence_ref }));
      out = await patchSession(session.id, () => ({ channel_pref: "text" }));
      break;
    case "skip":
      // "not now": stays open, one more light try in the chat (askPlan caps the offer at two nudges)
      await quietly("outcome", recordOutcome(session.id, { key: OFFER_CALL_KEY, receptivity: 4, signal: "ignored", note: "left the call question unanswered", turn, actor: "user", evidence_ref }));
      break;
  }
  await insertEvent(session.id, "call_offer", { via: opts.via, answer, turn });
  return out;
}
