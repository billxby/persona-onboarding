"use client";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { MessageRow, SessionRow } from "@/lib/shared/types";

/**
 * Browser Supabase client: anonymous sign-in (best effort) + Realtime
 * subscriptions filtered to one session. Reads go through RLS
 * (`owner_uid = auth.uid()`); all writes go through our route handlers.
 */
let client: SupabaseClient | null = null;
let warnedAnon = false;

export function supabaseBrowser(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  if (!client) {
    client = createClient(url, key, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
    });
  }
  return client;
}

/** Existing anonymous session, or a new one. `null` when anonymous auth is disabled or unreachable. */
export async function ensureAnonSession(): Promise<string | null> {
  const sb = supabaseBrowser();
  if (!sb) return null;
  try {
    const { data } = await sb.auth.getSession();
    if (data.session?.access_token) return data.session.access_token;
    const { data: fresh, error } = await sb.auth.signInAnonymously();
    if (error) {
      if (!warnedAnon) {
        warnedAnon = true;
        console.info(`[persona] anonymous sign-in unavailable (${error.message}); falling back to polling`);
      }
      return null;
    }
    return fresh.session?.access_token ?? null;
  } catch (e) {
    if (!warnedAnon) {
      warnedAnon = true;
      console.info("[persona] anonymous sign-in failed; falling back to polling", e);
    }
    return null;
  }
}

export type SubscribeStatus = "SUBSCRIBED" | "CHANNEL_ERROR" | "TIMED_OUT" | "CLOSED";

export interface SessionSubscriptionHandlers {
  onMessage(row: MessageRow): void;
  onSession(row: SessionRow): void;
  /** beliefs changed; the caller refetches the projection */
  onBeliefs(): void;
  onStatus?(status: SubscribeStatus): void;
}

/** Postgres-changes subscription for one session. Returns an unsubscribe function. */
export function subscribeSession(sessionId: string, h: SessionSubscriptionHandlers, accessToken?: string | null): () => void {
  const sb = supabaseBrowser();
  if (!sb) {
    h.onStatus?.("CHANNEL_ERROR");
    return () => {};
  }
  if (accessToken) void sb.realtime.setAuth(accessToken);
  const channel = sb
    .channel(`session:${sessionId}`)
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages", filter: `session_id=eq.${sessionId}` }, (payload) =>
      h.onMessage(payload.new as MessageRow),
    )
    .on("postgres_changes", { event: "UPDATE", schema: "public", table: "sessions", filter: `id=eq.${sessionId}` }, (payload) =>
      h.onSession(payload.new as SessionRow),
    )
    .on("postgres_changes", { event: "*", schema: "public", table: "beliefs", filter: `session_id=eq.${sessionId}` }, () => h.onBeliefs())
    .subscribe((status) => h.onStatus?.(status as SubscribeStatus));
  return () => {
    void sb.removeChannel(channel);
  };
}
