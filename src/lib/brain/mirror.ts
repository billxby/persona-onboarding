"use client";

import { session } from "@/lib/session/store";
import type { ChatMessage, LinkPreview, ReactionKind, Slot } from "@/lib/session/types";
import type { MessageRow, SessionRow, SessionView } from "@/lib/shared/types";

/**
 * Server rows → client store. The server is the source of truth; this file
 * only translates and applies. Everything here is idempotent, so the same row
 * may arrive via the chat stream, Realtime and catch-up polling.
 */

export const messageIdForRow = (row: Pick<MessageRow, "id" | "client_id">) => row.client_id ?? `srv-${row.id}`;

function domainOf(url: string | undefined, fallback?: string): string {
  if (fallback) return fallback;
  try {
    return new URL(url ?? "", typeof window !== "undefined" ? window.location.origin : "http://localhost").host;
  } catch {
    return "persona";
  }
}

/** `payload.app_clip` on a link card → the App Clip metadata the thread gates on Contacts. */
function appClipFromPayload(p: MessageRow["payload"]): LinkPreview["appClip"] | undefined {
  const raw = p.app_clip;
  if (!raw || typeof raw !== "object") return undefined;
  const c = raw as { app_name?: unknown; title?: unknown; subtitle?: unknown; verb?: unknown };
  const verb = c.verb === "Open" || c.verb === "View" || c.verb === "Play" ? c.verb : undefined;
  return {
    appName: typeof c.app_name === "string" && c.app_name ? c.app_name : "Persona",
    title: typeof c.title === "string" ? c.title : "Meet your Persona",
    subtitle: typeof c.subtitle === "string" ? c.subtitle : "",
    verb,
  };
}

function linkFromPayload(p: MessageRow["payload"], content: string | null): LinkPreview {
  const url = p.url ?? content ?? "";
  return {
    url,
    domain: domainOf(url, p.domain),
    title: p.title,
    description: p.description ?? (p.lines ? p.lines.join(" · ") : undefined),
    imageUrl: typeof p.image_url === "string" ? p.image_url : undefined,
    appClip: appClipFromPayload(p),
  };
}

/** Translate a `messages` row into what the thread renders. `null` = not a thread bubble. */
export function rowToMessage(row: MessageRow): ChatMessage | null {
  if (row.channel === "call") return null;
  if (row.kind === "tapback") return null;
  if (row.role === "system" && row.kind !== "call_log") return null;
  const p = row.payload ?? {};
  const ts = Date.parse(row.created_at);
  const base = {
    id: messageIdForRow(row),
    role: row.role,
    ts: Number.isFinite(ts) ? ts : Date.now(),
    serverId: row.id,
    status: "delivered" as const,
  };
  switch (row.kind) {
    case "text":
      return { ...base, content: { kind: "text", text: row.content ?? "", effect: p.effect } };
    case "link_card":
      return { ...base, content: { kind: "link", link: linkFromPayload(p, row.content) } };
    case "summary_card":
      return {
        ...base,
        content: {
          kind: "link",
          link: {
            url: p.url ?? row.content ?? "",
            domain: domainOf(p.url ?? row.content ?? "", p.domain),
            title: p.title ?? "You're set up",
            description: (p.lines?.length ? p.lines.join(" · ") : p.description) ?? undefined,
          },
        },
      };
    case "contact_card":
      return { ...base, content: { kind: "contact", contact: { name: p.name ?? row.content ?? "Persona", org: p.org, note: p.note } } };
    case "voicemail":
    case "audio":
      return {
        ...base,
        content: {
          kind: "audio",
          audio: { durationSec: p.duration_sec ?? 0, transcript: p.transcript ?? row.content ?? undefined, src: p.audio_url },
        },
      };
    case "call_log":
      return { ...base, role: "system", content: { kind: "call", call: { reason: p.reason ?? row.content ?? "ended", durationMs: p.duration_ms } } };
    case "screenshot":
      return { ...base, content: { kind: "image", image: { src: (p.url as string | undefined) ?? "", alt: row.content ?? undefined } } };
    default:
      return row.content ? { ...base, content: { kind: "text", text: row.content } } : null;
  }
}

/** A `tapback` row toggles a reaction on its target message. Idempotent (`added` is absolute). */
export function applyTapbackRow(row: MessageRow): void {
  const p = row.payload ?? {};
  const target = p.target_client_id ?? (typeof p.target_id === "number" ? `srv-${p.target_id}` : null);
  if (!target) return;
  const kind: ReactionKind | null = p.tapback
    ? { type: "tapback", tapback: p.tapback as ReactionKind extends { tapback: infer T } ? T : never }
    : p.emoji
      ? { type: "emoji", emoji: p.emoji }
      : null;
  if (!kind) return;
  const by = p.by ?? (row.role === "user" ? "user" : "assistant");
  session.get().setReaction(target, kind, by, p.added ?? true);
}

export function applyMessageRow(row: MessageRow): void {
  const st = session.get();
  if (row.kind === "tapback") applyTapbackRow(row);
  else {
    const m = rowToMessage(row);
    if (m) st.upsertMessage(m);
  }
  st.setLastServerMessageId(row.id);
}

export interface GmailFlip {
  prev: Slot["status"];
  next: Slot["status"];
  email?: string;
}

/** Apply a `sessions` row; reports the Gmail slot transition so the brain can react. */
export function applySessionRow(row: SessionRow): GmailFlip {
  const prev = session.get().slots.gmail.status;
  session.get().applyServerSession(row);
  const gmail = session.get().slots.gmail;
  return { prev, next: gmail.status, email: gmail.value };
}

export function applyView(view: SessionView): GmailFlip {
  const flip = applySessionRow(view.session);
  for (const row of view.messages) applyMessageRow(row);
  session.get().setBrainView({
    beliefs: view.beliefs,
    intentions: view.intentions ?? [],
    nextBestAsk: view.next_best_ask,
    latency: view.latency,
    promptVersion: view.session.prompt_version ?? null,
  });
  return flip;
}
