import { env } from "@/lib/server/env";

/**
 * Apple App Site Association for App Clip invocation from this domain, served at
 * /.well-known/apple-app-site-association through a rewrite in next.config.ts (a
 * dot-folder route breaks Next's route type generation). Apple fetches it over HTTPS
 * with no redirects; the `appclips.apps` entry is `<TEAMID>.<app clip bundle id>`.
 * Empty until APPLE_TEAM_ID and APP_CLIP_BUNDLE_ID are set.
 */
export async function GET() {
  const apps = env.APPLE_TEAM_ID && env.APP_CLIP_BUNDLE_ID ? [`${env.APPLE_TEAM_ID}.${env.APP_CLIP_BUNDLE_ID}`] : [];
  return new Response(JSON.stringify({ appclips: { apps } }), {
    headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=3600" },
  });
}
