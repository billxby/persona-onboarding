import { env, googleConfigured } from "@/lib/server/env";
import { providerLabel } from "@/lib/server/providers";
import { PROMPT_VERSION } from "@/lib/server/prompt";

/** Which brain, which inbox, which prompt: handy for the README and for checking env reloads. */
export async function GET() {
  return Response.json({
    ok: true,
    text_provider: env.TEXT_PROVIDER,
    models: providerLabel(),
    realtime_model: env.REALTIME_MODEL,
    voice: env.REALTIME_VOICE,
    google_configured: googleConfigured(),
    mock_inbox_default: env.MOCK_INBOX,
    prompt_version: PROMPT_VERSION,
    app_url: env.APP_URL,
  });
}
