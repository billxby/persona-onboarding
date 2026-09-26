import { z } from "zod";
import { CLIP_EVENT_TYPES } from "@/lib/shared/clip";
import { insertEvent } from "@/lib/server/messages";
import { getSession } from "@/lib/server/session";

/** Client-side analytics events (the /clip page and the simulated clip). Allow-listed types only. */
const Body = z.object({
  session_id: z.string().uuid(),
  type: z.enum(CLIP_EVENT_TYPES),
  payload: z.record(z.string(), z.unknown()).optional(),
});

export async function POST(req: Request) {
  let body: z.infer<typeof Body>;
  try {
    body = Body.parse(await req.json());
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "bad request" }, { status: 400 });
  }
  const session = await getSession(body.session_id);
  if (!session) return Response.json({ error: "unknown session" }, { status: 404 });
  await insertEvent(session.id, body.type, { ...(body.payload ?? {}), via: "client" });
  return Response.json({ ok: true });
}
