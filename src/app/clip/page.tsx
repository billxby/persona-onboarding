import type { Metadata } from "next";
import { loadClipContent } from "@/lib/server/clipContent";
import { ClipOnboarding } from "./ClipOnboarding";

/**
 * The App Clip's invocation URL and its web fallback: the app's onboarding (DESIGN §19).
 * On an iPhone with the clip published this page is what the App Clip card points at (Smart App
 * Banner below); everywhere else it is the same wizard as a normal page, no site chrome, centred
 * in a phone-width column. `?sid=` is the session the clip writes to.
 */

const APP_STORE_ID = process.env.APP_STORE_ID || "000000000";
const APP_CLIP_BUNDLE_ID = process.env.APP_CLIP_BUNDLE_ID || "com.persona.app.Clip";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const metadata: Metadata = {
  title: "Persona",
  description: "Your personal assistant, in Messages. Set it up in a minute: your name, what to call it, Google, and whether you want a call.",
  openGraph: {
    title: "Persona",
    description: "Your personal assistant, in Messages.",
    images: ["/clip/og.png"],
  },
  other: {
    // Smart App Banner: tells Safari/Messages which App Clip this page belongs to (App Store id and clip bundle id are deployment settings).
    "apple-itunes-app": `app-id=${APP_STORE_ID}, app-clip-bundle-id=${APP_CLIP_BUNDLE_ID}, app-clip-display=card`,
  },
};

export default async function ClipPage({ searchParams }: { searchParams: Promise<{ sid?: string }> }) {
  const { sid } = await searchParams;
  const content = loadClipContent();
  return (
    <main className="min-h-dvh bg-clip-bg text-clip-ink" data-clip-page>
      <div className="mx-auto flex h-dvh w-full max-w-[430px] flex-col">
        {/* the status-bar gap a phone would have */}
        <div className="h-[24px] shrink-0" />
        <div className="min-h-0 flex-1">
          <ClipOnboarding content={content} sid={sid && UUID.test(sid) ? sid : undefined} embed={false} />
        </div>
      </div>
    </main>
  );
}
