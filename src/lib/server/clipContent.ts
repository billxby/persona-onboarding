import fs from "node:fs";
import path from "node:path";
import { ClipContentSchema, type ClipContent } from "@/lib/shared/clip";
import { isProd } from "./env";

let cached: ClipContent | null = null;

/** Loads and validates data/clip_content.json (cached in production, re-read in dev). Read by /clip, /api/clip/content and the native clip. */
export function loadClipContent(): ClipContent {
  if (cached && isProd()) return cached;
  const raw = fs.readFileSync(path.join(process.cwd(), "data", "clip_content.json"), "utf8");
  const parsed = ClipContentSchema.parse(JSON.parse(raw));
  cached = parsed;
  return parsed;
}
