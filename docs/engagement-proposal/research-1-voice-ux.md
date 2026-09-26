# Research lens 1: conversational and voice UX craft

Research subagent report, 2026-09-26. Read `DESIGN.md`, `docs/implementation-log.md`, `prompts/persona.md`, `prompts/channel_call.md`, `prompts/channel_text.md`. Everything in DESIGN §7 and §14 treated as built.

Common thread across the prior art: the products that feel alive in the first 60 seconds (Sesame, Hume EVI, Duplex, Pi) win on timing and listening signals, not on personality volume. Most of what follows is timing, echo, and channel choreography; only one idea is about personality, and it is deliberately one line long.

## V1. Instant pickup (pre-rendered greeting) — score 8, cost M

**Experience.** They tap Accept and the bot is already talking, inside ~300 ms: "Hey, it's your Persona." The first 1–2 sentences are a pre-rendered audio clip chosen from STATE (need typed or not, name known or not) and played locally while WebRTC is still negotiating. When Realtime is live, the bot's first generated turn continues from the greeting rather than repeating it (inject a system item: "You already said: '<greeting>'. Continue from there.").

**Why.** The 1–3 s of dead air after Accept is the single worst moment in every WebRTC voice product; it reads as "nobody's there". Outbound-call research puts the decide-to-stay window at the first ~8 s, and reason-first openers beat name/company openers on listen-through (55% → 78% in one set of A/B tests; https://pathors.com/en/blog/ai-voice-outbound-script-guide, https://vida.io/blog/outbound-call-script). Character.ai calls advertise minimal connect latency as the engagement lever (https://blog.character.ai/introducing-character-calls/).

**Prior art.** Bland/Retell users pre-generate first sentences to hide time-to-first-audio (https://futureagi.com/blog/how-to-optimize-retell-latency-2026/, https://dev.to/kenimo49/your-voice-agent-is-slow-here-are-5-tricks-to-hide-it-3pcb). Differs: the clip is selected from shared STATE, so it already continues what was typed, preserving §7.3.

**Build.** `gpt-4o-mini-tts` + Storage exist for voicemail. Pre-render 4 opener variants, cache in Storage; client plays on Accept, then `conversation.item.create` tells the model the greeting is spoken. Suppress a duplicate first response (create the item before the SDK's first `response.create`, or `turn_detection.create_response=false` for the first turn).

**Risk.** Low. Double greeting if the handoff races is a bug, not an exploit.

## V2. Warm hold during the Gmail wait — score 8, cost S

**Experience.** After "Button's on your screen, read-only. I'll wait," the call does not go dead for up to 60 s. The client emits OAuth-popup lifecycle events (popup opened, Google screen loaded, popup closed without callback, callback landed) and the bot responds with one short human line to each: "Take your time." → (popup open 8 s) "If it shows a 'Google hasn't verified this app' screen, that's just testing mode, hit Advanced and continue." → (popup closed, no callback) "No worries, we can do it later, or the demo inbox works too." Between events it says nothing.

**Why.** Duplex added "mm-hmm" specifically for wait states and found conversations were rated more natural (https://research.google/blog/google-duplex-an-ai-system-for-accomplishing-real-world-tasks-over-the-phone/). Fillers matter most under long waits (4 s+). The Gmail wait is the longest silence and the only one that ends in a completion event. The "Advanced → Continue" hint directly attacks the known drop-off in Testing mode (§12.4).

**Prior art.** Duplex hold behaviour; Sesame CSM's variable-timing fillers (https://www.sesame.com/research/crossing_the_uncanny_valley_of_voice). Differs: backchannels are event-driven from the popup, not timer-driven, so they are informative rather than decorative.

**Build.** Client already watches the popup and injects the connected event; add three more injected system hints. Rate-limit to one line per event and three per pending window.

## V3. Say it, then show it (voice value lands in the thread) — score 9, cost S

**Experience.** On a call, when the bot delivers the value moment ("one's from Peak Fitness, renews October 1 for $189"), the same three emails land in the text thread as a compact plain-text bubble at the same moment, and the bot points at it: "It's in the chat if you want to look." Likewise the paraphrased need lands as a one-line note when `set_slot(need)` succeeds on the call. When the call ends, the thread already reads like notes from the call.

**Why.** Voice is ephemeral; a spoken list of three emails is forgotten before the call ends, so the value moment on the call channel does not persist as evidence. Dual-coding (hear + see) makes the observation stick and makes "Watch the chat" (§7.4) literally true. This is the strongest use of the two-channel architecture: voice for rapport, text as the durable notepad.

**Prior art.** Duolingo's Lily calls end with a written recap (https://blog.duolingo.com/ai-and-video-call/); Character.ai emphasises call/text switching. Differs: posting happens during the call, keyed to tool success, not as a post-hoc summary.

**Build.** `/api/tools/recent_emails` and `set_slot` already know `channel`; when `channel = call`, also insert an assistant `messages` row (kind `text`, plain 3-line format). Realtime/polling mirror already renders it.

**Risk.** Render only from/subject/date for the call-time note, never snippet.

## V4. Lexical entrainment: echo their words, not the slot — score 8, cost S

**Experience.** The user says "the gym thing" or "my landlord's being weird about the lease." The bot keeps using their phrase at every later touch: the Gmail ask ("If you connect Gmail I can find the gym thing"), the value moment, the summary card, and the naming beat ("Jarvis it is. Jarvis's first job: the gym thing."). The normalized `need` slot still exists for tooling; a second, verbatim field is what the prompt says aloud.

**Why.** Lexical entrainment is the most reliable rapport signal in dialogue research: people rate partners who adopt their referring expressions as more attentive and cooperative. Pi's perceived warmth comes largely from mirroring the user's framing and returning to it later (https://medium.com/@lindseyliu/what-makes-inflections-pi-a-great-companion-chatbot-8a8bd93dbc43). It turns four separate asks into one continuous thread about one thing.

**Prior art.** Pi; Hume EVI's language mirroring (https://www.hume.ai/empathic-voice-interface). Differs: the echo is a stored fact with provenance (`need_phrase`, source `user_text`/`user_call`), so it survives the hangup and the channel switch.

**Build.** One `memory_events` predicate (`need_phrase`) set by `set_slot(need)` from the raw user span; one STATE line: `say it as: "the gym thing"`. Prompt line in both channel files.

**Risk.** Echoing obscene or injected phrasing. Run the verbatim through the profanity/blocklist; fall back to normalized `need`. Never store a phrase from a supervisor-flagged turn.

## V5. Tempo and length mirroring — score 7, cost S

**Experience.** A terse user ("bill. gym.") gets one bubble and one-sentence voice turns. A chatty user gets the full two or three bubbles. In text, the "Read" receipt appears at the end of the 1.5 s debounce, then the typing indicator starts, and typing duration scales with reply length.

**Why.** Communication Accommodation Theory: matching verbosity is read as respect. The read-receipt-before-typing sequence is native iMessage behaviour and the cheapest presence cue not yet used.

**Build.** Compute `user_tempo: terse|normal|chatty` from mean user turn length; one STATE line; `channel_text.md` gets "terse → one bubble". Client shows "Read <time>" when the debounce fires.

## V6. Name-use budget — score 7, cost S

**Experience.** The bot says the user's name exactly twice on a call: in the sentence after learning it and in the closing line. In text, at most once per five assistant turns.

**Why.** Name repetition is the strongest telemarketer tell; outbound-AI literature reports hang-up rates up to 45% for name-first scripts (https://pathors.com/en/blog/ai-voice-outbound-script-guide). LLMs over-use a name once it is in context; the current prompt has no ceiling.

**Build.** One line in `persona.md`; `guard.ts` counts `user_name` occurrences in the last five assistant turns and triggers the existing regenerate.

## V7. Earned personality reveal on naming — score 7, cost M

**Experience.** Until named, the bot is competent and plain. When `set_slot(agent_name)` succeeds, the server derives a one-line delivery note from the name and the next reply carries exactly one beat of it: "Jarvis" → dry understatement ("Jarvis it is. I'll try to live up to the tuxedo."); "Bob" → plain ("Bob. Good. Bob gets things done."); "Mom" → gently declines the framing. One line of flavour, then back to work.

**Why.** Naming creates psychological ownership (https://www.tandfonline.com/doi/full/10.1080/0960085X.2026.2673990); the IKEA effect. The reveal rewards naming, the only optional slot with the weakest intrinsic motivation. Duolingo's calibration rule: "slightly unpredictable but supportive" (https://blog.duolingo.com/ai-and-video-call/).

**Build.** On `set_slot(agent_name)`, a Haiku structured call returns `{tone_word, first_line}` with hard constraints; store `agent_style` on `sessions`; append one line to the persona block.

**Risk.** The main one. No impersonating named people beyond a tone adjective, no accents, no sexual/romantic or family-role framing, fixed fallback if the generator declines. After two renames, suppress the reveal.

## V8. Gmail as a shared plan, not a permission — score 8, cost S/M

**Experience.** Before the card appears, the bot states the plan in the user's terms: "Here's what I'd look for: anything from Peak Fitness in the last two months, plus anything with 'membership' in the subject. Read-only, and you can pull it any time. Want me to?" Then the card. After connect, the value moment includes the actual query in plain words ("I searched Peak Fitness, last 60 days: two emails"). Declining gets a "not now" tapback.

**Why.** Permission research is consistent: grant rates rise when the request is user-triggered, explains a specific personal benefit, and is primed before the system dialog (https://www.useronboard.com/onboarding-ux-patterns/permission-priming/, https://www.w3.org/Privacy/permissions-ws-2022/report, https://github.com/WICG/PEPC/blob/main/explainer.md). This converts "trust me" into "check me."

**Prior art.** Auth0's consent-management guidance (https://auth0.com/blog/the-art-of-user-consent-management-oauth/). Differs: the "scope" is a natural-language search plan derived from the need, and the receipt is the executed query.

**Build.** Prompt lines in both channels; `search_gmail`/`recent_emails` already return the query. Tapback "not now" → `set_slot(gmail, declined)`.

**Risk.** User dictates a malicious search string; paraphrase the plan, never execute arbitrary operators verbatim.

## V9. Phase-aware delivery and spoken lead-ins — score 7, cost S

**Experience.** The voice changes gear with the phase. Warm-up: unhurried, playful. Collecting: brisk, short. The instant Gmail connects: a spoken lead-in before the tool call ("Okay, let me look.") then a slower, more deliberate observation. Interrupted mid-sentence, the next turn opens with "Go ahead." rather than resuming.

**Why.** Hume's core claim is that matching prosody to the moment makes voice feel attentive; named fillers ("let me look") improve perceived response time more than generic ones, largest when the wait is long (https://arxiv.org/pdf/2603.21682, https://arxiv.org/pdf/2511.07397).

**Build.** `channel_call.md` gets a four-line delivery table keyed on `phase`; lead-in prompt line; yield line conditioned on the truncation event.

## V10. Humor dial with de-escalation — score 7, cost S

**Experience.** Default "a little playful." If the user is playful back, one more beat of wit per turn. If the user trolls, insults, or jailbreaks, the dial goes down to zero: calm, plain, unbothered, still doing the job. Never matches escalation with banter.

**Why.** Duolingo found the failure modes are symmetric and calibration had to be per-user. A bot that gets less funny when attacked is far harder to make say something embarrassing.

**Build.** Supervisor already runs per user turn; add a `humor: 0|1|2` field; one STATE line; two prompt lines. Dial rises again only after two consecutive non-hostile turns.

## Top 3 from this lens

1. **V3 Say it, then show it (9).** The only idea that makes the two-channel architecture visibly better than either channel alone; a one-afternoon change to two tool routes.
2. **V1 Instant pickup (8).** The dead air after Accept is the moment most likely to lose an impatient evaluator; the TTS pipeline exists.
3. **V8 Gmail as a shared plan (8).** The Gmail slot is the completion bottleneck; stating the exact search first and reporting it after is the highest-evidence lever on grant rate.

Honourable mention: V4 (lexical entrainment) is the cheapest change with the largest effect on feeling heard, and pairs with V3.
