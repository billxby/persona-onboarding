/**
 * Session model shared by every channel (call + text) and, later, the backend.
 * Mirrors the slot table in the design doc. Nothing here is AI-specific.
 *
 * The message model is deliberately a closed union of what a regular iMessage
 * sender can actually put in a 1:1 thread (see docs/research/imessage-allowed-content.md).
 * No buttons, chips, forms or pickers: those exist only in Apple Messages for Business.
 */

export type SlotKey = "user_name" | "need" | "gmail" | "agent_name";
export type SlotStatus = "empty" | "pending" | "filled" | "skipped" | "declined" | "failed";

export interface Slot {
  status: SlotStatus;
  value?: string;
  updatedAt?: number;
}
export type Slots = Record<SlotKey, Slot>;

export const SLOT_ORDER: SlotKey[] = ["user_name", "need", "gmail", "agent_name"];
export const SLOT_LABELS: Record<SlotKey, string> = {
  user_name: "You",
  need: "Your need",
  gmail: "Gmail",
  agent_name: "My name",
};

export type Channel = "call" | "text";
export type Phase = "warmup" | "collecting" | "value" | "graduated";

export type CallState = "idle" | "ringing" | "connecting" | "live" | "ended";
export type CallEndReason = "user_hangup" | "bot_hangup" | "declined" | "dropped" | "silence" | "mic_denied";

export interface CallInfo {
  state: CallState;
  startedAt?: number;
  endedAt?: number;
  endReason?: CallEndReason;
  muted: boolean;
  speaker: boolean;
}

export type MessageRole = "user" | "assistant" | "system";

// ---------------------------------------------------------------------------
// Message content: the closed set of things iMessage can show.
// ---------------------------------------------------------------------------

/** Bubble effects a sender can attach (Sendblue `send_style`, LoopMessage `effect`). */
export type BubbleEffect = "slam" | "loud" | "gentle" | "invisibleInk";

/** Rich link preview. iOS renders a standalone URL as its own preview bubble. */
export interface LinkPreview {
  url: string;
  domain: string;
  title?: string;
  description?: string;
  imageUrl?: string;
  /**
   * App Clip metadata from App Store Connect. The App Clip bubble/card only
   * renders when the sender is in the recipient's Contacts; otherwise iOS
   * falls back to the plain rich link preview above.
   */
  appClip?: {
    appName: string;
    title: string; // ≤ 30 chars
    subtitle: string; // ≤ 56 chars
    verb?: "Open" | "View" | "Play";
  };
}

export interface ImageAttachment {
  src: string;
  alt?: string;
  width?: number;
  height?: number;
}

export type MessageContent =
  | { kind: "text"; text: string; effect?: BubbleEffect }
  | { kind: "link"; link: LinkPreview }
  | { kind: "image"; image: ImageAttachment };

/** iMessage tapbacks: the six classic glyphs, or any emoji (iOS 18+). */
export type Tapback = "heart" | "thumbsUp" | "thumbsDown" | "haha" | "exclaim" | "question";
export const TAPBACKS: Tapback[] = ["heart", "thumbsUp", "thumbsDown", "haha", "exclaim", "question"];

export type ReactionKind = { type: "tapback"; tapback: Tapback } | { type: "emoji"; emoji: string };

export interface Reaction {
  kind: ReactionKind;
  by: "user" | "assistant";
  ts: number;
}

export const sameReaction = (a: ReactionKind, b: ReactionKind) =>
  a.type === b.type && (a.type === "tapback" ? a.tapback === (b as { tapback: Tapback }).tapback : a.emoji === (b as { emoji: string }).emoji);

export interface ChatMessage {
  id: string;
  role: MessageRole;
  ts: number;
  content: MessageContent;
  status?: "sending" | "delivered" | "read";
  /** when the other side read it (shown as "Read 6:21 PM") */
  readAt?: number;
  reactions?: Reaction[];
  /** inline reply: id of the message this one answers */
  replyToId?: string;
}

/** Plain-text rendering of any content, for quotes, transcripts and copy. */
export function messageText(m: Pick<ChatMessage, "content">): string {
  switch (m.content.kind) {
    case "text":
      return m.content.text;
    case "link":
      return m.content.link.url;
    case "image":
      return m.content.image.alt ?? "Image";
  }
}

export interface CaptionLine {
  id: string;
  speaker: "user" | "assistant";
  text: string;
  final: boolean;
  ts: number;
}

export interface SessionEvent {
  id: string;
  ts: number;
  type: string;
  payload?: Record<string, unknown>;
}

export type Screen = "messages" | "call";

export const emptySlots = (): Slots => ({
  user_name: { status: "empty" },
  need: { status: "empty" },
  gmail: { status: "empty" },
  agent_name: { status: "empty" },
});
