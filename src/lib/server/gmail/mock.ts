import fs from "node:fs";
import path from "node:path";
import type { EmailFull, EmailSummary, GmailClient } from "./types";

/**
 * Demo inbox over data/mock_inbox.json. Standalone on purpose (no env, no db)
 * so it runs in unit tests and works before Google OAuth is configured.
 * Dates are relative (`days_ago`) so the demo always looks fresh.
 */
interface RawMessage {
  id: string;
  from: string;
  subject: string;
  snippet: string;
  body: string;
  days_ago: number;
  unread: boolean;
}
interface RawInbox {
  email: string;
  messages: RawMessage[];
}

let cache: RawInbox | null = null;
export const MOCK_INBOX_PATH = () => path.join(process.cwd(), "data", "mock_inbox.json");

export function loadMockInbox(): RawInbox {
  if (!cache) cache = JSON.parse(fs.readFileSync(MOCK_INBOX_PATH(), "utf8")) as RawInbox;
  return cache;
}

const DAY = 86_400_000;
const dateOf = (m: RawMessage, now: number) => new Date(now - m.days_ago * DAY).toISOString();

function toSummary(m: RawMessage, now: number): EmailSummary {
  return { id: m.id, from: m.from, subject: m.subject, snippet: m.snippet, date: dateOf(m, now), unread: m.unread };
}

/** Tiny Gmail-query parser: from:, subject:, is:unread, newer_than:Nd, quoted phrases, bare words (AND). */
function matches(m: RawMessage, q: string, now: number): boolean {
  const tokens = q.match(/"[^"]+"|\S+/g) ?? [];
  const hay = `${m.from}\n${m.subject}\n${m.snippet}\n${m.body}`.toLowerCase();
  for (const raw of tokens) {
    const t = raw.replace(/^"|"$/g, "").toLowerCase();
    if (!t) continue;
    if (t.startsWith("from:")) {
      if (!m.from.toLowerCase().includes(t.slice(5))) return false;
    } else if (t.startsWith("subject:")) {
      if (!m.subject.toLowerCase().includes(t.slice(8))) return false;
    } else if (t === "is:unread") {
      if (!m.unread) return false;
    } else if (t === "is:read") {
      if (m.unread) return false;
    } else if (t.startsWith("newer_than:")) {
      const n = parseFloat(t.slice(11));
      if (Number.isFinite(n) && m.days_ago > n) return false;
    } else if (t.startsWith("older_than:")) {
      const n = parseFloat(t.slice(11));
      if (Number.isFinite(n) && m.days_ago < n) return false;
    } else if (t.startsWith("label:") || t.startsWith("in:") || t.startsWith("has:")) {
      continue; // unsupported operators are ignored rather than excluding everything
    } else if (!hay.includes(t)) {
      return false;
    }
  }
  void now;
  return true;
}

export class MockGmail implements GmailClient {
  readonly kind = "mock" as const;
  constructor(private readonly inbox: RawInbox = loadMockInbox()) {}

  get email() {
    return this.inbox.email;
  }

  private sorted() {
    return [...this.inbox.messages].sort((a, b) => a.days_ago - b.days_ago);
  }

  async recent(n: number): Promise<EmailSummary[]> {
    const now = Date.now();
    return this.sorted()
      .slice(0, Math.max(0, Math.min(5, n)))
      .map((m) => toSummary(m, now));
  }

  async search(q: string): Promise<EmailSummary[]> {
    const now = Date.now();
    return this.sorted()
      .filter((m) => matches(m, q, now))
      .slice(0, 5)
      .map((m) => toSummary(m, now));
  }

  async get(id: string): Promise<EmailFull | null> {
    const m = this.inbox.messages.find((x) => x.id === id);
    return m ? { ...toSummary(m, Date.now()), body: m.body } : null;
  }

  async unreadCount(days: number): Promise<number> {
    return this.inbox.messages.filter((m) => m.unread && m.days_ago <= days).length;
  }
}

let shared: MockGmail | null = null;
export function mockGmail(): MockGmail {
  if (!shared) shared = new MockGmail();
  return shared;
}
