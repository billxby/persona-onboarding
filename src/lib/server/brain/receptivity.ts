import { generateText, Output } from "ai";
import { z } from "zod";
import { heuristicReceptivity, type ReceptivityRead } from "@/lib/memory/intentions";
import { mindFor, recordOutcome } from "@/lib/memory/mind";
import type { Intention, ReceptivitySignal, ServerChannel, SessionRow } from "@/lib/shared/types";
import { insertEvent } from "../messages";
import { receptivityPrompt } from "../prompt";
import { fastModel } from "../providers";
import { turnOf } from "../state";

/**
 * Receptivity assessor (DESIGN.md §13b). After the agent raised something (an intention in
 * status `asked`), the next user message is read once by the fast model: how did they take it,
 * 0 (shut it down) to 10 (yes). The score sets the intention's backoff. Off the main model's
 * path; falls back to a regex read when the model is unavailable. Never reads mood or personality.
 */
export const ReceptivitySchema = z.object({
  receptivity: z.number().min(0).max(10),
  signal: z.enum(["accepted", "deferred", "declined", "shut_down", "ignored", "unclear"]),
  note: z.string().max(200),
});

const MAX_PER_TURN = 2;
const TIMEOUT_MS = 8_000;

export interface AssessInput {
  session: SessionRow;
  mind: Intention[];
  userText: string;
  channel: ServerChannel;
}

export interface Assessed {
  key: string;
  read: ReceptivityRead;
  source: "model" | "heuristic";
}

async function modelRead(asked: Intention, userText: string): Promise<ReceptivityRead | null> {
  try {
    const { output } = await generateText({
      model: fastModel(),
      output: Output.object({ schema: ReceptivitySchema, name: "receptivity_read" }),
      instructions: receptivityPrompt(),
      prompt: [`Persona raised: ${asked.goal} (${asked.key}).`, `How it was phrased: "${asked.last_approach ?? "(unrecorded)"}"`, `User replied: "${userText.trim().slice(0, 600)}"`].join("\n"),
      maxOutputTokens: 120,
      temperature: 0,
      abortSignal: AbortSignal.timeout(TIMEOUT_MS),
    });
    return { receptivity: Math.round(output.receptivity), signal: output.signal as ReceptivitySignal, note: output.note.replace(/\s+/g, " ").trim().slice(0, 160) };
  } catch (e) {
    console.warn("[receptivity] model read failed:", e instanceof Error ? e.message : e);
    return null;
  }
}

/**
 * Score the user's reaction to every intention currently `asked`, record the outcomes and return
 * the refreshed mind. A no-op when nothing was asked. Errors are logged, never thrown.
 */
export async function assessReactions({ session, mind, userText, channel }: AssessInput): Promise<{ mind: Intention[]; assessed: Assessed[] }> {
  const asked = mind.filter((r) => r.status === "asked").slice(0, MAX_PER_TURN);
  if (asked.length === 0 || !userText.trim()) return { mind, assessed: [] };
  // the reply is processed while the next assistant turn is being produced: same turn number the
  // tool layer uses, so a verbal "no" scored here and by set_slot(gmail, declined) dedupes to one outcome
  const turn = turnOf(session) + 1;
  const assessed: Assessed[] = [];
  let current = mind;
  for (const rec of asked) {
    try {
      const fromModel = await modelRead(rec, userText);
      const read = fromModel ?? heuristicReceptivity(userText);
      current = await recordOutcome(session.id, { key: rec.key, receptivity: read.receptivity, signal: read.signal, note: read.note, turn, actor: "system", evidence_ref: `assessor:${channel}` });
      assessed.push({ key: rec.key, read, source: fromModel ? "model" : "heuristic" });
      const after = current.find((r) => r.key === rec.key);
      await insertEvent(session.id, "receptivity", {
        key: rec.key,
        receptivity: read.receptivity,
        signal: read.signal,
        note: read.note,
        source: fromModel ? "model" : "heuristic",
        approach: rec.last_approach,
        nudges: rec.nudges,
        status: after?.status ?? null,
        next_eligible_turn: after?.next_eligible_turn ?? null,
        channel,
      });
    } catch (e) {
      console.warn("[receptivity] outcome not recorded:", e instanceof Error ? e.message : e);
    }
  }
  return { mind: current.length ? current : await mindFor(session.id), assessed };
}
