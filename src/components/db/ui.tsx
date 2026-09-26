"use client";

import { cn } from "@/lib/utils";

export function Card({ title, subtitle, right, children, className, id }: { title: string; subtitle?: string; right?: React.ReactNode; children: React.ReactNode; className?: string; id?: string }) {
  return (
    <section id={id} className={cn("rounded-2xl border border-black/[0.08] bg-white shadow-[0_1px_2px_rgba(0,0,0,0.03)]", className)}>
      <header className="flex items-start justify-between gap-4 px-5 pt-4 pb-3">
        <div>
          <h2 className="text-[15px] font-semibold tracking-tight">{title}</h2>
          {subtitle && <p className="mt-0.5 text-[12.5px] text-black/50">{subtitle}</p>}
        </div>
        {right}
      </header>
      <div className="px-5 pb-5">{children}</div>
    </section>
  );
}

export function Pill({ children, tone = "neutral", className }: { children: React.ReactNode; tone?: "neutral" | "green" | "amber" | "red" | "blue" | "violet"; className?: string }) {
  const tones = {
    neutral: "bg-black/[0.06] text-black/70",
    green: "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200",
    amber: "bg-amber-50 text-amber-800 ring-1 ring-amber-200",
    red: "bg-rose-50 text-rose-700 ring-1 ring-rose-200",
    blue: "bg-blue-50 text-blue-700 ring-1 ring-blue-200",
    violet: "bg-violet-50 text-violet-700 ring-1 ring-violet-200",
  };
  return <span className={cn("inline-flex items-center rounded-full px-2 py-0.5 font-mono text-[11px] leading-[16px]", tones[tone], className)}>{children}</span>;
}

export function Button({ children, tone = "default", className, ...rest }: React.ButtonHTMLAttributes<HTMLButtonElement> & { tone?: "default" | "primary" | "danger" }) {
  return (
    <button
      {...rest}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[13px] font-medium transition active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40",
        tone === "default" && "border border-black/10 bg-white hover:bg-black/[0.03]",
        tone === "primary" && "bg-black text-white hover:bg-black/85",
        tone === "danger" && "border border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100",
        className,
      )}
    >
      {children}
    </button>
  );
}

export function KV({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[11px] uppercase tracking-wider text-black/40">{label}</span>
      <span className="text-[14px]">{children}</span>
    </div>
  );
}

export const fmtTime = (ts: number) => new Date(ts).toLocaleTimeString([], { hour12: false });
export const fmtDateTime = (ts: number) => new Date(ts).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
