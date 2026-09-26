import fs from "node:fs";
import path from "node:path";
import type { Metadata } from "next";
import { ClipContentSchema, type ClipContent } from "@/lib/shared/clip";
import { ClipExperience } from "./ClipExperience";

/**
 * The App Clip's invocation URL and its web fallback: "Meet your Persona".
 * On an iPhone with the clip published this page is what the App Clip card
 * points at (Smart App Banner below); everywhere else it is a normal page.
 * `?embed=1` strips the site chrome so the simulator can run it inside the phone.
 */

const APP_STORE_ID = process.env.APP_STORE_ID || "000000000";
const APP_CLIP_BUNDLE_ID = process.env.APP_CLIP_BUNDLE_ID || "com.persona.app.Clip";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

let cached: ClipContent | null = null;
function loadContent(): ClipContent {
  if (cached && process.env.NODE_ENV === "production") return cached;
  const raw = JSON.parse(fs.readFileSync(path.join(process.cwd(), "data", "clip_content.json"), "utf8"));
  const parsed = ClipContentSchema.safeParse(raw);
  if (!parsed.success) throw new Error(`data/clip_content.json is invalid: ${parsed.error.message}`);
  cached = parsed.data;
  return parsed.data;
}

export const metadata: Metadata = {
  title: "Meet your Persona",
  description: "What your Persona can do for you in Messages, then the Persona Band, the products, and how the first five minutes go.",
  openGraph: {
    title: "Meet your Persona",
    description: "What it can do for you in Messages, then the wristband and the full experience.",
    images: ["/clip/og.png"],
  },
  other: {
    // Smart App Banner: tells Safari/Messages which App Clip this page belongs to (App Store id and clip bundle id are deployment settings).
    "apple-itunes-app": `app-id=${APP_STORE_ID}, app-clip-bundle-id=${APP_CLIP_BUNDLE_ID}, app-clip-display=card`,
  },
};

export default async function ClipPage({ searchParams }: { searchParams: Promise<{ sid?: string; embed?: string }> }) {
  const { sid, embed } = await searchParams;
  const content = loadContent();
  return <ClipExperience content={content} sid={sid && UUID.test(sid) ? sid : undefined} embed={embed === "1" || embed === "true"} />;
}
