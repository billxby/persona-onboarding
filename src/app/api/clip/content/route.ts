import { loadClipContent } from "@/lib/server/clipContent";

/** GET /api/clip/content — the clip's copy (onboarding screens + tour), for the in-phone clip and the native scaffold. */
export async function GET() {
  try {
    const content = loadClipContent();
    return Response.json(content, { headers: { "Cache-Control": "public, max-age=60" } });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return Response.json({ error: "clip content invalid", detail: message }, { status: 500 });
  }
}
