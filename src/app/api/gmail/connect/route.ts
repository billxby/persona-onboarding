import { NextResponse, type NextRequest } from "next/server";
import { markGmail } from "@/lib/server/gmail/oauth";
import { getSession } from "@/lib/server/session";

export const DEMO_EMAIL = "demo@persona.test";

/** "Use the demo inbox": connects the session to data/mock_inbox.json. */
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as { session_id?: string; mock?: boolean };
  const session = body.session_id ? await getSession(body.session_id) : null;
  if (!session) return NextResponse.json({ error: "session_not_found" }, { status: 404 });
  if (!body.mock) return NextResponse.json({ error: "only mock: true is supported here; real Gmail goes through /api/oauth/google/start" }, { status: 400 });

  await markGmail(session.id, "connected", DEMO_EMAIL, { mock: true });
  return NextResponse.json({ ok: true, email: DEMO_EMAIL });
}
