"use client";

import { getBrain } from "@/lib/brain";
import { session } from "@/lib/session/store";
import type { SlotKey } from "@/lib/session/types";
import type { ToolRouteResponse } from "@/lib/shared/types";

const PROMPTS: Record<Exclude<SlotKey, "gmail">, string> = {
  user_name: "What should your Persona call you?",
  need: "One thing you want off your plate this week:",
  agent_name: "What do you want to call your Persona?",
};

export function connectUrl(sessionId: string) {
  return `${window.location.origin}/connect?sid=${encodeURIComponent(sessionId)}`;
}

/**
 * Chip edit: never a form in the thread. Gmail opens the connect page; the
 * other three prompt for a value and go through the same validated `set_slot`
 * tool the model uses, so the server stays the only writer.
 */
export async function editSlot(key: SlotKey): Promise<void> {
  const st = session.get();
  if (key === "gmail") {
    void getBrain().onLinkOpen("chip:gmail", connectUrl(st.sessionId));
    return;
  }
  const raw = window.prompt(PROMPTS[key], st.slots[key].value ?? "");
  if (raw == null) return;
  const value = raw.trim();
  if (!value) return;
  st.logEvent("user.chip_edit", { key, value });
  try {
    const res = await fetch("/api/tools/set_slot", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ session_id: st.sessionId, input: { slot: key, value }, channel: "text" }),
    });
    const data = (await res.json()) as ToolRouteResponse;
    if (!res.ok || !data.result?.ok) session.get().logEvent("slot.rejected", { key, value, error: data.result?.error ?? res.status });
  } catch (e) {
    session.get().logEvent("slot.edit_failed", { key, error: String(e) });
  }
  await getBrain().refresh?.();
}
