import type { NextBestAsk, ServerChannel, SessionRow, SlotName } from "@/lib/shared/types";

/** Pure helpers over the session row: what to ask next, the STATE block, attempts and question history. */

export const asks = (s: SessionRow, slot: SlotName) => s.attempts?.[slot] ?? 0;
export const isSkipped = (s: SessionRow, slot: SlotName) => asks(s, slot) >= 3;
export const isGraduated = (s: SessionRow) => s.phase === "graduated" || !!s.graduated_at;

export function nextBestAsk(s: SessionRow, channel: ServerChannel): NextBestAsk {
  if (s.gmail_status === "pending") {
    return { slot: null, hint: "Gmail connect is pending. Wait for it, do not re-ask. Keep helping with the need meanwhile." };
  }
  const nameMissing = !s.user_name && !isSkipped(s, "user_name");
  const needMissing = !s.need;
  const gmailMissing = s.gmail_status === "none" && !isSkipped(s, "gmail");
  const agentMissing = !s.agent_name && !isSkipped(s, "agent_name");
  const valueDone = !!s.value_moment_at || isGraduated(s);

  if (s.mode === "onboarding") {
    if (nameMissing) {
      return {
        slot: "user_name",
        hint:
          asks(s, "user_name") >= 2
            ? "Two misses on the name: offer a choice ('a first name, or I just go with friend?'), then move on."
            : "Ask what to call them, once, and use the name in your next sentence.",
      };
    }
    if (needMissing) {
      return {
        slot: "need",
        hint:
          asks(s, "need") >= 2
            ? "Two misses on the need: offer three concrete options (inbox cleanup, cancelling subscriptions, booking an appointment) and ask which."
            : "Ask for one thing to take off their plate this week. Paraphrase it back when they answer.",
      };
    }
    if (gmailMissing) {
      return { slot: "gmail", hint: "Frame Gmail as the way to do THAT task, call request_gmail_connect, then wait." };
    }
    return { slot: null, hint: "Deliver the value moment now; call graduate once the task is in motion." };
  }

  // main mode: value before completeness; everything else is a soft, once-per-session nudge
  if (gmailMissing && asks(s, "gmail") < 2 && !valueDone) {
    return { slot: "gmail", hint: "Only as the way to do the stated task: offer Gmail once (request_gmail_connect), read-only, then wait." };
  }
  if (nameMissing && asks(s, "user_name") < 2 && (valueDone || s.gmail_status !== "none")) {
    return { slot: "user_name", hint: "Soft nudge, once, while doing the task: ask what to call them. 'friend' is fine if they pass." };
  }
  if (channel === "text" && agentMissing && asks(s, "agent_name") < 1 && valueDone) {
    return { slot: "agent_name", hint: "Once: ask what they'd like to call you. Default is Persona. Save it with set_slot(agent_name)." };
  }
  return { slot: null, hint: "Help with the need. Do not ask for anything else unless it serves the task." };
}

const fmt = (v: string | null | undefined, empty = "(empty)") => (v ? v : empty);

/** The STATE block from DESIGN.md §9. Re-injected every turn; the model never keeps state itself. */
export function stateBlock(s: SessionRow, channel: ServerChannel): string {
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
  const nba = nextBestAsk(s, channel);
  return [
    "STATE (never ask for a filled slot)",
    `user_name: ${name} | need: ${fmt(s.need)} | gmail: ${gmail} | agent_name: ${agent}`,
    `attempts: ${attempts || "none"} | last_questions: ${last} | channel: ${channel} | mode: ${s.mode} | phase: ${s.phase} | channel_pref: ${fmt(s.channel_pref, "none")} | call_state: ${s.call_state}`,
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
