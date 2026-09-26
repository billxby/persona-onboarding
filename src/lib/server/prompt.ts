import fs from "node:fs";
import path from "node:path";
import type { Belief, ServerChannel, SessionRow } from "@/lib/shared/types";
import { stateBlock } from "./state";

/**
 * Prompt composition (DESIGN.md §9): persona + policy[mode] + channel[channel] + STATE + WHAT I KNOW.
 * Static parts first, dynamic parts last, so the static prefix can be cached by the provider.
 * Files live in prompts/*.md and are read from disk (cached in production).
 */
export const PROMPT_VERSION = "2026-09-26.1";

/** Rough budget check: ~4 chars per token. The whole prompt must stay under 1,500 tokens. */
export const PROMPT_TOKEN_BUDGET = 1500;
export const approxTokens = (s: string) => Math.ceil(s.length / 4);

export type PromptName =
  | "persona"
  | "policy_onboarding"
  | "policy_main"
  | "channel_call"
  | "channel_text"
  | "supervisor"
  | "output_guard"
  | "hostile_user";

const cache = new Map<string, string>();
const promptDir = () => path.join(process.cwd(), "prompts");

export function loadPrompt(name: PromptName): string {
  const cached = cache.get(name);
  if (cached !== undefined && process.env.NODE_ENV === "production") return cached;
  const text = fs.readFileSync(path.join(promptDir(), `${name}.md`), "utf8").trim();
  cache.set(name, text);
  return text;
}

const WHAT_I_KNOW_MAX_CHARS = 800;

/** Active beliefs the model may rely on. Capped at ≈200 tokens; oldest first, truncated with a marker. */
export function whatIKnowBlock(beliefs: Belief[]): string {
  const active = beliefs.filter((b) => b.status === "active");
  if (active.length === 0) return "WHAT I KNOW\n(nothing yet)";
  const lines: string[] = ["WHAT I KNOW"];
  let used = lines[0].length;
  let truncated = false;
  for (const b of active) {
    const line = `- ${b.subject}.${b.predicate} = ${b.object} (${b.confidence.toFixed(2)})`;
    if (used + line.length + 1 > WHAT_I_KNOW_MAX_CHARS) {
      truncated = true;
      break;
    }
    lines.push(line);
    used += line.length + 1;
  }
  if (truncated) lines.push("- (more omitted)");
  return lines.join("\n");
}

export function staticPrompt(mode: SessionRow["mode"], channel: ServerChannel): string {
  const policy = loadPrompt(mode === "main" ? "policy_main" : "policy_onboarding");
  const chan = loadPrompt(channel === "call" ? "channel_call" : "channel_text");
  return [loadPrompt("persona"), policy, chan].join("\n\n");
}

/**
 * `static` is identical for every turn of the same mode/channel (cache breakpoint goes here);
 * `dynamic` is the STATE block + WHAT I KNOW, rebuilt every turn.
 */
export function buildPromptParts(session: SessionRow, channel: ServerChannel, beliefs: Belief[]): { static: string; dynamic: string } {
  return {
    static: staticPrompt(session.mode, channel),
    dynamic: [stateBlock(session, channel), whatIKnowBlock(beliefs)].join("\n\n"),
  };
}

export function buildPrompt(session: SessionRow, channel: ServerChannel, beliefs: Belief[]): string {
  const parts = buildPromptParts(session, channel, beliefs);
  return `${parts.static}\n\n${parts.dynamic}`;
}

export const supervisorPrompt = () => loadPrompt("supervisor");
export const guardPrompt = () => loadPrompt("output_guard");

export interface HostilePersona {
  id: string;
  title: string;
  system: string;
  done: string;
}

/** Parses prompts/hostile_user.md: `## <id> — <title>` sections with `System:` and `Done when:` lines. */
export function hostilePersonas(): HostilePersona[] {
  const text = loadPrompt("hostile_user");
  const sections = text.split(/^## /m).slice(1);
  const personas: HostilePersona[] = [];
  for (const section of sections) {
    const [heading, ...rest] = section.split("\n");
    const m = heading.match(/^([a-z_]+)\s+[—-]\s+(.+)$/i);
    if (!m) continue;
    const body = rest.join("\n");
    const system = body.match(/System:\s*([\s\S]*?)(?:\n\s*Done when:|$)/)?.[1]?.trim() ?? "";
    const done = body.match(/Done when:\s*(.+)/)?.[1]?.trim() ?? "";
    personas.push({ id: m[1], title: m[2].trim(), system, done });
  }
  return personas;
}
