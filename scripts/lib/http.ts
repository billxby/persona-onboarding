/**
 * Thin HTTP helpers for the eval scripts. They speak the wire formats in
 * src/lib/shared/types.ts against a running dev server (default :3000).
 */
import type {
  CallEventRequest,
  CallEventResponse,
  ChatEvent,
  ChatTrigger,
  MessageRow,
  PostMessageResponse,
  SessionRow,
  SessionView,
} from "@/lib/shared/types";

export class HttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: string,
    url: string,
  ) {
    super(`HTTP ${status} ${url}: ${body.slice(0, 600)}`);
  }
}

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function expectJson<T>(res: Response, url: string): Promise<T> {
  if (!res.ok) throw new HttpError(res.status, await res.text(), url);
  return (await res.json()) as T;
}

const post = (url: string, body: unknown) =>
  fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

export async function createSession(base: string, id?: string): Promise<SessionView> {
  const url = `${base}/api/session`;
  return expectJson<SessionView>(await post(url, id ? { id } : {}), url);
}

export async function getView(base: string, session_id: string, afterId?: number): Promise<SessionView> {
  const url = `${base}/api/session/${session_id}${afterId ? `?after=${afterId}` : ""}`;
  return expectJson<SessionView>(await fetch(url), url);
}

export async function postMessage(
  base: string,
  session_id: string,
  text: string,
  client_id: string = crypto.randomUUID(),
): Promise<PostMessageResponse> {
  const url = `${base}/api/messages`;
  return expectJson<PostMessageResponse>(await post(url, { session_id, client_id, text }), url);
}

export async function callEvent(base: string, req: CallEventRequest): Promise<CallEventResponse> {
  const url = `${base}/api/call/event`;
  return expectJson<CallEventResponse>(await post(url, req), url);
}

/** Flip the session to the demo inbox (what the "Use the demo inbox" button on /connect does). */
export async function connectDemoInbox(base: string, session_id: string): Promise<{ ok: boolean; email?: string }> {
  const url = `${base}/api/gmail/connect`;
  return expectJson<{ ok: boolean; email?: string }>(await post(url, { session_id, mock: true }), url);
}

export interface ChatRun {
  events: ChatEvent[];
  /** assistant text bubbles inserted during this turn, in order */
  bubbles: string[];
  /** every message row the server emitted (bubbles, cards, tool side effects) */
  messages: MessageRow[];
  toolEvents: Extract<ChatEvent, { type: "tool" }>[];
  session?: SessionRow;
  done?: Extract<ChatEvent, { type: "done" }>;
  busy: boolean;
  error?: string;
}

/** POST /api/chat and collect the NDJSON ChatEvent stream. */
export async function runChat(base: string, session_id: string, trigger: ChatTrigger = "user", reason?: string): Promise<ChatRun> {
  const url = `${base}/api/chat`;
  const res = await post(url, { session_id, trigger, reason });
  if (!res.ok) throw new HttpError(res.status, await res.text(), url);
  if (!res.body) throw new HttpError(res.status, "empty body", url);

  const events: ChatEvent[] = [];
  const handleLine = (line: string) => {
    const t = line.trim();
    if (!t) return;
    try {
      events.push(JSON.parse(t) as ChatEvent);
    } catch {
      // tolerate garbage / partial lines
    }
  };
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let idx: number;
    while ((idx = buf.indexOf("\n")) >= 0) {
      handleLine(buf.slice(0, idx));
      buf = buf.slice(idx + 1);
    }
  }
  buf += decoder.decode();
  if (buf.trim()) handleLine(buf);

  const run: ChatRun = { events, bubbles: [], messages: [], toolEvents: [], busy: false };
  for (const ev of events) {
    switch (ev.type) {
      case "message":
        run.messages.push(ev.message);
        if (ev.message.role === "assistant" && ev.message.kind === "text" && ev.message.content) run.bubbles.push(ev.message.content);
        break;
      case "tool":
        run.toolEvents.push(ev);
        break;
      case "session":
        run.session = ev.session;
        break;
      case "done":
        run.done = ev;
        break;
      case "busy":
        run.busy = true;
        break;
      case "error":
        run.error = ev.message;
        break;
      default:
        break;
    }
  }
  return run;
}

/** Wait until POST /api/session answers 200 (the route may still be under construction). */
export async function waitForServer(base: string, timeoutMs = 20 * 60_000, everyMs = 60_000): Promise<boolean> {
  const start = Date.now();
  for (;;) {
    try {
      const res = await post(`${base}/api/session`, {});
      if (res.ok) return true;
    } catch {
      /* not up yet */
    }
    if (Date.now() - start > timeoutMs) return false;
    await sleep(everyMs);
  }
}
