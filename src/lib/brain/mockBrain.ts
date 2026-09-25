"use client";

import { session } from "@/lib/session/store";
import type { CallEndReason, MessageCard } from "@/lib/session/types";
import { sleep } from "@/lib/utils";
import type { OnboardingBrain } from "./types";

/**
 * Canned, deterministic stand-in for the LLM so the UI can be exercised
 * end-to-end. Every line it produces is prefixed in the event log with
 * `mock.` so nobody mistakes this for the real thing.
 */
export class MockBrain implements OnboardingBrain {
  private async say(text: string, opts: { card?: MessageCard; delayMs?: number } = {}) {
    const s = session.get();
    s.setTyping(true);
    await sleep(opts.delayMs ?? Math.min(2200, 500 + text.length * 18));
    const st = session.get();
    st.setTyping(false);
    st.appendMessage({ role: "assistant", text, card: opts.card });
    st.logEvent("mock.assistant_message", { text });
  }

  private ring() {
    const s = session.get();
    if (s.call.state === "ringing" || s.call.state === "live" || s.call.state === "connecting") return;
    s.clearCaptions();
    s.setCallState("ringing", { startedAt: undefined, endedAt: undefined, endReason: undefined });
    s.setScreen("call");
  }

  async start() {
    const s = session.get();
    if (s.messages.length > 0) return;
    await this.say(
      "Hey, I'm your new Persona 👋 I'll get you set up by doing something useful, not by asking a bunch of questions. Want me to give you a quick call, or just text?",
      {
        delayMs: 900,
        card: {
          title: "How should we start?",
          subtitle: "Two minutes tops, either way.",
          actions: [
            { id: "call_me", label: "Call me", variant: "primary" },
            { id: "just_text", label: "Just text" },
          ],
        },
      },
    );
  }

  async onUserText(text: string) {
    const s = session.get();
    s.logEvent("user.text", { text });
    const t = text.trim().toLowerCase();

    if (/\b(call|ring|phone)\b/.test(t)) {
      await this.say("On it. Calling you now.", { delayMs: 600 });
      this.ring();
      return;
    }
    if (/\b(skip|stop|later)\b/.test(t)) {
      await this.say("Sure. I've saved what we have. Text me anytime.");
      return;
    }
    await this.say(
      "(mock) The real brain isn't wired up yet. Try \"call me\" to test the call flow, or use the inspector to drive state.",
    );
  }

  async onCardAction(actionId: string, messageId: string) {
    const s = session.get();
    s.logEvent("user.card_action", { actionId, messageId });
    const msg = s.messages.find((m) => m.id === messageId);
    if (msg?.card) s.updateMessage(messageId, { card: { ...msg.card, takenActionId: actionId } });

    switch (actionId) {
      case "call_me":
      case "call_back":
        await this.say("Calling you now.", { delayMs: 500 });
        this.ring();
        return;
      case "just_text":
        s.setChannel("text");
        s.setPhase("collecting");
        await this.say("Cool, text works. First things first: what should I call you?");
        return;
      case "connect_gmail":
        s.setSlot("gmail", { status: "pending" });
        await this.say(
          "(mock) The Gmail OAuth popup lands in a later layer. For now I've marked Gmail as pending in the tracker.",
        );
        return;
      case "keep_texting":
        s.setChannel("text");
        await this.say("Perfect. So, what's one thing you keep meaning to get to and never do?");
        return;
      default:
        await this.say(`(mock) Unhandled card action: ${actionId}`);
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
    // (CallScreen shows "Call Ended" briefly, then returns to Messages itself.)

    const name = s.slots.user_name.value;
    const nameBit = name ? `, ${name}` : "";

    switch (reason) {
      case "dropped":
        await sleep(1500);
        await this.say(`Looks like the call dropped${nameBit}. No worries, I kept everything. Want to keep going here or should I call back?`, {
          delayMs: 700,
          card: {
            title: "Pick up where we left off",
            actions: [
              { id: "keep_texting", label: "Keep texting", variant: "primary" },
              { id: "call_back", label: "Call me back" },
            ],
          },
        });
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
        await this.say(`Good chat${nameBit}. I've saved what we have. Text me anytime.`, {
          delayMs: 900,
          card: {
            title: "Next step",
            subtitle: "Read-only. Nothing gets sent without your yes.",
            actions: [{ id: "connect_gmail", label: "Connect Gmail", variant: "primary" }],
          },
        });
    }
  }

  async onUserSpeechFinal(text: string) {
    session.get().logEvent("user.speech_final", { text });
  }
}
