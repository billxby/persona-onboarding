import { notFound } from "next/navigation";
import { getSession } from "@/lib/server/session";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ sid: string }> }) {
  const { sid } = await params;
  const s = await getSession(sid);
  return { title: s ? `You're set up${s.user_name ? `, ${s.user_name}` : ""} · Persona` : "Persona" };
}

/**
 * The graduation summary card. The thread links here (a real iMessage sender
 * can only send a link), so this page is what the "summary card" opens.
 */
export default async function SummaryPage({ params }: { params: Promise<{ sid: string }> }) {
  const { sid } = await params;
  const s = await getSession(sid);
  if (!s) notFound();

  const agent = s.agent_name ?? "Persona";
  const name = s.user_name ?? "friend";
  const gmail =
    s.gmail_status === "connected"
      ? `Connected${s.gmail_email ? ` as ${s.gmail_email}` : ""}${s.mock_inbox ? " (demo inbox)" : ""} · read-only`
      : s.gmail_status === "declined"
        ? "Not connected (you passed for now)"
        : s.gmail_status === "pending"
          ? "Connection pending"
          : "Not connected";
  const next = [
    s.need ? `I'll keep working on: ${s.need}.` : "Tell me one thing you want off your plate and I'll start.",
    s.gmail_status === "connected" ? "Ask me anything about your inbox; I'll draft replies but never send." : "Connect Gmail any time from the thread for inbox help.",
    `Text me in the same thread. I answer as ${agent}.`,
  ];

  return (
    <main className="min-h-dvh bg-[#f2f2f7] px-4 py-8 text-[#111]">
      <div className="mx-auto w-full max-w-[420px]">
        <div className="rounded-[28px] bg-white p-6 shadow-[0_20px_60px_-25px_rgba(0,0,0,0.3)]">
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-gradient-to-br from-[#8e8e93] to-[#636366] text-white text-[18px] font-semibold">
              {agent.slice(0, 1).toUpperCase()}
            </div>
            <div>
              <div className="text-[12px] uppercase tracking-wider text-black/40">Your Persona</div>
              <div className="text-[18px] font-semibold leading-tight">{agent}</div>
            </div>
          </div>

          <h1 className="mt-6 text-[28px] font-semibold leading-tight tracking-tight">You&apos;re set up, {name}.</h1>

          <dl className="mt-5 divide-y divide-black/[0.06] text-[15px]">
            <Row label="You">{s.user_name ?? "friend (you can tell me later)"}</Row>
            <Row label="Your task">{s.need ?? "not yet"}</Row>
            <Row label="Gmail">{gmail}</Row>
            <Row label="My name">{agent}</Row>
          </dl>

          <div className="mt-6">
            <div className="text-[12px] uppercase tracking-wider text-black/40">What happens next</div>
            <ol className="mt-2 space-y-2 text-[15px] leading-snug">
              {next.map((line, i) => (
                <li key={i} className="flex gap-2.5">
                  <span className="mt-[2px] flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-black/[0.06] text-[11px] font-semibold text-black/60">{i + 1}</span>
                  <span>{line}</span>
                </li>
              ))}
            </ol>
          </div>

          <div className="mt-6 rounded-2xl bg-[#f2f2f7] px-4 py-3 text-[14px] text-black/70">
            Try: <span className="font-medium text-black">&ldquo;anything from my landlord?&rdquo;</span>
          </div>
        </div>
        <p className="mt-4 text-center text-[12px] text-black/40">Session {sid.slice(0, 8)} · nothing is sent without your yes.</p>
      </div>
    </main>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 py-2.5">
      <dt className="shrink-0 text-black/45">{label}</dt>
      <dd className="text-right font-medium">{children}</dd>
    </div>
  );
}
