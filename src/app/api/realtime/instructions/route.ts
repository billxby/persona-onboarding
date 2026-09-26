import type { InstructionsResponse } from "@/lib/shared/types";
import { activeBeliefs } from "@/lib/server/messages";
import { buildPrompt, PROMPT_VERSION } from "@/lib/server/prompt";
import { getSession, isUuid } from "@/lib/server/session";

/** Fresh call instructions for a session.update re-send (after tool calls, on resume). */
export async function GET(req: Request) {
  const sid = new URL(req.url).searchParams.get("sid");
  if (!isUuid(sid)) return Response.json({ error: "sid required" }, { status: 400 });
  const session = await getSession(sid);
  if (!session) return Response.json({ error: "session not found" }, { status: 404 });
  const instructions = await buildPrompt(session, "call", await activeBeliefs(session.id));
  const res: InstructionsResponse = { instructions, prompt_version: PROMPT_VERSION };
  return Response.json(res);
}
