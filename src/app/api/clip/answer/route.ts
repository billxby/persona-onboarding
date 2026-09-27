import { recordClipAnswer } from "@/lib/server/clipAnswer";
import { getSession } from "@/lib/server/session";
import { ClipAnswerSchema, type ClipAnswerResponse } from "@/lib/shared/clip";

const PER_SESSION_LIMIT = 40;
const hits = new Map<string, number[]>();

/** In-memory, per server instance: enough to stop a loop, not a real quota. */
function limited(sid: string): boolean {
  const now = Date.now();
  const recent = (hits.get(sid) ?? []).filter((t) => now - t < 10 * 60 * 1000);
  if (recent.length >= PER_SESSION_LIMIT) return true;
  recent.push(now);
  hits.set(sid, recent);
  return false;
}

/**
 * POST /api/clip/answer — one step of the App Clip's onboarding, written the moment it is given.
 * The session id in the body is the one the clip was launched with (the invocation URL's `sid`).
 */
export async function POST(req: Request) {
  const parsed = ClipAnswerSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "bad_request", issues: parsed.error.issues }, { status: 400 });
  const { session_id, step, value } = parsed.data;
  if (limited(session_id)) return Response.json({ error: "too_many_answers" }, { status: 429 });
  const session = await getSession(session_id);
  if (!session) return Response.json({ error: "not_found" }, { status: 404 });
  const r = await recordClipAnswer(session, step, value);
  const res: ClipAnswerResponse = { ok: r.ok, ...(r.error ? { error: r.error } : {}), state: r.state };
  return Response.json(res, { headers: { "Cache-Control": "no-store" } });
}
