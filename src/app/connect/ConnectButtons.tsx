"use client";

import { useState } from "react";

type Status = "idle" | "loading" | "done" | "error";

export function ConnectButtons({ sid, configured }: { sid: string; configured: boolean }) {
  const [status, setStatus] = useState<Status>("idle");
  const [email, setEmail] = useState<string | null>(null);

  const useDemo = async () => {
    setStatus("loading");
    try {
      const res = await fetch("/api/gmail/connect", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ session_id: sid, mock: true }),
      });
      const data = (await res.json()) as { ok?: boolean; email?: string };
      if (!res.ok || !data.ok) throw new Error("connect failed");
      setEmail(data.email ?? null);
      setStatus("done");
      try {
        window.opener?.postMessage({ type: "persona:gmail", status: "connected", email: data.email ?? null, sid }, "*");
      } catch {
        /* no opener */
      }
      setTimeout(() => window.close(), 800);
    } catch {
      setStatus("error");
    }
  };

  if (status === "done") {
    return (
      <p className="rounded-2xl bg-white p-4 text-sm shadow-sm">
        Connected{email ? ` as ${email}` : ""}. You can close this window and go back to the chat.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <a
        href={configured ? `/api/oauth/google/start?sid=${encodeURIComponent(sid)}` : undefined}
        aria-disabled={!configured}
        className={`block w-full rounded-2xl px-4 py-3.5 text-center text-[15px] font-semibold text-white shadow-sm transition ${
          configured ? "bg-[#1982fc] hover:bg-[#1573e6] active:scale-[0.99]" : "cursor-not-allowed bg-[#9aa0a6]"
        }`}
      >
        Connect Gmail
      </a>
      {!configured && (
        <p className="px-1 text-xs text-[#6e6e73]">Google OAuth isn&apos;t configured on this deployment yet. Use the demo inbox below to see the same flow.</p>
      )}
      <button
        type="button"
        onClick={useDemo}
        disabled={status === "loading"}
        className="block w-full rounded-2xl bg-white px-4 py-3.5 text-[15px] font-semibold text-[#1982fc] shadow-sm transition hover:bg-[#f0f5ff] active:scale-[0.99] disabled:opacity-60"
      >
        {status === "loading" ? "Connecting…" : "Use the demo inbox instead"}
      </button>
      {status === "error" && <p className="px-1 text-xs text-[#d70015]">Couldn&apos;t connect the demo inbox. Try again.</p>}
      <p className="px-1 text-xs text-[#6e6e73]">The demo inbox is 20 sample emails (a gym you want to cancel, a landlord, a few subscriptions). It&apos;s labelled as a demo everywhere.</p>
    </div>
  );
}
