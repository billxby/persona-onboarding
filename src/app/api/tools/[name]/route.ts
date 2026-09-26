import type { NextRequest } from "next/server";
import { activeBeliefsFor } from "@/lib/memory/store";
import { buildPrompt } from "@/lib/server/prompt";
import { getSession, isUuid } from "@/lib/server/session";
import { compactForVoice, runTool } from "@/lib/server/tools/run";
import type { ToolRouteResponse } from "@/lib/shared/types";

export const maxDuration = 30;

/**
 * Tool calls from the voice channel (the browser's RealtimeSession executes
 * tools by POSTing here). Only `result` goes back to the model; the rest
 * steers the client (re-send instructions, end the call, ring).
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ name: string }> }) {
  const { name } = await ctx.params;
  const body = (await req.json().catch(() => null)) as { session_id?: unknown; input?: unknown } | null;
  if (!body || !isUuid(body.session_id)) return Response.json({ error: "session_id (uuid) required" }, { status: 400 });
  const session = await getSession(body.session_id);
  if (!session) return Response.json({ error: "session not found" }, { status: 404 });

  const run = await runTool({ session, channel: "call" }, name, body.input ?? {});
  const res: ToolRouteResponse = { result: compactForVoice(run.result) };
  if (run.effects.instructions_changed) {
    res.instructions = await buildPrompt(run.session, "call", await activeBeliefsFor(session.id));
  }
  if (run.effects.end_call) res.end_call = true;
  if (run.effects.ring) res.ring = true;
  return Response.json(res);
}
