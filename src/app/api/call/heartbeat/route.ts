import { heartbeat } from "@/lib/server/call";
import { isUuid } from "@/lib/server/session";

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { session_id?: string };
  if (!isUuid(body.session_id)) return Response.json({ error: "session_id required" }, { status: 400 });
  return Response.json(await heartbeat(body.session_id));
}
