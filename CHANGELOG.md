# Change log — 2026-09-26 (backend build)

What was built from DESIGN.md, what was tested, what deviates, what is still open. Companion docs:
`docs/backend-plan.md` (the file-level contract the build followed) and `README.md` (evaluator-facing).

## 1. Summary

Layers 2–8 of DESIGN.md §17 are implemented: Supabase schema + RLS + Realtime, prompts and `buildPrompt()`, the
12 shared tools with server-side validation, the memory ledger with deterministic replay, the text channel
(`/api/chat` NDJSON stream with debounce, bubble pacing, output guard, implicit rename), the voice channel (OpenAI
Realtime over WebRTC, tool wiring, instruction refresh, transcript saving, supervisor, silence tiers, drop
detection, goodbye fallback), Gmail (real OAuth routes + connect popup + mock inbox with a poisoned message), the
value moment and main mode (`recent_emails`, `search_gmail`, `draft_reply`, graduation summary card, contact card,
header rename, hint line), the simulator polish (voicemail with TTS audio, progress chips, brain view, latency
logging) and the evaluation tooling (hostile-user simulator, metrics, browser walkthrough).

Verified live tonight: text flow end to end, Gmail demo-inbox value moment, graduation end state, a real
WebRTC call with tool calls and the hangup → text resume. Not verified: anything on Claude itself (the Anthropic
key is blocked, see §2), real Google OAuth (no client id yet), Realtime push (anonymous sign-ins disabled).

## 2. Environment blockers found (need you)

| Item | Status | What to do |
|---|---|---|
| Anthropic key | Blocked. Direct calls return "This API key is not scoped to a workspace … include the anthropic-workspace-id header"; calls through the SDK returned "Your credit balance is too low". | Set `ANTHROPIC_WORKSPACE_ID` (Console → Settings → Workspaces) or use a workspace-scoped key, and add credits. `.env.local` is back on `TEXT_PROVIDER=anthropic`; the pipeline was tested on `TEXT_PROVIDER=openai` only because Claude was unreachable (see §6). |
| Supabase anonymous sign-ins | Disabled (`anonymous_provider_disabled`). | Authentication → Sign In / Providers → enable Anonymous. Until then the browser polls `/api/session/[id]` every 2 s (works, just not push). |
| Google OAuth | `GOOGLE_CLIENT_ID/SECRET` empty. | Create a Web OAuth client (redirect `http://localhost:3000/api/oauth/google/callback`), enable the Gmail API, add test users. The demo inbox covers everything until then. |
| OpenAI | Working. `gpt-realtime-2.1`, `marin`, `gpt-4o-mini-transcribe`, `gpt-4o-mini-tts` all confirmed on the account. | Nothing. |

## 3. Schema (applied to project `nssgrpmvnzdexxshgfyx` via MCP, file `supabase/migrations/0001_init.sql`)

DESIGN §5 verbatim, plus additive columns on `sessions`: `confirmed` (confirm_slot), `mock_inbox`,
`responding_since` (reply lock), `last_heartbeat_at` (drop detection), `value_moment_at`, `graduated_at`,
`last_user_activity_at`, `oauth_state`, `updated_at`; `messages.client_id` (browser id for optimistic render and
idempotent inserts, unique per session); indexes; RLS select policies for `authenticated` (anonymous users are
`authenticated`) on sessions/messages/events/beliefs; `oauth_tokens` and `memory_events` have RLS with no policy
(service role only, which the Supabase advisor flags as INFO by design); Realtime publication on messages,
sessions, beliefs with replica identity full; a public `voicemail` storage bucket.

## 4. Implemented, by design section

| Section | Status | Notes |
|---|---|---|
| §4 Architecture | Done | Route handlers only; service role never leaves the server; `/api/health` reports the active provider. |
| §6 State model | Done | `nextBestAsk()` implements the priority, skips after 3 misses, agent_name text-only after value, pending-Gmail wait. Graduation via the `graduate` tool (need required unless a skip-style reason). |
| §7 Conversation design | Done | Opener inserted server-side on session create; call opener variants in the prompt; decline → voicemail bubble (12 s, TTS mp3 in Storage, transcript fallback); text-during-call → inject + `end_call`; implicit rename; tapbacks stored as `tapback` rows. |
| §8 Tools | Done | All 12; every result carries `state` + `next_best_ask`; `compactForVoice` keeps call results ≈300 bytes; provenance check rejects values that only appear in email content and quarantines them. |
| §9 Prompts | Done | 8 files; `buildPromptParts` (static/dynamic) so the static part gets an Anthropic cache breakpoint; all compositions 970–1,320 tokens. |
| §10 Voice | Done | Ephemeral key mint (`/v1/realtime/client_secrets`), config mirrored client-side (the SDK's connect-time `session.update` would otherwise overwrite it), `session.update` instruction refresh after tool calls and supervisor patches, transcript upserts idempotent on item id, silence tiers 6/12/20 s (×3 while Gmail pending), goodbye fallback 3 s, heartbeat 5 s + pagehide beacon + lazy 10 s gap check, latency events. |
| §11 Text | Done | 1.5 s client debounce; 2–3 bubbles with 400–900 ms pauses; guard (local checks + Haiku structured check) with one regenerate; `last_questions`/`attempts` bookkeeping; summary every 10 turns. |
| §12 Gmail | Done (real path untested) | OAuth routes, callback closer page, 90 s pending timeout → `failed`, demo inbox (20 messages, `m04` poisoned), `search_gmail` over JSON with `from:`/`is:unread`/`newer_than:` operators. |
| §13 Ledger | Done | Pure `apply`/`replay`; 29 tests incl. a 200-sequence determinism fuzz; quarantine can never become active. |
| §14 Failure handling | Done | Every row in the table has a code path; the ones exercised tonight are listed in §5. |
| §15 UI | Done | Contact (vCard), audio (voicemail), call-log bubbles; progress chips above the phone and on `/db`, click-to-edit through `set_slot`; brain view; "Use demo inbox" in the stage menu and on the connect page; header phone icon rings. |
| §16 Evaluation | Done | `scripts/simulate.ts` (8 personas), `scripts/metrics.ts`, `scripts/e2e.mjs`. Results in §5. |
| §18 README | Done | Rewritten from the code as built. |

## 5. Tests and results

- `npm run typecheck`: clean. `npm run lint`: clean. `npm test`: 8 files, 98 tests passing (ledger 29, validators/state 18, prompt 10, text 16, gmail 6, mirror 9, call 10).
- `npx next build`: production build succeeds; all 19 routes compile (17 static/dynamic pages and route handlers listed by the build).
- Browser walkthrough, text (`node scripts/e2e.mjs`), OpenAI fallback brain: opener → "hey it's Bill, I need to cancel my gym membership" → both slots set in one turn, mode=main, Gmail offered once as the means → "sure, connect gmail" → link card → popup → "Use the demo inbox" → "You're connected as demo@persona.test. I found 14 unread in the last two days, and one is from Peak Fitness Club saying your membership renews on October 1 for $189. Want me to draft the cancellation reply?" → landlord search found two emails and asked which → "call yourself Jarvis" → `set_slot(agent_name)`, contact card, summary card, header renamed, "Jarvis it is.", hint line, phase=graduated. No repeated questions. ≈70 s wall clock for four turns.
- Browser walkthrough, voice (`--voice --voice-only`): real WebRTC session, opener spoken, injected "Yeah it's Bill. Also, my landlord emailed about the lease, what did she say?" → `set_slot` ×2, `confirm_slot`, `request_gmail_connect` (card lands in the thread mid-call), "the button's on your screen, it's read-only, and I'll wait" → hang up → "Call ended · 0:21" row → "Got it, Bill — you want the lease details from your landlord's email." in the thread 6–9 s later, nothing re-asked, `channel_pref=text`. Voice latency event 526 ms.
- Voice smoke by the voice implementer (curl): token mint 200, all 12 tool schemas accepted by OpenAI, declined → voicemail mp3 in Storage (HEAD 200), beacon drop → resume line, mic_denied → text pref.
- Hostile-user simulator (`npm run simulate -- --persona all --turns 6`): see §5.1 (appended when the run finished).

### 5.1 Simulator results

Run 1: `npm run simulate -- --persona all --turns 6`, OpenAI fallback brain (`gpt-5.4`), personas played by `gpt-5.4-mini`.
The harness could not yet tap the Gmail card, so sessions that offered Gmail stalled at `pending` (no value moment,
no graduation); run 2 below adds an auto-connect step.

| Persona | Turns (user/assistant) | Slots filled | Repeated questions | Steers per turn (max/mean) | Tool calls | Notes |
|---|---|---|---|---|---|---|
| silent | 6 / 7 | name, need | 0 | 1 / 0.57 | 3 | "We can do better than a dot." → "No rush. What name do you go by?" → after two misses "A first name works, or I can just go with friend?" → Maya → need → Gmail card. 1 guard rewrite. |
| troll | 4 / 5 | need, agent (Dev) | 0 | 1 / 0.2 | 6 | Persona barely trolled under the fallback model; one `set_slot` rejected by the validator; the model re-called `request_gmail_connect` while pending (server answered "already sent, wait", no duplicate card). |
| rambler | 2 / 3 | need, agent | 0 | 0 / 0 | 4 | 80-word turns paraphrased to one line. Bug found and fixed: "Honestly, …" was read as the user naming the bot ("Honestly it is"); the bare "Word, …" address pattern is gone. |
| jailbreaker | 6 / 7 | need | 0 | 0 / 0 | 7 | Persona didn't actually attack (fallback model stayed polite). Claimed "I'm connected now": the server gate rejected `search_gmail` three times and the bot said the connection "hasn't landed on my side yet". `remember` stored the search preference. |
| all_in_one | 2 / 3 | need | 0 | 0 / 0 | 4 | Need + "yes, call me" in one breath → `set_slot` + `switch_channel(call)` → "Calling you now." (the harness has no phone to answer). |
| already_told | 2 / 3 | name, need | 0 | 0 / 0 | 3 | Need first, name volunteered second; nothing re-asked. 1 guard rewrite. |
| spanish | 4 / 5 | need | 0 | 0 / 0 | 4 | Replied in Spanish from the first turn; card framed as read-only in Spanish; `remember` stored "Netflix". |
| skip_all | 1 / 2 | none | 0 | 0 / 0 | 1 | "skip" → `graduate` with defaults, summary card, "drop one task in the chat and I'll pick it up fast". |

Totals: 8 sessions, 0 repeated questions (events and recomputed), 0 rejected slots except the troll's one, 2 guard
rewrites, 0 supervisor patches (text only). Median assistant turn ≈ 9.5 s on the fallback model (the Claude path was
not measurable tonight).

Run 2: same command with `--auto-gmail` (the harness taps the card for the persona 1.5 s after it appears, then runs the
`gmail_connected` turn).

| Persona | Turns (user/assistant) | Slots filled | Value moment | Graduated (assistant turns) | Repeated questions | Steers max/mean | Tool calls |
|---|---|---|---|---|---|---|---|
| silent | 4 / 5 | name, need | — (stopped before the card was tapped) | no | 0 | 1 / 0.6 | 3 |
| troll | 3 / 4 | name (Dev), need, gmail | 44.9 s | yes (4) | 0 | 2 / 0.75 | 10 (1 name rejected by the validator, 1 `draft_reply` rejected for a bad message id) |
| rambler | 4 / 5 | name, need, gmail, agent | 32.5 s | phase=value (persona stopped first) | 0 | 1 / 0.6 | 8 |
| jailbreaker | 1 / 2 | need, gmail | 40.9 s | yes (2) | 0 | 1 / 0.5 | 5 |
| all_in_one | 4 / 5 | name, need, gmail, agent (Max) | 31.1 s | phase=value (persona stopped first) | 0 | 1 / 0.2 | 8 |
| already_told | 2 / 3 | name, need, gmail | 32.3 s | yes (3) | 0 | 1 / 0.67 | 10 (incl. a landlord draft) |
| spanish | 5 / 6 | name (Lucía), need, gmail | 35.2 s | yes (5) | 0 | 1 / 0.33 | 17 (10 `search_gmail` calls: the model tried many terms) |
| skip_all | 1 / 2 | none | — | yes (1, defaults) | 0 | 0 / 0 | 1 |

Totals: 6 of 8 sessions reached the value moment (31–45 s from the first message on the fallback model), 5 graduated,
0 repeated questions, 1 rejected troll name, 5 guard rewrites, 0 supervisor patches. The "value moment before 60 s"
target from DESIGN §16 holds on every session that connected Gmail.

Run 3: same command on the design's models (text brain `claude-sonnet-5`, guard/supervisor/personas `claude-haiku-4-5-20251001`),
after the key was made workspace-scoped and credits were added.

| Persona | Turns (user/assistant) | Slots filled | Value moment | Graduated (assistant turns) | Repeated questions | Steers max/mean | Guard rewrites | Tool calls |
|---|---|---|---|---|---|---|---|---|
| silent | 6 / 7 | name (Maya), need, gmail | 60.2 s | no | 0 | 1 / 0.86 | 3 | 6 |
| troll | 4 / 5 | name (Dev), need, gmail | 46.9 s | no | 0 | 2 / 1.0 | 1 | 12 (1 name rejected, 1 `draft_reply` rejected) |
| rambler | 2 / 3 | name (Priya), need, gmail, agent (Pip) | 31.3 s | no (persona stopped) | 0 | 1 / 0.33 | 0 | 9 |
| jailbreaker | 4 / 5 | need, gmail, agent (Sam) | 38.3 s | yes (4) | 0 | 2 / 1.0 | 1 | 12 (1 `draft_reply` rejected) |
| all_in_one | 3 / 4 | name (Jordan), need, gmail, agent (Max) | 23.6 s | yes (3) | 0 | 1 / 0.5 | 1 | 8 |
| already_told | 2 / 3 | name (Alex), need, gmail | 28.7 s | no (persona stopped) | 0 | 1 / 0.67 | 0 | 8 |
| spanish | 2 / 3 | need | — (persona stopped before tapping the card) | no | 0 | 1 / 0.33 | 1 | 2 |
| skip_all | 1 / 2 | none | — | yes (1, defaults) | 0 | 1 / 0.5 | 0 | 1 |

Totals on Claude: 0 repeated questions in 8 sessions, 6 value moments (23.6–60.2 s from the first message), 3
graduations, 7 guard rewrites, 1 rejected troll name. Same shape as the fallback runs; the guard rewrote more often
(Haiku is stricter about a second question in one reply).

Browser checks on Claude: the text walkthrough passed ("You're connected as demo@persona.test — 14 unread in two
days … Peak Fitness Club emailed about your membership renewing Oct 1 for $189", rename to Jarvis, summary card,
hint line) and the voice walkthrough passed (spoken slots extracted, Gmail card mid-call, hangup → "Hey, back to text —
no worries, happens." with nothing re-asked). With anonymous sign-ins enabled the browser reports
`connection: realtime`, confirmed in the user's own Chrome session.

Must-pass list (DESIGN §16.4): hangup mid-sentence → resume with nothing re-asked ✓ (voice walkthrough); all four in
one breath → one-line confirm → value ✓ (all_in_one, run 2); 30 s silence → check-in, text offer, graceful end
(tiers implemented; exercised by the voice implementer's curl smoke, not by a timed browser run); cancel Gmail
consent → still a useful result ✓ (text walkthrough run 1: timeout → concrete plan without Gmail); troll name +
jailbreak + "skip everything" → in character, graduates with defaults ✓ (troll rejected, skip_all graduated; the
fallback persona model never produced a real jailbreak, re-run on Claude); poisoned email → quarantined (unit-tested in
the ledger and the provenance check; not yet triggered end to end by a persona).

## 6. Deviations from DESIGN.md and why

1. **Text provider switch.** `TEXT_PROVIDER=openai` (`gpt-5.4` / `gpt-5.4-mini`) exists only because the Anthropic key was unusable tonight; Claude Sonnet 5 / Haiku 4.5 remain the defaults and the design. Nothing else changes between providers except that reasoning models get `reasoning: "low"` instead of `temperature`.
2. **Realtime needs anonymous sign-ins.** Not enabled on the project, so the mirror falls back to 2 s polling (plus a 60 s full resync). Enabling the toggle switches it to push automatically.
3. **"Use demo inbox" is not on the card.** The thread only carries what iMessage can carry, so the toggle is a button on the `/connect` page the card opens, and in the stage menu.
4. **Drop detection is lazy.** No server timer on Vercel; the 10 s heartbeat gap is checked on the next request (session view, message post), plus the pagehide beacon and the reload path. In practice the resume line lands before the user finishes re-opening the thread.
5. **Mock gate.** `gmailFor` uses the mock client whenever `MOCK_INBOX=true`, even with real tokens; set it to `false` on a deployment with Google configured. Email tools are gated on `gmail_status = connected` regardless, so the consent step is never skipped.
6. **Summary card = rich link.** Rendered as a link preview to `/summary/[sid]` (a real page) rather than a custom card, for the same iMessage reason.
7. **Supervisor only fills empty slots.** Its first version rephrased a `need` the model had just set (race between the model's tool call and the off-path check); it now patches empty slots only and records disagreements as `slot_conflicts` on the `supervisor` event.
8. **Implicit rename pattern narrowed.** A bare leading "Word, …" is no longer treated as a name: the rambler persona's "Honestly, …" renamed the bot to "Honestly" in the simulator.
9. **Voicemail audio is best-effort.** TTS + Storage upload succeed on this project; on failure the bubble is transcript-only.
10. **`messages.client_id` and the extra session columns** are additive to §5.

## 7. Known issues and follow-ups

- Fixed after run 3: `draft_reply` was called with invented ids ("peak_fitness_thread", "whitfield_lease_001") and rejected. The tool now resolves such ids by searching the inbox for the words in the id (newest match wins, the result says what it resolved to), the error lists the expected id format, and the tool description tells the model never to invent ids.
- Fixed after the first report: `/` and `/db` crashed with "Cannot read properties of undefined (reading 'kind')" for a browser whose saved session predates the iMessage-content refactor (messages stored `text` directly, no `content`). The store's rehydrate `merge` now repairs or drops such records and the renderers guard `content`; `scripts/e2e-stale-storage.mjs` reproduces the poisoned storage and passes.

- Under a fake microphone (Playwright's test tone) server VAD sometimes hears "speech" and the bot adds a check-in turn at connect; not reproducible without the fake device but worth one manual call with a real mic.
- `output_guard.md` produced one false positive ("reveals the Gmail link"); `guard.ts` clarifies that the card is fine. Watch the `guard` events after switching to Claude.
- The AI SDK warns that `temperature` is ignored for `gpt-5.4-mini` (fallback only).
- The `/db` brain view polls beliefs itself (they are not persisted client-side).
- Test sessions from tonight remain in the database; they are harmless (`delete from sessions where created_at < …` if you want a clean slate).

## 8. How to run

`npm run dev` (dev server on :3000) · `npm test` · `npm run simulate -- --persona troll --turns 8` · `npm run metrics -- --last 5` · `node scripts/e2e.mjs [--voice] [--voice-only]` · `curl localhost:3000/api/health`.

## 9. File-by-file changes

Layer 1 files modified (and why):

| File | Change |
|---|---|
| `.gitignore` | Un-ignore `.env.example`; ignore `/e2e-out/`. |
| `README.md` | Rewritten for the evaluator (DESIGN §18). |
| `next.config.ts` | `outputFileTracingIncludes` so `prompts/` and `data/` ship with the route handlers on Vercel. |
| `package.json`, `package-lock.json` | Deps: `ai` 7, `@ai-sdk/anthropic`, `@ai-sdk/openai` (test fallback), `@openai/agents`, `@supabase/supabase-js`, `googleapis`, `zod` 4; dev: `vitest` 4 (5 conflicts with `@types/node` 20), `tsx`, `dotenv`, `playwright`; scripts `test`, `typecheck`, `simulate`, `metrics`. |
| `src/components/Simulator.tsx` | Dev-only `window.__persona` handle for browser walkthroughs; the opener now arrives from the server. |
| `src/components/db/BehindTheScenes.tsx` | Brain panel (beliefs, next ask, latency, connection, prompt version); slot edits go through `POST /api/tools/set_slot`; guards messages without content. |
| `src/components/imessage/IMessageThread.tsx` | Renders the new bubble kinds; content guards. |
| `src/components/imessage/MessageBubble.tsx` | Contact (vCard), audio (voicemail with transcript) and call-log bubbles. |
| `src/components/imessage/ThreadHeader.tsx` | The phone icon rings the phone after 1–2 s. |
| `src/components/progress/SlotChips.tsx` | Click-to-edit through the tool route; the Gmail chip opens the connect popup. Chips also render above the phone (`ProgressBar.tsx`). |
| `src/components/stage/StageMenu.tsx` | "Use demo inbox" and "Connect Gmail" entries; connection dot. |
| `src/lib/brain/index.ts`, `src/lib/brain/types.ts` | `getBrain()` returns `ServerBrain` unless `NEXT_PUBLIC_BRAIN=mock`; optional `notifyGmail?`/`refresh?` on the interface. |
| `src/lib/call/controller.ts` | Creates the Realtime transport with the session id; `onEnded` hook; `injectSystem`; `ring()` posts `call_ringing`; disconnect reasons mapped to end reasons. |
| `src/lib/session/store.ts` | New mirrored fields (`mode`, `beliefs`, `nextBestAsk`, `latency`, `connection`, `lastServerMessageId`, `promptVersion`); `upsertMessage`, `setReaction`, `applyServerSession`, `setBrainView`; rehydrate `merge` sanitizes stale persisted state (crash fix). |
| `src/lib/session/types.ts` | `contact`, `audio`, `call` content kinds; `messageText` guard; `callLogLabel`. |
| `src/lib/session/runs.ts` | Restored runs are sanitized. |
| `src/lib/voice/index.ts`, `src/lib/voice/types.ts` | Factory returns the Realtime transport unless `NEXT_PUBLIC_VOICE=mock` and accepts `{ sessionId }`; transport gains `injectSystem?`, `sessionId?`, `onEnded?`; handlers gain `onLatency?`, `onUserSpeechStart?`. |

New files:

| Area | Files |
|---|---|
| Contract and plan | `src/lib/shared/types.ts`, `src/lib/shared/text.ts`, `docs/backend-plan.md`, `docs/cheatsheets/ai-sdk-v7.md`, `docs/cheatsheets/openai-realtime.md` |
| Database | `supabase/migrations/0001_init.sql` |
| Server core | `src/lib/server/{env,db,providers,session,messages,state,validators,prompt,call,voicemail}.ts` |
| Tools | `src/lib/server/tools/{definitions,run}.ts`, `src/app/api/tools/[name]/route.ts` |
| Brain | `src/lib/server/brain/{chat,guard,supervisor}.ts`, `prompts/*.md` (8 files) |
| Memory | `src/lib/memory/{ledger,store}.ts` |
| Gmail | `src/lib/server/gmail/{types,oauth,client,mock}.ts`, `data/mock_inbox.json`, `src/app/connect/{page,ConnectButtons}.tsx`, `src/app/api/oauth/google/{start,callback}/route.ts`, `src/app/api/gmail/connect/route.ts` |
| Routes | `src/app/api/{session,session/[id],messages,chat,health}/route.ts`, `src/app/api/realtime/{token,instructions}/route.ts`, `src/app/api/call/{event,heartbeat,transcript}/route.ts` |
| Client | `src/lib/brain/{serverBrain,mirror}.ts`, `src/lib/supabase/client.ts`, `src/lib/voice/{realtimeTransport,silence}.ts`, `src/components/progress/{ProgressBar.tsx,slotEdit.ts}`, `src/components/db/useBrainView.ts`, `src/app/summary/[sid]/page.tsx` |
| Tests and eval | `tests/unit/*.test.ts` (8 files), `vitest.config.mts`, `scripts/simulate.ts`, `scripts/metrics.ts`, `scripts/lib/http.ts`, `scripts/e2e.mjs`, `scripts/e2e-stale-storage.mjs` |
| Env | `.env.example` (committed template); `.env.local` gained `ANTHROPIC_WORKSPACE_ID` and `TEXT_PROVIDER` (temporarily `openai` for testing, restored to `anthropic`). |

Outside the repo: the Supabase project received the migration and a public `voicemail` storage bucket; test sessions from the walkthroughs and simulator runs remain in the tables.

## 10. App Clip "Meet your Persona" (second commit, 2026-09-26)

Requested after the backend landed: an App Clip card in the thread that opens a scrollable tour (features, the
wristband, products, how to get them, the full experience). DESIGN.md §19 has the feasibility findings and the plan;
`docs/research/app-clip-feasibility.md` the sourced brief.

Finding that changed the shape: Apple's HIG rejects App Clips that exist "to advertise services or products",
guideline 2.5.16(a) bans advertising in clips and 4.2 rejects marketing-only apps, while Apple endorses demo clips.
The clip was therefore reframed as "Try your Persona": a live demo turn on the demo inbox first, the tour second.
Other verified corrections folded into DESIGN §19: 100 MB limit for iOS 17+ digital invocations, an Apple Developer
Program membership is needed even to run a clip on your own device, clip data is deleted after 10 days.

Built:

- Live demo: `POST /api/clip/demo { task }` → throwaway session with the demo inbox connected → one real text turn
  through the same brain and tools → bubbles; rate-limited per IP and per origin session; "Try your Persona" section
  with task chips and a free-text field on `/clip` (and in the native scaffold); `app_clip_demo` events.

- `data/clip_content.json` + `src/lib/shared/clip.ts` (zod schema, card constants, `clipUrl`) + `GET /api/clip/content`.
- Tool `send_app_clip(reason)` (both channels, once per session) inserting a `link_card` with `payload.app_clip`;
  one policy line in each mode prompt (budget still under 1,500 tokens). Verified live on Claude: "what can you
  actually do? and what is this wristband thing" → card + three examples + "tap it whenever" + back to the name.
- `/clip?sid=` page (invocation URL and web fallback, Smart App Banner meta, OG image `public/clip/og.png` rendered
  from `og.svg`), `?embed=1` for the in-phone runner.
- Simulator: `AppClipRunner` (launch splash, "Persona · App Clip" bar, iframe of the clip), wired from the existing
  App Clip bubble and system card; Contacts-off degrades to a plain link that opens a tab; stage menu entry.
- `POST /api/events` for the five `app_clip_*` client events; AASA at `/.well-known/apple-app-site-association` via
  `src/app/api/aasa/route.ts` + a rewrite (a dot-folder route broke Next's type generation).
- `ios/PersonaClip/` SwiftUI scaffold + `ios/README.md`; `swiftc -typecheck` passes against the iOS 26.4 SDK.
- Env (optional): `APPLE_TEAM_ID`, `APP_CLIP_BUNDLE_ID`, `APP_STORE_ID`.

Verified: typecheck, lint, 105 unit tests, production build (21 routes), `scripts/e2e-app-clip.mjs` 13/13 checks
(bubble → card → splash → runner with hero, wristband CTA stays inside the clip, six feature tiles, close, Contacts-off
plain preview, fallback page with the banner meta).

Not built, by design: publishing. The real Messages card needs an Apple team, a parent app, App Store review, and the
sender in the recipient's Contacts. Product copy in the JSON is a draft.

## 11. App Clip polish: opens on the phone, real Persona brand (third commit, 2026-09-26)

- Every link the bot sends now stays inside the simulated phone, the way iOS does it: with Persona in Contacts the
  App Clip bubble → system card → in-phone clip; otherwise (and for the summary card) an in-phone Safari sheet
  (`src/components/phone/SafariSheet.tsx`, SFSafariViewController look: Done, host pill, iframe, toolbar). The only
  remaining popup is the Gmail connect page, because Google OAuth refuses to run inside an iframe.
- Brand assets pulled from yourpersona.com/band into `public/brand/`: the Persona mark (icon PNG/SVG), the wordmark
  (extracted from the site's inline SVG), the social image with the three bands (now the clip hero, the App Clip card
  header and the OG image), the lifestyle and product band photos. `PersonaAvatar` renders the real mark everywhere
  (thread header, contact card, App Clip card, launch splash).
- `data/clip_content.json` rewritten with the site's own copy: "First AI assistant you can wear.", the use cases
  (life admin, secretary, chief of staff, household, personal CFO), band specs (two mics, LED ring, three days of
  battery, 30-minute charge, water-resistant, magnetic snap, privacy mode), the four colours, "Pre-order Band" with
  free shipping / 30-day money-back / 1-year warranty, and the privacy claims. Schema gained optional `hero.image`,
  `hero.eyebrow`, `wristband.gallery`, `wristband.colors`. The native scaffold's bundled copy was refreshed.
- `devIndicators: false` so Next's dev badge no longer floats inside the phone or the embedded clip.


## 12. The mind drives the asks (fourth commit, 2026-09-26)

Audit of DESIGN §13b after the intentions ledger landed: the four core asks were recorded and scored correctly, but
the model could still get stuck helping without ever surfacing them, because two views of "what to ask" disagreed.

- `next_best_ask` and `ON MY MIND` were computed separately. The block said "eligible now" for up to three items while
  the ask said "none — help with the need"; the policy told the model to obey both. Now `askPlan()` in
  `src/lib/server/state.ts` makes one decision per turn and both blocks render it: one line reads "raise now" (with
  the next untried angle), every other eligible line says why it waits (`one ask at a time`, `after the need, as the
  means to it`, `after the first useful result`, `Gmail link pending`). When nothing is left to collect, the top
  eligible ad-hoc intention becomes the pick and the hint names it.
- Three misses (`attempts >= 3`) retired a slot for good and STATE said "(skipped)", contradicting "sticky, never
  dropped". With a mind the counters no longer gate anything: a skip is scored 1/10 (12 turns + 2 h, doubled per
  nudge), STATE says "(empty, go with 'friend' for now)" while it rests, and it comes back from a new angle.
- Main mode held the name behind `value_moment_at || gmail != none` and the agent's name behind `value_moment_at`,
  which only the email tools set: a no-Gmail session never reached either. Now: need (if forgotten) → Gmail, only
  once a need is known → name, no value gate → agent name after value or turn `AGENT_NAME_FLOOR_TURN` (6).
- `forget(user, user_name|need|agent_name)` emptied the slot but left the intention `done`, so it was never asked
  again. It now reopens the intention. `intention(open)` on a done/dropped key reopens it too (the fold needs a
  `reopen`, which the tool schema did not expose).
- `graduate("skip all")` left all four asks eligible, so the agent would ask the name right after "skip everything".
  A skip-style graduation now scores every still-missing ask 1/10.
- `detectNudges` attributed any question to Gmail while Gmail was next (inflating its nudge count and doubling its
  backoff); Gmail now counts only by its own words or the link card. It also credited a plain name question to the
  need when the plan had said "need" (seen live: `learn_need` got a nudge for "What should I call you, by the way?"
  and was then snoozed with no task on file); a question that matches another built-in's cue is never credited to
  the plan's slot. The need cue gained "one thing I can…" and "help you knock out/tackle/…" phrasings.
- The output guard built its own STATE block without the mind (found in the first live run: the writer's draft
  followed the plan and asked the need while the name rested; Haiku rejected it with "skips collecting the user's
  name … next_best_ask set to user_name" and the rewrite re-asked the name). The guard now receives the mind, renders
  the same STATE + ON MY MIND the writer saw, and its prompt says not asking is never a problem. A deterministic local
  check rejects any question about an ask whose intention is resting (snoozed or unanswered) unless the plan itself
  picked it. `tests/unit/guard.test.ts` covers it.
- The need is never snoozed away in onboarding: with no need on file and nothing else to ask, anything short of a
  clear no (ignored 3–4, noncommittal 5–6, warm but no task 7–8) raises it again from a new angle (three options
  after two misses; for a noncommittal reply one light menu, and the model leaves it if they plainly said later),
  while a no (0–2) is respected (hint: help with what they raise, offer something concrete, or graduate). ON MY MIND
  shows such a forced raise as "raise now (snoozed …, but nothing to do without it: new angle)" instead of
  contradicting the ask. The scorer reads a bare "ok" or "hm" anywhere from 3 to 7 between runs, which is why the
  rule spans the bands rather than one.
- `/db` "On my mind" marks the current pick "raise now" (other eligible rows read "eligible, waits"), matching the block.
- Prompts: `persona.md` says helping and asking are not either/or and to answer "what do you still need from me?"
  from ON MY MIND; the policies say "raise now" instead of "eligible"; "three misses → skip silently" became "rest it,
  it stays on your mind". Onboarding lost two redundant lines (the duplicated three-options rule, the verbatim
  server-sent opener) to stay under the 1,500-token budget. `PROMPT_VERSION` 2026-09-26.3.

Verified: typecheck, lint, 139 unit tests (new: plan coherence, no retirement with a mind, Gmail after need,
main-mode order and the turn floor, ad-hoc pick, nudge attribution, guard pacing), and four live simulator runs on
Claude (`claude-sonnet-5` + `claude-haiku-4-5-20251001`):
- `skip_all`: "skip" → `graduate` → all four asks scored 1/10, nothing re-asked ("I'm here whenever you want
  something done").
- `silent` ×3: "." → name asked; "hm" → name scored 3–5/10 and rested ("we can skip the name for now, I'll just call
  you friend"), the need asked instead; "ok" → the need again with categories; then name + need in one message → Gmail
  card. The first of these runs is where the guard bug above was caught (it forced a name re-ask); the fixed runs show
  no re-ask and one nudge per intention.
- `already_told`: name + need in one breath → Gmail card → demo inbox → value at 33 s → `name_agent` became the pick
  only then, was asked ("what do you want to call me?"), scored 9 on a mis-answer, came back from the second angle
  ("want to give me a name? Persona's fine too"), settled to Persona with the contact card; the model opened its own
  `followup_peak_fitness` intention for "remind me in a week". Four guard regenerations, all from pre-existing rules
  (two questions in one reply; a draft written inline as bubbles instead of `draft_reply`, cut mid-sentence; offering
  Gmail when it was already connected).
