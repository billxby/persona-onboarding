import type { NextRequest } from "next/server";
import { closerHtml, exchangeCode, markGmail, saveTokens, sessionIdFromState } from "@/lib/server/gmail/oauth";
import { getSession } from "@/lib/server/session";

const html = (body: string, status = 200) => new Response(body, { status, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });

/** Google redirects here. Stores tokens, flips the session, tells the opener, closes the popup. */
export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams;
  const state = q.get("state");
  const sid = sessionIdFromState(state);
  const session = sid ? await getSession(sid) : null;
  if (!session || !state) return html(closerHtml({ status: "failed", sid }), 400);

  if (q.get("error")) {
    await markGmail(session.id, "declined", null, { reason: q.get("error") ?? "access_denied" });
    return html(closerHtml({ status: "declined", sid: session.id }));
  }
  if (session.oauth_state !== state) return html(closerHtml({ status: "failed", sid: session.id }), 400);

  const code = q.get("code");
  if (!code) return html(closerHtml({ status: "failed", sid: session.id }), 400);

  try {
    const { tokens, email, name } = await exchangeCode(code);
    await saveTokens(session.id, tokens, email);
    await markGmail(session.id, "connected", email, { name });
    return html(closerHtml({ status: "connected", email, sid: session.id }));
  } catch (e) {
    console.error("[oauth] callback failed", (e as Error).message);
    await markGmail(session.id, "failed", null, { reason: "exchange_failed" });
    return html(closerHtml({ status: "failed", sid: session.id }), 500);
  }
}
