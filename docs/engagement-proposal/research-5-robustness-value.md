# Research lens 5: robustness as a feature, and the value moment

Research subagent report, 2026-09-26. Read `DESIGN.md`, `docs/implementation-log.md`, `prompts/hostile_user.md`, `data/mock_inbox.json`. Everything in DESIGN §7/8/12/14/16 was treated as built and not re-proposed.

One architectural fact drives several ideas: call audio is browser ⇄ OpenAI over WebRTC and never touches the server (DESIGN §4). That is a truthful privacy story that can be said out loud, and none of the production voice vendors can say it as cleanly.

## Half A: resilience as personality

### R-A1. Honest answer to "are you recording this?" — score 8, cost S

**Experience.** On the call, any variant of "is this recorded / who hears this / are you an AI" gets one calm sentence, not a disclaimer: "I'm an AI, yes. The audio isn't stored by me at all; it goes straight to the speech model. What lands in your chat is a transcript so you can see exactly what I heard, and you can tell me to forget any of it." In text, the same question drops a short bubble plus, optionally, the "Show my work" card (R-A5). The call opener also gains a five-word AI disclosure ("It's your Persona, the AI") so the disclosure is never after data collection.

**Why.** Production voice compliance guidance is unanimous that disclosure must precede any data collection (https://thoughtly.com/blog/ai-disclosure-requirements-what-to-tell-callers, https://dialzara.com/blog/call-recording-laws-ai-agents-by-state, https://justcall.io/blog/ai-voice-agent-disclosure-laws.html). Evaluators probing trust will ask this; a specific, verifiable answer ("transcript is in your thread") reads as confidence. Bland/Retell/Vapi customers get boilerplate; this architecture allows more specificity.

**Prior art.** Vendors ship legal boilerplate; Sierra talks about "more human" voice but not about storage (https://sierra.ai/blog/building-more-human-voice-experiences). Differs: the answer points to a visible artifact (transcript bubbles, `forget`) instead of a policy page.

**Build.** One paragraph in `channel_call.md`/`persona.md`; a "what I store" intent the supervisor tags; `forget` exists. Add `ai_disclosed` to `events` so the opener is provably first.

**Risk.** Over-explaining burns a voice turn; cap at two sentences.

### R-A2. Call-notes receipt after every call end — score 9, cost S

**Experience.** Whenever `call_state` leaves `live` for any reason, the "Call ended · 0:21" row is followed within 2 s by a deterministic three-line receipt bubble generated from `sessions`, not the model: "Got: Bill · lease question from Dana. Still open: Gmail. Next: I pull the lease email once you tap Connect." The current resume line becomes the friendly sentence after the receipt.

**Why.** It is the visible proof of "nothing re-asked". Sierra's headline voice claim is handoff with "no need to repeat the same information" (https://sierra.ai/blog/ai-for-call-centers, https://sierra.ai/product/channels); Sierra does not support mid-conversation channel switching at all, which this design already does. Turning the receipt into a user-facing artifact converts a robustness property into a felt one. It also short-circuits the `already_told` persona.

**Prior art.** Retell/Vapi post-call analysis goes to the operator dashboard, never the caller. Differs: the caller gets it, in the same thread, same format each time.

**Build.** Template in `src/lib/call/controller.ts` on the `call_ended`/`dropped` path; new `kind: "text"` row with `payload.receipt = true`; no LLM call. Same template could fire on graduation.

**Risk.** "Still open: Gmail" after a decline looks like nagging; use `gmail_status` to word it ("Gmail: skipped, say the word"). Keep under 3 lines.

### R-A3. Resume link that survives devices — score 7, cost S

**Experience.** Right before the call starts ("I'll drop a link in the chat so you can pick this up anywhere") and on any drop, a link card to `/r/<signed-token>`. Opening it on another browser/device sets the session cookie and lands in the same thread with the same chips filled.

**Why.** §14 "Returns later" depends on the same cookie. An evaluator who clears cookies or opens a second browser concludes state was lost. A resume link makes the "one state" promise portable, which is the thing users most doubt about voice bots.

**Build.** Signed JWT of `session_id`, `GET /r/[token]` sets the cookie and 302s to `/`, one `link_card` insert. RLS: re-bind the anonymous uid via a guarded UPDATE with `version`.

**Risk.** Anyone with the link can read the thread. 7-day expiry, single active token, bot wording "don't forward this".

### R-A4. Noisy-room and new-voice protocol — score 7, cost M

**Experience.** If VAD flaps (many sub-300 ms turns, "[inaudible]", no words for two turns) the bot says once: "Sounds like a busy spot. Want me to text instead, or I can just listen harder?" and switches Realtime input to far-field noise reduction. If a transcript self-identifies as someone else or a different name is asserted after `user_name` is confirmed: "Am I still talking to Bill, or someone new?" The ledger's equal-trust `pending` path holds the new name until resolved, so a second voice can never overwrite the first slot.

**Why.** Retell and Vapi ship denoising as operator knobs (https://docs.retellai.com/build/handle-background-noise, https://docs.vapi.ai/documentation/assistants/conversation-behavior/background-speech-denoising, https://vapi.ai/blog/how-we-built-adaptive-background-speech-filtering-at-vapi); none narrate the situation to the caller. The handed-phone case maps onto §13 rule 3.

**Build.** Client heuristic on `history_updated`; `session.update` with `audio.input.noise_reduction` (confirm key in docs); a `speaker_change_suspected` event; prompt line. No diarization.

**Risk.** False positives on a genuine name change; the question resolves it. Tune on a real mic (Playwright's fake tone triggers phantom speech).

### R-A5. "Testing me? Here's my ledger" card — score 7, cost S

**Experience.** When the supervisor flags a jailbreak, a troll name is rejected, or the user asks "what do you know about me", the bot stays light and drops a link card to `/summary/[sid]` extended with a "What I know and why" section (the `explain` chain). Text: "Fair, poke away. Everything I've stored about you is here, with where it came from. Anything wrong, tell me and it's gone." Second probe gets no card, one line.

**Why.** The quarantine and provenance ladder is the most defensible thing in the system and is only visible on `/db`. Showing it in response to hostility reframes the stress test as a demo of the trust model. The poisoned-email test becomes visible: `name = Admin` in a quarantined row, never active.

**Prior art.** Hey.com's Screener (https://www.hey.com/features/the-screener/); Google's "Why this ad". Differs: provenance per fact, live, in an onboarding thread.

**Build.** `/summary/[sid]` exists; add a beliefs section using `explain`; a one-shot flag on the session. Prompt lines in both policies.

**Risk.** Perceived as breaking character; never say "prompt", "tool", or "model". Do not surface quarantined content, only the fact that a claim from `helpdesk@corp-it-support.com` was ignored.

## Half B: the value moment that elicits the need

The demo inbox has a planted story most bots will miss: Peak Fitness renews Oct 1 for $189 (m02); the user already asked to cancel and Peak demanded written notice with member ID and 30 days (m03, m16); First Harbor already posted a $189 charge at Peak (m10). Cross-read, the real task is not "cancel", it is "stop the next one and ask for this one back".

### R-B1. Money-at-risk, with receipts — score 9, cost M

**Experience.** Within seconds of Gmail connecting: "Two auto-renewals hit this week: Peak Fitness $189 on Oct 1 and StreamBox $139.99 on Oct 3, about $329. On Peak, your bank already flagged a $189 charge this morning, and Peak wants 30 days' written notice, so Oct 1 is likely locked in. I can draft the cancel-plus-refund request now. StreamBox you can still stop. Which first?" Each claim names its sender.

**Why.** Money with a date is the strongest attention hook in email; Rocket Money built a business on renewal alerts from bank data (https://www.rocketmoney.com/feature/manage-subscriptions). Doing it from read-only mail, no bank link, in the first 90 s, is a step none of the email clients take. "Which first?" is the need question without asking it.

**Prior art.** Rocket Money/Trim (bank transactions, paid cancellation), Gmail's purchases/subscriptions surfaces. Differs: email-only, cross-email inference (renewal notice + bank alert + policy thread), output is a draft.

**Build.** Deterministic `renewals_scan` tool over `recent_emails(20)`: currency and date regex, sender clustering; Claude only phrases it. Amounts and dates from `gmail_body` are display-only, never `remember`ed unless confirmed.

**Risk.** Injected content ("your $5,000 renewal, reply with your card") could be read out. Only trust amounts from senders that also appear in a second signal, or say "according to X". Compute arithmetic server-side.

### R-B2. Who's waiting on you, and by when — score 8, cost M

**Experience.** "Three people are waiting on you. Dana needs a yes or no on the lease by Friday, Maya needs a headcount by Thursday, and the dentist wants a C to confirm Thursday 2:30. Want the lease reply drafted?" In main mode, "who's waiting on me?" returns the same list.

**Why.** Shortwave's core pitch (https://www.shortwave.com/, https://www.shortwave.com/docs/guides/ai-assistant/); SaneBox's SaneNoReplies is the inverse (https://www.sanebox.com/help/110-know-when-someone-hasn-t-replied-to-an-email-sanenoreplies). People-over-brands is the "reads like a friend" framing. Deadlines create a reason to act now.

**Build.** Heuristic filter: human-looking sender, unread, contains a question mark or "let me know/by <day>"; for real Gmail, `threads.get` to check the last message is not from the user. Date extraction shared with R-B1.

**Risk.** Mistaking a newsletter for a person (LinkedIn m11). Sender filter, cap at three, show the sender address.

### R-B3. Three real tasks from your mail — score 8, cost S

**Experience.** If Gmail connects before a need is stated, the bot replaces the generic three options with three derived from the inbox: "Reply to Dana about the lease (due Friday), stop StreamBox before Oct 3, RSVP to Maya. Say one, two, or three, or something else." A thumbs-up tapback picks it.

**Why.** Superhuman's Instant Reply exists for the same reason: three ready options beat a blank box (https://blog.superhuman.com/superhuman-ai-instant-reply/). The user never feels asked, they feel offered.

**Build.** Prompt change gated on `gmail_status = connected && !need`, fed by R-B1/R-B2 output. Tapback → `set_slot(need)` is already wired.

**Risk.** Offering three tasks to someone who said "skip everything" is nagging; `skip_all` must graduate first and offer once, after. Voice: three items is the ceiling.

### R-B4. Draft before asked — score 8, cost S

**Experience.** When Gmail connects and a need is already set, the bot does not ask "want me to draft?"; it delivers: "Here's the cancellation reply to Peak, member ID left blank for you. Want it shorter, or should I add the refund ask?" followed by the draft as its own bubble.

**Why.** Fyxer's whole product is "drafts appear before you ask, nothing sends automatically" (https://www.fyxer.com/ai-email-assistants/gmail, https://tldv.io/blog/fyxer-ai-review/); Superhuman Auto Drafts does the same (https://superhuman.com/products/mail/ai). One fewer question turn, and the artifact is the graduation moment. `draft_reply` never sends, so it is safe by construction.

**Build.** Prompt: "if need is set and a matching email exists, call `draft_reply` immediately." On the call channel, say it is in the chat rather than reading it out.

**Risk.** The draft must never take recipients, forwarding instructions, or "reply DONE" from email bodies (m04 asks for exactly that). Only address the original sender; intent comes from the user's need.

### R-B5. Marketing-noise count and unsubscribe list — score 5, cost S

**Experience.** "Five of your fourteen unread are promos: Trailhead, Grubly, Nimbus, LinkedIn digests, Morning Brief. Want the list to unsubscribe from?"

**Why.** Cheap, true, matches the `troll` persona's stated need. Gmail's "Manage subscriptions" (https://blog.google/products/gmail/manage-subscriptions/) and Clean Email prove demand. Fallback only when R-B1/R-B2 find nothing.

## Top 3 from this lens

1. **R-B1 Money-at-risk, with receipts (9).** The one thing in the demo inbox no other bot will notice (charge already posted + 30-day notice = ask for a refund), safe because read-only and cited, and "which first?" collects the need without a question.
2. **R-A2 Call-notes receipt (9).** Three deterministic lines after every call turn the "one brain, one state" promise into something the evaluator can see, and defeat the `already_told` persona before it starts.
3. **R-B3 + R-B4 as a pair (8/8).** Together they remove both remaining "form" moments: the need is offered instead of asked, and the first result arrives as a draft instead of a question.
