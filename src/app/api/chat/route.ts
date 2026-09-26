import { z } from "zod";
import { runTextTurn } from "@/lib/server/brain/chat";
import type { ChatEvent } from "@/lib/shared/types";

export const maxDuration = 60;

const Body = z.object({
  session_id: z.string().uuid(),
  trigger: z.enum(["user", "open", "call_ended", "dropped", "voicemail", "gmail_connected", "gmail_declined", "welcome_back", "silence_end"]).default("user"),
  reason: z.string().max(200).optional(),
});

/**
 * POST /api/chat — run one assistant turn and stream ChatEvents as NDJSON
 * (one JSON object per line): typing, message, tool, session, beliefs, done | busy | error.
 */
export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "bad_request", issues: parsed.error.issues }, { status: 400 });
  const { session_id, trigger, reason } = parsed.data;

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let open = true;
      const emit = (e: ChatEvent) => {
        if (!open) return;
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(e)}\n`));
        } catch {
          open = false;
        }
      };
      try {
        await runTextTurn(session_id, trigger, reason, emit);
      } catch (e) {
        emit({ type: "error", message: e instanceof Error ? e.message : String(e) });
      } finally {
        open = false;
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}
