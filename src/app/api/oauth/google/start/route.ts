import { NextResponse, type NextRequest } from "next/server";
import { recordNudge } from "@/lib/memory/mind";
import { authUrl, googleConfigured, newState } from "@/lib/server/gmail/oauth";
import { insertEvent } from "@/lib/server/messages";
import { getSession, patchSession } from "@/lib/server/session";
import { turnOf } from "@/lib/server/state";

/**
 * Begins the Google consent flow for a session. Opened in a popup from the connect page
 * (`via=chat`, the default) or from the App Clip's Google screen (`via=clip`). From the clip the
 * Gmail ask was raised by the screen itself, so the ledger records that nudge here.
 */
export async function GET(req: NextRequest) {
  const sid = req.nextUrl.searchParams.get("sid") ?? "";
  const via = req.nextUrl.searchParams.get("via") === "clip" ? "clip" : "chat";
  const session = await getSession(sid);
  if (!session) return NextResponse.json({ error: "session_not_found" }, { status: 404 });
  if (!googleConfigured()) return NextResponse.json({ error: "google_not_configured" }, { status: 409 });

  const state = newState(session.id);
  await patchSession(session.id, () => ({ oauth_state: state, gmail_status: "pending" }));
  await insertEvent(session.id, "oauth_started", { mock: false, via });
  if (via === "clip") {
    await recordNudge(session.id, { key: "connect_gmail", approach: "the App Clip's Google connect screen", channel: "text", turn: turnOf(session) + 1, actor: "agent", evidence_ref: "clip:gmail" }).catch((e) =>
      console.warn("[oauth] mind: nudge failed:", e instanceof Error ? e.message : e),
    );
  }
  return NextResponse.redirect(authUrl(state), { status: 302 });
}
