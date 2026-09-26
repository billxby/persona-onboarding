import { cookies } from "next/headers";
import { z } from "zod";
import { db } from "@/lib/server/db";
import { insertEvent, listMessages, sessionView } from "@/lib/server/messages";
import { createSession, isUuid, SESSION_COOKIE, sessionCookie } from "@/lib/server/session";
import { seedOpening } from "@/lib/server/brain/chat";
import type { CreateSessionRequest } from "@/lib/shared/types";

const Body = z.object({
  id: z.string().uuid().optional(),
  access_token: z.string().min(10).max(4096).optional(),
});

/** POST /api/session — create (idempotent on a client-proposed id), seed the opening (your "Hey Persona" + the opener), set the cookie. */
export async function POST(req: Request) {
  const raw = (await req.json().catch(() => ({}))) as CreateSessionRequest;
  const parsed = Body.safeParse(raw ?? {});
  if (!parsed.success) return Response.json({ error: "bad_request", issues: parsed.error.issues }, { status: 400 });
  const { id, access_token } = parsed.data;

  let owner_uid: string | null = null;
  if (access_token) {
    try {
      const { data } = await db().auth.getUser(access_token);
      owner_uid = data.user?.id ?? null;
    } catch {
      owner_uid = null;
    }
  }

  const session = await createSession({ id, owner_uid });
  const existing = await listMessages(session.id, { limit: 1 });
  if (existing.length === 0) {
    await seedOpening(session.id);
    await insertEvent(session.id, "session_created", { owner_uid: !!owner_uid, proposed_id: !!id });
  }

  const cookieStore = await cookies();
  const c = sessionCookie();
  cookieStore.set(c.name, session.id, { maxAge: c.maxAge, httpOnly: c.httpOnly, sameSite: c.sameSite, path: c.path });

  const view = await sessionView(session.id);
  return Response.json(view);
}

/** GET /api/session — the session named by the cookie, with catch-up. */
export async function GET() {
  const cookieStore = await cookies();
  const sid = cookieStore.get(SESSION_COOKIE)?.value;
  if (!sid || !isUuid(sid)) return Response.json({ error: "no_session" }, { status: 404 });
  const view = await sessionView(sid);
  if (!view) return Response.json({ error: "not_found" }, { status: 404 });
  return Response.json(view);
}
