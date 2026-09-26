import type { RealtimeTokenResponse } from "@/lib/shared/types";
import { ensureMind } from "@/lib/memory/mind";
import { env } from "@/lib/server/env";
import { activeBeliefs, detectDrop } from "@/lib/server/messages";
import { buildPrompt, PROMPT_VERSION } from "@/lib/server/prompt";
import { getSession, isUuid, patchSession } from "@/lib/server/session";
import { toolJsonSchemas } from "@/lib/server/tools/definitions";

export const maxDuration = 30;

/** Turn-detection settings shared by the mint and the browser session (the client's session.update overwrites the mint). */
export const TURN_DETECTION = { silence_duration_ms: 500, prefix_padding_ms: 300 } as const;

/**
 * Mint a short-lived Realtime client secret bound to this session's prompt and tools (DESIGN §10.1).
 * Audio never touches our server: the browser talks to OpenAI directly over WebRTC with this key.
 */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { session_id?: string };
  if (!isUuid(body.session_id)) return Response.json({ error: "session_id required" }, { status: 400 });
  let session = await getSession(body.session_id);
  if (!session) return Response.json({ error: "session not found" }, { status: 404 });
  session = await detectDrop(session);

  const [beliefs, mind] = await Promise.all([activeBeliefs(session.id), ensureMind(session.id, session.turn ?? 0).catch(() => undefined)]);
  const instructions = buildPrompt(session, "call", beliefs, mind);
  const tools = toolJsonSchemas("call");
  const model = env.REALTIME_MODEL;
  const voice = env.REALTIME_VOICE;
  const transcribe_model = env.TRANSCRIBE_MODEL;

  const r = await fetch("https://api.openai.com/v1/realtime/client_secrets", {
    method: "POST",
    headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      expires_after: { anchor: "created_at", seconds: 600 },
      session: {
        type: "realtime",
        model,
        instructions,
        output_modalities: ["audio"],
        audio: {
          input: {
            transcription: { model: transcribe_model },
            turn_detection: { type: "server_vad", ...TURN_DETECTION, create_response: true, interrupt_response: true },
          },
          output: { voice },
        },
        tools,
        tool_choice: "auto",
      },
    }),
  });
  if (!r.ok) {
    const text = await r.text();
    let message = text;
    try {
      message = (JSON.parse(text) as { error?: { message?: string } }).error?.message ?? text;
    } catch {
      /* keep raw */
    }
    console.error("[realtime/token] mint failed", r.status, message);
    return Response.json({ error: `OpenAI client_secrets ${r.status}: ${message}` }, { status: 502 });
  }
  const json = (await r.json()) as { value: string; expires_at: number };
  await patchSession(session.id, (s) => (s.prompt_version === PROMPT_VERSION ? null : { prompt_version: PROMPT_VERSION }));

  const res: RealtimeTokenResponse & { transcribe_model: string; turn_detection: typeof TURN_DETECTION } = {
    client_secret: json.value,
    expires_at: json.expires_at,
    model,
    voice,
    instructions,
    tools,
    transcribe_model,
    turn_detection: TURN_DETECTION,
  };
  return Response.json(res);
}
