import type { ChatEvent, MessageRow } from "@/lib/shared/types";
import { runTextTurn } from "@/lib/server/brain/chat";
import { markGmail } from "@/lib/server/gmail/oauth";
import { insertEvent, insertMessage, listEvents } from "@/lib/server/messages";
import { createSession, getSession, isUuid, patchSession } from "@/lib/server/session";
import { validateNeed } from "@/lib/server/validators";

/**
 * "Try your Persona" inside the App Clip: one task, one real turn of the text brain on the
 * labelled demo inbox, in a throwaway session. No consent step is needed because the inbox is
 * fake and the clip says so; nothing here touches the user's own session state.
 */

/** Same address the connect page uses for the demo inbox (src/app/api/gmail/connect/route.ts). */
const DEMO_EMAIL = "demo@persona.test";
const TURN_TIMEOUT_MS = 40_000;
const IP_LIMIT_PER_HOUR = 10;
const ORIGIN_LIMIT = 3;

export class DemoError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

// in-memory, per server instance: enough to stop a loop, not a real quota
const ipHits = new Map<string, number[]>();
function checkIpLimit(ip: string) {
  const now = Date.now();
  const recent = (ipHits.get(ip) ?? []).filter((t) => now - t < 60 * 60 * 1000);
  if (recent.length >= IP_LIMIT_PER_HOUR) throw new DemoError(429, "demo limit reached; continue in Messages");
  recent.push(now);
  ipHits.set(ip, recent);
}

export interface ClipDemoInput {
  task: string;
  origin_sid?: string | null;
  ip: string;
}

export interface ClipDemoResult {
  session_id: string;
  bubbles: string[];
  messages: MessageRow[];
  ms: number;
}

export async function runClipDemo({ task, origin_sid, ip }: ClipDemoInput): Promise<ClipDemoResult> {
  const t0 = Date.now();
  const need = validateNeed(task);
  if (!need.ok) throw new DemoError(400, need.reason);
  checkIpLimit(ip || "local");

  const origin = origin_sid && isUuid(origin_sid) ? await getSession(origin_sid) : null;
  if (origin) {
    const prior = await listEvents(origin.id, ["app_clip_demo"]);
    if (prior.length >= ORIGIN_LIMIT) throw new DemoError(429, "demo limit reached; continue in Messages");
  }

  // Throwaway session, already "in the task": need set, demo inbox connected, nothing to ask.
  const fresh = await createSession();
  await patchSession(fresh.id, () => ({
    need: need.value,
    mode: "main",
    phase: "value",
    mock_inbox: true,
    // skip every ask: the demo never collects a name or names the agent
    attempts: { user_name: 3, agent_name: 3 },
    channel_pref: "text",
  }));
  await markGmail(fresh.id, "connected", DEMO_EMAIL, { mock: true });
  await insertMessage({ session_id: fresh.id, role: "user", kind: "text", content: need.value, channel: "text" });

  const messages: MessageRow[] = [];
  let error: string | null = null;
  const emit = (e: ChatEvent) => {
    if (e.type === "message" && e.message.role === "assistant") messages.push(e.message);
    if (e.type === "error") error = e.message;
    if (e.type === "busy") error = "busy";
  };
  const timeout = new Promise<"timeout">((resolve) => setTimeout(() => resolve("timeout"), TURN_TIMEOUT_MS));
  const outcome = await Promise.race([runTextTurn(fresh.id, "clip_demo", undefined, emit).then(() => "done" as const), timeout]);

  const bubbles = messages.filter((m) => m.kind === "text" && m.content).map((m) => m.content as string);
  const ms = Date.now() - t0;
  const payload = { task: need.value, origin_sid: origin?.id ?? null, demo_session: fresh.id, ms, bubbles: bubbles.length, outcome, error };
  await insertEvent(fresh.id, "app_clip_demo", payload);
  if (origin) await insertEvent(origin.id, "app_clip_demo", payload);

  if (bubbles.length === 0) {
    throw new DemoError(outcome === "timeout" ? 504 : 502, outcome === "timeout" ? "the demo took too long; try again or continue in Messages" : (error ?? "no reply; continue in Messages"));
  }
  return { session_id: fresh.id, bubbles, messages, ms };
}
