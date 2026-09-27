"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CLIP_SCREENS, CLIP_SKIP, type ClipAnswerResponse, type ClipContent, type ClipScreen, type ClipState, type ClipStateResponse, type ClipStep } from "@/lib/shared/clip";
import { cn } from "@/lib/utils";
import { BigCheck, CheckRow, Chip, Dots, Eyebrow, Field, GetAppStrip, GhostClose, GoogleG, Headline, Mark, MockThread, PrimaryButton, SecondaryButton, Sub, TextLink, Wordmark } from "./clipUi";

/**
 * The Persona App Clip: the app's onboarding, as a short mobile wizard (DESIGN §19). Runs inside
 * the simulated phone (AppClipRunner) and as the web fallback at /clip; one component, so the two
 * can never drift. Every answer is written the moment it is given (POST /api/clip/answer against
 * the session in the invocation URL), so leaving at any screen loses nothing; when the clip closes,
 * the thread takes the relay.
 *
 * Screens: welcome → three value pages → your name → a name for Persona → Google → the call offer → done.
 */

export interface ClipDoneDetail {
  screen: ClipScreen;
  completed: boolean;
  call: "yes" | "no" | null;
}

interface Props {
  content: ClipContent;
  /** the session the clip was launched for; without it nothing is captured (cold web visit) */
  sid?: string;
  /** inside the simulated phone (true) or the web fallback page (false) */
  embed: boolean;
  /**
   * What the session already has, fetched by the host before mounting (the runner during its launch screen,
   * the /clip page on the server): decides the first screen with no wait and no flash. `null` = fetched, nothing
   * or failed; `undefined` = not fetched, the component fetches itself.
   */
  initialState?: ClipState | null;
  onDone?: (detail: ClipDoneDetail) => void;
}

type GmailPhase = "idle" | "pending" | "connected" | "declined";

const GMAIL_POLL_MS = 1000;
const GMAIL_POLL_MAX_MS = 90_000;
const POPUP_CLOSED_GRACE_MS = 1500;
const SAVE_RACE_MS = 2500;
/** how long the wizard waits for the resume state before falling back to the welcome (dev routes cold-compile slowly) */
const RESUME_MAX_MS = 8000;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export function ClipOnboarding({ content, sid, embed, initialState, onDone }: Props) {
  const copy = content.onboarding;
  const reduce = useReducedMotion();
  const [screen, setScreen] = useState<ClipScreen>(() => (initialState ? startScreenFor(initialState) : "welcome"));
  const [page, setPage] = useState(0);
  const [dir, setDir] = useState<1 | -1>(1);
  const [state, setState] = useState<ClipState | null>(initialState ?? null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [answers, setAnswers] = useState<{ user_name?: string; agent_name?: string; gmail?: "connected" | "skipped"; call?: "yes" | "no" }>({});
  const [gmail, setGmail] = useState<GmailPhase>("idle");
  const [gmailEmail, setGmailEmail] = useState<string | null>(null);
  const [gmailNote, setGmailNote] = useState<string | null>(null);
  const [stripDismissed, setStripDismissed] = useState(false);
  const doneRef = useRef(false);
  const popupRef = useRef<Window | null>(null);

  // ------------------------------------------------------------------ api
  const report = useCallback(
    (label: string, extra: Record<string, unknown> = {}) => {
      if (!sid) return;
      void fetch("/api/events", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ session_id: sid, type: "app_clip_cta", payload: { label, embed, screen, ...extra } }),
      }).catch(() => undefined);
    },
    [sid, embed, screen],
  );

  const fetchState = useCallback(async (): Promise<ClipState | null> => {
    if (!sid) return null;
    try {
      const res = await fetch(`/api/clip/state?sid=${encodeURIComponent(sid)}`, { cache: "no-store" });
      if (!res.ok) return null;
      const data = (await res.json()) as ClipStateResponse;
      setState(data.state);
      return data.state;
    } catch {
      return null;
    }
  }, [sid]);

  const postAnswer = useCallback(
    async (step: ClipStep, value: string): Promise<ClipAnswerResponse | null> => {
      if (!sid) return null;
      try {
        const res = await fetch("/api/clip/answer", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ session_id: sid, step, value }) });
        const data = (await res.json().catch(() => null)) as ClipAnswerResponse | null;
        if (data?.state) setState(data.state);
        if (!res.ok && !data) return { ok: false, error: "Couldn't save that, try again", state: state! };
        return data;
      } catch {
        return null; // offline: keep going, the chat picks it up later
      }
    },
    [sid, state],
  );

  // Resume: what the session already has decides where the clip opens. A finished onboarding opens on
  // "You're set"; one left half-way opens on the first step still missing; a fresh one on the welcome.
  // Nothing renders until that is known (the runner's launch screen covers the wait).
  const [ready, setReady] = useState(!sid || initialState !== undefined);
  useEffect(() => {
    if (!sid || initialState !== undefined) return;
    let alive = true;
    const settle = (s: ClipState | null) => {
      if (!alive) return;
      if (s) {
        setState(s);
        const start = startScreenFor(s);
        if (start !== "welcome") setScreen(start);
      }
      setReady(true);
    };
    const timeout = setTimeout(() => settle(null), RESUME_MAX_MS);
    fetch(`/api/clip/state?sid=${encodeURIComponent(sid)}`, { cache: "no-store" })
      .then((r) => (r.ok ? (r.json() as Promise<ClipStateResponse>) : null))
      .then((d) => settle(d?.state ?? null))
      .catch(() => settle(null))
      .finally(() => clearTimeout(timeout));
    return () => {
      alive = false;
      clearTimeout(timeout);
    };
  }, [sid, initialState]);

  // ------------------------------------------------------------------ flow
  const filled = useCallback(
    (s: ClipScreen): boolean => {
      if (!state) return false;
      switch (s) {
        case "user_name":
        case "agent_name":
        case "gmail":
          return state.steps[s] !== "empty";
        case "call_offer":
          return state.call_offer !== "unasked";
        default:
          return false;
      }
    },
    [state],
  );

  /** The web fallback inside the phone's Safari sheet: the sheet's parent is the simulator, which closes it and takes the relay. */
  const framed = !embed && typeof window !== "undefined" && window.parent !== window;
  const startUrl = sid ? `/?sid=${encodeURIComponent(sid)}&clip=closed` : "/";

  const finish = useCallback(
    (completed: boolean) => {
      if (doneRef.current) return;
      doneRef.current = true;
      const detail: ClipDoneDetail = { screen, completed, call: answers.call ?? null };
      onDone?.(detail);
      if (framed) window.parent.postMessage({ type: "persona:clip", event: "done", ...detail }, window.location.origin);
      else if (!embed) window.location.assign(startUrl);
    },
    [onDone, answers.call, screen, framed, embed, startUrl],
  );

  const goTo = useCallback((s: ClipScreen) => {
    setDir(1);
    setError(null);
    setScreen(s);
  }, []);

  /** Advance to the next screen, skipping steps the session already has (a reopened clip). */
  const next = useCallback(() => {
    if (screen === "values" && page < copy.values.length - 1) {
      setDir(1);
      setPage(page + 1);
      return;
    }
    let i = CLIP_SCREENS.indexOf(screen) + 1;
    while (i < CLIP_SCREENS.length - 1 && filled(CLIP_SCREENS[i])) i++;
    goTo(CLIP_SCREENS[Math.min(i, CLIP_SCREENS.length - 1)]);
  }, [screen, page, copy.values.length, filled, goTo]);

  const back = useCallback(() => {
    setDir(-1);
    setError(null);
    if (screen === "values" && page > 0) {
      setPage(page - 1);
      return;
    }
    const i = Math.max(0, CLIP_SCREENS.indexOf(screen) - 1);
    setScreen(CLIP_SCREENS[i]);
  }, [screen, page]);

  /** Save a typed step; a rejected value stays on the screen with the agent's reason. Never blocks for long. */
  const save = useCallback(
    async (step: "user_name" | "agent_name", value: string) => {
      const v = value.trim();
      if (!v) return;
      setBusy(true);
      const res = await Promise.race([postAnswer(step, v), sleep(SAVE_RACE_MS).then(() => "timeout" as const)]);
      setBusy(false);
      if (res && res !== "timeout" && !res.ok) {
        setError(res.error ?? "Try another one?");
        return;
      }
      setAnswers((a) => ({ ...a, [step]: v }));
      next();
    },
    [postAnswer, next],
  );

  const skip = useCallback(
    (step: ClipStep) => {
      void postAnswer(step, CLIP_SKIP);
      if (step === "gmail") setAnswers((a) => ({ ...a, gmail: "skipped" }));
      next();
    },
    [postAnswer, next],
  );

  // ------------------------------------------------------------------ Google
  const gmailDone = useCallback(
    (status: "connected" | "declined", email?: string | null) => {
      setGmail(status);
      if (status === "connected") {
        setGmailEmail(email ?? null);
        setAnswers((a) => ({ ...a, gmail: "connected" }));
      } else {
        setAnswers((a) => ({ ...a, gmail: "skipped" }));
      }
    },
    [],
  );

  useEffect(() => {
    if (gmail !== "connected" && gmail !== "declined") return;
    const t = setTimeout(() => next(), gmail === "connected" ? 900 : 600);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gmail]);

  // the consent popup posts `persona:gmail` to its opener (that is us), and we poll as a fallback
  useEffect(() => {
    if (gmail !== "pending") return;
    const onMessage = (e: MessageEvent) => {
      const d = e.data as { type?: string; status?: "connected" | "declined" | "failed"; email?: string | null } | null;
      if (!d || d.type !== "persona:gmail" || !d.status) return;
      gmailDone(d.status === "connected" ? "connected" : "declined", d.email);
    };
    window.addEventListener("message", onMessage);
    const started = Date.now();
    let closedAt: number | null = null;
    let settled = false;
    const timer = setInterval(async () => {
      if (settled) return;
      // the consent window closed without choosing (the X, not Google's Cancel): "not now", after a short grace for a callback in flight
      const popup = popupRef.current;
      if (popup && popup.closed && closedAt === null) closedAt = Date.now();
      const s = await fetchState();
      if (settled) return;
      if (s?.gmail_status === "connected") {
        settled = true;
        gmailDone("connected", s.gmail_email);
      } else if (s?.gmail_status === "declined" || s?.gmail_status === "failed") {
        settled = true;
        gmailDone("declined");
      } else if (closedAt !== null && Date.now() - closedAt > POPUP_CLOSED_GRACE_MS) {
        settled = true;
        await postAnswer("gmail", CLIP_SKIP);
        gmailDone("declined");
      } else if (Date.now() - started > GMAIL_POLL_MAX_MS) {
        settled = true;
        setGmail("idle");
        setGmailNote("That took too long. Try again, or skip for now.");
      }
    }, GMAIL_POLL_MS);
    return () => {
      window.removeEventListener("message", onMessage);
      clearInterval(timer);
    };
  }, [gmail, fetchState, gmailDone, postAnswer]);

  const connectGoogle = useCallback(() => {
    if (!sid) {
      setGmailNote("Open this from your Messages thread to connect Google.");
      return;
    }
    if (state && !state.google_configured) {
      setGmailNote("Google sign-in isn't set up on this build. The demo inbox shows the same flow.");
      return;
    }
    setGmailNote(null);
    setGmail("pending");
    report("google_connect");
    popupRef.current = window.open(`/api/oauth/google/start?sid=${encodeURIComponent(sid)}&via=clip`, "persona-connect", "popup,width=520,height=720");
  }, [sid, state, report]);

  const useDemo = useCallback(async () => {
    if (!sid) {
      setGmailNote("Open this from your Messages thread to connect an inbox.");
      return;
    }
    setGmailNote(null);
    setGmail("pending");
    report("demo_inbox");
    try {
      const res = await fetch("/api/gmail/connect", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ session_id: sid, mock: true, via: "clip" }) });
      const data = (await res.json()) as { ok?: boolean; email?: string };
      if (!res.ok || !data.ok) throw new Error("connect failed");
      gmailDone("connected", data.email ?? null);
    } catch {
      setGmail("idle");
      setGmailNote("Couldn't connect the demo inbox. Try again, or skip for now.");
    }
  }, [sid, report, gmailDone]);

  // ------------------------------------------------------------------ call + done
  const answerCall = useCallback(
    async (yes: boolean) => {
      setBusy(true);
      await Promise.race([postAnswer("call_offer", yes ? "yes" : "no"), sleep(SAVE_RACE_MS)]);
      setBusy(false);
      setAnswers((a) => ({ ...a, call: yes ? "yes" : "no" }));
      goTo("done");
    },
    [postAnswer, goTo],
  );

  // "Call me now": the clip hands off and the phone rings (the relay turn rings it) wherever the clip runs
  useEffect(() => {
    if (screen !== "done" || answers.call !== "yes") return;
    const t = setTimeout(() => finish(true), 1400);
    return () => clearTimeout(t);
  }, [screen, answers.call, finish]);

  const getApp = useCallback(() => {
    report("get_app");
    if (!embed && !framed) window.open(copy.get_app.url, "_blank", "noopener");
  }, [report, embed, framed, copy.get_app.url]);

  const userName = answers.user_name ?? state?.user_name ?? null;
  const agentName = answers.agent_name ?? state?.agent_name ?? null;
  const gmailFinal = answers.gmail === "connected" || state?.gmail_status === "connected";

  // ------------------------------------------------------------------ render
  const screenIndex = CLIP_SCREENS.indexOf(screen);
  const showStrip = !stripDismissed && screenIndex >= 1 && screen !== "done";
  const showClose = screen !== "done";
  const showBack = screenIndex > 0 && screen !== "done";

  const slide = useMemo(
    () => ({
      initial: reduce ? { opacity: 0 } : { opacity: 0, x: 36 * dir },
      animate: { opacity: 1, x: 0 },
      exit: reduce ? { opacity: 0 } : { opacity: 0, x: -36 * dir },
      transition: { type: "spring" as const, stiffness: 380, damping: 34, mass: 0.9 },
    }),
    [dir, reduce],
  );

  return (
    <div data-clip-onboarding data-clip-screen={screen} className="relative flex h-full w-full flex-col bg-clip-bg text-clip-ink" style={{ WebkitFontSmoothing: "antialiased" }}>
      {/* top bar: back, page dots, close */}
      <header className="flex h-[48px] shrink-0 items-center justify-between px-4">
        <div className="flex w-[64px] items-center">
          {showBack ? (
            <button type="button" onClick={back} aria-label="Back" data-clip-back className="flex h-[34px] w-[34px] items-center justify-center rounded-full text-clip-ink/60 active:bg-clip-ink/[0.06]">
              <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M15 18l-6-6 6-6" />
              </svg>
            </button>
          ) : null}
        </div>
        <div className="flex items-center">{screen === "values" && <Dots count={copy.values.length} index={page} />}</div>
        <div className="flex w-[64px] items-center justify-end">{showClose && <GhostClose onClick={() => finish(false)} label={screen === "values" ? "Skip" : "Close"} />}</div>
      </header>

      <main className="relative flex-1 overflow-hidden">
        {ready && (
        <AnimatePresence mode="wait" initial={false} custom={dir}>
          <motion.section key={`${screen}-${page}`} {...slide} className="absolute inset-0 flex flex-col overflow-hidden px-6 pb-2">
            {screen === "welcome" && (
              <Screen
                body={
                  <div className="flex flex-1 flex-col items-center justify-center text-center">
                    <Mark size={104} />
                    <Wordmark className="mt-7 h-[24px]" />
                    <Headline className="mt-6">{copy.welcome.title}</Headline>
                    <Sub className="mt-3 max-w-[300px]">{copy.welcome.subtitle}</Sub>
                  </div>
                }
                footer={<PrimaryButton onClick={next} testId="welcome">{copy.welcome.next}</PrimaryButton>}
              />
            )}

            {screen === "values" && (
              <Screen
                body={
                  <div className="flex flex-1 flex-col pt-2">
                    <Eyebrow>{copy.values[page].eyebrow}</Eyebrow>
                    <Headline className="mt-3 text-[34px]">{copy.values[page].title}</Headline>
                    <Sub className="mt-3">{copy.values[page].subtitle}</Sub>
                    <div className="mt-6">
                      <MockThread key={page} thread={copy.values[page].thread} />
                    </div>
                  </div>
                }
                footer={<PrimaryButton onClick={next} testId={`value-${page}`}>{page < copy.values.length - 1 ? "Next" : "Let's set it up"}</PrimaryButton>}
              />
            )}

            {screen === "user_name" && <NameScreen key="user_name" title={copy.user_name.title} subtitle={copy.user_name.subtitle} placeholder={copy.user_name.placeholder} skipLabel={copy.user_name.skip} error={error} busy={busy} onSubmit={(v) => save("user_name", v)} onSkip={() => skip("user_name")} testId="user_name" />}

            {screen === "agent_name" && (
              <NameScreen
                key="agent_name"
                title={copy.agent_name.title}
                subtitle={copy.agent_name.subtitle}
                placeholder={copy.agent_name.placeholder}
                skipLabel={copy.agent_name.skip}
                suggestions={copy.agent_name.suggestions}
                error={error}
                busy={busy}
                onSubmit={(v) => save("agent_name", v)}
                onSkip={() => save("agent_name", copy.agent_name.placeholder)}
                testId="agent_name"
              />
            )}

            {screen === "gmail" && (
              <Screen
                body={
                  <div className="flex flex-1 flex-col pt-2">
                    <Headline className="text-[34px]">{copy.gmail.title}</Headline>
                    <Sub className="mt-3">{copy.gmail.subtitle}</Sub>
                    <AnimatePresence mode="wait" initial={false}>
                      {gmail === "connected" ? (
                        <motion.div key="ok" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="mt-10 flex flex-col items-center gap-4 text-center">
                          <BigCheck />
                          <div className="text-[17px] font-medium" data-clip-gmail-connected>
                            Connected{gmailEmail ? ` as ${gmailEmail}` : ""}
                          </div>
                        </motion.div>
                      ) : gmail === "declined" ? (
                        <motion.div key="no" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="mt-10 text-center text-[17px] text-clip-ink/70">
                          No problem, we can do it later.
                        </motion.div>
                      ) : (
                        <motion.ul key="rows" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="clip-card mt-6 divide-y divide-clip-line px-4">
                          {copy.gmail.rows.map((r) => (
                            <CheckRow key={r}>{r}</CheckRow>
                          ))}
                        </motion.ul>
                      )}
                    </AnimatePresence>
                    {gmailNote && (
                      <p className="mt-4 text-center text-[14px] leading-snug text-clip-ink/55" data-clip-gmail-note>
                        {gmailNote}
                      </p>
                    )}
                  </div>
                }
                footer={
                  gmail === "connected" || gmail === "declined" ? null : (
                    <div className="flex flex-col gap-2.5">
                      <SecondaryButton onClick={connectGoogle} disabled={gmail === "pending"} testId="gmail-connect" icon={<GoogleG />}>
                        {gmail === "pending" ? "Waiting for Google…" : copy.gmail.connect}
                      </SecondaryButton>
                      <TextLink onClick={useDemo} testId="gmail-demo">
                        {copy.gmail.demo}
                      </TextLink>
                      <TextLink onClick={() => skip("gmail")} testId="gmail-skip" className="-mt-1">
                        {copy.gmail.skip}
                      </TextLink>
                    </div>
                  )
                }
              />
            )}

            {screen === "call_offer" && (
              <Screen
                body={
                  <div className="flex flex-1 flex-col pt-2">
                    <Headline className="text-[34px]">{copy.call.title}</Headline>
                    <Sub className="mt-3">{userName ? copy.call.subtitle.replace("by voice", `by voice, ${userName}`) : copy.call.subtitle}</Sub>
                    <div className="clip-card clip-thread mt-8 flex flex-col gap-[6px] px-4 py-4">
                      <div className="bubble bubble-in">Quick call, two minutes tops, then I&apos;ll actually do something for you.</div>
                      <div className="bubble bubble-in">📞 Persona would like to call you</div>
                    </div>
                  </div>
                }
                footer={
                  <div className="flex flex-col gap-2.5">
                    <PrimaryButton onClick={() => void answerCall(true)} busy={busy} testId="call-yes">
                      {copy.call.yes}
                    </PrimaryButton>
                    <SecondaryButton onClick={() => void answerCall(false)} disabled={busy} testId="call-no">
                      {copy.call.no}
                    </SecondaryButton>
                  </div>
                }
              />
            )}

            {screen === "done" && (
              <Screen
                body={
                  <div className="flex flex-1 flex-col items-center justify-center text-center">
                    <BigCheck />
                    <Headline className="mt-6">{userName ? `You're set, ${userName}.` : copy.done.title}</Headline>
                    <Sub className="mt-3 max-w-[300px]">{answers.call === "yes" ? copy.done.calling : copy.done.subtitle}</Sub>
                    <ul className="clip-card mt-7 w-full divide-y divide-clip-line px-4 text-left" data-clip-recap>
                      <CheckRow done={!!userName}>{userName ? `I'll call you ${userName}` : "No name yet, I'll go with friend"}</CheckRow>
                      <CheckRow done={!!agentName}>{agentName ? `You call me ${agentName}` : "You call me Persona"}</CheckRow>
                      <CheckRow done={gmailFinal}>{gmailFinal ? `Google connected${gmailEmail ?? state?.gmail_email ? ` as ${gmailEmail ?? state?.gmail_email}` : ""}` : "Google: later, when it helps"}</CheckRow>
                    </ul>
                  </div>
                }
                footer={
                  answers.call === "yes" ? null : (
                    <div className="flex flex-col gap-2.5">
                      <SecondaryButton onClick={getApp} testId="get-app" icon={<Mark size={22} className="rounded-[6px] shadow-none" />}>
                        {copy.get_app.label}
                      </SecondaryButton>
                      {embed || framed ? (
                        <PrimaryButton onClick={() => finish(true)} testId="done">
                          {copy.done.back}
                        </PrimaryButton>
                      ) : (
                        <a href={startUrl} data-clip-next="done" className="clip-btn-primary flex h-[52px] w-full items-center justify-center rounded-full text-[17px] font-semibold">
                          {copy.done.start_web}
                        </a>
                      )}
                    </div>
                  )
                }
              />
            )}
          </motion.section>
        </AnimatePresence>
        )}
      </main>

      <AnimatePresence>{showStrip && <GetAppStrip key="strip" label={copy.get_app.label} onTap={getApp} onDismiss={() => setStripDismissed(true)} />}</AnimatePresence>
      {/* room for the home indicator inside the phone; a little breathing room on the web */}
      <div className={cn("shrink-0", embed ? "h-[30px]" : "h-[16px]")} />
    </div>
  );
}

/** Where a reopened clip starts: done when everything is answered, the first missing step when some are, else the welcome. */
export function startScreenFor(s: ClipState): ClipScreen {
  const stepFilled: Record<ClipStep, boolean> = {
    user_name: s.steps.user_name !== "empty",
    agent_name: s.steps.agent_name !== "empty",
    gmail: s.steps.gmail !== "empty",
    call_offer: s.call_offer !== "unasked",
  };
  const any = Object.values(stepFilled).some(Boolean);
  if (!any) return "welcome";
  for (const step of ["user_name", "agent_name", "gmail", "call_offer"] as const) if (!stepFilled[step]) return step;
  return "done";
}

/** The body scrolls on its own; the footer never moves and nothing draws over it. */
function Screen({ body, footer }: { body: React.ReactNode; footer: React.ReactNode }) {
  return (
    <>
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto pb-3 [scrollbar-width:none]">{body}</div>
      {footer && <div className="shrink-0 pt-3">{footer}</div>}
    </>
  );
}

function NameScreen({
  title,
  subtitle,
  placeholder,
  skipLabel,
  suggestions,
  error,
  busy,
  onSubmit,
  onSkip,
  testId,
}: {
  title: string;
  subtitle: string;
  placeholder: string;
  skipLabel: string;
  suggestions?: string[];
  error: string | null;
  busy: boolean;
  onSubmit: (value: string) => void;
  onSkip: () => void;
  testId: string;
}) {
  const [value, setValue] = useState("");
  const submit = () => {
    if (value.trim()) onSubmit(value);
  };
  return (
    <Screen
      body={
        <div className="flex flex-1 flex-col pt-2">
          <Headline className="text-[34px]">{title}</Headline>
          <Sub className="mt-3">{subtitle}</Sub>
          <div className="mt-7">
            <Field value={value} onChange={setValue} placeholder={placeholder} autoFocus onSubmit={submit} error={error} testId={testId} />
          </div>
          {suggestions && (
            <div className="mt-4 flex flex-wrap gap-2">
              {suggestions.map((s) => (
                <Chip key={s} onClick={() => setValue(s)} selected={value.trim().toLowerCase() === s.toLowerCase()} testId={s}>
                  {s}
                </Chip>
              ))}
            </div>
          )}
        </div>
      }
      footer={
        <div className="flex flex-col gap-1.5">
          <PrimaryButton onClick={submit} disabled={!value.trim()} busy={busy} testId={testId}>
            Continue
          </PrimaryButton>
          <TextLink onClick={onSkip} testId={`${testId}-skip`}>
            {skipLabel}
          </TextLink>
        </div>
      }
    />
  );
}
