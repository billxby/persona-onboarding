import { google, type gmail_v1 } from "googleapis";
import type { SessionRow } from "@/lib/shared/types";
import { env, googleConfigured } from "@/lib/server/env";
import { mockGmail } from "./mock";
import { clientForSession } from "./oauth";
import type { EmailFull, EmailSummary, GmailClient } from "./types";

export type { EmailFull, EmailSummary, GmailClient } from "./types";
export { mockGmail } from "./mock";

const MAX = 5;
const BODY_CAP = 4_000;

const header = (m: gmail_v1.Schema$Message, name: string) =>
  m.payload?.headers?.find((h) => h.name?.toLowerCase() === name.toLowerCase())?.value ?? "";

function toSummary(m: gmail_v1.Schema$Message): EmailSummary {
  const dateHeader = header(m, "Date");
  const parsed = dateHeader ? Date.parse(dateHeader) : NaN;
  const ms = Number.isFinite(parsed) ? parsed : m.internalDate ? Number(m.internalDate) : Date.now();
  return {
    id: m.id ?? "",
    from: header(m, "From"),
    subject: header(m, "Subject") || "(no subject)",
    snippet: (m.snippet ?? "").slice(0, 200),
    date: new Date(ms).toISOString(),
    unread: (m.labelIds ?? []).includes("UNREAD"),
  };
}

const b64url = (s: string) => Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");

/** First text/plain part, depth-first; falls back to text/html stripped of tags, then the snippet. */
function extractBody(payload: gmail_v1.Schema$MessagePart | undefined, snippet: string): string {
  if (!payload) return snippet;
  const plain: string[] = [];
  const html: string[] = [];
  const walk = (p: gmail_v1.Schema$MessagePart) => {
    if (p.body?.data) {
      if (p.mimeType === "text/plain") plain.push(b64url(p.body.data));
      else if (p.mimeType === "text/html") html.push(b64url(p.body.data));
    }
    p.parts?.forEach(walk);
  };
  walk(payload);
  const text = plain[0] ?? (html[0] ? html[0].replace(/<style[\s\S]*?<\/style>/gi, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim() : "") ?? snippet;
  return (text || snippet).slice(0, BODY_CAP);
}

/** Real Gmail, read-only. Every Google error is logged and turned into an empty result. */
export class RealGmail implements GmailClient {
  readonly kind = "real" as const;
  constructor(
    private readonly gmail: gmail_v1.Gmail,
    readonly email: string,
  ) {}

  private async list(q: string, max: number): Promise<EmailSummary[]> {
    try {
      const res = await this.gmail.users.messages.list({ userId: "me", q: q || undefined, maxResults: Math.min(MAX, max) });
      const ids = (res.data.messages ?? []).map((m) => m.id).filter((id): id is string => !!id);
      const metas = await Promise.all(
        ids.map((id) => this.gmail.users.messages.get({ userId: "me", id, format: "metadata", metadataHeaders: ["From", "Subject", "Date"] })),
      );
      return metas.map((r) => toSummary(r.data));
    } catch (e) {
      console.error("[gmail] list failed", (e as Error).message);
      return [];
    }
  }

  recent(n: number) {
    return this.list("", n);
  }

  search(q: string) {
    return this.list(q, MAX);
  }

  async get(id: string): Promise<EmailFull | null> {
    try {
      const { data } = await this.gmail.users.messages.get({ userId: "me", id, format: "full" });
      const summary = toSummary(data);
      return { ...summary, body: extractBody(data.payload, summary.snippet) };
    } catch (e) {
      console.error("[gmail] get failed", (e as Error).message);
      return null;
    }
  }

  async unreadCount(days: number): Promise<number> {
    try {
      const res = await this.gmail.users.messages.list({ userId: "me", q: `is:unread newer_than:${Math.max(1, Math.round(days))}d`, maxResults: 1 });
      return res.data.resultSizeEstimate ?? 0;
    } catch (e) {
      console.error("[gmail] unread count failed", (e as Error).message);
      return 0;
    }
  }
}

/**
 * The inbox for a session: the demo inbox when the session (or the deployment) asked for it
 * or Google isn't configured; the real one when tokens exist; null otherwise.
 * Callers still gate on `session.gmail_status === "connected"` for the conversation logic.
 */
export async function gmailFor(session: SessionRow): Promise<GmailClient | null> {
  if (session.mock_inbox || env.MOCK_INBOX || !googleConfigured()) return mockGmail();
  const c = await clientForSession(session.id);
  if (!c) return null;
  return new RealGmail(google.gmail({ version: "v1", auth: c.auth }), session.gmail_email ?? c.email ?? "me");
}
