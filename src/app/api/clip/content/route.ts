import fs from "node:fs";
import path from "node:path";
import { ClipContentSchema, type ClipContent } from "@/lib/shared/clip";
import { isProd } from "@/lib/server/env";

let cached: ClipContent | null = null;

/** Loads and validates data/clip_content.json (cached in production, re-read in dev). */
export function loadClipContent(): ClipContent {
  if (cached && isProd()) return cached;
  const raw = fs.readFileSync(path.join(process.cwd(), "data", "clip_content.json"), "utf8");
  const parsed = ClipContentSchema.parse(JSON.parse(raw));
  cached = parsed;
  return parsed;
}

export async function GET() {
  try {
    const content = loadClipContent();
    return Response.json(content, { headers: { "Cache-Control": "public, max-age=60" } });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return Response.json({ error: "clip content invalid", detail: message }, { status: 500 });
  }
}
