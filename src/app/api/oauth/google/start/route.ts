import { NextResponse, type NextRequest } from "next/server";
import { authUrl, googleConfigured, newState } from "@/lib/server/gmail/oauth";
import { insertEvent } from "@/lib/server/messages";
import { getSession, patchSession } from "@/lib/server/session";

/** Begins the Google consent flow for a session. Opened in a popup from the connect page. */
export async function GET(req: NextRequest) {
  const sid = req.nextUrl.searchParams.get("sid") ?? "";
  const session = await getSession(sid);
  if (!session) return NextResponse.json({ error: "session_not_found" }, { status: 404 });
  if (!googleConfigured()) return NextResponse.json({ error: "google_not_configured" }, { status: 409 });

  const state = newState(session.id);
  await patchSession(session.id, () => ({ oauth_state: state, gmail_status: "pending" }));
  await insertEvent(session.id, "oauth_started", { mock: false });
  return NextResponse.redirect(authUrl(state), { status: 302 });
}
