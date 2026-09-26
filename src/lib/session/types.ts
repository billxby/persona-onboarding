/**
 * Session model shared by every channel (call + text) and, later, the backend.
 * Mirrors the slot table in the design doc. Nothing here is AI-specific.
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
export type CallEndReason =
  | "user_hangup"
  | "bot_hangup"
  | "declined"
  | "dropped"
  | "silence"
  | "mic_denied";

export interface CallInfo {
  state: CallState;
  startedAt?: number;
  endedAt?: number;
  endReason?: CallEndReason;
  muted: boolean;
  speaker: boolean;
}

export type MessageRole = "user" | "assistant" | "system";

export interface CardAction {
  id: string;
  label: string;
  variant?: "primary" | "secondary" | "destructive";
}

/** Rich card rendered inside an assistant bubble (e.g. Connect Gmail / Call me back). */
export interface MessageCard {
  title: string;
  subtitle?: string;
  actions: CardAction[];
  /** once an action was taken, we disable the card and show which one */
  takenActionId?: string;
}

/** iMessage tapbacks. */
export type Tapback = "heart" | "thumbsUp" | "thumbsDown" | "haha" | "exclaim" | "question";
export const TAPBACKS: Tapback[] = ["heart", "thumbsUp", "thumbsDown", "haha", "exclaim", "question"];

export interface Reaction {
  kind: Tapback;
  by: "user" | "assistant";
  ts: number;
}

export interface ChatMessage {
  id: string;
  role: MessageRole;
  text: string;
  ts: number;
  status?: "sending" | "delivered" | "read";
  /** when the other side read it (shown as "Read 6:21 PM") */
  readAt?: number;
  card?: MessageCard;
  reactions?: Reaction[];
  /** inline reply: id of the message this one answers */
  replyToId?: string;
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
