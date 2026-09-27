/**
 * Shared contract between the Next.js route handlers (server) and the browser
 * mirror (client). Every row shape here matches supabase/migrations/0001_init.sql.
 * Nothing in this file may import server-only or React code.
 */

// ---------------------------------------------------------------------------
// Database rows
// ---------------------------------------------------------------------------

export type Mode = "onboarding" | "main";
export type ServerPhase = "warmup" | "collecting" | "value" | "graduated";
export type GmailStatus = "none" | "pending" | "connected" | "declined" | "failed";
export type ChannelPref = "text" | "call" | null;
export type ServerCallState = "idle" | "ringing" | "live" | "ended_by_user" | "dropped" | "ended_by_bot";
export type ServerChannel = "text" | "call";
export type SlotName = "user_name" | "need" | "gmail" | "agent_name";

export interface SessionRow {
  id: string;
  owner_uid: string | null;
  mode: Mode;
  user_name: string | null;
  need: string | null;
  gmail_status: GmailStatus;
  gmail_email: string | null;
  agent_name: string | null;
  channel_pref: ChannelPref;
  phase: ServerPhase;
  call_state: ServerCallState;
  /** {"user_name": 1} — how many times each slot has been asked and missed */
  attempts: Partial<Record<SlotName, number>>;
  /** last 5 questions asked, verbatim */
  last_questions: string[];
  summary: string | null;
  prompt_version: string | null;
  version: number;
  /** {"user_name": true} — set by confirm_slot */
  confirmed: Partial<Record<SlotName, boolean>>;
  mock_inbox: boolean;
  /** reply lock for /api/chat */
  responding_since: string | null;
  /** call heartbeat for lazy drop detection */
  last_heartbeat_at: string | null;
  value_moment_at: string | null;
  graduated_at: string | null;
  last_user_activity_at: string | null;
  oauth_state: string | null;
  /** assistant turns so far (text bubbles bursts + final call utterances); drives turn-based backoff */
  turn: number;
  created_at: string;
  updated_at: string;
}

export type MessageKind =
  | "text"
  | "tapback"
  | "contact_card"
  | "link_card"
  | "voicemail"
  | "call_log"
  | "screenshot"
  | "audio"
  | "summary_card";

export type MessageRole = "user" | "assistant" | "system";

export interface MessageRow {
  id: number;
  session_id: string;
  /** uuid chosen by the browser for optimistic rendering + idempotent inserts */
  client_id: string | null;
  channel: ServerChannel;
  role: MessageRole;
  kind: MessageKind;
  content: string | null;
  payload: MessagePayload;
  created_at: string;
}

/** Payload shapes by kind. Kept loose on purpose (jsonb); narrow with the helpers below. */
export type MessagePayload = Record<string, unknown> & {
  // link_card / summary_card
  url?: string;
  domain?: string;
  title?: string;
  description?: string;
  lines?: string[];
  // contact_card
  name?: string;
  org?: string;
  note?: string;
  // voicemail / audio
  duration_sec?: number;
  transcript?: string;
  audio_url?: string;
  // call_log
  reason?: string;
  duration_ms?: number;
  // tapback
  target_client_id?: string;
  target_id?: number;
  tapback?: string;
  emoji?: string;
  by?: "user" | "assistant";
  added?: boolean;
  // text
  effect?: "slam" | "loud" | "gentle" | "invisibleInk";
  // call transcript turns (channel = call)
  item_id?: string;
  final?: boolean;
};

export type EventType =
  | "session_created"
  | "call_ringing"
  | "call_started"
  | "call_ended"
  | "hangup_detected"
  | "silence_tier"
  | "mic_denied"
  | "slot_set"
  | "slot_rejected"
  | "slot_skipped"
  | "tool_call"
  | "oauth_started"
  | "oauth_success"
  | "oauth_declined"
  | "graduated"
  | "steer"
  | "repeat_question"
  | "latency"
  | "guard"
  | "supervisor"
  | "value_moment"
  | "resume"
  | "text_during_call"
  | "app_clip_card_shown"
  | "app_clip_opened"
  | "app_clip_closed"
  | "app_clip_cta"
  | "app_clip_fallback_web"
  | "app_clip_demo"
  | "app_clip_answer"
  | "call_offer"
  | "reply_held"
  | "intention"
  | "receptivity"
  | "error";

export interface EventRow {
  id: number;
  session_id: string;
  type: EventType | (string & {});
  payload: Record<string, unknown>;
  created_at: string;
}

/** `clip`: typed into the App Clip's onboarding form (same tier as a text reply; a restatement in chat promotes it). */
export type MemorySource = "user_call" | "user_text" | "clip" | "oauth" | "gmail_body" | "agent_inference";
export type MemoryOp = "assert" | "retract" | "resolve";
export type MemoryActor = "user" | "system" | "gmail" | "agent";

export interface MemoryEvent {
  id: number;
  session_id: string;
  ts: string;
  actor: MemoryActor;
  op: MemoryOp;
  subject: string;
  predicate: string;
  object: string;
  source: MemorySource;
  evidence_ref: string | null;
}

export type BeliefStatus = "active" | "superseded" | "contradicted" | "pending" | "quarantined" | "retracted";

export interface Belief {
  session_id: string;
  subject: string;
  predicate: string;
  object: string;
  confidence: number;
  status: BeliefStatus;
  reason: string | null;
  evidence_ids: number[];
  updated_at: string;
}

// ---------------------------------------------------------------------------
// Intentions: what is on the agent's own mind (DESIGN.md §13b)
// ---------------------------------------------------------------------------

/** open: start tracking · nudge: I brought it up · outcome: how they took it (0–10) · defer: snooze · done/drop: terminal · reopen */
export type IntentionOp = "open" | "nudge" | "outcome" | "defer" | "done" | "drop" | "reopen";
export type IntentionActor = "agent" | "system" | "user";
export type IntentionStatus = "open" | "asked" | "done" | "dropped";
export type ReceptivitySignal = "accepted" | "deferred" | "declined" | "shut_down" | "ignored" | "unclear";

export interface IntentionEvent {
  id: number;
  session_id: string;
  ts: string;
  key: string;
  op: IntentionOp;
  actor: IntentionActor;
  /** assistant turn counter at the time of the event (null when unknown) */
  turn: number | null;
  payload: IntentionPayload;
  evidence_ref: string | null;
}

/** Per-op payload; every field optional so the fold can ignore malformed rows. */
export interface IntentionPayload {
  // open / reopen
  goal?: string;
  slot?: SlotName | null;
  sticky?: boolean;
  priority?: number;
  channels?: ServerChannel[];
  // nudge
  approach?: string;
  channel?: ServerChannel;
  // outcome
  receptivity?: number;
  signal?: ReceptivitySignal;
  note?: string;
  // defer
  turns?: number;
  ms?: number;
  // done / drop / defer / reopen
  reason?: string;
}

/** Projection row (= fold of intention_events); one per (session, key). */
export interface Intention {
  session_id: string;
  key: string;
  goal: string;
  slot: SlotName | null;
  sticky: boolean;
  priority: number;
  channels: ServerChannel[];
  status: IntentionStatus;
  nudges: number;
  last_nudge_turn: number | null;
  last_nudge_at: string | null;
  last_approach: string | null;
  approaches: string[];
  receptivity: number | null;
  receptivity_history: number[];
  receptivity_mean: number | null;
  last_outcome_turn: number | null;
  notes: string[];
  next_eligible_turn: number;
  next_eligible_at: string;
  reason: string | null;
  evidence_ids: number[];
  updated_at: string;
}

export interface OAuthTokenRow {
  session_id: string;
  access_token: string;
  refresh_token: string | null;
  expires_at: string | null;
  scopes: string | null;
  email: string | null;
}

// ---------------------------------------------------------------------------
// API contract
// ---------------------------------------------------------------------------

/** Compact state the model sees in every tool result (keep it small: results must stay < 300 bytes). */
export interface StateSummary {
  user_name: string | null;
  user_name_confirmed: boolean;
  need: string | null;
  gmail: GmailStatus;
  gmail_email: string | null;
  agent_name: string | null;
  mode: Mode;
  phase: ServerPhase;
  channel_pref: ChannelPref;
}

/** What the server thinks should be asked next. `slot: null` means: nothing to ask, deliver value / just help. */
export interface NextBestAsk {
  slot: SlotName | null;
  hint: string;
}

export interface ToolResult {
  ok: boolean;
  error?: string;
  ask_again?: boolean;
  data?: unknown;
  state: StateSummary;
  next_best_ask: NextBestAsk;
}

/** Response of POST /api/tools/[name] (voice channel). Only `result` goes back to the model. */
export interface ToolRouteResponse {
  result: ToolResult;
  /** fresh instructions to re-send via session.update after this tool call */
  instructions?: string;
  /** the client must end the WebRTC call now */
  end_call?: boolean;
  /** the client should ring the phone (switch_channel to call) */
  ring?: boolean;
}

export interface LatencyStats {
  p50: number | null;
  p95: number | null;
  n: number;
}

export interface SessionView {
  session: SessionRow;
  messages: MessageRow[];
  beliefs: Belief[];
  /** what is on the agent's mind (intentions projection) */
  intentions: Intention[];
  next_best_ask: NextBestAsk;
  latency: LatencyStats;
  /** true when owner_uid is set, so the browser can subscribe via Realtime + RLS */
  realtime: boolean;
  /** server time, for client clock skew */
  now: string;
}

export interface CreateSessionRequest {
  /** client-proposed uuid (the zustand sessionId) so ids match on both sides */
  id?: string;
  /** anonymous-auth access token, if the browser has one */
  access_token?: string;
}

export interface PostMessageRequest {
  session_id: string;
  client_id: string;
  text: string;
  reply_to_client_id?: string;
}

export interface PostMessageResponse {
  message: MessageRow;
  /** a call is live: the client injects the text into the voice session; the bot will end the call */
  call_live: boolean;
  /** a tapback answered something the agent had asked: the client should POST /api/chat with this trigger */
  chat_trigger?: ChatTrigger;
  /** the intention the tapback was read against (goes into the trigger's `reason`) */
  reacted_key?: string;
}

/** iMessage tapbacks the server understands (mirrors `Tapback` in src/lib/session/types.ts). */
export const TAPBACK_KINDS = ["heart", "thumbsUp", "thumbsDown", "haha", "exclaim", "question"] as const;
export type TapbackKind = (typeof TAPBACK_KINDS)[number];

export type ChatTrigger =
  | "user"
  | "open"
  | "call_ended"
  | "dropped"
  | "voicemail"
  | "gmail_connected"
  | "gmail_declined"
  | "welcome_back"
  | "silence_end"
  | "clip_demo"
  /** the App Clip onboarding closed (finished or abandoned): the thread takes the relay */
  | "clip_closed"
  /** the user answered the agent's last question with a tapback */
  | "tapback";

export interface ChatRequest {
  session_id: string;
  trigger?: ChatTrigger;
  /** free text context for the trigger (e.g. call end reason) */
  reason?: string;
}

/** NDJSON stream emitted by POST /api/chat, one JSON object per line. */
export type ChatEvent =
  | { type: "typing"; on: boolean }
  | { type: "message"; message: MessageRow }
  | { type: "session"; session: SessionRow }
  | { type: "beliefs"; beliefs: Belief[] }
  | { type: "mind"; intentions: Intention[] }
  | { type: "tool"; name: string; ok: boolean; ring?: boolean; next_best_ask: NextBestAsk }
  | { type: "done"; latency_ms: number; next_best_ask: NextBestAsk }
  | { type: "busy" }
  | { type: "error"; message: string };

export type CallEventType =
  | "call_ringing"
  | "call_started"
  | "call_ended"
  | "call_dropped"
  | "silence_tier"
  | "latency"
  | "mic_denied";

export interface CallEventRequest {
  session_id: string;
  type: CallEventType;
  /** user_hangup | bot_hangup | declined | dropped | silence | mic_denied */
  reason?: string;
  payload?: Record<string, unknown>;
}

export interface CallEventResponse {
  session: SessionRow;
  /** messages inserted as a direct consequence (voicemail, call_log, resume text) */
  messages: MessageRow[];
  /** the client should now POST /api/chat with this trigger */
  chat_trigger?: ChatTrigger;
}

export interface TranscriptTurn {
  item_id: string;
  role: "user" | "assistant";
  text: string;
  final: boolean;
}

export interface TranscriptRequest {
  session_id: string;
  turns: TranscriptTurn[];
}

export interface TranscriptResponse {
  /** the supervisor changed state; re-send `instructions` */
  patched: boolean;
  instructions?: string;
  /** assistant said goodbye: end the call if no end_call arrives within 3 s */
  should_end: boolean;
}

export interface RealtimeTokenResponse {
  client_secret: string;
  expires_at: number;
  model: string;
  voice: string;
  instructions: string;
  /** JSON-schema function tool definitions for the Realtime session */
  tools: unknown[];
  /** the server's choice of first line, injected as a system note before the first response */
  opener_note?: string;
}

export interface InstructionsResponse {
  instructions: string;
  prompt_version: string;
}

/** Slot as the UI shows it (mirrors src/lib/session/types.ts Slot). Derived from SessionRow. */
export interface SlotView {
  status: "empty" | "pending" | "filled" | "skipped" | "declined" | "failed";
  value?: string;
}

export function slotsFromSession(s: SessionRow): Record<SlotName, SlotView> {
  const attempts = s.attempts ?? {};
  const skipped = (slot: SlotName) => (attempts[slot] ?? 0) >= 3;
  return {
    user_name: s.user_name
      ? { status: "filled", value: s.user_name }
      : skipped("user_name")
        ? { status: "skipped", value: "friend" }
        : { status: "empty" },
    need: s.need ? { status: "filled", value: s.need } : { status: "empty" },
    gmail:
      s.gmail_status === "connected"
        ? { status: "filled", value: s.gmail_email ?? "connected" }
        : s.gmail_status === "pending"
          ? { status: "pending" }
          : s.gmail_status === "declined"
            ? { status: "declined" }
            : s.gmail_status === "failed"
              ? { status: "failed" }
              : { status: "empty" },
    agent_name: s.agent_name
      ? { status: "filled", value: s.agent_name }
      : skipped("agent_name")
        ? { status: "skipped", value: "Persona" }
        : { status: "empty" },
  };
}

export function stateSummary(s: SessionRow): StateSummary {
  return {
    user_name: s.user_name,
    user_name_confirmed: !!s.confirmed?.user_name,
    need: s.need,
    gmail: s.gmail_status,
    gmail_email: s.gmail_email,
    agent_name: s.agent_name,
    mode: s.mode,
    phase: s.phase,
    channel_pref: s.channel_pref,
  };
}
