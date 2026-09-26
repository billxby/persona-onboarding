/**
 * Server-only environment access. Lazy getters so importing this file never
 * throws at build time; a missing required key throws when first used.
 */
function req(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var ${name} (see .env.example)`);
  return v;
}
const opt = (name: string) => process.env[name] || undefined;
const bool = (name: string, d = false) => {
  const v = process.env[name];
  return v == null || v === "" ? d : /^(1|true|yes|on)$/i.test(v);
};

export const env = {
  get ANTHROPIC_API_KEY() { return req("ANTHROPIC_API_KEY"); },
  get ANTHROPIC_WORKSPACE_ID() { return opt("ANTHROPIC_WORKSPACE_ID"); },
  get TEXT_PROVIDER(): "anthropic" | "openai" { return opt("TEXT_PROVIDER") === "openai" ? "openai" : "anthropic"; },
  get OPENAI_API_KEY() { return req("OPENAI_API_KEY"); },
  get GOOGLE_CLIENT_ID() { return opt("GOOGLE_CLIENT_ID"); },
  get GOOGLE_CLIENT_SECRET() { return opt("GOOGLE_CLIENT_SECRET"); },
  get SUPABASE_URL() { return req("NEXT_PUBLIC_SUPABASE_URL"); },
  get SUPABASE_SERVICE_ROLE_KEY() { return req("SUPABASE_SERVICE_ROLE_KEY"); },
  get APP_URL() { return (opt("APP_URL") ?? "http://localhost:3000").replace(/\/$/, ""); },
  get MOCK_INBOX() { return bool("MOCK_INBOX", true); },
  // models (all overridable)
  get TEXT_MODEL() { return opt("TEXT_MODEL") ?? "claude-sonnet-5"; },
  get FAST_MODEL() { return opt("FAST_MODEL") ?? "claude-haiku-4-5-20251001"; },
  get OPENAI_TEXT_MODEL() { return opt("OPENAI_TEXT_MODEL") ?? "gpt-5.4"; },
  get OPENAI_FAST_MODEL() { return opt("OPENAI_FAST_MODEL") ?? "gpt-5.4-mini"; },
  get REALTIME_MODEL() { return opt("REALTIME_MODEL") ?? "gpt-realtime-2.1"; },
  get REALTIME_VOICE() { return opt("REALTIME_VOICE") ?? "marin"; },
  get TRANSCRIBE_MODEL() { return opt("TRANSCRIBE_MODEL") ?? "gpt-4o-mini-transcribe"; },
  // App Clip (optional until there is a real iOS app): AASA entry + Smart App Banner
  get APPLE_TEAM_ID() { return opt("APPLE_TEAM_ID"); },
  get APP_CLIP_BUNDLE_ID() { return opt("APP_CLIP_BUNDLE_ID"); },
  get APP_STORE_ID() { return opt("APP_STORE_ID"); },
};

export const googleConfigured = () => !!(opt("GOOGLE_CLIENT_ID") && opt("GOOGLE_CLIENT_SECRET"));
export const isProd = () => process.env.NODE_ENV === "production";
