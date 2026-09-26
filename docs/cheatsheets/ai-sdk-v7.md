# Vercel AI SDK v7 + `@ai-sdk/anthropic` v4 — server-side cheat sheet

Verified 2026-09-26 against installed types: `ai` 7.0.116, `@ai-sdk/anthropic` 4.0.65, `@ai-sdk/provider-utils` 5.0.49, `zod` 4.6.5, `next` 16.3.6.
Ground truth: `node_modules/ai/dist/index.d.ts`, `node_modules/@ai-sdk/provider-utils/dist/index.d.ts`, `node_modules/@ai-sdk/anthropic/dist/index.d.ts`.
Prose docs ship locally in `node_modules/ai/docs/` (migration guide: `08-migration-guides/23-migration-guide-7-0.mdx`) and
`node_modules/@ai-sdk/anthropic/docs/05-anthropic.mdx`. Packages are **ESM-only** and need **Node 22+**.

## 0. Imports

```ts
import {
  streamText, generateText, tool, Output,
  isStepCount, hasToolCall, isLoopFinished,          // `stepCountIs` still exported = deprecated alias of isStepCount
  type ModelMessage, type ToolSet, type StepResult, type TextStreamPart, type LanguageModelUsage,
  APICallError, StreamProviderError, NoSuchToolError, InvalidToolInputError, ToolCallRepairError,
  NoObjectGeneratedError, NoOutputGeneratedError, InvalidPromptError, RetryError, TypeValidationError,
} from 'ai';
import { anthropic, createAnthropic, type AnthropicProviderOptions } from '@ai-sdk/anthropic';
import { z } from 'zod';   // zod 4; provider-utils accepts `$ZodType` (v4) and zod v3 schemas directly
```

## 1. `streamText` consumed server-side (Next 16 route handler)

Signature (trimmed; every name copied from `ai/dist/index.d.ts`):

```ts
declare function streamText<TOOLS extends ToolSet, RUNTIME_CONTEXT extends Context = Context, OUTPUT extends Output = Output<string, string, never>>(
  options: LanguageModelCallOptions & RequestOptions<TOOLS> & Prompt & ToolsContextParameter<TOOLS> /* { tools?, toolsContext? } */ & {
    model: LanguageModel;
    toolChoice?: ToolChoice<TOOLS>;                       // 'auto' | 'none' | 'required' | { type: 'tool', toolName }
    stopWhen?: Arrayable<StopCondition<NoInfer<TOOLS>, RUNTIME_CONTEXT>>;   // @default isStepCount(1)
    output?: OUTPUT;                                      // structured output spec (Output.object(...))
    providerOptions?: ProviderOptions;                    // { anthropic: {...} }
    prepareStep?: PrepareStepFunction<NoInfer<TOOLS>, RUNTIME_CONTEXT>;
    activeTools?; toolOrder?; toolApproval?; runtimeContext?; repairToolCall?;
    onChunk?: StreamTextOnChunkCallback<TOOLS>;           // ({ chunk: TextStreamPart }) — pauses the stream until resolved
    onError?: StreamTextOnErrorCallback | StreamTextOnErrorRetryCallback;   // ({ error }); may return { retry: true } with streamRetries
    onEnd?: StreamTextOnEndCallback<...>;  onFinish?: /* @deprecated alias of onEnd */;
    onStepEnd?: GenerateTextOnStepEndCallback<...>;  onStepFinish?: /* @deprecated alias of onStepEnd */;
    onAbort?: StreamTextOnAbortCallback<...>; onStart?; onStepStart?; onToolExecutionStart?; onToolExecutionEnd?;
    include?: { requestBody?: boolean; requestMessages?: boolean; rawChunks?: boolean };   // includeRawChunks deprecated
    streamRetries?: number; telemetry?: TelemetryOptions;   // experimental_telemetry deprecated
  }): StreamTextResult<TOOLS, RUNTIME_CONTEXT, OUTPUT>;

type LanguageModelCallOptions = { maxOutputTokens?; temperature?; topP?; topK?; presencePenalty?; frequencyPenalty?; stopSequences?; seed?;
  reasoning?: 'provider-default' | 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' };
type RequestOptions<TOOLS> = { maxRetries?: number /* 2 */; abortSignal?: AbortSignal; headers?: Record<string, string | undefined>;
  timeout?: number | { totalMs?; stepMs?; firstChunkMs?; chunkMs?; toolMs?; tools?: Partial<Record<`${keyof TOOLS & string}Ms`, number>> } };
type Prompt = { instructions?: Instructions; system?: Instructions /* @deprecated Use `instructions` */; allowSystemInMessages?: boolean /* false */ }
  & ({ prompt: string | Array<ModelMessage>; messages?: never } | { messages: Array<ModelMessage>; prompt?: never });
type Instructions = string | SystemModelMessage | Array<SystemModelMessage>;
```

```ts
// app/api/brain/route.ts  (Next 16: route.ts exports Web-standard handlers; segment config still supported)
export const maxDuration = 60;

export async function POST(req: Request) {
  const { messages } = (await req.json()) as { messages: ModelMessage[] };

  const result = streamText({
    model: anthropic('claude-sonnet-4-5'),
    instructions: SYSTEM_PROMPT,          // not `system` (deprecated alias; `instructions` wins if both set)
    messages,                             // role:'system' entries here throw InvalidPromptError unless allowSystemInMessages: true
    tools: { lookupContact },
    stopWhen: isStepCount(5),             // default is isStepCount(1): a tool call would END the response
    maxOutputTokens: 1024,
    temperature: 0.7,                     // Anthropic: set temperature OR topP, not both
    abortSignal: req.signal,
    onStepEnd: (step) => log(step.stepNumber, step.finishReason, step.usage),       // step: StepResult
    onEnd: ({ text, steps, usage, responseMessages, finishReason }) => persist(...),  // not called on abort (see onAbort)
    onError: ({ error }) => console.error(error),                                    // stream errors are NOT thrown
  });

  for await (const part of result.stream) {          // `fullStream` still works but is @deprecated → `stream`
    switch (part.type) {
      case 'text-delta':  buffer += part.text; break;             // field is `text` (not textDelta / delta)
      case 'tool-call':   log(part.toolName, part.input); break;
      case 'tool-result': log(part.toolName, part.output); break;
      case 'tool-error':  log(part.toolName, part.error); break;
      case 'finish-step': log(part.finishReason, part.usage); break;
      case 'finish':      log(part.finishReason, part.totalUsage); break;
      case 'error':       throw part.error;                          // only surfaced as a part; decide yourself
      case 'abort':       return new Response(null, { status: 499 });
    }
  }
  const text = await result.text;
  const history = [...messages, ...(await result.responseMessages)];   // continue the conversation with this
  return Response.json({ text, usage: await result.usage });
}
```

`TextStreamPart<TOOLS>` members (all fields exact). `FinishReason = 'stop' | 'length' | 'content-filter' | 'tool-calls' | 'error' | 'other'`.

| `type` | fields |
|---|---|
| `start` | — |
| `start-step` | `request: LanguageModelRequestMetadata`, `warnings: CallWarning[]` |
| `text-start` / `text-end` | `id`, `providerMetadata?` |
| `text-delta` | `id`, `text`, `providerMetadata?` |
| `reasoning-start` / `reasoning-delta` / `reasoning-end` | `id`, (`text` on delta), `providerMetadata?` |
| `tool-input-start` | `id`, `toolName`, `providerExecuted?`, `dynamic?`, `title?`, `toolMetadata?` |
| `tool-input-delta` | `id`, `delta` |
| `tool-input-end` | `id` |
| `tool-call` | `toolCallId`, `toolName`, `input`, `providerExecuted?`, `dynamic?`, `invalid?`, `error?` (dynamic/invalid only), `toolMetadata?` |
| `tool-result` | `toolCallId`, `toolName`, `input`, `output`, `preliminary?`, `providerExecuted?`, `dynamic?` |
| `tool-error` | `toolCallId`, `toolName`, `input`, `error: unknown`, `dynamic?` |
| `tool-output-denied` / `tool-approval-request` / `tool-approval-response` / `source` / `file` / `reasoning-file` / `custom` | approval flow and attachments; rarely needed server-side |
| `finish-step` | `response` (no `messages`/`body`), `usage`, `performance`, `finishReason`, `rawFinishReason`, `providerMetadata` |
| `finish` | `finishReason`, `rawFinishReason`, `totalUsage` |
| `abort` | `reason?` |
| `error` | `error: unknown` |
| `raw` | `rawValue` (only with `include: { rawChunks: true }`) |

`StreamTextResult` (every field is `PromiseLike` and auto-consumes the stream): `text`, `content`, `steps`, `finalStep` (= `steps.at(-1)`),
`usage` (sum of all steps; `totalUsage` deprecated), `finishReason`, `rawFinishReason`, `toolCalls`, `toolResults`, `warnings`,
`responseMessages` (accumulated across steps), `output`, `files`, `sources`; streams `stream`, `textStream`, `partialOutputStream`,
`elementStream`; `consumeStream({ onError? })`. Deprecated: `fullStream`, `response`/`request`/`providerMetadata`/`reasoning`
(→ `finalStep.*`), all `to*Response`/`pipe*` methods (→ standalone `toUIMessageStream`/`createUIMessageStreamResponse`).
If the model stream ends with no output, the result promises reject with `NoOutputGeneratedError`.

`LanguageModelUsage = { inputTokens, inputTokenDetails: { noCacheTokens, cacheReadTokens, cacheWriteTokens }, outputTokens,
outputTokenDetails: { textTokens, reasoningTokens }, totalTokens, raw? }` (all `number | undefined`).

## 2. `ModelMessage` shapes (`@ai-sdk/provider-utils`)

```ts
type ModelMessage = SystemModelMessage | UserModelMessage | AssistantModelMessage | ToolModelMessage;
type SystemModelMessage    = { role: 'system';    content: string; providerOptions?: ProviderOptions };
type UserModelMessage      = { role: 'user';      content: string | Array<TextPart | ImagePart /* deprecated */ | FilePart>; providerOptions? };
type AssistantModelMessage = { role: 'assistant'; content: string | Array<TextPart | CustomPart | FilePart | ReasoningPart | ReasoningFilePart | ToolCallPart | ToolResultPart | ToolApprovalRequest>; providerOptions? };
type ToolModelMessage      = { role: 'tool';      content: Array<ToolResultPart | ToolApprovalResponse>; providerOptions? };

interface TextPart       { type: 'text'; text: string; providerOptions? }
interface FilePart       { type: 'file'; data: FileData | DataContent | URL | ProviderReference; mediaType: string; filename?; providerOptions? }
  // FileData = { type:'data', data } | { type:'url', url } | { type:'reference', reference } | { type:'text', text }
  // images: { type: 'file', mediaType: 'image/png' /* or just 'image' */, data: bytesOrBase64 }   ({ type:'image', image } is deprecated)
interface ToolCallPart   { type: 'tool-call';   toolCallId: string; toolName: string; input: unknown; providerOptions?; providerExecuted? }
interface ToolResultPart { type: 'tool-result'; toolCallId: string; toolName: string; output: ToolResultOutput; providerOptions? }
type ToolResultOutput =
  | { type: 'text'; value: string }            | { type: 'json'; value: JSONValue }
  | { type: 'error-text'; value: string }      | { type: 'error-json'; value: JSONValue }
  | { type: 'execution-denied'; reason?: string }
  | { type: 'content'; value: Array<{ type: 'text'; text } | { type: 'file'; mediaType; data: FileData; filename? } | { type: 'custom'; ... }> };
```

What the SDK writes into `responseMessages` after a tool step (from `createToolModelOutput`): `execute` returned a string →
`{ type: 'text', value }`; anything else → `{ type: 'json', value }` (JSON round-tripped, `undefined` → `null`); a thrown error →
`{ type: 'error-text', value: message }`; `tool.toModelOutput` overrides all of that.

```ts
// typical result.responseMessages after one tool round-trip + final answer
[
  { role: 'assistant', content: [{ type: 'tool-call', toolCallId: 'toolu_01…', toolName: 'lookupContact', input: { name: 'Ana' } }] },
  { role: 'tool',      content: [{ type: 'tool-result', toolCallId: 'toolu_01…', toolName: 'lookupContact', output: { type: 'json', value: { id: 7 } } }] },
  { role: 'assistant', content: [{ type: 'text', text: 'Found Ana (#7).' }] },
]
```

Per-step `step.response.messages` now holds **only that step's** messages; use `result.responseMessages` (or `onEnd`'s
`responseMessages`) for the accumulated history. `prepareStep` also receives `initialMessages` / `responseMessages`.

## 3. `tool()` with zod 4

```ts
declare function tool<INPUT, OUTPUT, CONTEXT extends Context>(tool: Tool<INPUT, OUTPUT, CONTEXT> & { execute: ToolExecuteFunction<INPUT, OUTPUT, CONTEXT> }): ExecutableTool<Tool<INPUT, OUTPUT, CONTEXT>>;
declare function tool<INPUT, OUTPUT, CONTEXT extends Context>(tool: Tool<INPUT, OUTPUT, CONTEXT>): Tool<INPUT, OUTPUT, CONTEXT>;
type ToolExecuteFunction<INPUT, OUTPUT, CONTEXT> = (input: INPUT, options: ToolExecutionOptions<CONTEXT>) => AsyncIterable<OUTPUT> | PromiseLike<OUTPUT> | OUTPUT;
interface ToolExecutionOptions<CONTEXT> { toolCallId: string; messages: ModelMessage[]; abortSignal?: AbortSignal; context: CONTEXT; experimental_sandbox?: SandboxSession }
```

Function-tool fields: `description?: string | (({ context }) => string)`, `inputSchema: FlexibleSchema<INPUT>` (**`parameters` no longer
exists**), `outputSchema?`, `execute?`, `toModelOutput?({ toolCallId, input, output }) => ToolResultOutput`, `strict?`, `inputExamples?`,
`providerOptions?` (e.g. Anthropic cache control on the tool definition), `contextSchema?`, `metadata?`, `onInputStart/onInputDelta/onInputAvailable?`.
`needsApproval` is deprecated → `toolApproval` on the call.

```ts
const lookupContact = tool({
  description: 'Find a contact by name',
  inputSchema: z.object({ name: z.string().describe('Full or partial name') }),   // .describe()/.meta() must be LAST in the chain
  execute: async ({ name }, { toolCallId, messages, abortSignal }) => {
    return { id: 7, name };            // plain object is fine → serialized as { type: 'json', value }
  },
});
```

- `execute` may return a plain object, a string, a Promise, or an `AsyncIterable` (intermediate yields arrive as `tool-result` parts with
  `preliminary: true`). `options.messages` = the messages sent to the model for that step (no system prompt, no assistant tool-call message).
- Execution errors are not thrown: they become `tool-error` parts / `{ type: 'error-text' }` tool results and the loop continues.
- **Tool without `execute`**: the step ends with `finishReason: 'tool-calls'`; the loop does not continue no matter what `stopWhen`
  says. `result.responseMessages` ends with the assistant `tool-call`; you must append a `{ role: 'tool', content: [{ type: 'tool-result', ... }] }`
  message yourself and call again. Add `outputSchema` if you want the `output` typed.

## 4. Multi-step tool calling

```ts
type StopCondition<TOOLS, RUNTIME_CONTEXT> = (options: { steps: Array<StepResult<TOOLS, RUNTIME_CONTEXT>> }) => PromiseLike<boolean> | boolean;
declare function isStepCount(stepCount: number): StopCondition<any, any>;        // exported also as `stepCountIs` (deprecated alias)
declare function hasToolCall<TOOLS extends ToolSet>(...toolName: Array<keyof TOOLS | (string & {})>): StopCondition<TOOLS, any>;
declare function isLoopFinished(): StopCondition<any, any>;                        // never stops; loop ends naturally
```

- `maxSteps` does not exist (0 hits in the v7 types). `stopWhen` defaults to `isStepCount(1)`.
- `stopWhen` accepts an array (any match stops) and is only evaluated when the last step contains tool results.
- The loop also ends when `finishReason !== 'tool-calls'`, when a tool without `execute` is called, or when approval is pending.
- `prepareStep({ steps, stepNumber, model, instructions, initialInstructions, messages, initialMessages, responseMessages, toolsContext, runtimeContext })`
  returns `{ model?, toolChoice?, activeTools?, toolOrder?, instructions?, messages?, providerOptions?, ...LanguageModelCallOptions } | undefined`;
  `instructions`/`messages` overrides carry forward to later steps.
- `StepResult` fields: `callId`, `stepNumber`, `model`, `content`, `text`, `reasoning`, `reasoningText`, `files`, `sources`, `toolCalls`, `toolResults`,
  `finishReason`, `rawFinishReason`, `usage`, `performance`, `warnings`, `request`, `response` (`{ messages, id, timestamp, modelId, headers?, body? }`), `providerMetadata`.

## 5. Structured output

`generateObject` / `streamObject` still exist but are `@deprecated Use generateText / streamText with an output setting instead`.
`experimental_output` is **gone** (removed in 7.0); the option is `output`, the result field is `output`.

```ts
declare namespace Output {           // exported as `Output` (internally `output`)
  const object: <OBJECT>(o: { schema: FlexibleSchema<OBJECT>; name?: string; description?: string }) => Output<OBJECT, DeepPartial<OBJECT>, never>;
  const array:  <ELEMENT>(o: { element: FlexibleSchema<ELEMENT>; minItems?; maxItems?; name?; description? }) => Output<Array<ELEMENT>, Array<ELEMENT>, ELEMENT>;
  const choice: <CHOICE extends string>(o: { options: Array<CHOICE>; name?; description? }) => Output<CHOICE, CHOICE, never>;
  const json:   (o?: { name?; description? }) => Output<JSONValue, JSONValue, never>;
  const text:   () => Output<string, string, never>;
}
```

```ts
const { output } = await generateText({           // result.output is a getter: throws NoOutputGeneratedError if the final step
  model: anthropic('claude-haiku-4-5'),           // did not finish with 'stop' (e.g. finished with 'tool-calls')
  output: Output.object({
    schema: z.object({
      intent: z.enum(['schedule', 'question', 'smalltalk']),
      entities: z.array(z.object({ kind: z.string(), value: z.string() })),
    }),
  }),
  instructions: 'Classify the incoming text message.',
  prompt: incomingText,
});
// quick classification: Output.choice({ options: ['schedule', 'question', 'smalltalk'] }) → output: 'schedule' | ...
// streaming: streamText({ ..., output }) → result.partialOutputStream (DeepPartial), await result.output, result.elementStream (arrays)
```

- A structured-output generation counts as a step; when mixing with tools raise `stopWhen` accordingly.
- Schema/parse failure → `NoObjectGeneratedError` (`text`, `response`, `usage`, `finishReason`, `cause`).
- Legacy `generateObject({ model, schema, schemaName?, schemaDescription?, output?: 'object' | 'array' | 'enum' | 'no-schema', enum?, ... })` → `result.object`.

## 6. Anthropic provider

```ts
declare function createAnthropic(options?: AnthropicProviderSettings): AnthropicProvider;
declare const anthropic: AnthropicProvider;                 // default instance; reads env lazily per call
interface AnthropicProviderSettings { baseURL?; apiKey?; authToken?; headers?; fetch?; generateId?; name? }
```

- `apiKey` defaults to **`ANTHROPIC_API_KEY`** (`environmentVariableName: "ANTHROPIC_API_KEY"` in dist/index.js); `authToken` → `ANTHROPIC_AUTH_TOKEN`;
  `ANTHROPIC_BASE_URL` overrides the base URL. So `anthropic('claude-sonnet-4-5')` works with no `createAnthropic` call.
- `anthropic(id)` = `.languageModel(id)` = `.chat(id)` = `.messages(id)`. `AnthropicModelId` includes `claude-haiku-4-5`, `claude-sonnet-4-5`,
  `claude-sonnet-4-6`, `claude-opus-4-5/4-6/4-7/4-8`, `claude-opus-5`, `claude-opus-5-5`, `claude-sonnet-5`, `claude-fable-5`, `claude-fable-5-1`, plus `(string & {})`.
- Provider options live under the key **`anthropic`**; type them with `satisfies AnthropicProviderOptions` (alias of `AnthropicLanguageModelOptions`).

Prompt caching — the exact key is `providerOptions.anthropic.cacheControl` (`cache_control` also accepted), value
`{ type: 'ephemeral', ttl?: '5m' | '1h' }`. Where it can go (all read by `CacheControlValidator.getCacheControl` in dist/index.js):

```ts
// system: Instructions accepts SystemModelMessage[] (providerOptions preserved), so no allowSystemInMessages needed
instructions: [{ role: 'system', content: BIG_PROMPT, providerOptions: { anthropic: { cacheControl: { type: 'ephemeral' } } } }],
// user / assistant content part (or on the whole message → applied to its last part)
{ role: 'user', content: [{ type: 'text', text: transcript, providerOptions: { anthropic: { cacheControl: { type: 'ephemeral', ttl: '1h' } } } }] },
// tool definition
tool({ inputSchema, execute, providerOptions: { anthropic: { cacheControl: { type: 'ephemeral' } } } }),
// whole request (top-level `cache_control` in the API body)
providerOptions: { anthropic: { cacheControl: { type: 'ephemeral' } } satisfies AnthropicProviderOptions },
```

- Max **4** breakpoints (`MAX_CACHE_BREAKPOINTS = 4`); extra ones are dropped with an `unsupported` warning. Minimum cacheable prompt is
  1024–4096 tokens depending on model; shorter prompts silently run uncached.
- Read hits via `usage.inputTokenDetails.cacheReadTokens` / `.cacheWriteTokens`; raw Anthropic usage at `finalStep.providerMetadata?.anthropic?.usage`.
  `providerMetadata.anthropic.cacheCreationInputTokens` was removed in 4.0.

Thinking / effort (`anthropicLanguageModelOptions` schema):

```ts
providerOptions: { anthropic: {
  thinking: { type: 'adaptive', display?: 'omitted' | 'summarized' | 'updates' }   // or { type: 'enabled', budgetTokens?: number } | { type: 'disabled' }
  effort: 'low' | 'medium' | 'high' | 'xhigh' | 'max',        // → output_config.effort
  sendReasoning?: boolean, disableParallelToolUse?: boolean, toolStreaming?: boolean,
  structuredOutputMode?: 'auto' | 'outputFormat' | 'jsonTool',   // auto = native output_format when the model supports it
  metadata?: { userId }, anthropicBeta?: string[], speed?: 'fast' | 'standard', serviceTier?, inferenceGeo?: 'us' | 'global',
  taskBudget?, fallbacks?, contextManagement?, compaction?, container?, mcpServers?, safeguards?
} satisfies AnthropicProviderOptions }
```

- Portable alternative: top-level `reasoning: 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh'` → adaptive thinking + effort on newer
  models, a token budget on older ones. If `providerOptions.anthropic.thinking`/`effort` is set, top-level `reasoning` is ignored (never merged).
- `thinking: { type: 'enabled' }` without `budgetTokens` → budget 1024 + a `compatibility` warning; `temperature` is dropped when thinking is on;
  `max_tokens` = `maxOutputTokens + budgetTokens`, capped at the model max.

## 7. Breaking changes that matter here (v5 → v6 → v7)

| Old | v7 |
|---|---|
| `CoreMessage`, `CoreUserMessage`, … (v4) | `ModelMessage`, `UserModelMessage`, `AssistantModelMessage`, `ToolModelMessage` |
| `maxTokens` | `maxOutputTokens` |
| `tool({ parameters, execute: (args) })`, `toolCall.args`, `toolResult.result` | `tool({ inputSchema, execute: (input, options) })`, `.input`, `.output` |
| `maxSteps: n` | `stopWhen: isStepCount(n)` (`stepCountIs` = deprecated alias; default `isStepCount(1)`) |
| `system: '…'` | `instructions: '…'` (`system` still works, deprecated) |
| `role: 'system'` inside `messages` | throws `InvalidPromptError` unless `allowSystemInMessages: true` |
| `experimental_output` / `result.experimental_output` | `output` / `result.output` (old name removed) |
| `generateObject` / `streamObject` | deprecated → `generateText` / `streamText` + `Output.*` |
| `onFinish`, `onStepFinish`, `experimental_onStart`, `experimental_onToolCallStart/Finish` | `onEnd`, `onStepEnd`, `onStart`, `onToolExecutionStart/End` (old names = deprecated aliases) |
| `result.fullStream` | `result.stream` (deprecated alias kept) |
| `result.response.messages` (accumulated) | `result.responseMessages`; `step.response.messages` is per-step only |
| `result.totalUsage`, `usage.cachedInputTokens`, `usage.reasoningTokens` | `result.usage` (all steps), `usage.inputTokenDetails.cacheReadTokens`, `usage.outputTokenDetails.reasoningTokens` |
| `result.toDataStreamResponse()` (v4) → `toUIMessageStreamResponse()` (v5/6) | deprecated → `createUIMessageStreamResponse({ stream: toUIMessageStream({ stream: result.stream }) })` |
| `experimental_telemetry`, `experimental_prepareStep`, `experimental_activeTools`, `includeRawChunks`, `experimental_repairToolCall` | `telemetry`, `prepareStep`, `activeTools`, `include.rawChunks`, `repairToolCall` |
| `experimental_context` in tools, `ToolCallOptions`, `CallSettings` | `context` (from `toolsContext`, typed by `contextSchema`) + `runtimeContext`, `ToolExecutionOptions`, `LanguageModelCallOptions & RequestOptions` |
| `{ type: 'image', image }` part; `image-*`/`file-data` tool outputs | `{ type: 'file', mediaType: 'image', data }` everywhere |
| `text-delta.textDelta` (v4) | `text-delta.text` |

## 8. Errors and warnings

All errors extend `AISDKError` (`cause?`) and expose `static isInstance(error: unknown)`; use that rather than `instanceof`.

| Class | Fields | When |
|---|---|---|
| `APICallError` | `url`, `statusCode?`, `responseHeaders?`, `responseBody?`, `isRetryable`, `data?`, `requestBodyValues` | HTTP failure starting a call (thrown by `generateText`; arrives as an `error` part in `streamText`) |
| `RetryError` | `reason`, `lastError`, `errors[]` | `maxRetries` exhausted (wraps the last `APICallError`) |
| `StreamProviderError` | `type?`, `code?`, `statusCode?`, `isRetryable`, `data?` | provider error event mid-stream (`error` part / `onError`; `streamRetries` can retry) |
| `NoSuchToolError` | `toolName`, `availableTools?` | model called an undefined tool |
| `InvalidToolInputError` | `toolName`, `toolInput` (raw string), `cause` | tool input failed `inputSchema` validation |
| `ToolCallRepairError` | `originalError: NoSuchToolError \| InvalidToolInputError` | `repairToolCall` threw |
| `ToolChoiceViolationError` | `toolChoice`, `finishReason`, `provider`, `modelId`, `content` | required/named tool not called |
| `MissingToolResultsError` | `toolCallIds[]` | input `messages` contain tool calls without matching tool results |
| `InvalidPromptError` | `prompt` | bad messages (e.g. `role: 'system'` inside `messages`) |
| `NoObjectGeneratedError` | `text?`, `response?`, `usage?`, `finishReason?` | `output` parse/validation failed |
| `NoOutputGeneratedError` | — | `result.output` read with no output, or stream ended with nothing |
| `TypeValidationError` | `value`, `context?`, `cause` | schema validation (also tool `contextSchema`) |

In `streamText`, tool-call errors (`NoSuchToolError`, `InvalidToolInputError`) appear as `tool-call` parts with `invalid: true` /
`tool-error` parts and as `error-text` tool results; only fatal transport errors throw from the `for await` loop.

```ts
readonly warnings: PromiseLike<CallWarning[] | undefined>;    // also per step: step.warnings and the `start-step` part
type CallWarning = { type: 'unsupported'; feature: string; details?: string } | { type: 'compatibility'; feature: string; details?: string }
                 | { type: 'deprecated'; setting: string; message: string } | { type: 'other'; message: string };
```

Typical Anthropic warnings: `temperature` dropped with thinking on, >4 cache breakpoints, effort lowered when thinking is disabled, `toolChoice` downgraded on models that reject forced tool use.
