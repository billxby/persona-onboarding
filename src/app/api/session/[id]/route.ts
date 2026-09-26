import type { NextRequest } from "next/server";
import { sessionView } from "@/lib/server/messages";
import { isUuid } from "@/lib/server/session";

/** GET /api/session/[id]?after=<messageId> — catch-up view (runs lazy drop detection). */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) return Response.json({ error: "bad_id" }, { status: 400 });
  const afterRaw = req.nextUrl.searchParams.get("after");
  const afterId = afterRaw && /^\d+$/.test(afterRaw) ? Number(afterRaw) : undefined;
  const view = await sessionView(id, { afterId });
  if (!view) return Response.json({ error: "not_found" }, { status: 404 });
  return Response.json(view, { headers: { "Cache-Control": "no-store" } });
}
