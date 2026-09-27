import { z } from "zod";
import type { GmailStatus, Intention, SessionRow } from "./types";

/**
 * Persona App Clip: shared contract for the bot's card, the /clip page (the clip's
 * invocation URL and web fallback), the simulated in-phone clip and the native scaffold.
 * The clip is the app's onboarding (DESIGN §19): a short mobile wizard that collects the
 * user's name, what to call the assistant, a Google connection and whether they want a
 * call, each captured the moment it is given against the session in the URL. The copy
 * lives in data/clip_content.json; nothing here is user-specific.
 */

export const ClipFeatureIcon = z.enum(["mail", "pen", "scissors", "calendar", "phone", "shield"]);

const Cta = z.object({ label: z.string().min(1).max(40), url: z.string().url() });
const Bubble = z.object({ from: z.enum(["user", "persona"]), text: z.string().min(1).max(160) });

/** The onboarding wizard's copy, screen by screen. */
export const ClipOnboardingSchema = z.object({
  welcome: z.object({ title: z.string().min(1).max(60), subtitle: z.string().min(1).max(140), next: z.string().min(1).max(30) }),
  values: z
    .array(z.object({ eyebrow: z.string().min(1).max(30), title: z.string().min(1).max(60), subtitle: z.string().min(1).max(140), thread: z.array(Bubble).min(1).max(4) }))
    .min(1)
    .max(4),
  user_name: z.object({ title: z.string().min(1).max(60), subtitle: z.string().min(1).max(140), placeholder: z.string().min(1).max(40), skip: z.string().min(1).max(30) }),
  agent_name: z.object({
    title: z.string().min(1).max(60),
    subtitle: z.string().min(1).max(140),
    placeholder: z.string().min(1).max(40),
    suggestions: z.array(z.string().min(1).max(20)).min(1).max(6),
    skip: z.string().min(1).max(30),
  }),
  gmail: z.object({
    title: z.string().min(1).max(60),
    subtitle: z.string().min(1).max(140),
    rows: z.array(z.string().min(1).max(60)).min(1).max(4),
    connect: z.string().min(1).max(30),
    demo: z.string().min(1).max(40),
    skip: z.string().min(1).max(30),
  }),
  call: z.object({ title: z.string().min(1).max(60), subtitle: z.string().min(1).max(140), yes: z.string().min(1).max(30), no: z.string().min(1).max(30) }),
  done: z.object({
    title: z.string().min(1).max(60),
    subtitle: z.string().min(1).max(140),
    calling: z.string().min(1).max(140),
    back: z.string().min(1).max(30),
    start_web: z.string().min(1).max(30),
  }),
  get_app: z.object({ label: z.string().min(1).max(40), url: z.string().url() }),
});

export const ClipContentSchema = z.object({
  version: z.string().min(1),
  onboarding: ClipOnboardingSchema,
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
export type ClipOnboardingCopy = z.infer<typeof ClipOnboardingSchema>;
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
  title: "Persona",
  subtitle: "Your personal assistant, in Messages",
  verb: "Open" as const,
};

/** The card's header image (2:1, the App Store Connect "header image" slot). */
export const APP_CLIP_HEADER_IMAGE = "/clip/card-header.svg";

/** `payload.app_clip` on a `link_card` row; the client maps it to `LinkPreview.appClip`. */
export interface LinkCardAppClipPayload {
  app_name: string;
  title: string;
  subtitle: string;
  verb: "Open" | "View" | "Play";
}

/** Invocation URL of the clip (and its web fallback). `sid` is the session the clip writes to (our stand-in for "launched with the phone number attached"). */
export function clipUrl(appUrl: string, sessionId?: string | null): string {
  const base = `${appUrl.replace(/\/$/, "")}/clip`;
  return sessionId ? `${base}?sid=${encodeURIComponent(sessionId)}` : base;
}

/** Client-side analytics event types the /clip page and the simulated clip may post to /api/events. */
export const CLIP_EVENT_TYPES = ["app_clip_card_shown", "app_clip_opened", "app_clip_closed", "app_clip_cta", "app_clip_fallback_web", "app_clip_demo"] as const;
export type ClipEventType = (typeof CLIP_EVENT_TYPES)[number];

// ---------------------------------------------------------------------------
// the onboarding wizard's wire contract (POST /api/clip/answer, GET /api/clip/state)
// ---------------------------------------------------------------------------

/** The steps that capture something. `gmail` is written by OAuth or the demo inbox; only its skip goes through /answer. */
export const CLIP_STEPS = ["user_name", "agent_name", "gmail", "call_offer"] as const;
export type ClipStep = (typeof CLIP_STEPS)[number];

/** Every screen of the wizard, in order (the value screens are one step with pages). */
export const CLIP_SCREENS = ["welcome", "values", "user_name", "agent_name", "gmail", "call_offer", "done"] as const;
export type ClipScreen = (typeof CLIP_SCREENS)[number];

/** `"skip"` is legal for every step; for `call_offer` the value is `yes` | `no` | `skip`. */
export const CLIP_SKIP = "skip";

export const ClipAnswerSchema = z.object({
  session_id: z.string().uuid(),
  step: z.enum(CLIP_STEPS),
  value: z.string().min(1).max(240),
});
export type ClipAnswer = z.infer<typeof ClipAnswerSchema>;

export type CallOfferAnswer = "yes" | "no" | "skip";

/** Normalise what the wizard (or a text reply routed here) said about the call offer. */
export function callOfferAnswer(value: string): CallOfferAnswer {
  const v = value.trim().toLowerCase();
  if (v === CLIP_SKIP || /^(later|not now|maybe)/.test(v)) return "skip";
  if (/^(y|yes|yep|yeah|sure|ok|okay|call|ring|please)/.test(v)) return "yes";
  return "no";
}

export type ClipStepState = "empty" | "filled" | "skipped";

/** What the wizard needs to resume where the session already is (and to poll Gmail). */
export interface ClipState {
  user_name: string | null;
  agent_name: string | null;
  gmail_status: GmailStatus;
  gmail_email: string | null;
  /** `prefers_text`: a hangup or an earlier no already settled it (DESIGN §1.7) */
  call_offer: "unasked" | "yes" | "no" | "prefers_text";
  /** real Google OAuth is configured on this deployment (else the demo inbox is the only option) */
  google_configured: boolean;
  steps: Record<ClipStep, ClipStepState>;
}

const skippedSlot = (s: SessionRow, slot: "user_name" | "agent_name") => (s.attempts?.[slot] ?? 0) >= 3;

/** Pure: the wizard's view of a session. `mind` decides whether the call offer is already settled. */
export function clipStateFrom(s: SessionRow, mind: Pick<Intention, "key" | "status">[], googleConfigured: boolean): ClipState {
  const offer = mind.find((r) => r.key === "offer_call");
  const call_offer: ClipState["call_offer"] =
    s.channel_pref === "call" ? "yes" : s.channel_pref === "text" ? (offer?.status === "done" ? "no" : "prefers_text") : offer?.status === "done" ? "no" : "unasked";
  return {
    user_name: s.user_name,
    agent_name: s.agent_name,
    gmail_status: s.gmail_status,
    gmail_email: s.gmail_email,
    call_offer,
    google_configured: googleConfigured,
    steps: {
      user_name: s.user_name ? "filled" : skippedSlot(s, "user_name") ? "skipped" : "empty",
      agent_name: s.agent_name ? "filled" : skippedSlot(s, "agent_name") ? "skipped" : "empty",
      gmail: s.gmail_status === "connected" ? "filled" : s.gmail_status === "declined" || s.gmail_status === "failed" ? "skipped" : "empty",
      call_offer: call_offer === "unasked" ? "empty" : "filled",
    },
  };
}

export interface ClipAnswerResponse {
  ok: boolean;
  /** why a value was rejected (a name the validator refused), in the agent's words */
  error?: string;
  state: ClipState;
}

export interface ClipStateResponse {
  state: ClipState;
}

// ---------------------------------------------------------------------------
// "Try your Persona" (kept for the native scaffold and POST /api/clip/demo)
// ---------------------------------------------------------------------------

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
