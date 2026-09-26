import { z } from "zod";

/**
 * Input validation for every tool the model can call (DESIGN.md §8.1). The
 * server, not the model, decides what is a name, what is a need, and what is
 * never stored.
 */

// ---------------------------------------------------------------------------
// zod input schemas (all fields required: the Realtime API's strict mode needs it)
// ---------------------------------------------------------------------------

export const SLOT_NAMES = ["user_name", "need", "gmail", "agent_name"] as const;

export const setSlotInput = z.object({
  slot: z.enum(SLOT_NAMES).describe("Which slot to fill"),
  value: z.string().max(240).describe("The value the user gave, verbatim or lightly normalised. 'skip' skips the slot; for gmail, 'declined' records a verbal no."),
});
export const confirmSlotInput = z.object({ slot: z.enum(SLOT_NAMES) });
export const requestGmailConnectInput = z.object({});
export const recentEmailsInput = z.object({ n: z.number().int().min(1).max(5).describe("How many; use 3") });
export const searchGmailInput = z.object({ query: z.string().min(1).max(200).describe("Gmail search query, e.g. 'from:landlord' or 'gym membership'") });
export const draftReplyInput = z.object({
  message_id: z.string().min(1).max(64),
  intent: z.string().min(1).max(300).describe("What the reply should achieve, in one line"),
});
export const rememberInput = z.object({
  kind: z.enum(["preference", "fact", "todo"]),
  content: z.string().min(1).max(200),
  source: z.enum(["user_text", "user_call", "agent_inference"]),
});
export const forgetInput = z.object({ subject: z.string().min(1).max(60), predicate: z.string().min(1).max(80) });
/** intention(op, key, ...): the agent's own reminders. Nullable fields keep the Realtime strict schema happy. */
export const intentionInput = z.object({
  op: z.enum(["open", "outcome", "defer", "done", "drop"]).describe("open: track something to do or raise later · outcome: how they took what you raised · defer: snooze · done: it happened · drop: stop pursuing (not for the built-ins)"),
  key: z
    .string()
    .min(2)
    .max(60)
    .regex(/^[a-z][a-z0-9_-]*$/i, "snake_case key, e.g. followup_landlord")
    .describe("get_name | learn_need | connect_gmail | name_agent, or your own like followup_landlord"),
  goal: z.string().max(140).nullable().describe("open: what you want to do or bring up, one line; else null"),
  receptivity: z.number().int().min(0).max(10).nullable().describe("outcome: 0 shut it down … 10 yes; else null"),
  note: z.string().max(160).nullable().describe("outcome: what they said or did, under 15 words · done/drop/defer: why; else null"),
  turns: z.number().int().min(1).max(200).nullable().describe("defer: how many of your turns to wait; else null"),
});
export const explainInput = z.object({ subject: z.string().min(1).max(60), predicate: z.string().min(1).max(80) });
export const graduateInput = z.object({ reason: z.string().min(1).max(200).describe("Why now: value delivered | user wants to get going | skip all") });
export const switchChannelInput = z.object({ to: z.enum(["call", "text"]) });
export const endCallInput = z.object({ reason: z.string().min(1).max(120).describe("done | user asked | switching to text | silence") });

// ---------------------------------------------------------------------------
// word lists
// ---------------------------------------------------------------------------

/** Values that are never a person's or an agent's name (whole value, case-insensitive). */
export const NAME_BLOCKLIST = [
  "admin", "administrator", "root", "system", "sudo", "superuser", "assistant", "null", "undefined", "none", "nil",
  "test", "testing", "asdf", "asdfgh", "qwerty", "anonymous", "anon", "user", "username", "bot", "ai", "gpt", "chatgpt",
  "claude", "openai", "anthropic", "google", "gmail", "unknown", "nobody", "n/a", "na", "idk", "lol", "no", "yes",
];

/** Common English profanity: playful pushback, not stored as a name. */
export const PROFANITY = [
  "fuck", "fucking", "fucker", "motherfucker", "shit", "bullshit", "bitch", "asshole", "arsehole", "bastard", "damn",
  "dick", "dickhead", "cunt", "piss", "cock", "pussy", "slut", "whore", "wanker", "twat", "bollocks", "prick",
  "douche", "douchebag", "jackass", "dumbass", "crap", "arse", "bugger", "tosser",
];

/**
 * Slurs: hard reject, never stored, never echoed. Kept as two lists: longer
 * terms matched as substrings of the letters-only value, short ones as whole
 * words (substring matching on short terms hits ordinary words).
 */
export const SLURS_SUBSTRING = [
  "nigger", "nigga", "faggot", "kike", "chink", "gook", "wetback", "beaner", "raghead", "towelhead", "tranny", "retard",
  "spick", "spik", "dyke", "coon", "porchmonkey", "zipperhead", "jigaboo", "sandnigger", "paki",
];
export const SLURS_WORD = ["fag", "spic", "jap", "homo", "tard"];

const STOPWORDS = new Set([
  "a", "an", "the", "my", "me", "i", "to", "of", "and", "or", "for", "in", "on", "with", "at", "by", "is", "it", "its",
  "this", "that", "these", "those", "be", "been", "am", "are", "was", "were", "do", "does", "did", "have", "has", "had",
  "you", "your", "we", "our", "they", "them", "their", "he", "she", "his", "her", "so", "just", "like", "some", "any",
  "can", "could", "would", "should", "will", "want", "need", "help", "please", "thanks", "ok", "okay", "yeah", "yes", "no",
  "um", "uh", "hmm", "well", "kind", "sort", "thing", "things", "stuff", "something", "anything", "everything", "nothing",
]);

/** Filler answers that are not a need. */
export const NEED_FILLER = new Set([
  "idk", "i dont know", "i don't know", "dunno", "dont know", "not sure", "nothing", "nothing really", "stuff", "things",
  "whatever", "nah", "no", "nope", "none", "n/a", "na", "help", "anything", "something", "everything", "you tell me",
  "i guess", "hmm", "um", "uh", "lol", "ok", "okay", "yes", "sure", "idk lol", "no idea",
]);

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

export const lettersOnly = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[^a-z]+/g, "");
export const words = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9' ]+/g, " ").split(/\s+/).filter(Boolean);

/** true when the text contains a slur (substring on the letters-only form, or whole-word for the short list) */
export function containsSlur(text: string): boolean {
  const flat = lettersOnly(text);
  if (SLURS_SUBSTRING.some((s) => flat.includes(s))) return true;
  const ws = new Set(words(text).map((w) => w.replace(/'/g, "")));
  return SLURS_WORD.some((s) => ws.has(s));
}

/** Strong terms that are also caught as substrings ("Shithead"); the rest only as whole words ("Hancock" is a surname). */
export const PROFANITY_SUBSTRING = ["fuck", "shit", "bitch", "wanker", "twat", "whore", "slut", "asshole", "arsehole", "motherfucker"];

/** true when the text contains common profanity (whole words, plus strong terms as substrings). */
export function isProfane(text: string): boolean {
  const ws = words(text).map((w) => w.replace(/'/g, ""));
  if (ws.some((w) => PROFANITY.includes(w))) return true;
  const flat = lettersOnly(text);
  return PROFANITY_SUBSTRING.some((p) => flat.includes(p));
}

/** Strip the markdown the model is told not to produce anyway. */
export function stripMarkdown(s: string): string {
  return s
    .replace(/[*_`~#>]+/g, "")
    .replace(/^\s*[-•]\s+/gm, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

const NAME_CHARS = /^[\p{L}\p{M}][\p{L}\p{M}'’.\- ]*$/u;
const isAsciiLetters = (s: string) => /^[A-Za-z'’.\- ]+$/.test(s);
const hasMixedCase = (s: string) => /[a-z]/.test(s) && /[A-Z]/.test(s.slice(1));
const titleCaseWord = (w: string) =>
  w
    .split(/(-|')/) // keep separators: Mary-Ann, O'Brien
    .map((part) => (part === "-" || part === "'" ? part : part.charAt(0).toUpperCase() + part.slice(1).toLowerCase()))
    .join("");

export type NameCheck = { ok: true; value: string } | { ok: false; reason: string; severity: "playful" | "hard" };

/**
 * Person or agent name validator. Playful reasons are safe to read back to
 * the user; hard reasons are for the log only (slurs are never echoed).
 */
export function validateName(raw: string, kind: "user_name" | "agent_name"): NameCheck {
  let value = String(raw ?? "")
    .normalize("NFC")
    .replace(/[‘’]/g, "'")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[\s.,!?;:"“”'()]+$/g, "")
    .replace(/^["“”'()]+/g, "")
    .trim();
  const who = kind === "user_name" ? "a name for you" : "a name for me";

  if (!value) return { ok: false, reason: `I need ${who}, even a short one`, severity: "playful" };
  if (containsSlur(value)) return { ok: false, reason: "slur", severity: "hard" };
  if (value.length > 40) return { ok: false, reason: "that's a bit long for a name, what do people actually call you?", severity: "playful" };
  if (!NAME_CHARS.test(value)) return { ok: false, reason: "names are just letters here, no numbers or symbols", severity: "playful" };

  const parts = value.split(" ").filter(Boolean);
  if (parts.length > 3) return { ok: false, reason: "that's a lot of names, which one do you go by?", severity: "playful" };

  const flatLower = value.toLowerCase().replace(/[.'\-]/g, "");
  if (NAME_BLOCKLIST.includes(value.toLowerCase()) || NAME_BLOCKLIST.includes(flatLower)) {
    return { ok: false, reason: `nice try, but "${value}" isn't ${who}`, severity: "playful" };
  }
  if (isProfane(value)) return { ok: false, reason: "ha, I'm not calling anyone that. Real name?", severity: "playful" };

  // keyboard mash: ASCII letters with no vowels, or one letter repeated 4+ times
  if (isAsciiLetters(value)) {
    const letters = value.toLowerCase().replace(/[^a-z]/g, "");
    if (letters.length >= 5 && !/[aeiouy]/.test(letters)) return { ok: false, reason: "that looks like a keyboard sneeze, what's your actual name?", severity: "playful" };
    if (/(.)\1{3,}/.test(letters)) return { ok: false, reason: "that looks like a keyboard sneeze, what's your actual name?", severity: "playful" };
  }

  if (!hasMixedCase(value)) value = parts.map(titleCaseWord).join(" ");
  return { ok: true, value };
}

export type NeedCheck = { ok: true; value: string } | { ok: false; reason: string };

/** A need is a concrete task or area, 3–200 chars, not filler. */
export function validateNeed(raw: string): NeedCheck {
  const value = stripMarkdown(String(raw ?? "")).replace(/[.!?]+$/g, "").trim();
  const lower = value.toLowerCase().replace(/[^a-z0-9' /]+/g, "").trim();
  if (value.length < 3) return { ok: false, reason: "too short to act on" };
  if (value.length > 200) return { ok: false, reason: "too long; keep the need to one line" };
  if (NEED_FILLER.has(lower)) return { ok: false, reason: "that's not a task yet; offer concrete examples" };
  if (containsSlur(value)) return { ok: false, reason: "slur" };
  const content = words(value).filter((w) => w.length >= 3 && !STOPWORDS.has(w));
  if (content.length === 0) return { ok: false, reason: "no concrete task in that; ask for one specific thing" };
  return { ok: true, value };
}

/** Content tokens (no stopwords, ≥ 3 chars) — used by the provenance check. */
export function contentTokens(s: string): string[] {
  return Array.from(new Set(words(s).map((w) => w.replace(/'/g, "")).filter((w) => w.length >= 3 && !STOPWORDS.has(w))));
}

const MOOD_WORDS = /\b(seems?|feels?|mood|personality|angry|happy|sad|anxious|frustrated|rude|nice|lazy|smart|dumb|emotional|depressed|excited|impatient|annoyed|upset|friendly|hostile|introvert|extrovert)\b/i;
/** DESIGN §13.7: no personality or mood inferences, ever. */
export const isMoodInference = (content: string) => MOOD_WORDS.test(content);
