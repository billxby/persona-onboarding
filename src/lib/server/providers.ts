import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import { env } from "./env";

/**
 * Model providers. Anthropic is the design default for the text brain, the
 * supervisor and the output guard. TEXT_PROVIDER=openai is a pipeline-test
 * fallback only (the Anthropic key is org-scoped and needs a workspace id).
 */
let anthropicProvider: ReturnType<typeof createAnthropic> | null = null;
let openaiProvider: ReturnType<typeof createOpenAI> | null = null;

function anthropic() {
  if (!anthropicProvider) {
    const headers: Record<string, string> = {};
    if (env.ANTHROPIC_WORKSPACE_ID) headers["anthropic-workspace-id"] = env.ANTHROPIC_WORKSPACE_ID;
    anthropicProvider = createAnthropic({ apiKey: env.ANTHROPIC_API_KEY, headers });
  }
  return anthropicProvider;
}

function openai() {
  if (!openaiProvider) openaiProvider = createOpenAI({ apiKey: env.OPENAI_API_KEY });
  return openaiProvider;
}

/** Main text brain (claude-sonnet-5 by default). */
export function textModel() {
  return env.TEXT_PROVIDER === "openai" ? openai()(env.OPENAI_TEXT_MODEL) : anthropic()(env.TEXT_MODEL);
}

/** Small fast model for the supervisor, output guard, summaries and the hostile-user simulator. */
export function fastModel() {
  return env.TEXT_PROVIDER === "openai" ? openai()(env.OPENAI_FAST_MODEL) : anthropic()(env.FAST_MODEL);
}

export function providerLabel() {
  return env.TEXT_PROVIDER === "openai"
    ? `openai:${env.OPENAI_TEXT_MODEL}/${env.OPENAI_FAST_MODEL}`
    : `anthropic:${env.TEXT_MODEL}/${env.FAST_MODEL}`;
}
