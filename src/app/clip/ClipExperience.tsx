"use client";

import { CalendarDays, ChevronRight, Mail, PenLine, Phone, Scissors, ShieldCheck } from "lucide-react";
import type { ClipContent, ClipFeatureIcon } from "@/lib/shared/clip";
import type { z } from "zod";
import { TryIt } from "./TryIt";

type IconKey = z.infer<typeof ClipFeatureIcon>;
const ICONS: Record<IconKey, React.ComponentType<{ className?: string; strokeWidth?: number }>> = {
  mail: Mail,
  pen: PenLine,
  scissors: Scissors,
  calendar: CalendarDays,
  phone: Phone,
  shield: ShieldCheck,
};

const FONT = "-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'SF Pro Display', 'Helvetica Neue', Helvetica, Arial, sans-serif";

/**
 * The scrollable "Meet your Persona" experience. Served at /clip (the App Clip's
 * invocation URL and web fallback) and embedded by the simulator's App Clip runner.
 * Native iOS look: large title, grouped white cards on the grouped-background grey.
 */
export function ClipExperience({ content, sid, embed }: { content: ClipContent; sid?: string; embed: boolean }) {
  const report = (label: string, url: string, action?: string) => {
    if (sid) {
      void fetch("/api/events", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ session_id: sid, type: "app_clip_cta", payload: { label, url, embed } }),
      }).catch(() => undefined);
    }
    if (embed && typeof window !== "undefined" && window.parent !== window) {
      window.parent.postMessage({ type: "persona:clip", event: "cta", label, url, action }, "*");
    }
  };

  /** Inside the phone, CTAs report and stay put (a real clip would hand off to Safari); on the web they navigate. */
  const cta = (label: string, url: string, action?: string) => ({
    href: url,
    target: embed ? undefined : "_blank",
    rel: embed ? undefined : "noopener",
    onClick: (e: React.MouseEvent) => {
      if (embed) e.preventDefault();
      report(label, url, action);
    },
  });

  const startUrl = sid ? `/?sid=${encodeURIComponent(sid)}` : "/";
  const bandImage = content.wristband.image ?? "/clip/band.svg";

  return (
    <div
      data-clip-experience
      className={embed ? "min-h-full bg-[#f2f2f7] text-[#1c1c1e]" : "min-h-screen bg-[#f2f2f7] text-[#1c1c1e]"}
      style={{ fontFamily: FONT, WebkitFontSmoothing: "antialiased" }}
    >
      {!embed && (
        <nav className="sticky top-0 z-10 flex items-center justify-between border-b border-black/[0.06] bg-[#f2f2f7]/85 px-5 py-3 backdrop-blur-xl">
          {/* the wordmark already carries the loop mark, so it stands alone */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/persona-wordmark.svg" alt="Persona" className="h-[18px] w-auto" />
          <a {...cta("nav-start", startUrl)} className="text-[15px] font-medium text-[#1982fc]">
            Open in Messages
          </a>
        </nav>
      )}

      <main className={embed ? "mx-auto max-w-[560px] px-4 pb-10 pt-4" : "mx-auto max-w-[560px] px-4 pb-16 pt-8"}>
        {/* hero */}
        <section data-clip="hero" className="mb-6">
          {content.hero.image && (
            <div className="mb-4 overflow-hidden rounded-[18px] bg-white ring-1 ring-black/[0.06]">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={content.hero.image} alt="What your Persona does in Messages" className="h-[220px] w-full object-cover object-center" />
            </div>
          )}
          <div className="mb-3 flex items-center gap-2 text-[12px] font-semibold uppercase tracking-[0.1em] text-black/40">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/brand/persona-wordmark.svg" alt="Persona" className="h-[14px] w-auto opacity-80" />
            <span className="rounded-full bg-black/[0.06] px-2 py-0.5">App Clip</span>
          </div>
          <h1 className="text-[34px] font-bold leading-[40px] tracking-[-0.4px]">{content.hero.title}</h1>
          <p className="mt-2 text-[17px] leading-[23px] text-black/60">{content.hero.subtitle}</p>
          <a
            {...cta(content.hero.cta.label, embed ? startUrl : content.hero.cta.url, "close")}
            data-clip-cta="start"
            className="mt-4 inline-flex h-[48px] w-full items-center justify-center rounded-[14px] bg-[#1982fc] text-[17px] font-semibold text-white active:opacity-80"
          >
            {content.hero.cta.label}
          </a>
        </section>

        {/* live demo: the clip must let the user do something, not just read */}
        <TryIt sid={sid} embed={embed} />

        {/* features */}
        <SectionTitle>What your Persona does</SectionTitle>
        <div className="grid grid-cols-2 gap-3">
          {content.features.map((f) => {
            const Icon = ICONS[f.icon];
            return (
              <div key={f.id} data-clip-feature={f.id} className="rounded-[18px] bg-white p-4 shadow-[0_1px_0_rgba(0,0,0,0.04)]">
                <span className="mb-3 flex h-9 w-9 items-center justify-center rounded-[10px] bg-[#1982fc]/10 text-[#1982fc]">
                  <Icon className="h-[18px] w-[18px]" strokeWidth={2} />
                </span>
                <div className="text-[15px] font-semibold leading-tight">{f.title}</div>
                <p className="mt-1 text-[13px] leading-[18px] text-black/55">{f.body}</p>
              </div>
            );
          })}
        </div>

        {/* wristband */}
        <SectionTitle>The wristband</SectionTitle>
        <section data-clip="wristband" className="overflow-hidden rounded-[18px] bg-white shadow-[0_1px_0_rgba(0,0,0,0.04)]">
          <div className="bg-[#0b0b0c]">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={bandImage} alt={content.wristband.name} className="h-[230px] w-full object-cover" />
          </div>
          {content.wristband.gallery && content.wristband.gallery.length > 1 && (
            <div className="flex gap-2 overflow-x-auto px-4 pt-3 [scrollbar-width:none]">
              {content.wristband.gallery.map((g) => (
                // eslint-disable-next-line @next/next/no-img-element
                <img key={g} src={g} alt="" className="h-[72px] w-[96px] shrink-0 rounded-[10px] object-cover ring-1 ring-black/[0.06]" />
              ))}
            </div>
          )}
          {content.wristband.colors && (
            <div className="flex flex-wrap gap-1.5 px-5 pt-3">
              {content.wristband.colors.map((c) => (
                <span key={c} className="rounded-full bg-black/[0.05] px-2.5 py-1 text-[12px] font-medium text-black/65">{c}</span>
              ))}
            </div>
          )}
          <div className="px-5 pb-5 pt-2">
            <div className="text-[20px] font-bold leading-tight">{content.wristband.name}</div>
            <div className="mt-0.5 text-[15px] font-medium text-[#1982fc]">{content.wristband.tagline}</div>
            <p className="mt-3 text-[15px] leading-[21px] text-black/65">{content.wristband.body}</p>
            <ul className="mt-3 divide-y divide-black/[0.06]">
              {content.wristband.bullets.map((b) => (
                <li key={b} className="flex items-start gap-2.5 py-2.5 text-[15px] leading-[20px]">
                  <span className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-[#1982fc]" />
                  <span>{b}</span>
                </li>
              ))}
            </ul>
            <a
              {...cta(content.wristband.how_to_get.label, content.wristband.how_to_get.url)}
              data-clip-cta="band-waitlist"
              className="mt-3 inline-flex h-[46px] w-full items-center justify-center rounded-[14px] bg-[#1c1c1e] text-[16px] font-semibold text-white active:opacity-80"
            >
              {content.wristband.how_to_get.label}
            </a>
            {content.wristband.how_to_get.note && <p className="mt-2 text-center text-[12px] text-black/40">{content.wristband.how_to_get.note}</p>}
          </div>
        </section>

        {/* products */}
        <SectionTitle>Products</SectionTitle>
        <div className="space-y-3">
          {content.products.map((p) => (
            <div key={p.id} data-clip-product={p.id} className="rounded-[18px] bg-white p-4 shadow-[0_1px_0_rgba(0,0,0,0.04)]">
              <div className="flex items-baseline justify-between gap-3">
                <div className="text-[17px] font-semibold">{p.name}</div>
                {p.price && <div className="shrink-0 text-[13px] font-medium text-black/45">{p.price}</div>}
              </div>
              <p className="mt-1 text-[14px] leading-[19px] text-black/60">{p.body}</p>
              <a
                {...cta(p.cta.label, p.cta.url)}
                data-clip-cta={`product-${p.id}`}
                className="mt-3 inline-flex items-center gap-1 text-[15px] font-semibold text-[#1982fc]"
              >
                {p.cta.label}
                <ChevronRight className="h-4 w-4" strokeWidth={2.5} />
              </a>
            </div>
          ))}
        </div>

        {/* experience */}
        <SectionTitle>{content.experience.title}</SectionTitle>
        <ol data-clip="experience" className="divide-y divide-black/[0.06] rounded-[18px] bg-white shadow-[0_1px_0_rgba(0,0,0,0.04)]">
          {content.experience.steps.map((s, i) => (
            <li key={s.title} className="flex gap-3.5 px-4 py-3.5">
              <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#1982fc] text-[13px] font-bold text-white">{i + 1}</span>
              <div>
                <div className="text-[15px] font-semibold leading-tight">{s.title}</div>
                <p className="mt-0.5 text-[14px] leading-[19px] text-black/60">{s.body}</p>
              </div>
            </li>
          ))}
        </ol>

        <footer className={embed ? "mt-8 px-1 text-center text-[12px] leading-[17px] text-black/40" : "mt-12 px-1 text-center text-[12px] leading-[17px] text-black/40"}>
          {content.footer.privacy}
        </footer>
      </main>
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h2 className="mb-2.5 mt-8 px-1 text-[22px] font-bold tracking-[-0.3px]">{children}</h2>;
}
