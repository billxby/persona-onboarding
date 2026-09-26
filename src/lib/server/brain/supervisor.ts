import { generateText, Output } from "ai";
import { z } from "zod";
import type { SessionRow } from "@/lib/shared/types";
import { insertEvent } from "../messages";
import { supervisorPrompt } from "../prompt";
import { fastModel } from "../providers";
import { stateBlock } from "../state";
import { getSession } from "@/lib/server/session";
import { runTool } from "../tools/run";

/**
 * Off-the-audio-path supervisor (DESIGN §10.9): Haiku re-reads each user transcript, re-extracts slots
 * and flags jailbreaks or conflicts. Patches go through the same typed tools as everything else.
 */
const SlotGuess = z.object({ value: z.string().nullable(), confidence: z.number().min(0).max(1) });
export const SupervisorSchema = z.object({
  slots: z.object({ user_name: SlotGuess, need: SlotGuess, agent_name: SlotGuess }),
  jailbreak: z.boolean(),
  conflict: z.string().nullable(),
  language: z.string().nullable(),
});
export type SupervisorVerdict = z.infer<typeof SupervisorSchema>;

const MIN_CONFIDENCE = 0.7;
type SupervisedSlot = "user_name" | "need" | "agent_name";
const SLOTS: SupervisedSlot[] = ["user_name", "need", "agent_name"];
const same = (a: string | null | undefined, b: string) => (a ?? "").trim().toLowerCase() === b.trim().toLowerCase();

export interface SuperviseResult {
  patched: boolean;
  session: SessionRow;
  verdict?: SupervisorVerdict;
}

export async function superviseTurn(session: SessionRow, text: string): Promise<SuperviseResult> {
  const clean = text.trim();
  if (clean.length < 2) return { patched: false, session };
  let current = session;
  try {
    const { output: verdict } = await generateText({
      model: fastModel(),
      output: Output.object({ schema: SupervisorSchema, name: "supervisor_verdict" }),
      instructions: `${supervisorPrompt()}\n\n${stateBlock(session, "call")}`,
      prompt: `User said (voice transcript): "${clean}"`,
      maxOutputTokens: 300,
      temperature: 0,
      abortSignal: AbortSignal.timeout(8_000),
    });
    let patched = false;
    // The model's own set_slot calls race with this off-path check: re-read the row and only fill
    // slots that are still empty. A different value for a filled slot is flagged, never overwritten.
    const conflicts: Record<string, { current: string; heard: string }> = {};
    current = (await getSession(session.id)) ?? current;
    for (const slot of SLOTS) {
      const guess = verdict.slots[slot];
      const value = guess.value?.trim();
      if (!value || guess.confidence < MIN_CONFIDENCE) continue;
      if (same(current[slot], value)) continue;
      if (current[slot]) {
        conflicts[slot] = { current: current[slot] as string, heard: value };
        continue;
      }
      const res = await runTool({ session: current, channel: "call" }, "set_slot", { slot, value });
      current = res.session;
      if (res.result.ok) patched = true;
    }
    await insertEvent(session.id, "supervisor", {
      patched,
      jailbreak: verdict.jailbreak,
      conflict: verdict.conflict,
      slot_conflicts: Object.keys(conflicts).length ? conflicts : null,
      language: verdict.language,
      slots: Object.fromEntries(SLOTS.map((s) => [s, verdict.slots[s].confidence >= MIN_CONFIDENCE ? verdict.slots[s].value : null])),
    });
    return { patched, session: current, verdict };
  } catch (e) {
    console.warn("[supervisor] failed", e instanceof Error ? e.message : e);
    await insertEvent(session.id, "supervisor", { patched: false, error: e instanceof Error ? e.message : String(e) });
    return { patched: false, session: current };
  }
}
