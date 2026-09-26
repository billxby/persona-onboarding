# Research lens 3: growth and activation science

Research subagent report, 2026-09-26. Read `DESIGN.md`, `docs/implementation-log.md`, `data/mock_inbox.json`. Ideas already in DESIGN §6, §7, §12.6, §14 were excluded.

## Framing first: what to measure

The log's metrics (slot completion, turns to graduation, value moment < 60 s) are setup-moment metrics. Reforge's three-moment model (setup → aha → habit, https://www.reforge.com/guides/define-your-setup-moment, https://www.reforge.com/c/retention-series-eg/activation/aha-moment) and Lenny/Timen's 500-product study (median activation 36%; "completed onboarding" is not an activation event; generic tours complete at 15% and do not predict conversion, https://www.lennysnewsletter.com/p/what-is-a-good-activation-rate, https://www.lennysnewsletter.com/p/how-to-determine-your-activation) both say the same thing: define activation as a behaviour on the user's own data, not as graduation.

Proposed instrumentation (all derivable from the existing `events` table, no schema change):

- **Aha**: first `search_gmail` or `draft_reply` tool call in `mode = main` with `gmail_status = connected`, within the first session.
- **Time-to-aha**: `created_at` of session → that event. Keep the "value moment before 60 s" shape but attach it to this event, not the observation bubble.
- **Habit proxy / day-2**: a second session-cookie visit with at least one user message in `mode = main`.
- **Gmail funnel**: `link_card` inserted → `/api/oauth/google/start` hit → `oauth_success` vs `oauth_declined`/`failed`. Today only the endpoints are logged; the gap between card and start is the one to watch.

## G1. Stakes-first value moment — score 9, cost S

**Experience.** After Gmail connects, the first observation leads with the single most expensive, soonest, most personal item, in that order, and names the counterpart: "You're connected. Peak Fitness already charged you $189 on Tuesday and renews again October 1 unless they get written notice, and Dana needs a yes or no on the $2,350 lease by Friday. Which one first?" Not "14 unread, three need a reply."

**Why.** Loss aversion plus a concrete deadline plus a named person is the strongest specificity stack available; Superhuman doubled activation by getting to "aha" inside the first session rather than describing features (https://www.flowjam.com/blog/superhuman-onboarding-teardown-30-minute-wow-session, https://www.thebottleneck.io/p/superhuman-onboarding). The demo inbox is already built for this (m02 + m10 is a paid charge and an imminent re-charge; m01 has a Friday deadline and a landlord's first name; m06 renews in 7 days) but §12.6 and the verified walkthrough pull one fact. Moves: value moment → graduation conversion, time-to-aha, tap rate on "draft it?".

**Prior art.** Rocket Money's "we found $X in subscriptions" reveal; Superhuman's first-session migration (65% fully switched). Differs: ranking is deterministic on the server from structured fields, so the model is handed the headline rather than asked to find it.

**Build.** Add a `stakes` field to the `recent_emails` result (or a sibling `triage_inbox()` tool) that extracts `{amount, due_date, counterpart, message_id}` from snippets with a regex/date pass and ranks by (due soonest × amount × sender is a person). Under 300 bytes still fits. One line in `policy_onboarding.md`: "lead with the top stakes item; name the person; end with a two-way choice."

**Risk.** Hallucinated dollar figures or dates. Extend the output guard (already checks names/emails/need against beliefs) to compare any `$` amount or date in the reply against the tool result. The stakes pass must run on snippets/structured fields only and never on quarantined bodies, so m04 cannot inject. Dark-pattern risk is low as long as only real deadlines are surfaced.

## G2. Need menu generated from their inbox — score 8, cost M

**Experience.** The user says "I don't really have anything" or stalls twice. Instead of Persona's generic three (inbox cleanup, subscriptions, booking; §14), the bot says: "Fair. Connect Gmail and I'll show you three things I'd take off your plate; you can say no to all of them." After connect: "Three candidates: cancel Peak before the Oct 1 charge, answer Dana about the lease by Friday, RSVP to Maya by Thursday. Heart the one you want, or none." The user picks with a tapback.

**Why.** The blank-page problem is the largest single drop-off in any "what do you need?" flow; a choice set drawn from the user's own data converts "I have no need" into "pick one." Clay enriches the account on signup and recommends a specific Claybook for that ICP instead of a generic tour (https://blog.saasboarding.com/p/how-clay-turns-a-complex-product). Shortwave opens by offering to organise the inbox rather than asking (https://clean.email/blog/email-clients/shortwave-review). Moves: `need` completion in the no-need cohort, graduation rate, Gmail connect rate (Gmail now has a reason for people who had none).

**Prior art.** Clay's ICP-driven onboarding; Shortwave's first-run inbox pass. Differs: three items, tied to deadlines, chosen with a tapback in a thread rather than a checklist UI.

**Build.** A `suggest_needs()` tool over `recent_emails` reusing the stakes ranker from G1; a `nextBestAsk` branch: when `need` is empty after two misses and `gmail_status` is `none`, offer Gmail as the way to find a need; when connected and `need` still empty, call `suggest_needs`. Tapback → `set_slot("need", …)` mapping in the chat route.

**Risk.** Inverts the fixed priority (need before Gmail) for one cohort; keep it an offer, and if Gmail is declined fall back to the generic three so `need` is never gated on OAuth (Decision 1.5). Hostile users can heart the poisoned m04; the ranker excludes anything whose sender has no money/date/person signal, and the validator still runs.

## G3. Paste one email, get the result, then ask for Gmail — score 8, cost M

**Experience.** Before any OAuth: "Paste or screenshot the gym email and I'll write the cancellation right now." The user pastes text or drops a screenshot into the composer. The bot returns the draft with member-ID placeholder and the 30-day notice line, then: "That's one. Want me to watch for the rest? Gmail's read-only and I'll wait."

**Why.** Reciprocity: giving something before asking raises willingness to comply (https://www.nngroup.com/videos/reciprocation-vs-reward/). It gives the Gmail-declined cohort (a real production segment, and the evaluator's "cancel consent" test) a genuine result instead of a plan. Moves: OAuth start rate among hesitators; time-to-aha for the declined cohort; drafts per session.

**Prior art.** Perplexity answers before it asks you to sign in; Granola gives you a note from your first meeting before asking for calendar access; Cash App and Robinhood let you browse before KYC. Differs: the artifact is a single email the user chooses to share, the smallest possible permission.

**Build.** Composer accepts image paste (Claude vision via AI SDK, `kind = screenshot` already in the schema); a `pasted_content` path in `/api/chat` that routes the content through the same provenance check as `gmail_body` (trust 0, quarantined) so nothing pasted can set a slot; a `draft_reply` variant that takes inline text.

**Risk.** Paste injection, already modelled by the ledger provided pasted text is treated as `gmail_body`, not `user_text`. Scope creep into "general document assistant"; keep it to one email and one draft during onboarding.

## G4. Deadline-bound open loop at graduation — score 8, cost S–M

**Experience.** The graduation summary card ends with one unfinished, real thing: "Dana wants an answer by Friday. When you're back, say 'lease' and the reply is ready." `/summary/[sid]` shows "1 waiting: lease reply, due Friday." The draft is precomputed at graduation so the return is instant.

**Why.** The Zeigarnik effect and open loops with deadlines are what Duolingo's streak exploits (https://growth.design/case-studies/duolingo-user-retention), but losing a streak is a top quit reason. Tying the loop to the user's own real deadline avoids the artificial-streak failure mode. This is the only idea that touches day-2 return without violating the no-proactive-messages rule. Moves: day-2 return rate, first-message latency on return.

**Prior art.** Duolingo streaks, Headspace "your next session", Linear's "1 issue assigned to you" badge. Differs: one real item, never a count, never a streak.

**Build.** At `graduate`, pick the top stakes item with a due date, call `draft_reply` server-side, store the draft as a pending `agent_inference` belief (so it never asserts anything), render a "waiting" line on the summary page. One line in `policy_main.md` about the return phrase.

**Risk.** Over-promising if the draft is poor; mark it "a first pass." Manufactured urgency would be a dark pattern; only surface deadlines that appear in an email.

## G5. "Just connect Gmail" fast path with honest endowed progress — score 7, cost S

**Experience.** The opener gains a third exit: "or just connect Gmail and I'll work out the rest." One tap, OAuth, and three chips fill at once: You (from the Google profile name), Gmail, and Your need (a suggestion from G2, marked as a guess until confirmed). The user sees "3 of 4" without having typed anything.

**Why.** Endowed progress effect: identical remaining work, but people who see progress already made complete at roughly twice the rate (34% vs 19%, Nunes & Drèze, https://papers.ssrn.com/sol3/papers.cfm?abstract_id=991962, https://learningloop.io/plays/psychology/endowed-progress-effect). Here the progress is real because OAuth did the work. Moves: onboarding completion, turns-to-graduation; gives the chips a moment where they visibly jump.

**Build.** Add `profile` to the OAuth scopes; a second `link_card` variant in the opener; after `oauth_success`, run the name-guess and `suggest_needs` in the callback.

**Risk.** Leading with OAuth raises the perceived ask before trust exists; keep it the third exit, never the first line. Junk accounts get a junk need suggestion; it is marked unconfirmed and `confirm_slot` gates it.

## G6. Weak-signal register matching — score 7, cost S

**Experience.** Nothing visible. At 11 pm the bot is shorter and skips the call offer; on a phone-sized viewport the default exit is the call, on a laptop it is text; a user typing three-word lowercase bursts gets one-bubble replies and no exclamation marks; a user who writes paragraphs gets one paraphrase line; browser language sets the opener language before the first user turn.

**Why.** NN/g: onboarding tutorials interrupt, do not improve task performance and are forgotten; the bot's job is to reduce friction it cannot see. Register mismatch (chirpy bot, terse user) is a common bounce reason. Moves: opener reply rate, turns to need, steers per turn.

**Build.** A `CONTEXT` block in `buildPromptParts` (local hour from the client, viewport class, mean user message length and burst cadence from the last five rows, `Accept-Language`). Dynamic block, so it lands after the cache breakpoint. No new tools.

**Risk.** Saying the inference aloud is creepy; act on it, never state it. Wrong inferences are cheap because the next message corrects the register.

## G7. Answer "what can you do?" by doing it — score 7, cost S

**Experience.** Instead of three examples, the bot runs one. Connected: "Here's one: your StreamBox annual plan renews Oct 3 for $139.99; want me to draft the switch to monthly?" Not connected: "Here's what it looks like on a sample inbox," one labelled demo observation, then "want that on yours?"

**Why.** Generic tours complete at 15% and do not predict conversion; capability demos on realistic data convert curiosity into a Gmail ask with a visible payoff. Moves: Gmail connect rate after a "what can you do" turn; time-to-aha.

**Build.** A `demo: true` flag on `recent_emails` that reads `mock_inbox.json` regardless of `gmail_status`, returning results tagged `sample`. The consent gate on the real inbox stays intact. Exclude m04 from the demo pick explicitly.

**Risk.** Confusing sample with real; the bubble must say "sample inbox" and the guard should reject any reply asserting a sample fact as the user's.

## G8. Micro-yes before the OAuth card — score 7, cost S

**Experience.** Before the Connect Gmail card: "Should I look for the gym email or the lease one first?" The answer is stored; the moment OAuth succeeds, that search runs and the first observation is the answer to the thing they just chose. On the call this is one sentence.

**Why.** Foot-in-the-door and commitment-consistency: a small yes raises the likelihood of the bigger yes, and the value moment lands as a fulfilled request rather than an unsolicited observation. Wealthfront and Robinhood ask about goals before KYC; Cash App asks what you want to do before linking a bank. Moves: card tap → OAuth start; success → first observation latency (the query is pre-planned).

**Build.** `remember("pending_query", …)` before `request_gmail_connect`; the callback reads it and calls `search_gmail` server-side before inserting the "you're connected" message.

**Risk.** Adds a turn before the biggest ask; skip it when the need is already specific. Never "choose 1/2/3."

## G9. Read-only receipt for the hesitant — score 6, cost S–M

**Experience.** On pushback ("why do you need my email?"), one sentence and an image bubble: a plain card showing the exact scope (`gmail.readonly`), "cannot send, cannot delete," and a revoke link. After connect, `/summary/[sid]` gains a "what I read" list: subjects and dates of every message the tools touched, from `tool_call` events.

**Why.** Trust is the dominant blocker on email OAuth; transparency lowers perceived risk for the about-to-decline cohort and does nothing for everyone else. Moves: declined → retry rate; connect rate among sessions with a privacy objection.

**Prior art.** Superhuman and Shortwave security pages; Granola's "we never record audio." Differs: in-thread, only on objection, and the post-hoc "what I read" ledger is unusual.

**Risk.** Volunteering it makes the ask heavier for people who were not worried; trigger only on objection or a second decline.

## G10. User-owned re-engagement via calendar file — score 6, cost S

**Experience.** In main mode, when a deadline is on the table: "Want 'answer Dana by Friday' on your calendar?" A link card delivers an `.ics` with the summary page URL in the notes. The calendar alert brings them back; the bot never messages proactively.

**Build.** A `/api/ics/[sid]/[message_id]` route generating a VEVENT from the stakes item. Calendar integration is out of scope in §2, but a downloadable file is not an integration.

**Risk.** Offer once per session or it becomes a nag.

## Top 3 from this lens

1. **G1 Stakes-first value moment.** Smallest build, moves the core metric directly, and the demo inbox was clearly written for it.
2. **G2 Need menu from their inbox.** Attacks the biggest drop-off ("I have no need") with the user's own data instead of Persona's list.
3. **G4 Deadline-bound open loop at graduation.** The only lever that touches day-2 return without breaking the no-proactive-messages rule.

Runner-up: G3 (paste before OAuth) is the best answer to the "cancel consent → still useful" test but costs more and opens a second injection surface.
