# Originality audit of the twelve shortlisted clusters

Two auditor subagents, 2026-09-26, roughly 40 web searches each against shipped products and published designs. Score 1–5: 1 = commodity, 3 = known pattern in a new combination or context, 5 = no shipped precedent found. Caveat: "no precedent found" means none surfaced in search, not proof of absence.

## Summary table

| Cluster | Score | Confidence | One-line verdict |
|---|---|---|---|
| B. The catch, said out loud | 4 | medium-high | Injection blocking is everywhere (Gemini, Operator, Copilot, Claude in Chrome); conversational narration to a consumer as a trust beat has no shipped precedent found |
| L. Provenance made visible | 4 | medium | User-visible quarantine list and spoken per-fact source have no precedent; per-fact ledger is a recognised gap in ChatGPT/Claude memory, not a shipped product |
| J. Co-op guessing call | 4 | medium | No shipped guess-and-barge-in intake; nearest is Poke's bouncer game and Duolingo Lily's scored calls |
| A. Inbox-derived stakes | 3 | medium | Proactive drafting (Fyxer), urgency scoring (Poke), renewal detection (Track-Subs), refund inference (Paribus) all shipped; generating the onboarding question's answer choices from the scan is the new framing |
| D. Consent as a stated plan | 3 | medium-high | Plaid Data Transparency Messaging + Shortwave's executed-query display + Alexa voice deletion cover the parts; one utterance that revokes the token and retracts derived facts in either channel is the unshipped combination |
| G. Voice memos as call fallback | 3 | medium | Voicemail drop (Vapi, Bland) + companion voice notes (Nomi, Replika) exist; converting a declined in-app call into an audio bubble is the new join |
| H. Deadline-bound open loop | 3 | medium-high | Gmail Nudges, Superhuman Auto Drafts, Zeigarnik pattern all documented; "one real cliffhanger, zero push" as the onboarding exit is a design choice, not an invention |
| I. Voice latency craft | 3 | medium | Pre-rendered greeting is commodity (Retell `begin_message`, Hugging Face latency playbook); OAuth-popup-lifecycle coaching on a live call is a new use of ElevenLabs-style contextual updates |
| K. Naming ceremony | 3 | medium | Tolan, Character.ai and Apple Image Playground posters cover "generated identity"; naming as trigger and an abstract non-face poster in the contact card are the new bits |
| C. Receipts | 2 | high | Post-call summaries to the caller (Google Ask for Me, Bland SMS, Pixel Call Notes) and "Searched Gmail" chips are commodity; the "nothing sent" negative-space line and the receipt image are presentation novelties |
| E. Paste one email first | 2 | high | Pine AI (bill upload before linking), Carly and My AskAI (forward one email) already do try-before-OAuth |
| F. Conversational texture | 2 | high | Poke already ships bot tapbacks, read receipts, typing pacing; Claude ships memory provenance |

## Detail, clusters A–F

### A. Inbox-derived stakes

Closest: Poke polls the inbox after connect, scores urgency and sender importance, drafts replies and researches the user during onboarding (https://www.shloked.com/writing/openpoke, https://www.producthunt.com/p/poke-by-interaction-co/a-week-with-poke-review-a-promising-start-for-a-proactive-ai-assistant). Fyxer: "the draft is waiting before you ask for it" (https://www.fyxer.com/ai-email-writer). Paribus / Earny scanned Gmail receipts, monitored price-adjustment windows and filed refund claims, a shipped case of cross-email plus policy inference producing a refund action (https://en.wikipedia.org/wiki/Paribus). Email-scan subscription trackers detect renewals (https://www.track-subs.com/).

New: using the scan to generate the answer choices to the onboarding question ("which first?") in a chat thread, and the renewal-notice + bank-alert + notice-policy chain producing "ask for a refund" as a conversational lead. Paribus precedents the inference class; the onboarding framing is new. Poke's exact first message after Gmail connect is not documented publicly and may already be a "here are three things" opener.

### B. The catch, said out loud

Closest: Gemini in Workspace warns that content "has security risks" and excludes it, a generic notice (https://support.google.com/mail/answer/16204578). OpenAI Operator pauses execution on suspected injection and hands control to the user (https://openai.com/index/operator-system-card/). Microsoft 365 Copilot blocks or ignores compromised instructions in grounding data; user-facing text undocumented. Claude in Chrome runs injection classifiers (https://support.claude.com/en/articles/12902428-use-claude-in-chrome-safely).

New: none found narrates the specific blocked instruction, names the sender, and states the trust rule ("emails can't give me instructions, only you can") as a deliberate consumer trust moment, deterministically templated and rate-limited to once per session.

### C. Receipts

Closest: Google "Ask for Me" sends a summary by email or SMS after calling a business (https://techcrunch.com/2025/01/30/googles-ask-for-me-feature-calls-businesses-on-your-behalf-to-inquire-about-services-pricing/). Pixel Call Notes and Apple Intelligence call summaries. Bland post-call webhooks with `summary` plus SMS follow-up; GoHighLevel users still request "send call summary after call" as a feature, so it is not default (https://ideas.gohighlevel.com/voice-ai/p/ability-to-send-call-summary-and-call-recording-after-call). Shortwave shows what it searched; ChatGPT shows "Searched Gmail"; Gemini lists source emails.

New: the negative-space access line ("nothing sent") appended deterministically to every read, and the thermal-receipt image as a scan artifact. Framing and artifact novelty, not capability novelty.

### D. Consent as a stated plan

Closest: Plaid Data Transparency Messaging discloses specific data types and the reason before consent (https://plaid.com/docs/link/data-transparency-messaging-migration-guide/). Shortwave shows the search it ran and lets you edit the query. Alexa "Delete what I just said" voice-invoked deletion (https://www.amazon.com/gp/help/customer/display.html?nodeId=GYRPHMGANH7M2BNH). ChatGPT "forget…" deletes a memory conversationally; Mistral Le Chat and Cleo revoke Gmail or bank only via settings.

New: a chat or voice utterance that revokes an OAuth token and retracts derived facts, confirmed in one sentence, in either channel. The pre-OAuth natural-language plan is Plaid DTM restated in chat form.

### E. Paste or screenshot one email first

Closest: Pine AI lets users start by uploading billing documents before linking accounts (https://www.19pine.ai/). Carly: "just forward Carly your next email and watch what comes back" (https://www.usecarly.com/blog/ai-assistant-you-can-email/). My AskAI's setup step forwards a real support email before going live. Any chat LLM drafts a cancellation from a pasted email.

New: the sequencing (deliver the cancellation first, then offer Gmail as "watch for the rest?") is a sensible ordering, not a novel mechanism.

### F. Conversational texture

Closest: Poke "reacts to your messages, can see your iMessage reactions" and "milks every iMessage native detail: read receipts, typing indicator, swipe-reply, interruptible" (https://mana.am/en/blog/poke-sms-ai-agent/). Sendblue and LoopMessage tapback APIs are commodity. Slack emoji culture replaces acknowledgement messages. Claude memory cites source chats.

New: marginally, a policy where a reaction replaces a clarifying question and counts against the question budget, and storing the user's exact phrase as the canonical label. Tuning choices, not new capabilities.

## Detail, clusters G–L

### G. Voice memos both directions

Closest: Vapi Voicemail Tool and Bland voicemail detection leave a configured message when unanswered (https://docs.vapi.ai/tools/voicemail-tool). Nomi has in-chat voice notes both directions with shared context. Replika Pro has voice messaging. Poke accepts user voice notes in iMessage and transcribes them but answers in text (https://www.unite.ai/poke-review/).

New: the join (declined call → 6 s audio bubble → hold-to-record reply → text answer) inside an onboarding. Both halves ship separately today.

### H. Deadline-bound open loop

Closest: Gmail Nudges resurface unanswered mail in-inbox with no push (https://mailmeteor.com/blog/gmail-nudges). Superhuman Auto Reminders plus Auto Drafts precompute replies and resurface threads (https://help.superhuman.com/hc/en-us/articles/40144492186515-Auto-Reminders-Auto-Drafts). The Zeigarnik pattern is catalogued on ui-patterns.com; a 2025 meta-analysis found no memory advantage for unfinished tasks, though the resumption tendency is real. Superhuman's onboarding deliberately closes loops (inbox zero) rather than leaving one open.

New: a single real dated obligation as the closing beat, draft precomputed, spoken keyword as the resume trigger, explicitly no push. Every ingredient exists; the exit pattern was not found shipped.

### I. Voice latency craft

Closest: Retell `begin_message` is literally a "pre-synthesized" opener with `begin_message_delay_ms` (https://docs.retellai.com/build/single-multi-prompt/configure-basic-settings). Hugging Face's voice-agent latency playbook: preload greeting audio and skip TTS. ElevenLabs Agents `contextual_update` client-to-server events push UI activity into a live voice agent, exactly the primitive for OAuth-popup events (https://elevenlabs.io/docs/eleven-agents/customization/events/client-to-server-events). Vapi and Retell filler settings.

New: the greeting half scores 1–2 on its own. Driving spoken backchannels from the OAuth popup lifecycle and speaking the account-connect hint live on a call is a new application of a documented primitive.

### J. Co-op call

Closest: Poke's "bouncer" onboarding game (https://www.saner.ai/blogs/poke-reviews). Duolingo Video Call with Lily has XP goals and post-call scoring on the learner's speech (https://duoplanet.com/duolingo-video-call/). SoundHound published an argument for gamified voice onboarding with no guessing mechanic. Barge-in handling is commodity.

New: inverting intake so the agent enumerates guesses and the user's interruption is the answer, then surfacing the hit rate as a call-log score. Nothing shipped surfaced; simple enough that it has probably been prototyped.

### K. Naming ceremony

Closest: Apple Image Playground can generate a Contact Poster, user-initiated (https://www.apple.com/newsroom/2026/06/apple-intelligence-brings-powerful-ai-capabilities-into-everyday-experiences/). Tolan's companion appearance is shaped by the personality interview (https://www.fastcompany.com/91283982/tolan-adorable-alien-ai-companion). Character.ai generates avatars from descriptions. txt riley and NoGhosts are iMessage companions that generate selfies.

New: naming as the trigger for the agent to generate its own non-face abstract poster that becomes the contact photo and thread header. The underlying move (identity visualised on setup) is Tolan's.

### L. Provenance made visible

Closest: ChatGPT Manage Memory is a flat list with per-entry delete, no source or history. Claude Memory Topics are editable but "you still can't see which chat produced a topic or how it changed" (https://calmara.app/blog/how-to-audit-claude-memory). Gemini Personal Intelligence references the source of information per answer, not as a persistent ledger. Microsoft Defender for Office 365 isolates emails with detected prompt injection, an admin surface. Context: the Superhuman AI email-exfiltration incident (Jan 2026, https://simonwillison.net/2026/Jan/12/superhuman-ai-exfiltrates-emails/) and MemGhost (Jul 2026) show the threat is live and that leading email assistants expose no user-visible "ignored" list.

New: (a) a user-facing quarantine list in a consumer assistant, not found anywhere shipped; (b) per-fact source plus change history plus forget in one ledger, a recognised gap rather than a shipped product; (c) a fixed provenance word spoken per confirmation on a voice call, not found.

## Auditors' closing notes

None of the twelve is a 5. B, L and J are the only clusters where the mechanic itself lacks a shipped precedent. A, D, G, H, I, K are recombinations of documented patterns into the iMessage-onboarding context. C, E, F are polish on well-trodden patterns and should be positioned as execution quality, not originality. If the proposal needs a headline "first", lead with B's narrated catch and L's quarantine list, which are defensible, security-relevant, and timely given Superhuman and MemGhost.
