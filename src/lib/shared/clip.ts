import { z } from "zod";

/**
 * "Meet your Persona" App Clip: shared content contract for the bot's card, the
 * /clip web page (App Clip fallback) and the simulated in-phone clip. The copy
 * lives in data/clip_content.json; nothing here is user-specific.
 */

export const ClipFeatureIcon = z.enum(["mail", "pen", "scissors", "calendar", "phone", "shield"]);

const Cta = z.object({ label: z.string().min(1).max(40), url: z.string().url() });

export const ClipContentSchema = z.object({
  version: z.string().min(1),
  hero: z.object({ title: z.string().min(1).max(60), subtitle: z.string().min(1).max(140), cta: Cta, image: z.string().optional(), eyebrow: z.string().max(40).optional() }),
  features: z
    .array(z.object({ id: z.string().min(1), icon: ClipFeatureIcon, title: z.string().min(1).max(40), body: z.string().min(1).max(200) }))
    .min(1),
  wristband: z.object({
    name: z.string().min(1).max(40),
    tagline: z.string().min(1).max(80),
    body: z.string().min(1).max(400),
    bullets: z.array(z.string().min(1).max(120)).min(1),
    image: z.string().optional(),
    gallery: z.array(z.string()).optional(),
    colors: z.array(z.string().max(30)).optional(),
    how_to_get: z.object({ label: z.string().min(1).max(40), url: z.string().url(), note: z.string().max(120).optional() }),
  }),
  products: z
    .array(z.object({ id: z.string().min(1), name: z.string().min(1).max(40), body: z.string().min(1).max(240), price: z.string().max(40).optional(), cta: Cta }))
    .min(1),
  experience: z.object({ title: z.string().min(1).max(60), steps: z.array(z.object({ title: z.string().min(1).max(60), body: z.string().min(1).max(200) })).min(1) }),
  footer: z.object({ privacy: z.string().min(1).max(300) }),
});

export type ClipContent = z.infer<typeof ClipContentSchema>;
export type ClipFeature = ClipContent["features"][number];
export type ClipProduct = ClipContent["products"][number];

/** App Clip card limits (HIG): title ≤ 30 chars, subtitle ≤ 56 chars. */
export const APP_CLIP_TITLE_MAX = 30;
export const APP_CLIP_SUBTITLE_MAX = 56;

/**
 * What the system App Clip card shows. Static per App Store Connect experience, so it is
 * static here too. Written to `link_card` messages as `payload.app_clip`.
 */
export const APP_CLIP_CARD = {
  app_name: "Persona",
  title: "Meet your Persona",
  subtitle: "What it can do for you, right in Messages",
  verb: "Open" as const,
};

/** `payload.app_clip` on a `link_card` row; the client maps it to `LinkPreview.appClip`. */
export interface LinkCardAppClipPayload {
  app_name: string;
  title: string;
  subtitle: string;
  verb: "Open" | "View" | "Play";
}

/** Invocation URL of the clip (and its web fallback). `sid` lets the page report events for the session. */
export function clipUrl(appUrl: string, sessionId?: string | null): string {
  const base = `${appUrl.replace(/\/$/, "")}/clip`;
  return sessionId ? `${base}?sid=${encodeURIComponent(sessionId)}` : base;
}

/** Client-side analytics event types the /clip page and the simulated clip may post to /api/events. */
export const CLIP_EVENT_TYPES = ["app_clip_card_shown", "app_clip_opened", "app_clip_closed", "app_clip_cta", "app_clip_fallback_web", "app_clip_demo"] as const;
export type ClipEventType = (typeof CLIP_EVENT_TYPES)[number];

/**
 * "Try your Persona": the live demo inside the clip (Apple's HIG rejects clips that only advertise;
 * the clip must let the user do something). One task, one turn on the labelled demo inbox.
 */
export const DEMO_TASKS = [
  "Cancel my gym membership before it renews",
  "What is my landlord asking about the lease?",
  "Draft a reply to the dentist about my appointment",
] as const;

export interface ClipDemoRequest {
  task: string;
  /** the session the clip was opened from, when known (rate limit + event attribution) */
  sid?: string;
}

export interface ClipDemoResponse {
  /** throwaway session the demo ran in */
  session_id: string;
  /** the assistant's text bubbles, in order */
  bubbles: string[];
  ms: number;
}
