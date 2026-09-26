import type { CallEndReason, Tapback } from "@/lib/session/types";

/**
 * The seam where the LLM "brain" plugs in later. The UI never talks to a model
 * directly; it raises these events and the brain writes to the session store.
 *
 * Today: MockBrain (canned lines). Later: a client that calls the Next.js
 * backend, which owns the real slot tracker + next-best-ask policy.
 */
export interface OnboardingBrain {
  /** Called once when the simulator mounts / session is (re)opened. */
  start(): Promise<void>;
  /** User sent a text in the iMessage thread. */
  onUserText(text: string): Promise<void>;
  /** User tapped a button on a rich card. */
  onCardAction(actionId: string, messageId: string): Promise<void>;
  /** User added (or removed) a tapback on a message. */
  onUserReaction(messageId: string, kind: Tapback, added: boolean): Promise<void>;
  /** User accepted the incoming call and the voice transport connected. */
  onCallAnswered(): Promise<void>;
  /** The call ended, for whatever reason (hangup, drop, decline, silence…). */
  onCallEnded(reason: CallEndReason): Promise<void>;
  /** A final user speech transcript arrived from the voice transport. */
  onUserSpeechFinal(text: string): Promise<void>;
}
