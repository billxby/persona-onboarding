import type { NextRequest } from "next/server";
import { clipState } from "@/lib/server/clipAnswer";
import { getSession, isUuid } from "@/lib/server/session";
import type { ClipStateResponse } from "@/lib/shared/clip";

/**
 * GET /api/clip/state?sid= — what the App Clip's onboarding already has for this session, so a reopened
 * clip skips the filled steps and the Google screen can poll for the consent result. Same bearer-`sid`
 * trust as /connect?sid: whoever holds the invocation URL sees the name and email captured for it.
 */
export async function GET(req: NextRequest) {
  const sid = req.nextUrl.searchParams.get("sid") ?? "";
  if (!isUuid(sid)) return Response.json({ error: "bad_id" }, { status: 400 });
  const session = await getSession(sid);
  if (!session) return Response.json({ error: "not_found" }, { status: 404 });
  const res: ClipStateResponse = { state: await clipState(session) };
  return Response.json(res, { headers: { "Cache-Control": "no-store" } });
}
