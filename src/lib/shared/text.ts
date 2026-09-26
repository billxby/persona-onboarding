/**
 * Pure text helpers shared by the chat route (server) and, where useful, the client.
 * No IO, no React, no server imports.
 */

const MAX_BUBBLES = 3;
const MAX_BUBBLE_CHARS = 220;

/** Remove markdown the model might still emit: bold/italic, headings, bullets, code, links. */
export function stripMarkdown(text: string): string {
  let t = text ?? "";
  t = t.replace(/```[\s\S]*?```/g, (m) => m.replace(/```[a-z]*\n?/gi, "").trim());
  t = t.replace(/`([^`\n]+)`/g, "$1");
  t = t.replace(/^\s{0,3}#{1,6}\s+/gm, "");
  t = t.replace(/\*\*([^*\n]+)\*\*/g, "$1");
  t = t.replace(/__([^_\n]+)__/g, "$1");
  t = t.replace(/(^|[^\w*])\*(?!\s)([^*\n]+?)(?<!\s)\*(?!\w)/g, "$1$2");
  t = t.replace(/(^|[^\w_])_(?!\s)([^_\n]+?)(?<!\s)_(?!\w)/g, "$1$2");
  t = t.replace(/\[([^\]\n]+)\]\((?:[^)\n]+)\)/g, "$1");
  t = t.replace(/^\s*(?:[-*•]|\d+[.)])\s+/gm, "");
  t = t.replace(/^\s*>\s?/gm, "");
  t = t.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n");
  return t.trim();
}

/** Split a paragraph into sentences, keeping terminal punctuation and closing quotes. */
export function sentencesOf(text: string): string[] {
  const out = text.match(/[^.!?\n]+(?:[.!?]+["')\]]*|$)/g) ?? [];
  return out.map((s) => s.trim()).filter(Boolean);
}

function groupSentences(sentences: string[], groups: number): string[] {
  if (sentences.length <= groups) return sentences;
  const total = sentences.reduce((n, s) => n + s.length + 1, 0);
  const target = Math.ceil(total / groups);
  const result: string[] = [];
  let cur = "";
  for (const s of sentences) {
    const remainingGroups = groups - result.length;
    const next = cur ? `${cur} ${s}` : s;
    if (cur && next.length > target && remainingGroups > 1) {
      result.push(cur);
      cur = s;
    } else {
      cur = next;
    }
  }
  if (cur) result.push(cur);
  // still too many (very long sentences): merge from the end
  while (result.length > groups) {
    const last = result.pop()!;
    result[result.length - 1] = `${result[result.length - 1]} ${last}`;
  }
  return result;
}

function chunkLong(piece: string): string[] {
  if (piece.length <= MAX_BUBBLE_CHARS) return [piece];
  const sentences = sentencesOf(piece);
  if (sentences.length <= 1) return [piece];
  const chunks: string[] = [];
  let cur = "";
  for (const s of sentences) {
    const next = cur ? `${cur} ${s}` : s;
    if (cur && next.length > MAX_BUBBLE_CHARS) {
      chunks.push(cur);
      cur = s;
    } else cur = next;
  }
  if (cur) chunks.push(cur);
  return chunks;
}

/**
 * Turn a reply into 1–3 iMessage bubbles. Blank lines (or single newlines) are the
 * model's own bubble breaks; long pieces are split at sentence boundaries; more than
 * three pieces are merged (adjacent, shortest first). Never splits mid-sentence.
 */
export function splitBubbles(text: string): string[] {
  const clean = stripMarkdown(text);
  if (!clean) return [];
  let pieces = clean
    .split(/\n\s*\n/)
    .map((p) => p.replace(/\s*\n\s*/g, " ").trim())
    .filter(Boolean);
  if (pieces.length === 1 && clean.includes("\n")) {
    pieces = clean
      .split("\n")
      .map((p) => p.trim())
      .filter(Boolean);
  }
  let chunks = pieces.flatMap(chunkLong);
  if (chunks.length === 1) {
    const sentences = sentencesOf(chunks[0]);
    if (sentences.length >= 2 && chunks[0].length > 60) {
      const groups = Math.min(MAX_BUBBLES, sentences.length, chunks[0].length > 160 ? 3 : 2);
      chunks = groupSentences(sentences, groups);
    }
  }
  while (chunks.length > MAX_BUBBLES) {
    let bestIdx = 0;
    let bestLen = Infinity;
    for (let i = 0; i < chunks.length - 1; i++) {
      const len = chunks[i].length + chunks[i + 1].length;
      if (len < bestLen) {
        bestLen = len;
        bestIdx = i;
      }
    }
    chunks.splice(bestIdx, 2, `${chunks[bestIdx]} ${chunks[bestIdx + 1]}`);
  }
  return chunks.map((c) => c.trim()).filter(Boolean);
}

/** Every sentence that ends with a question mark, across all bubbles. */
export function questionsIn(bubbles: string[]): string[] {
  return bubbles.flatMap((b) => sentencesOf(b).filter((s) => /\?["')\]]*$/.test(s)));
}

/** iMessage typing pause before a bubble lands: 400–900 ms, scaled by length. */
export function typingDelayMs(bubble: string): number {
  return Math.round(Math.min(900, Math.max(400, 400 + (bubble?.length ?? 0) * 4)));
}

const NOT_NAMES = new Set(
  [
    "i", "im", "i'm", "ok", "okay", "yes", "no", "hey", "hi", "hello", "thanks", "thank", "please", "sure", "cool", "great",
    "honestly", "actually", "anyway", "anyways", "basically", "seriously", "look", "listen", "wait", "right", "fine", "well",
    "yeah", "yep", "yup", "nope", "nah", "sorry", "maybe", "perhaps", "obviously", "apparently", "hopefully", "unfortunately",
    "again", "first", "second", "next", "then", "now", "today", "tomorrow", "yesterday", "tonight", "hmm", "oh", "ah", "um",
    "alright", "absolutely", "definitely", "totally", "frankly", "personally", "quick", "one", "two", "also", "still", "plus",
    "gmail", "google", "persona", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday",
    "january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december",
    "can", "could", "what", "where", "when", "why", "how", "who", "do", "does", "did", "is", "are", "was", "were", "will", "would",
    "should", "let", "lets", "let's", "just", "also", "and", "but", "so", "the", "this", "that", "it", "its", "my", "me", "you",
    "your", "we", "our", "they", "them", "sorry", "yeah", "yep", "nope", "nah", "now", "later", "today", "tomorrow", "tonight",
    "call", "text", "stop", "skip", "wait", "actually", "right", "fine", "good", "nice", "awesome", "perfect", "done", "there",
    "here", "again", "everyone", "anyone", "nothing", "something", "man", "dude", "bro", "buddy", "friend", "mate", "sir",
    "morning", "evening", "night", "afternoon", "bye", "goodbye", "cheers", "yo", "sup", "alright", "well", "oh", "ah", "um",
  ].map((w) => w.toLowerCase()),
);

const NAME_TOKEN = "([A-Z][a-zA-Z'\\-]{1,20})";
const ADDRESS_PATTERNS = [
  new RegExp(`^\\s*(?:hey|hi|hello|yo|ok|okay|thanks|thank you|thx|cheers|please|sup|morning|alright)[,!]?\\s+${NAME_TOKEN}\\b`, "i"),
  new RegExp(`\\b(?:thanks|thank you|cheers|ok|okay|please|got it)[,]?\\s+${NAME_TOKEN}[.!?]*\\s*$`, "i"),
];

const titleCase = (s: string) => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();

/**
 * Detects the user addressing the assistant by a name ("hey Jarvis", "thanks Jarvis"). A bare leading
 * "Word, ..." is deliberately NOT treated as a name: sentence adverbs ("Honestly, ...") renamed the bot in tests.
 * Returns the name in Title Case, or null. `excluded` = the user's own name, the current agent name, etc.
 */
export function detectAddressedName(text: string, excluded: (string | null | undefined)[] = []): string | null {
  if (!text) return null;
  const ex = new Set(excluded.filter(Boolean).map((s) => String(s).toLowerCase()));
  for (const re of ADDRESS_PATTERNS) {
    const m = text.match(re);
    const raw = m?.[1];
    if (!raw) continue;
    // the leading-word pattern is case-insensitive; the name itself must start with a capital
    if (!/^[A-Z]/.test(raw)) continue;
    const lower = raw.toLowerCase();
    if (NOT_NAMES.has(lower) || ex.has(lower)) continue;
    return titleCase(raw);
  }
  return null;
}

export function looksLikeSkip(text: string): boolean {
  const t = (text ?? "").trim().toLowerCase();
  if (!t) return false;
  if (/\bskip (everything|all|it all|this)\b/.test(t)) return true;
  return /^(skip|stop|no thanks|no thank you|not now|later|i'?m good|im good|nah|pass|next|move on|nope)\b/.test(t);
}

export function looksLikeCallRequest(text: string): boolean {
  const t = (text ?? "").toLowerCase();
  if (/\b(don'?t|do not|no need to|never|stop) (call|ring|phone)\b/.test(t)) return false;
  return /\b(call me|give me a call|ring me|phone me|can you call|could you call|let'?s (talk|do a call|hop on a call|call)|call\?|do the call|on the phone|i'?d rather (talk|call))\b/.test(t);
}
