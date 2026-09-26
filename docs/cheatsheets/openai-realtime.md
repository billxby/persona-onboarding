# OpenAI Realtime voice agent in the browser — `@openai/agents` 0.18 cheat sheet

Ground truth: installed `.d.ts`/`.mjs` in `node_modules/@openai/agents-realtime/dist` (0.18.0),
`@openai/agents-core/dist/tool.d.ts`, `openai@7.23.0/resources/realtime/*.d.ts`, the SDK docs
source (`guides/voice-agents/{quickstart,build,transport}.mdx`) and a live call to the API on
2026-09-26. zod 4.6.5 is installed; the SDK requires zod `^4.0.0`.

```ts
import { RealtimeAgent, RealtimeSession, OpenAIRealtimeWebRTC, tool, backgroundResult,
         type RealtimeItem, type RealtimeOutputGuardrail, type RealtimeContextData,
         type TransportEvent } from '@openai/agents/realtime'; // re-exports @openai/agents-realtime
```

## 1. `RealtimeAgent` and `tool()`

```ts
new RealtimeAgent<TContext>({
  name: string,                                   // required
  instructions?: string | ((runContext, agent) => string | Promise<string>),
  tools?: Tool[],                                 // function tools (run in the browser) or hostedMcpTool()
  handoffs?: (RealtimeAgent | Handoff)[],
  handoffDescription?: string,
  voice?: string,                                 // cannot change after the session has produced audio
  prompt?: ...                                    // NOT supported: model, modelSettings, outputType, toolUseBehavior, guardrails
})
```

```ts
const getWeather = tool({
  name: 'get_weather',                            // unique across tools + handoffs
  description: 'Return the weather for a city.',
  parameters: z.object({ city: z.string(), unit: z.enum(['c', 'f']).optional() }),
  strict: true,                                   // default true
  needsApproval: false,                           // true | (ctx, input, callId) => Promise<boolean>
  timeoutMs: 10_000,                              // optional; timeoutBehavior 'error_as_result' (default) | 'raise_exception'
  async execute({ city, unit }, runContext, details) {
    const history: RealtimeItem[] = runContext?.context.history ?? []; // snapshot; may lag the last user turn
    return { tempC: 21, city };                   // any value; sync or async
  },
});
```

- `parameters`: `ToolInputParameters = undefined | ZodObject<any, any> | StandardSchemaWithJSON | JsonObjectSchema`.
  A zod v4 object schema is the normal path; it is converted to JSON Schema at `tool()` time
  (`z.optional()` fields are lowered to nullable+required for strict mode and nulls stripped back on parse).
  A plain JSON-schema object is accepted too (parsed as JSON, not validated); `strict: false` requires JSON schema.
- `execute(input, context?, details?)`: `input` is the zod-inferred object (a `string` when `parameters` is
  undefined, `unknown` for JSON schema); `context: RunContext<RealtimeContextData<TContext>>`
  (`context.context.history` is the `RealtimeItem[]` snapshot); `details.toolCall` is the raw call.
  Type it with `tool<typeof params, RealtimeContextData>({...})` to get `history` typed.
- Result: any value. Strings pass through, objects are `JSON.stringify`-ed (`toSmartString`), then the SDK sends
  `conversation.item.create { item: { type: 'function_call_output', call_id, output } }` followed by
  `response.create`. Return `backgroundResult(value)` to send the output **without** triggering a response.
- Realtime rejects `outputSchema` and `allowedCallers: ['programmatic']` on function tools (UserError).
- Session events around a call: `agent_tool_start` → `agent_tool_end(result: string)`; with `needsApproval`
  → `tool_approval_requested` then `session.approve(item, { alwaysApprove? })` / `session.reject(item, { message? })`.

## 2. `new RealtimeSession(agent, options)`

```ts
const session = new RealtimeSession(agent, {
  model: 'gpt-realtime-2.1',                      // default DEFAULT_OPENAI_REALTIME_MODEL = 'gpt-realtime-2.1'
  transport: 'webrtc' | 'websocket' | new OpenAIRealtimeWebRTC({...}),   // default: webrtc in browsers
  config: {                                       // Partial<RealtimeSessionConfig> — camelCase, nested audio.*
    outputModalities: ['audio'],                  // or ['text']
    audio: {
      input: {
        format: { type: 'audio/pcm', rate: 24000 },   // legacy 'pcm16' still normalized
        transcription: { model: 'gpt-4o-mini-transcribe', language: 'en', prompt?: string } | null,
        //   gpt-live-transcribe / gpt-transcribe also take: delay ('minimal'|'low'|'medium'|'high'|'xhigh'),
        //   keywords: string[], languages: string[]
        noiseReduction: { type: 'near_field' | 'far_field' } | null,
        turnDetection: {                          // null = manual turns (sendAudio + commit + response.create)
          type: 'server_vad',                     // or 'semantic_vad'
          threshold: 0.5, prefixPaddingMs: 300, silenceDurationMs: 500,
          idleTimeoutMs: 8000,                    // server_vad only; counted after the agent finishes speaking
          createResponse: true, interruptResponse: true,
          // semantic_vad instead: eagerness: 'auto'|'low'|'medium'|'high' (+ createResponse/interruptResponse)
        },
      },
      output: { voice: 'marin', speed: 1.0, format: { type: 'audio/pcm', rate: 24000 } },
    },
    reasoning: { effort: 'low' },                 // reasoning-capable models (gpt-realtime-2.1)
    parallelToolCalls: true,
    toolChoice: 'auto',
    tracing: 'auto' | { workflow_name, group_id, metadata } | null,
    providerData: { truncation: 'auto', max_output_tokens: 'inf' }, // raw session fields with no camelCase key
  },
  outputGuardrails: [{ name, execute: async ({ agentOutput }) => ({ tripwireTriggered, outputInfo }), policyHint? }],
  outputGuardrailSettings: { debounceTextLength: 100 },  // -1 = only on the final transcript
  historyStoreAudio: false,                       // true keeps base64 audio in history items (memory!)
  tracingDisabled: false,                         // true sends tracing: null
  workflowName?, groupId?, traceMetadata?,        // groupId/traceMetadata need workflowName
  toolExecution: { preApprovalInputGuardrails: false },
  automaticallyTriggerResponseForMcpToolCalls: true,
  context: {},                                    // your TContext; history is merged in automatically
});
```

- Keys are **camelCase** in the SDK and converted to snake_case (`buildSessionPayload`) — inside `turnDetection`
  both spellings are accepted (`silenceDurationMs` or `silence_duration_ms`). Whatever you put in `providerData`
  is spread raw into the `session` object.
- Legacy top-level keys (`voice`, `modalities`, `turnDetection`, `inputAudioTranscription`, ...) still normalize
  but are `@deprecated`; use `audio.input` / `audio.output`. Voice precedence: `config.audio.output.voice`
  > `config.voice` > `agent.voice` > server default.
- SDK defaults sent on connect (`DEFAULT_OPENAI_REALTIME_SESSION_CONFIG`): `outputModalities: ['audio']`,
  pcm 24 kHz in/out, `transcription: { model: 'gpt-4o-mini-transcribe' }`, `turnDetection: { type: 'semantic_vad' }`,
  `noiseReduction: null`, `speed: 1`.

## 3. Connect, transport, audio, controls

```ts
await session.connect({
  apiKey: async () => (await fetch('/api/realtime/token', { method: 'POST' })).json().then(j => j.value), // 'ek_...'
  // model?: string (prefer the constructor), url?: string, callId?: string (SIP/sideband)
});
```

- In a browser the WebRTC transport **throws** unless the key starts with `ek_` or `useInsecureApiKey: true`.
- `connect()` resolves after the data channel opens **and** the initial `session.update` is acknowledged by
  `session.updated` (5 s fallback). It then emits `history_updated([])`.

```ts
const mic = await navigator.mediaDevices.getUserMedia({ audio: true }); // you own it: SDK won't stop it on close()
const audioEl = document.createElement('audio');                       // SDK sets autoplay + srcObject on 'track'
const transport = new OpenAIRealtimeWebRTC({
  audioElement: audioEl, mediaStream: mic,
  useInsecureApiKey: false, baseUrl?: 'https://api.openai.com/v1/realtime/calls', model?, apiKey?,
  changePeerConnection: (pc) => { pc.addEventListener('track', e => meter(e.streams[0])); return pc; },
});
const session = new RealtimeSession(agent, { transport, model: 'gpt-realtime-2.1' });
```

- Remote audio for loudness metering: after the `track` event, `audioEl.srcObject` is the remote `MediaStream`
  (`new AudioContext().createMediaStreamSource(audioEl.srcObject as MediaStream)` + `AnalyserNode`). Hook it via
  `changePeerConnection` + `addEventListener('track', ...)` (do not overwrite `pc.ontrack`, the SDK owns it) or read
  `(session.transport as OpenAIRealtimeWebRTC).connectionState.peerConnection.getReceivers()[0].track`.
  Mic level: meter the `mediaStream` you passed in.
- Controls: `session.mute(true)` (disables sender tracks; `session.muted: boolean | null`), `session.interrupt()`
  (WebRTC: `response.cancel` + `output_audio_buffer.clear`), `session.close()`, `session.sendMessage(text | {type:'message', role:'user', content:[{type:'input_text', text}]})`,
  `session.addImage(dataUrl, { triggerResponse })`, `session.sendAudio(buf, { commit })`, `session.updateHistory(items | fn)`,
  `session.history: RealtimeItem[]`, `session.currentAgent`, `session.usage`, `session.context`.
- Connection state: `session.transport.status: 'connecting' | 'connected' | 'disconnected'`;
  `session.transport.on('connection_change', (status) => ...)`; WebRTC also has `.connectionState`
  (`{ status, peerConnection, dataChannel, callId }`) and `.callId`. A peer connection stuck in `disconnected`
  for 5 s auto-closes.

## 4. Session events (`session.on(name, listener)`) and history items

| event | listener args |
|---|---|
| `history_updated` | `(history: RealtimeItem[])` — full snapshot, fires on every item update/delete |
| `history_added` | `(item: RealtimeItem)` — first time an itemId appears (transcript may still be in progress) |
| `agent_start` / `agent_end` | `(context, agent, turnInput?)` / `(context, agent, output: string)` |
| `agent_handoff` | `(context, fromAgent, toAgent)` (also fired by `updateAgent`) |
| `agent_tool_start` / `agent_tool_end` | `(context, agent, tool, { toolCall })` / `(context, agent, tool, result: string, { toolCall })` |
| `audio_start` / `audio` | `(context, agent)` / `({ type:'audio', data: ArrayBuffer, responseId })` — **WebSocket only** (WebRTC plays natively) |
| `audio_stopped` | `(context, agent)` — from `response.output_audio.done`; fires on WebRTC too |
| `audio_interrupted` | `(context, agent)` — **emitted only by the WebSocket transport in 0.18**; on WebRTC watch `input_audio_buffer.speech_started` / `output_audio_buffer.cleared` transport events |
| `transport_event` | `(event: TransportEvent)` — every raw server event (structured clone) |
| `error` | `({ type:'error', error: unknown })` — server `error` events and local failures |
| `guardrail_tripped` | `(context, agent, error: OutputGuardrailTripwireTriggered, { itemId })` |
| `tool_approval_requested` | `(context, agent, { type:'function_approval', tool, approvalItem } \| { type:'mcp_approval_request', approvalItem })` |
| `mcp_tool_call_completed` / `mcp_tools_changed` | `(context, agent, toolCall)` / `(tools: RealtimeMcpToolInfo[])` |

`RealtimeItem` (all have `itemId: string`, messages/calls also `previousItemId?: string | null`):

```ts
{ type:'message', role:'system', content:[{ type:'input_text', text }] }
{ type:'message', role:'user', status:'in_progress'|'completed'|'incomplete',
  content:[{ type:'input_text', text } | { type:'input_audio', audio?: string|null, transcript: string|null }] }
{ type:'message', role:'assistant', status, 
  content:[{ type:'output_text', text } | { type:'output_audio', audio?: string|null, transcript?: string|null }] }
{ type:'function_call', status, name, arguments: string /* JSON */, output: string|null }  // output filled in when the tool returns
{ type:'mcp_call'|'mcp_tool_call', status, name, arguments, output } | { type:'mcp_approval_request', serverLabel, name, arguments, approved }
```

There is no separate `function_call_output` item in SDK history: the output is folded into the `function_call`
item (`status` goes `in_progress` → `completed`). Server `audio` parts are renamed to `output_audio`. User
transcripts arrive late (async) via `conversation.item.input_audio_transcription.completed`; the SDK then
re-fetches the item (`conversation.item.retrieve`) and updates `content[].transcript`.
`utils.getLastTextFromAudioOutputMessage(item)` returns the assistant transcript text.

## 5. Raw client events, injecting messages, updating instructions

```ts
session.transport.sendEvent(event: RealtimeClientMessage /* { type: string; [k: string]: any } */): void
```

```ts
// Inject a system (or user) text item, then ask for a response
session.transport.sendEvent({ type: 'conversation.item.create',
  item: { type: 'message', role: 'system', content: [{ type: 'input_text', text: 'The user just opened the app.' }] } });
session.transport.sendEvent({ type: 'response.create' });          // or session.transport.requestResponse()
// One-off overrides: requestResponse({ instructions: 'Say goodbye', output_modalities: ['audio'] })
// User text without auto-response: session.transport.sendMessage('hi', {}, { triggerResponse: false })
```

- `sendEvent` throws if the data channel is not open. On WebRTC `response.create` goes through a sequencer that
  waits for the previous response's `response.done` before sending; `response.cancel` is tracked the same way.
- Update instructions mid-session — three options:
  1. `await session.updateAgent(newAgent)` — recomputes instructions/tools/voice/handoffs, sends a full
     `session.update` merged with your previous config, emits `agent_handoff`. Make `instructions` a function
     that reads mutable state and call `updateAgent(sameAgent)` to re-resolve it.
  2. Raw partial update (safest for a single field):
     `session.transport.sendEvent({ type: 'session.update', session: { type: 'realtime', instructions: '...' } })`.
  3. `session.transport.updateSessionConfig({ instructions })` — **warning**: it merges with SDK *defaults*, not your
     last config, so it re-sends `turn_detection: semantic_vad` and `transcription: gpt-4o-mini-transcribe` and will
     clobber a custom VAD setup unless you pass the full `audio` block again.
- `voice` and `model` cannot change once audio has been produced / ever; `tracing` cannot be changed after enabling.

## 6. Server (transport) events — GA names

Listen with `session.on('transport_event', e => ...)`, `session.transport.on('*', ...)` (raw clone) or a named
listener for a schema-known type, e.g. `session.transport.on('response.done', e => ...)` (validated).

| event | key fields |
|---|---|
| `conversation.item.input_audio_transcription.delta` | `item_id, content_index, delta` (user, partial) |
| `conversation.item.input_audio_transcription.completed` | `item_id, content_index, transcript, usage?` (user, final) |
| `conversation.item.input_audio_transcription.failed` | `item_id, error` |
| `response.output_audio_transcript.delta` / `.done` | `response_id, item_id, output_index, content_index, delta` / `transcript` (assistant) |
| `response.output_text.delta` / `.done` | same shape with `delta` / `text` (text modality) |
| `response.created` / `response.done` | `response.id`; `done` adds `response.status` (`completed\|cancelled\|failed\|incomplete`), `response.output[]` (includes `function_call` items with `call_id, name, arguments`), `response.usage` |
| `response.output_item.added` / `.done` | `response_id, output_index, item` |
| `response.function_call_arguments.delta` / `.done` | `response_id, item_id, call_id, delta` / `arguments` |
| `conversation.item.added` / `conversation.item.done` / `.retrieved` / `.deleted` / `.truncated` | `item`, `previous_item_id` / `item_id` |
| `input_audio_buffer.speech_started` / `speech_stopped` | `item_id, audio_start_ms` / `audio_end_ms` (barge-in signal) |
| `input_audio_buffer.committed` / `.cleared` / `.timeout_triggered` | `item_id, previous_item_id` / — / (idle timeout; generic, not in SDK schema) |
| `output_audio_buffer.started` / `.stopped` / `.cleared` | `response_id` — **WebRTC only**; best "agent is speaking" signal on WebRTC |
| `session.created` / `session.updated` | `session` (effective config) |
| `rate_limits.updated` | `rate_limits[]` |
| `error` | `error: { type, code, message, param, event_id }` |

Old beta names that no longer exist: `response.audio_transcript.*` → `response.output_audio_transcript.*`,
`response.audio.*` → `response.output_audio.*`, `response.text.*` → `response.output_text.*`,
`conversation.item.created` → `conversation.item.added`/`done`, `modalities` → `output_modalities`, top-level
`voice`/`turn_detection`/`input_audio_transcription` → `audio.output.voice`/`audio.input.turn_detection`/`audio.input.transcription`.

## 7. Server side: mint an ephemeral client secret

```ts
// app/api/realtime/token/route.ts (Next.js) — never expose OPENAI_API_KEY to the browser
const r = await fetch('https://api.openai.com/v1/realtime/client_secrets', {
  method: 'POST',
  headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({
    expires_after: { anchor: 'created_at', seconds: 600 },   // anchor only 'created_at'; 10..7200, default 600
    session: {
      type: 'realtime',
      model: 'gpt-realtime-2.1',                              // must match the model the client session uses
      instructions: '...',
      audio: {
        input: {
          format: { type: 'audio/pcm', rate: 24000 },
          transcription: { model: 'gpt-4o-mini-transcribe', language: 'en' },
          turn_detection: { type: 'server_vad', threshold: 0.5, prefix_padding_ms: 300, silence_duration_ms: 500,
                            idle_timeout_ms: 8000, create_response: true, interrupt_response: true },
          noise_reduction: { type: 'near_field' },
        },
        output: { voice: 'marin', speed: 1.0 },
      },
      output_modalities: ['audio'],
      tools: [{ type: 'function', name: 'get_weather', description: '...',
                parameters: { type: 'object', properties: { city: { type: 'string' } }, required: ['city'], additionalProperties: false } }],
      tool_choice: 'auto', max_output_tokens: 'inf', truncation: 'auto', tracing: null,
    },
  }),
});
const { value, expires_at, session } = await r.json();      // value: 'ek_...', expires_at: unix seconds
return Response.json({ value, expires_at });                // browser: session.connect({ apiKey: value })
```

Verified live (HTTP 200): the response echoes the effective `session` (`id: 'sess_…'`, `object: 'realtime.session'`,
plus defaults `format`, `include: null`, `prompt: null`). Function tool JSON shape is
`{ type: 'function', name, description, parameters }` (the SDK strips `strict` when it sends tools).

Who sets what:
- **Server only**: `expires_after`, the `model` (client cannot change it), hosted-MCP `authorization`/`headers`,
  anything you do not want a modified client to change (the key is bound to this `session`).
- **Client overrides on connect**: the SDK sends `session.update` as soon as the data channel opens with the
  agent's `instructions`, `tools`, `voice`, `output_modalities`, `audio.input.*` and `audio.output.*` (its own
  defaults if you did not set `config`), `tool_choice`, `tracing`. So server-minted instructions/tools/VAD/
  transcription are **replaced** by the client config — mirror them in `config` or keep the mint minimal.
- The browser SDK then POSTs the SDP offer to `https://api.openai.com/v1/realtime/calls`
  (`Authorization: Bearer ek_…`, `Content-Type: application/sdp`), data channel `oai-events`, call id from the
  `Location` header. Old `/v1/realtime/sessions` + `client_secret.value` is the beta flow; do not use it.

## 8. Models and voices (this account, 2026-09-26)

`GET /v1/models` filtered on `realtime|transcribe`:

- Realtime: `gpt-realtime`, `gpt-realtime-2025-08-28`, `gpt-realtime-1.5`, `gpt-realtime-2`, `gpt-realtime-2.1`,
  `gpt-realtime-2.1-mini`, `gpt-realtime-mini`, `gpt-realtime-mini-2025-12-15`, `gpt-realtime-translate`,
  `gpt-realtime-whisper`. No `gpt-4o-realtime-preview*` ids are listed.
- Transcription: `gpt-4o-mini-transcribe` (+`-2025-03-20`, `-2025-12-15`), `gpt-4o-transcribe`,
  `gpt-4o-transcribe-diarize`, `gpt-live-transcribe`, `gpt-transcribe`, `gpt-realtime-whisper`
  (`whisper-1` is not matched by the filter; the API still accepts it as a transcription model).
- SDK `OpenAIRealtimeModels` union includes all of the above realtime ids; default is `gpt-realtime-2.1`.
- `audio.input.transcription.model` union (SDK + openai 7.23): `gpt-transcribe`, `gpt-live-transcribe`,
  `gpt-4o-transcribe`, `gpt-4o-mini-transcribe`, `gpt-4o-mini-transcribe-2025-12-15`, `gpt-4o-transcribe-diarize`,
  `gpt-realtime-whisper`, `whisper-1`.
- Voices (`audio.output.voice`): `alloy`, `ash`, `ballad`, `coral`, `echo`, `sage`, `shimmer`, `verse`, `marin`,
  `cedar`. OpenAI: "For best quality, we recommend using `marin` or `cedar`." The API reference sample shows `alloy` when unset.

## 9. Gotchas

1. Browser + WebRTC needs an `ek_` key; a `sk-` key throws unless `useInsecureApiKey: true` (do not).
2. Set the same `model` in the mint and in `new RealtimeSession(agent, { model })` — the SDK sends `model` in
   its first `session.update` and the model cannot change mid-session (SDK default is `gpt-realtime-2.1`).
3. The client's connect-time `session.update` overwrites server-minted instructions/tools/VAD/transcription.
4. `audio`, `audio_start`, `audio_interrupted` do not fire on WebRTC; use `output_audio_buffer.started/stopped`,
   `input_audio_buffer.speech_started` and an `AnalyserNode` on `audioElement.srcObject` instead.
5. `transport.updateSessionConfig(partial)` re-applies SDK defaults; use `updateAgent()` or a raw `session.update`.
6. `idleTimeoutMs` only works with `server_vad`; `semantic_vad` ignores `threshold/prefixPaddingMs/silenceDurationMs`.
7. User transcript is asynchronous — it can land after the assistant already started answering; history snapshots
   inside tools may miss it.
8. Function tools execute in the browser; call your backend from `execute` for anything privileged. The model
   is blocked while a tool runs or awaits approval; use `backgroundResult()` when you do not want a response.
9. Tool and handoff names must be unique (throws), and `voice` changes fail after the first audio output.
10. Pass your own `mediaStream` if you need the mic after `close()`; the SDK stops only the tracks it opened.
11. A session is capped at 60 minutes; ephemeral keys default to 10 minutes (max 2 h) but only gate connecting.
12. `historyStoreAudio: true` keeps base64 audio for every item in memory — leave it off for long calls.
