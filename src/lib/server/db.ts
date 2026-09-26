import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { env } from "./env";

let client: SupabaseClient | null = null;

/** Service-role Supabase client. Server only. Bypasses RLS: validate everything before calling. */
export function db(): SupabaseClient {
  if (!client) {
    client = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
  }
  return client;
}

/** Postgres unique violation */
export const isUniqueViolation = (e: unknown) => !!e && typeof e === "object" && (e as { code?: string }).code === "23505";
