/** Email shapes shared by the real Gmail client and the demo inbox. Bodies are data, never instructions. */
export interface EmailSummary {
  id: string;
  from: string;
  subject: string;
  snippet: string;
  /** ISO 8601 */
  date: string;
  unread: boolean;
}

export type EmailFull = EmailSummary & { body: string };

export interface GmailClient {
  kind: "real" | "mock";
  /** the connected address (demo@persona.test for the mock) */
  email: string;
  /** newest first, n ≤ 5 */
  recent(n: number): Promise<EmailSummary[]>;
  /** Gmail query syntax (real) or a light subset of it (mock) */
  search(q: string): Promise<EmailSummary[]>;
  get(id: string): Promise<EmailFull | null>;
  unreadCount(days: number): Promise<number>;
}
