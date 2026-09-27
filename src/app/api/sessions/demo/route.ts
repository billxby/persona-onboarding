import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { listMessages } from "@/lib/server/messages";
import { getSession } from "@/lib/server/session";
import type { DemoSession } from "@/lib/shared/types";

const File = z.object({ sessions: z.array(z.object({ id: z.string().uuid(), label: z.string().max(120).optional() })) });

/**
 * GET /api/sessions/demo — the prepared sessions pinned as DEMO (data/demo_sessions.json), enriched from
 * their rows. Any browser can load one into its phone: the rows are the server's, only the pointer is here.
 * Ids that no longer exist are dropped, so a wiped session simply disappears from the list.
 */
export async function GET() {
  let ids: z.infer<typeof File>["sessions"] = [];
  try {
    ids = File.parse(JSON.parse(fs.readFileSync(path.join(process.cwd(), "data", "demo_sessions.json"), "utf8"))).sessions;
  } catch (e) {
    return Response.json({ error: "demo_sessions.json invalid", detail: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
  const demos: DemoSession[] = [];
  for (const d of ids) {
    const s = await getSession(d.id).catch(() => null);
    if (!s) continue;
    const messages = await listMessages(s.id, { channel: "text", limit: 1000 }).catch(() => []);
    demos.push({
      id: s.id,
      label: d.label ?? null,
      user_name: s.user_name,
      agent_name: s.agent_name,
      need: s.need,
      phase: s.phase,
      mode: s.mode,
      gmail_status: s.gmail_status,
      messages: messages.filter((m) => m.kind === "text" && (m.role === "user" || m.role === "assistant")).length,
      created_at: s.created_at,
    });
  }
  return Response.json({ demos }, { headers: { "Cache-Control": "no-store" } });
}
