import type { SessionRow } from "@/lib/shared/types";

/**
 * The first line of a call is the server's call, not the model's (DESIGN §7, §9): the token route
 * hands the browser a one-line system note built from what is known, and the browser injects it
 * before the first response. Left to the instructions alone, gpt-realtime sometimes skipped the name
 * ("Alright, friend, what's one thing I can take off your plate this week?").
 */
export const CALL_OPENER_UNKNOWN = "Quick call, two minutes, then I'll actually do something for you. What should I call you?";

export function callOpenerNote(s: Pick<SessionRow, "user_name" | "need">): string {
  const name = s.user_name?.trim();
  const need = s.need?.trim();
  if (!name && !need) return `Start of the call. Say this, word for word, then stop: "${CALL_OPENER_UNKNOWN}"`;
  if (!name) return `Start of the call. Their task is known (${need}). One line: pick it up, then ask what to call them. Then stop.`;
  if (!need) return `Start of the call. Say this, word for word, then stop: "Hey ${name}. What's one thing I can take off your plate this week?"`;
  return `Start of the call. One line: greet ${name} by name and pick up their task (${need}) where the chat left off, the way "Hey ${name}, so the gym thing." would. Then stop.`;
}
