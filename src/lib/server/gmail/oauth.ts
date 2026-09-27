import { randomBytes } from "node:crypto";
import { google } from "googleapis";
import type { OAuth2Client, Credentials } from "google-auth-library";
import type { GmailStatus, OAuthTokenRow, SessionRow } from "@/lib/shared/types";
import { db } from "@/lib/server/db";
import { env, googleConfigured } from "@/lib/server/env";
import { insertEvent } from "@/lib/server/messages";
import { patchSession } from "@/lib/server/session";
import { assertFact } from "@/lib/memory/store";
import { recordOutcome, settleIfOpen } from "@/lib/memory/mind";

export { googleConfigured };

export const SCOPES = ["openid", "email", "https://www.googleapis.com/auth/gmail.readonly"];
export const redirectUri = () => `${env.APP_URL}/api/oauth/google/callback`;

export function oauthClient(): OAuth2Client {
  return new google.auth.OAuth2(env.GOOGLE_CLIENT_ID, env.GOOGLE_CLIENT_SECRET, redirectUri());
}

/** CSRF state: random nonce + session id, stored on the session until the callback. */
export const newState = (session_id: string) => `${randomBytes(12).toString("hex")}:${session_id}`;
export const sessionIdFromState = (state: string | null) => state?.split(":")[1] ?? null;

export function authUrl(state: string): string {
  return oauthClient().generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: true,
    scope: SCOPES,
    state,
  });
}

export async function exchangeCode(code: string): Promise<{ tokens: Credentials; email: string | null; name: string | null }> {
  const client = oauthClient();
  const { tokens } = await client.getToken(code);
  client.setCredentials(tokens);
  const { data } = await google.oauth2({ version: "v2", auth: client }).userinfo.get();
  return { tokens, email: data.email ?? null, name: data.name ?? null };
}

export async function saveTokens(session_id: string, tokens: Credentials, email: string | null): Promise<void> {
  const existing = await loadTokens(session_id);
  const row = {
    session_id,
    access_token: tokens.access_token ?? existing?.access_token ?? "",
    // Google only returns a refresh token on the first consent; keep the one we have
    refresh_token: tokens.refresh_token ?? existing?.refresh_token ?? null,
    expires_at: tokens.expiry_date ? new Date(tokens.expiry_date).toISOString() : existing?.expires_at ?? null,
    scopes: tokens.scope ?? existing?.scopes ?? SCOPES.join(" "),
    email: email ?? existing?.email ?? null,
    updated_at: new Date().toISOString(),
  };
  const { error } = await db().from("oauth_tokens").upsert(row, { onConflict: "session_id" });
  if (error) throw error;
}

export async function loadTokens(session_id: string): Promise<OAuthTokenRow | null> {
  const { data, error } = await db().from("oauth_tokens").select().eq("session_id", session_id).maybeSingle();
  if (error) throw error;
  return (data as OAuthTokenRow | null) ?? null;
}

/**
 * An authorised OAuth2 client for the session, refreshing the access token when it is
 * (about to be) expired. Returns null when the session never connected Gmail.
 */
export async function clientForSession(session_id: string): Promise<{ auth: OAuth2Client; email: string | null } | null> {
  if (!googleConfigured()) return null;
  const row = await loadTokens(session_id);
  if (!row?.access_token) return null;
  const auth = oauthClient();
  auth.setCredentials({
    access_token: row.access_token,
    refresh_token: row.refresh_token ?? undefined,
    expiry_date: row.expires_at ? new Date(row.expires_at).getTime() : undefined,
    scope: row.scopes ?? undefined,
  });
  // google-auth-library refreshes lazily; persist whatever it hands back.
  auth.on("tokens", (t) => {
    void saveTokens(session_id, t, row.email).catch((e) => console.error("[gmail] token persist failed", e));
  });
  const expiresAt = row.expires_at ? new Date(row.expires_at).getTime() : 0;
  if (expiresAt && expiresAt < Date.now() + 60_000 && row.refresh_token) {
    try {
      await auth.getAccessToken(); // triggers the refresh + "tokens" event
    } catch (e) {
      console.error("[gmail] refresh failed", e);
      return null;
    }
  }
  return { auth, email: row.email };
}

export interface MarkGmailOpts {
  mock?: boolean;
  /** display name from Google, asserted as a name belief with oauth trust */
  name?: string | null;
  reason?: string;
}

/**
 * Single place that flips the session's Gmail status, logs the event and, on success,
 * writes the oauth-trust memory facts. Used by the OAuth callback, the demo-inbox route
 * and (for failed/declined) the text channel.
 */
export async function markGmail(session_id: string, status: Exclude<GmailStatus, "none" | "pending">, email?: string | null, opts: MarkGmailOpts = {}): Promise<SessionRow> {
  const session = await patchSession(session_id, () => ({
    gmail_status: status,
    gmail_email: status === "connected" ? (email ?? null) : undefined,
    mock_inbox: opts.mock ? true : undefined,
    oauth_state: null,
  }) as Partial<SessionRow>);
  const turn = (session.turn ?? 0) + 1;
  const mind = async (what: string, p: Promise<unknown>) => {
    try {
      await p;
    } catch (e) {
      console.warn(`[gmail] mind: ${what} failed:`, e instanceof Error ? e.message : e);
    }
  };
  if (status === "connected") {
    await insertEvent(session_id, "oauth_success", { email: email ?? null, mock: !!opts.mock });
    const evidence_ref = opts.mock ? "demo_inbox" : "google_userinfo";
    if (email) await assertFact(session_id, { predicate: "email", object: email, source: "oauth", actor: "system", evidence_ref });
    if (opts.name && !opts.mock) await assertFact(session_id, { predicate: "name", object: opts.name, source: "oauth", actor: "system", evidence_ref });
    await mind("settle", settleIfOpen(session_id, { key: "connect_gmail", reason: opts.mock ? "demo inbox connected" : "Gmail connected", turn, actor: "system", evidence_ref }));
  } else {
    const reason = opts.reason ?? (status === "declined" ? "access_denied" : "no_callback");
    await insertEvent(session_id, "oauth_declined", { status, reason });
    // how they took the Gmail ask, in the ledger's terms: a no backs it off hard, a timeout only a little, and
    // "Not now" on the App Clip's Google screen is a maybe-later (soft ask again in main mode, as the means to the task).
    // The intention stays on the mind either way (core ask): "much later, another angle", never "never".
    const read = reason.startsWith("verbal_no")
      ? { receptivity: 2, signal: "declined" as const, note: "said no to connecting Gmail" }
      : reason === "access_denied"
        ? { receptivity: 2, signal: "declined" as const, note: "declined on Google's consent screen" }
        : reason === "clip_skip"
          ? { receptivity: 5, signal: "deferred" as const, note: "skipped the Google step in the App Clip" }
          : reason === "clip_abandoned"
            ? { receptivity: 4, signal: "ignored" as const, note: "started Google in the App Clip, left before finishing" }
            : { receptivity: 4, signal: "ignored" as const, note: "link sent, no reaction before it timed out" };
    await mind("outcome", recordOutcome(session_id, { key: "connect_gmail", ...read, turn, actor: "system", evidence_ref: `gmail:${reason}` }));
  }
  return session;
}

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c);

/** The popup's last page: tells the opener what happened, then closes itself. */
export function closerHtml(p: { status: "connected" | "declined" | "failed"; email?: string | null; sid: string | null }): string {
  const headline =
    p.status === "connected"
      ? `Connected${p.email ? ` as ${escapeHtml(p.email)}` : ""}.`
      : p.status === "declined"
        ? "No problem, Gmail stays disconnected."
        : "Something went wrong connecting Gmail.";
  const payload = JSON.stringify({ type: "persona:gmail", status: p.status, email: p.email ?? null, sid: p.sid }).replace(/</g, "\\u003c");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Persona · Gmail</title>
<style>body{margin:0;font-family:-apple-system,BlinkMacSystemFont,"SF Pro Text",Inter,system-ui,sans-serif;background:#f5f5f7;color:#1d1d1f;display:flex;min-height:100vh;align-items:center;justify-content:center}main{max-width:360px;padding:32px 24px;text-align:center}h1{font-size:20px;font-weight:600;margin:0 0 8px}p{margin:0;color:#6e6e73;font-size:15px;line-height:1.4}</style></head>
<body><main><h1>${headline}</h1><p>You can close this window and go back to the chat.</p></main>
<script>try{if(window.opener&&!window.opener.closed){window.opener.postMessage(${payload},"*")}}catch(e){}setTimeout(function(){window.close()},800)</script></body></html>`;
}
