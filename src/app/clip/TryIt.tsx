"use client";

import { ArrowUp } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { DEMO_TASKS, type ClipDemoResponse } from "@/lib/shared/clip";

/**
 * "Try your Persona": a one-turn live demo inside the clip. The user picks or types a task, the
 * real text brain answers on the labelled demo inbox, and the clip hands off to Messages.
 * (Apple's HIG rejects clips that only advertise; this is the part where the user does something.)
 */
type Status = "idle" | "running" | "done" | "error";

export function TryIt({ sid, embed }: { sid?: string; embed: boolean }) {
  const [task, setTask] = useState("");
  const [sent, setSent] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>("idle");
  const [bubbles, setBubbles] = useState<string[]>([]);
  const [pending, setPending] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const threadRef = useRef<HTMLDivElement>(null);

  // the route returns every bubble at once; land them like iMessage would, one every 500 ms
  useEffect(() => {
    if (!pending.length) return;
    const t = setTimeout(() => {
      setBubbles((b) => [...b, pending[0]]);
      setPending((p) => p.slice(1));
    }, 500);
    return () => clearTimeout(t);
  }, [pending]);

  useEffect(() => {
    threadRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [bubbles, sent]);

  const finished = status === "done" && pending.length === 0;

  const run = async (text: string) => {
    const value = text.trim();
    if (!value || status === "running") return;
    setSent(value);
    setTask("");
    setBubbles([]);
    setPending([]);
    setError(null);
    setStatus("running");
    try {
      const res = await fetch("/api/clip/demo", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ task: value, sid }),
      });
      const data = (await res.json()) as Partial<ClipDemoResponse> & { error?: string };
      if (!res.ok || !data.bubbles?.length) {
        setError(res.status === 429 ? "Limit reached, continue in Messages" : (data.error ?? "Something went wrong, continue in Messages"));
        setStatus("error");
        return;
      }
      setPending(data.bubbles);
      setStatus("done");
    } catch {
      setError("Couldn't reach your Persona, continue in Messages");
      setStatus("error");
    }
  };

  const report = (label: string) => {
    if (sid) {
      void fetch("/api/events", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ session_id: sid, type: "app_clip_cta", payload: { label, embed, demo: true } }),
      }).catch(() => undefined);
    }
  };

  const continueHref = sid ? `/?sid=${encodeURIComponent(sid)}` : "/";
  const onContinue = (e: React.MouseEvent) => {
    report("continue");
    if (embed && typeof window !== "undefined" && window.parent !== window) {
      e.preventDefault();
      window.parent.postMessage({ type: "persona:clip", event: "cta", label: "continue", action: "close" }, "*");
    }
  };

  return (
    <section data-clip="tryit" className="mb-2 mt-6 rounded-[18px] bg-white p-4 shadow-[0_1px_0_rgba(0,0,0,0.04)]">
      <div className="text-[20px] font-bold leading-tight">Try your Persona</div>
      <p className="mt-1 text-[14px] leading-[19px] text-black/55">Pick one thing. It answers for real, on a demo inbox.</p>

      <div className="mt-3 flex flex-wrap gap-2">
        {DEMO_TASKS.map((t) => (
          <button
            key={t}
            type="button"
            data-demo-chip
            disabled={status === "running"}
            onClick={() => void run(t)}
            className="rounded-full bg-[#1982fc]/10 px-3.5 py-2 text-left text-[14px] font-medium leading-tight text-[#1982fc] active:opacity-70 disabled:opacity-50"
          >
            {t}
          </button>
        ))}
      </div>

      <form
        className="mt-3 flex items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void run(task);
        }}
      >
        <input
          data-demo-input
          value={task}
          onChange={(e) => setTask(e.target.value)}
          disabled={status === "running"}
          placeholder="…or type one thing you want off your plate"
          className="h-[40px] min-w-0 flex-1 rounded-full border border-black/10 bg-[#f2f2f7] px-4 text-[15px] outline-none placeholder:text-black/35 focus:border-[#1982fc]/50"
        />
        <button
          type="submit"
          data-demo-go
          disabled={status === "running" || !task.trim()}
          aria-label="Go"
          className="flex h-[40px] w-[40px] shrink-0 items-center justify-center rounded-full bg-[#1982fc] text-white active:opacity-80 disabled:opacity-40"
        >
          <ArrowUp className="h-5 w-5" strokeWidth={2.5} />
        </button>
      </form>

      {sent && (
        <div data-demo-thread className="mt-4 space-y-2 rounded-[14px] bg-[#f2f2f7] px-3 py-3">
          <div className="flex justify-end">
            <div data-demo-bubble="out" className="max-w-[85%] rounded-[18px] rounded-br-[4px] bg-[#1982fc] px-3.5 py-2 text-[15px] leading-[20px] text-white">
              {sent}
            </div>
          </div>
          {bubbles.map((b, i) => (
            <div key={i} className="flex justify-start">
              <div data-demo-bubble="in" className="max-w-[85%] whitespace-pre-wrap rounded-[18px] rounded-bl-[4px] bg-white px-3.5 py-2 text-[15px] leading-[20px] text-[#1c1c1e] shadow-[0_1px_0_rgba(0,0,0,0.04)]">
                {b}
              </div>
            </div>
          ))}
          {(status === "running" || pending.length > 0) && (
            <div className="flex justify-start" data-demo-typing>
              <div className="flex items-center gap-1 rounded-[18px] rounded-bl-[4px] bg-white px-3.5 py-3">
                {[0, 1, 2].map((i) => (
                  <span key={i} className="h-2 w-2 animate-bounce rounded-full bg-black/30" style={{ animationDelay: `${i * 150}ms` }} />
                ))}
              </div>
            </div>
          )}
          {error && (
            <p data-demo-error className="pt-1 text-center text-[13px] text-[#d70015]">
              {error}
            </p>
          )}
          <p className="pt-1 text-center text-[11px] uppercase tracking-[0.08em] text-black/35">demo inbox · nothing is real</p>
          <div ref={threadRef} />
        </div>
      )}

      {(finished || status === "error") && (
        <a
          href={continueHref}
          onClick={onContinue}
          data-demo-cta="continue"
          className="mt-3 inline-flex h-[46px] w-full items-center justify-center rounded-[14px] bg-[#1982fc] text-[16px] font-semibold text-white active:opacity-80"
        >
          Continue in Messages
        </a>
      )}
    </section>
  );
}
