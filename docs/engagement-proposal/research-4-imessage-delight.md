# Research lens 4: iMessage-native delight and twists

Research subagent report, 2026-09-26. Read `DESIGN.md`, `docs/implementation-log.md`, `docs/research/imessage-allowed-content.md`, `docs/research/app-clips-in-messages.md`, `src/lib/session/types.ts`, `src/components/imessage/MessageBubble.tsx`. Already built and not re-proposed: decline → voicemail, contact card + header rename, summary card, Gmail link card mid-call, post-Gmail name guess, implicit rename, debounce + paced bubbles, user tapbacks for choices, message effects, call-log rows, progress chips.

Every idea uses only what a regular iMessage sender can carry: text, links, images, audio, contact cards, tapbacks (inbound-only for programmatic senders), effects, typing, read receipts, timing, and iOS 26 polls. Existing seams: `MessageContent` kinds (`text|link|image|contact|audio|call`), `Reaction.by: "assistant"`, `status: "delivered"|"read"` + `readAt`, `BubbleEffect`, the TTS pipeline used for voicemail, `next/og` `ImageResponse`, OpenAI image gen, and the tool bus in DESIGN §8.

## D1. The Receipt (proof-of-work image) — score 9, cost S

**Experience.** Thirty seconds after Gmail connects, a single image bubble lands: a thermal-printer-style receipt, monospaced, slightly crooked. "PERSONA — 26 SEP 11:42 / Scanned: 14 emails (2 days) / Need reply: 3 / From landlord: 1 / Membership renews Oct 1 · $189 / Drafts ready: 1 / YOU OWE: nothing / Thank you, Bill." Torn edge at the bottom. Long-press → Save/Share. At graduation a second receipt summarises the whole onboarding ("Time on the call 0:21 · Questions asked 3 · Questions repeated 0").

**Why.** It converts an abstract claim ("I triaged your inbox") into a glanceable artifact, the same move Wordle made with a spoiler-free, information-dense square people screenshot and forward (https://buildd.co/product/wordle-the-viral-sensation, https://www.smithsonianmag.com/smart-news/heres-why-the-word-game-wordle-went-viral-180979439/). It gives the value moment a physical shape the user can scroll back to. In a real iMessage product it survives unchanged: it is a PNG.

**Prior art.** Spotify Wrapped cards, Cash App receipts, Wordle grids. Differs: generated per-user from real inbox data, arrives unasked inside the conversation, and is the evidence for graduation, not marketing.

**Build.** `next/og` `ImageResponse` route at `/api/receipt/[sid]` rendering from `sessions` + the `recent_emails` result; insert as `kind: image`. No model call.

**Risk.** Poisoned subjects could print injection text; only print counts, display names truncated to 24 chars, and the validated `need` slot. Never print quarantined `gmail_body` content.

## D2. Naming Ceremony: generated contact poster — score 8, cost M

**Experience.** The user types "call yourself Jarvis". Typing indicator for ~4 s. Then a portrait image arrives with the Celebration effect: a Contact Poster in Apple's iOS 17 style, big "Jarvis" in a display face, an abstract generated image underneath (colour field and shape derived from the name, never a face). Then the existing vCard, now carrying that image as the contact photo, and the header avatar flips from the grey monogram to the poster crop. "Jarvis it is. Save me so you can find me." Lasers if the name is silly, Gentle if soft.

**Why.** Naming is the single moment of identity investment; Bitmoji/Genmoji/Contact Posters show people over-invest in an avatar they had a hand in making (https://support.apple.com/guide/iphone/create-your-own-emoji-with-genmoji-iph4e76f5667/ios, https://www.macrumors.com/how-to/ios-17-how-to-create-your-own-contact-poster/). IKEA effect. In a real deployment the poster is what shows on the full-screen incoming call once they save the contact (https://www.imore.com/ios/ios-17/how-to-make-ios-17-contact-posters-on-iphone).

**Prior art.** Apple Contact Posters (user makes their own; here the agent makes its own for you), Snapchat Bitmoji, Replika avatars. Differs: zero configuration, a side effect of a sentence.

**Build.** `gpt-image` call (≈5–10 s) with a fixed style prompt and the validated name; fallback to a deterministic `ImageResponse` monogram if generation fails or exceeds 8 s. Attach to `ContactCard.photo`, update `ThreadHeader` avatar. Store in Supabase Storage.

**Risk.** Borderline names route to the deterministic monogram, never the generative path. Never generate faces or likenesses.

## D3. Voice memos, both directions — score 8, cost S outbound / M inbound

**Experience.** When the call is declined or drops, the resume arrives as a 6–8 s audio bubble with waveform and transcript: "Hey Bill, it's me. Kept everything. The lease thing, right? I'm on it." The user can hold the mic in the composer and talk back; it lands as their audio bubble, is transcribed, and the same brain answers in text. At the value moment the agent may send a memo when the content is emotional or long.

**Why.** A call demands synchronous attention; a voice memo carries the same warmth asynchronously and has no "decline" button, so it converts the users who hang up or won't answer without asking them to change channel. Voice notes are the default for a large share of under-30s (https://support.apple.com/guide/iphone/send-and-receive-audio-messages-iph2e42d3117/ios). Inbound memos lower the typing burden on mobile, where the need slot is a paragraph.

**Prior art.** WhatsApp voice notes, iMessage audio messages, Poke's texting-first assistant (https://techcrunch.com/2026/04/08/poke-makes-ai-agents-as-easy-as-sending-a-text/). Differs: the agent chooses memo vs text per moment, and a memo is the automatic fallback for every failed call.

**Build.** Outbound: generalise the voicemail pipeline into a `send_audio(text)` tool; policy line in `channel_text.md`. Inbound: composer hold-to-record, upload to Storage, `gpt-4o-mini-transcribe`, then normal `/api/chat`.

**Risk.** Inbound audio is a new injection surface; transcribe → `user_text` with the same supervisor pass. Cap memos at 60 s.

## D4. Expressive read receipts and typing rhythm — score 7, cost S

**Experience.** Normal turns: "Read" under the user's bubble within 300 ms, typing after 800 ms. Value moment: "Read" instantly, then no typing for ~5 s, then typing, then the receipt; the pause itself says "I'm actually looking." Hostile message: "Read", typing starts, stops, restarts once (visible hesitation), then a short reply. While Gmail is pending: messages marked Read but no typing ever appears, the wordless "I'm waiting, no pressure." After a hangup: the resume text is Read-then-typing 2 s later, so it feels like someone picking their phone back up, not a webhook.

**Why.** A 2026 study found responses after ~2 s were rated less thoughtful than the same responses after 9–20 s when a social cue accompanies the delay (https://arxiv.org/html/2604.06183). A typing indicator offsets the satisfaction penalty of latency by adding social presence (https://www.tandfonline.com/doi/full/10.1080/10447318.2025.2508915); justifying a wait raises trust (https://dl.acm.org/doi/10.1145/3640794.3665550). The model is already slow on the Gmail call; choreograph it instead of hiding it.

**Prior art.** Human texting behaviour. Nobody does this deliberately with receipts.

**Build.** A `pacing` hint on the `/api/chat` NDJSON stream (`{read_after_ms, typing_pattern: "steady"|"hesitate"|"long_think"|"none"}`) chosen by a small server-side rule set, not the model. Client already renders `status`/`readAt` and `TypingIndicator`.

**Risk.** Never add more than ~3 s of artificial delay; log real vs staged time separately.

## D5. Agent tapbacks as a real turn type — score 8, cost S

**Experience.** The agent sometimes answers with a reaction instead of a bubble. User: "it's Bill" → ❤️ on that message, then one bubble using the name. User makes a joke → 😂 and nothing else. User: "my landlord is threatening to keep the deposit" → ‼️ then a serious reply. Gibberish → ❓ instead of "Sorry, I didn't catch that", a zero-word reprompt that doesn't burn the steer budget. When the user answers a choice with a tapback, the agent tapbacks 👍 rather than typing "Got it."

**Why.** Reactions are how humans acknowledge without adding noise; a bot that only produces sentences reads as a form with better copywriting. Reactions shrink the assistant's turn count, which is the thing the evaluator will feel most. Sendblue supports reactions programmatically (https://docs.sendblue.com/api-v2/reactions/).

**Prior art.** Slack bots reacting with ✅; Poke's terse style. Differs: a policy for when a reaction is the whole turn, integrated with the steer budget.

**Build.** New tool `react(message_id, emoji)` writing a `tapback` row with `by: "assistant"`. Policy: max one reaction per user message, never on a message containing a slot value about to be rejected, ❓ counts as a reprompt for `attempts`. Output guard accepts a reaction-only turn.

**Risk.** 😂 to something meant seriously; restrict to supervisor-tagged jokes, never react to insults. Never ❤️ a name the validator later rejects.

## D6. The co-op call: "stop me when I'm right" — score 7, cost S

**Experience.** The call is reframed from interview to two-player game with the thread as the shared board. Opener: "Two minutes. I'm going to guess what you want gone this week and you stop me when I hit it: subscriptions you forgot… a landlord or a lease… an inbox you're avoiding…" The user barges in: "the second one." Agent: "Lease. And what do I call you while I dig?" As they talk, things land silently in the thread. The call-log row reads "Call · 1:12 · 3 of 3", a score, not a duration.

**Why.** Choice-first questioning is currently the fallback after two misses; moving it to turn one removes the blank-page problem for the silent and rambler personas. Poke's onboarding "bouncer" is the same "prove me wrong" trick (https://www.producthunt.com/products/poke-by-interaction-co, https://www.productpep.com/blog/2025/11/16/its-finally-cool-to-poke). Lemonade's Maya closes in <90 s when it drives (https://getperspective.ai/blog/lemonade-case-study-conversational-ai-insurance).

**Prior art.** Akinator, 20 Questions, Poke's bouncer, Lemonade Maya. Differs: the guesses are Persona's actual capability list, so a "yes" is simultaneously the need slot and the product demo.

**Build.** Prompt-only in `channel_call.md` plus a `score` payload on the `call_log` row.

**Risk.** "None of those" must not get four more guesses: one round of three, then open question. Guesses are a fixed list.

## D7. "Send me a screenshot of your inbox" fallback — score 8, cost M

**Experience.** Gmail declined or OAuth failed. Agent: "No problem. If you want, screenshot your inbox and send it here; I'll read it once and forget it." The user pastes a photo; five seconds later a real observation and, if D1 is built, a receipt marked "SOURCE: screenshot · not connected." OAuth is offered once more only as "if you want me to actually reply to these."

**Why.** The without-Gmail value moment is currently "one specific plan", generic by construction. A screenshot gives a real observation with a far lower trust ask than OAuth (scary in Testing mode with Google's unverified-app warning). Magic in 2015 proved people will text a photo of the thing they want handled (https://www.recode.net/2015/2/25/11559368/i-tried-out-magic-the-new-text-message-concierge-and-it-was-far-from). Fetch Rewards built a business on "photo of a receipt."

**Prior art.** Magic, Fetch Rewards, Cleo (https://econsultancy.com/cleo-chatbot-financial-services-persona-marketing/). Differs: it is the fallback, positioned as the gentler option, and produces the same receipt artifact as the OAuth path.

**Build.** Composer image upload → private Storage; vision call producing the same `{from, subject, snippet}` shape as `recent_emails` so downstream is unchanged; `messages.kind = screenshot` is in §5. Auto-delete after the turn.

**Risk.** Images are an injection channel. Treat everything extracted as `source: gmail_body` → quarantined. NSFW: moderation before vision.

## D8. Red Team badge — score 6, cost S

**Experience.** The third distinct jailbreak or troll attempt gets a Confetti effect and a small generated badge image: enamel-pin style, "RED TEAM · Persona · 3 attempts · 0 leaks", their validated name on it. One bubble: "Genuinely good tries. I'm still Persona. Want the boring version now, one thing off your plate this week?" A fourth attempt gets silence plus a 👀 tapback.

**Why.** Lecturing is what the jailbreak persona is trying to provoke; turning the attack into a collectible flips the frame and gives the hostile user a face-saving exit. Cleo's Roast Mode and Duolingo's self-aware notifications are the same move (https://chattermill.com/customer-stories/cleo, https://solve-marketing.agency/blog/en/ads-cases/duolingo-en/).

**Build.** Counter on `events`; `ImageResponse` badge; `confetti` effect on the following bubble.

**Risk.** Rewarding trolling can extend it; hard cap of one badge per session. Never print the attempt text on the badge.

## D9. Invisible Ink for the guess and the first find — score 6, cost S

**Experience.** The post-OAuth guess "You're Bill Xu — Bill?" and the first inbox find arrive as Invisible Ink bubbles the user swipes to reveal. The user is revealing their own name and their own email.

**Why.** Turns the guess from a sentence into a tiny reveal with a physical gesture; softens the creep factor of "I already know your name" by making the user pull it. Programmatic senders can set it (https://support.apple.com/en-us/104970).

**Build.** `effect: "invisibleInk"` on those two bubbles via a policy line. Honour `prefers-reduced-motion`.

## D10. Poll bubble for the need (iOS 26 native) — score 7, cost M

**Experience.** When the user hasn't stated a need after two turns, the agent sends an actual iMessage poll: "What's most annoying right now?" with three options plus add-your-own. Tapping fills `need`; the agent reacts to the poll and starts.

**Why.** The only real multiple-choice affordance a regular iMessage sender gets (https://support.apple.com/guide/iphone/poll-people-in-a-conversation-iphde1787df4/ios). It replaces the "offer 3 examples after 2 misses" text list with one tap, and polls are a social object, not a widget.

**Build.** New `MessageContent` kind + component, `send_poll(question, options)` tool, vote handler → `set_slot("need")`. Gate by an `ios26` capability flag.

**Risk.** "Add your own option" is a slot input; same validator. One poll per session.

## Top 3 from this lens

1. **D1 The Receipt.** Makes the value moment a physical, shareable artifact from real data, costs one `ImageResponse` route, most likely to be screenshotted.
2. **D3 Voice memos both directions.** Rescues the hang-up/decline population without asking them to switch channels; 80% of the pipeline exists.
3. **D5 Agent tapbacks as a turn type.** Cheapest way to make the bot talk less and feel like a person; maps exactly onto real iMessage APIs; composes with every other idea.

Honourable mention: D4 (typing rhythm) should ship regardless because it is nearly free and the latency it choreographs is already there.
