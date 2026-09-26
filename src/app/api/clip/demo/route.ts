import { z } from "zod";
import type { ClipDemoResponse } from "@/lib/shared/clip";
import { DemoError, runClipDemo } from "@/lib/server/clipDemo";

export const maxDuration = 60;

const Body = z.object({ task: z.string().min(1).max(300), sid: z.string().uuid().optional() });

/** One-turn live demo for the App Clip ("Try your Persona"). Runs on the labelled demo inbox in a throwaway session. */
export async function POST(req: Request) {
  let body: z.infer<typeof Body>;
  try {
    body = Body.parse(await req.json());
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "bad request" }, { status: 400 });
  }
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "local";
  try {
    const r = await runClipDemo({ task: body.task, origin_sid: body.sid ?? null, ip });
    const res: ClipDemoResponse = { session_id: r.session_id, bubbles: r.bubbles, ms: r.ms };
    return Response.json(res);
  } catch (e) {
    if (e instanceof DemoError) return Response.json({ error: e.message }, { status: e.status });
    const message = e instanceof Error ? e.message : String(e);
    console.error("[clip demo] failed:", message);
    return Response.json({ error: "demo failed; continue in Messages" }, { status: 500 });
  }
}
