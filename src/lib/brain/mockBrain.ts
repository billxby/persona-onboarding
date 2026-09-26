"use client";

import { session } from "@/lib/session/store";
import type { BubbleEffect, CallEndReason, LinkPreview, ReactionKind } from "@/lib/session/types";
import { USER_HELLO } from "@/lib/shared/text";
import { sleep } from "@/lib/utils";
import type { OnboardingBrain } from "./types";

/** The one link the assistant sends: the /start page, which is also the App Clip invocation URL. */
const GMAIL_LINK: LinkPreview = {
  url: "https://yourpersona.com/start?t=demo",
  domain: "yourpersona.com",
  title: "Connect Gmail to Persona",
  description: "Read-only. Nothing gets sent without your yes.",
  appClip: { appName: "Persona", title: "Set up your Persona", subtitle: "Connect Gmail · read-only", verb: "Open" },
};

/**
 * Canned, deterministic stand-in for the LLM so the UI can be exercised
 * end-to-end. It only ever produces content a real iMessage sender can:
 * text (optionally with a bubble effect) and links. No buttons, no forms.
 * Every line is logged as `mock.` so nobody mistakes it for the real thing.
 */
export class MockBrain implements OnboardingBrain {
  private opening = false;
  /** what the last assistant question was about, so short replies ("yes") make sense */
  private pending: "call_or_text" | "call_back" | "gmail" | null = null;

  private async say(text: string, opts: { delayMs?: number; effect?: BubbleEffect } = {}) {
    await sleep(650);
    const s = session.get();
    s.markRead("user");
    s.setTyping(true);
    await sleep(opts.delayMs ?? Math.min(2200, 500 + text.length * 18));
    const st = session.get();
    st.setTyping(false);
    st.appendMessage({ role: "assistant", content: { kind: "text", text, effect: opts.effect } });
    st.logEvent("mock.assistant_message", { text, effect: opts.effect });
  }

  /** iOS renders a standalone URL as its own preview bubble, so links go out separately. */
  private async sendLink(link: LinkPreview) {
    const s = session.get();
    s.setTyping(true);
    await sleep(700);
    const st = session.get();
    st.setTyping(false);
    st.appendMessage({ role: "assistant", content: { kind: "link", link } });
    st.logEvent("mock.assistant_link", { url: link.url, appClip: !!link.appClip });
  }

  private ring() {
    const s = session.get();
    if (s.call.state === "ringing" || s.call.state === "live" || s.call.state === "connecting") return;
    s.clearCaptions();
    s.setCallState("ringing", { startedAt: undefined, endedAt: undefined, endReason: undefined });
    s.setScreen("call");
  }

  async start() {
    if (this.opening || session.get().messages.length > 0) return;
    this.opening = true;
    try {
      // you text first (the start link prefills it); the mock replies the way the server would
      session.get().appendMessage({ role: "user", content: { kind: "text", text: USER_HELLO }, status: "delivered" });
      await this.say(
        "Hey, I'm your new Persona 👋 I'll get you set up by doing something useful, not by asking a bunch of questions. Want me to give you a quick call, or just text?",
        { delayMs: 900 },
      );
      this.pending = "call_or_text";
    } finally {
      this.opening = false;
    }
  }

  async onUserText(text: string) {
    const s = session.get();
    s.logEvent("user.text", { text });
    const t = text.trim().toLowerCase();
    const yes = /^(y|ya|yes|yeah|yep|sure|ok|okay|please|do it|go ahead)\b/.test(t);
    const no = /^(n|no|nah|nope|not now|later)\b/.test(t);

    if (/\b(call|ring|phone)\b/.test(t) && !/\bdon'?t\b/.test(t)) {
      this.pending = null;
      await this.say("On it. Calling you now.", { delayMs: 600 });
      this.ring();
      return;
    }
    if (this.pending === "call_or_text" && (yes || /\btext\b/.test(t))) {
      this.pending = null;
      s.setChannel("text");
      s.setPhase("collecting");
      await this.say(yes ? "Calling you now." : "Cool, text works. First things first: what should I call you?", { delayMs: 600 });
      if (yes) this.ring();
      return;
    }
    if (this.pending === "call_back" && yes) {
      this.pending = null;
      await this.say("Calling you back now.", { delayMs: 500 });
      this.ring();
      return;
    }
    if (this.pending === "call_back" && no) {
      this.pending = null;
      await this.say("No problem, we'll keep going here. What's one thing you keep meaning to get to and never do?");
      return;
    }
    if (/\b(gmail|inbox|email|mail)\b/.test(t)) {
      await this.say("I can take a first pass at your inbox. It's read-only and nothing gets sent without your yes. Tap this to connect:");
      await this.sendLink(GMAIL_LINK);
      this.pending = "gmail";
      return;
    }
    if (/\b(thanks|thank you|ty)\b/.test(t)) {
      const last = [...s.messages].reverse().find((m) => m.role === "user");
      await sleep(700);
      if (last) session.get().toggleReaction(last.id, { type: "tapback", tapback: "heart" }, "assistant");
      return;
    }
    if (/\b(skip|stop|later)\b/.test(t)) {
      await this.say("Sure. I've saved what we have. Text me anytime.");
      return;
    }
    if (/\bslam\b/.test(t)) {
      await this.say("Like this?", { effect: "slam", delayMs: 500 });
      return;
    }
    await this.say('(mock) The real brain isn\'t wired up yet. Try "call me", "connect gmail", or "slam" to see the effect.');
  }

  async onLinkOpen(messageId: string, url: string) {
    const s = session.get();
    s.logEvent("user.link_open", { messageId, url, appClip: s.senderInContacts });
    if (url === GMAIL_LINK.url) {
      s.setSlot("gmail", { status: "pending" });
      await this.say(
        s.senderInContacts
          ? "(mock) The App Clip would run the server-side Google OAuth here and hand back a connected inbox."
          : "(mock) That opens the consent page in Safari. Gmail is marked pending in the tracker.",
        { delayMs: 700 },
      );
    }
  }

  async onUserReaction(messageId: string, kind: ReactionKind, added: boolean) {
    const s = session.get();
    s.logEvent("user.reaction", { messageId, ...kind, added });
    const isHeart = kind.type === "tapback" && kind.tapback === "heart";
    if (added && isHeart && !s.messages.some((m) => m.reactions?.some((r) => r.by === "assistant"))) {
      const lastUser = [...s.messages].reverse().find((m) => m.role === "user");
      if (lastUser) {
        await sleep(900);
        session.get().toggleReaction(lastUser.id, { type: "tapback", tapback: "heart" }, "assistant");
      }
    }
  }

  async onCallAnswered() {
    const s = session.get();
    s.setChannel("call");
    if (s.phase === "warmup") s.setPhase("collecting");
  }

  async onCallEnded(reason: CallEndReason) {
    const s = session.get();
    s.setChannel("text");
    const name = s.slots.user_name.value;
    const nameBit = name ? `, ${name}` : "";

    switch (reason) {
      case "dropped":
        await sleep(1500);
        await this.say(`Looks like the call dropped${nameBit}. No worries, I kept everything. Want me to call back, or keep going here?`, { delayMs: 700 });
        this.pending = "call_back";
        return;
      case "declined":
        await this.say(`No problem${nameBit}. We can do all of this right here. What should I call you?`, { delayMs: 800 });
        return;
      case "silence":
        await this.say(`Couldn't hear you so I hung up${nameBit}. No rush, we can just text.`, { delayMs: 800 });
        return;
      case "mic_denied":
        await this.say("Can't hear you. Mic might be off. We can just text.", { delayMs: 600 });
        return;
      case "user_hangup":
      case "bot_hangup":
      default:
        await this.say(`Good chat${nameBit}. Want me to take a first pass at your inbox? Read-only, nothing sent without your yes:`, { delayMs: 900 });
        await this.sendLink(GMAIL_LINK);
        this.pending = "gmail";
    }
  }

  async onUserSpeechFinal(text: string) {
    session.get().logEvent("user.speech_final", { text });
  }
}
