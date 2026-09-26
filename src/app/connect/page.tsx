import { googleConfigured } from "@/lib/server/env";
import { getSession } from "@/lib/server/session";
import { ConnectButtons } from "./ConnectButtons";

export const metadata = { title: "Connect Gmail · Persona" };
export const dynamic = "force-dynamic";

/**
 * The page the "Connect Gmail" link card opens (in a popup). Buttons live here,
 * not in the iMessage thread, because a real iMessage sender can only send links.
 */
export default async function ConnectPage({ searchParams }: { searchParams: Promise<{ sid?: string }> }) {
  const { sid } = await searchParams;
  const session = sid ? await getSession(sid) : null;
  const configured = googleConfigured();

  return (
    <main className="flex min-h-dvh items-center justify-center bg-[#f5f5f7] px-5 py-10 text-[#1d1d1f]">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[#1982fc] text-lg font-semibold text-white shadow-sm">P</div>
          <div>
            <h1 className="text-xl font-semibold leading-tight">Connect Gmail to Persona</h1>
            <p className="text-sm text-[#6e6e73]">Read-only. Persona only reads; nothing is ever sent without your yes.</p>
          </div>
        </div>

        {!session ? (
          <p className="rounded-2xl bg-white p-4 text-sm text-[#6e6e73] shadow-sm">
            This link has no session attached. Go back to the chat and tap the Connect Gmail card again.
          </p>
        ) : session.gmail_status === "connected" ? (
          <p className="rounded-2xl bg-white p-4 text-sm shadow-sm">
            Already connected{session.gmail_email ? ` as ${session.gmail_email}` : ""}. You can close this window.
          </p>
        ) : (
          <ConnectButtons sid={session.id} configured={configured} />
        )}

        <div className="mt-6 space-y-2 text-xs leading-relaxed text-[#6e6e73]">
          <p>
            <span className="font-medium text-[#1d1d1f]">What Persona can see:</span> sender, subject, date and a short preview of recent messages, only when you ask it to look.
          </p>
          <p>
            <span className="font-medium text-[#1d1d1f]">Testing mode:</span> this app isn&apos;t verified by Google yet, so Google shows &ldquo;this app isn&apos;t verified&rdquo;. Tap
            <span className="font-medium"> Advanced → Continue</span>. Only allow-listed test accounts can connect; if yours isn&apos;t listed, use the demo inbox.
          </p>
        </div>
      </div>
    </main>
  );
}
