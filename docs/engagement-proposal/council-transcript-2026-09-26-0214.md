# Council transcript, 2026-09-26 02:14

Five advisors (Contrarian, First Principles Thinker, Expansionist, Outsider, Executor) answered the framed question independently, five fresh reviewers peer-reviewed the anonymised responses, and the chairman (the orchestrating session) synthesised the verdict. Method adapted from Karpathy's LLM Council.

## 1. Original user question (verbatim)

> currently i have debugged and implemented based off of @DESIGN.md, please now summon subagents to investigate all the addditioanl ways we could make this more interesting and engaging add evryting to a proposal document, summon reserach subagents think abotu everything /goal 3 genuinely good ideas / additions / twists taht owuld acc be good on the onboarding workflow for a production product, 3 genuinely good ideas accoridng to a council you summon and check for origianlity

## 2. Framed question (verbatim, as given to all five advisors)

Context: Persona onboarding bot, a production-intent conversational onboarding for an email assistant. Web simulator of an iPhone: iMessage-style thread plus a phone call screen. The bot must collect four things (user's name, a name for the agent, a connected Gmail via read-only OAuth, one thing the user needs help with), can call the user (OpenAI Realtime voice) and text (Claude), shares one Postgres state across both channels, must not feel like a form, lets the user graduate early into the main experience once a need is stated, and must withstand hostile users (hangups, silence, jailbreaks, poisoned emails). Already built and verified: call-continues-texts opener, Gmail card lands mid-call, hangup → resume in text with nothing re-asked, name-guess after OAuth, agent naming → contact card + header rename, tapbacks, voicemail on decline, silence tiers, one value moment after Gmail ("14 unread, one from Peak Fitness renews Oct 1 for $189, draft the cancellation?"), an append-only memory ledger with per-source trust, quarantine of email-derived facts, and a developer-facing brain view. The demo inbox has 20 emails including one prompt-injection email. Constraint: the thread can only carry what real iMessage carries (text, links, images, audio, contact cards, tapbacks, effects, typing, read receipts); no buttons or forms. No proactive messages after graduation.

Decision: Five research lenses produced 50 candidate additions. We must pick exactly THREE to add to the onboarding, judged as "genuinely good for a production product, not a demo gimmick", with originality as a tiebreaker. The clustered shortlist (each cluster is one candidate):

- A. Inbox-derived stakes. After Gmail connects, a deterministic server-side scan ranks money-at-risk (renewals, charges already posted), deadlines, and named people waiting; the bot leads with the top item and offers three real tasks from the user's own mail ("which first?") instead of asking "what do you need?"; drafts the reply before being asked. Cost S–M.
- B. The catch, said out loud. When the ledger quarantines an instruction hidden in an email, the server (not the model) inserts one templated bubble: "an email from 'IT Helpdesk' tried to tell me to rename you Admin. I ignored it. Emails can't give me instructions, only you can." Once per session. Cost S.
- C. Receipts. Deterministic proof-of-work artifacts in the thread: a 3-line call-notes receipt after every call end (got / still open / next), a generated receipt image after the Gmail scan, and a trailing "looked at: 3 subject lines, nothing sent" line after any Gmail access. Cost S–M.
- D. Consent as a stated plan. Before the Gmail card, the bot says exactly what it will search and why, tied to the need; after, it reports the executed query; "disconnect Gmail" revokes, deletes, and retracts in one sentence from either channel. Cost S–M.
- E. Paste or screenshot one email first. Before any OAuth, "paste the gym email and I'll write the cancellation now"; the result arrives, then Gmail is offered as "want me to watch for the rest?" Pasted content is quarantined like email bodies. Cost M.
- F. Conversational texture. Agent tapbacks as a whole turn (❤️ on "it's Bill", ❓ instead of "sorry?"), echoing the user's own phrase ("the gym thing") everywhere, read-receipt-then-typing pacing, terse users get one bubble. Cost S.
- G. Voice memos both directions. Declined/dropped call → a 6 s audio bubble resume instead of text; user can hold-to-record back. Cost S outbound, M inbound.
- H. Deadline-bound open loop at graduation. Summary card ends with one real unfinished item with a date ("Dana wants an answer by Friday; say 'lease' when you're back, the reply is ready"), draft precomputed. Cost S–M.
- I. Voice latency craft. Pre-rendered instant pickup so the bot is talking within 300 ms of Accept; event-driven "warm hold" lines while the Gmail popup is open, including the "Google hasn't verified this app → Advanced" hint. Cost S–M.
- J. Co-op call. Call opener is a guessing game ("I'll guess what you want gone this week, stop me when I hit it") instead of an interview; call-log row shows a score. Cost S.
- K. Naming ceremony. On naming the agent, a generated contact poster image (abstract, never a face) becomes the contact photo and header avatar, plus one line of earned personality derived from the name. Cost M.
- L. Provenance made visible. Confirmations carry a source word ("that's from you, not a guess" / "Google says Bill Xu"), plus a user-facing "What I know about you" page with per-fact source, history, forget button, and quarantined items shown as "ignored". Cost S–M.

Stakes: this decides what gets built next before an evaluator stress-tests the product and before it becomes a real onboarding for real inboxes. Wrong picks cost build time and could introduce gimmicks, dark patterns, or new injection surfaces.

## 3. Advisor responses

### The Contrarian

The fatal flaw is A, and it's the one everyone will want. A ranks emails by urgency, money, and deadlines — exactly the signals phishing and prompt-injection mail are optimized to emit. Your ranker becomes the attacker's delivery mechanism: the poisoned "renewal" lands at position one, and the bot "drafts the reply before being asked" from it. On a real inbox (40k messages, not 20), a deterministic scan also reads far more than any user consented to, which makes C's "looked at 3 subject lines" a lie unless D's scoping is enforced server-side. A and C cannot both ship honestly.

Second failure: the transparency cluster (B, C, D, L) is one idea wearing four hats. Stack them and the bot becomes a narrator of its own paperwork — the "feels like a form" failure the brief forbids, just moved into prose.

Kill on sight: G (users who declined a call cannot play audio — that's why they declined), H (manufactured deadline urgency as the exit hook is a dark pattern, and the deadline is email-derived, i.e., quarantined data driving behavior), I's "click Advanced past Google's warning" hint (you are training users to bypass a phishing defense; get verified instead), J and K (no data to guess from before Gmail; posters are demo candy).

B has a hidden injection surface: the template interpolates attacker-controlled sender name and instruction text into the thread. Hard-truncate and escape or don't ship it.

Recommendations:
1. Before building anything, run the poisoned email through A's ranker as a spike. If it ranks top-3, A is dead permanently, not deferred.
2. Make D's stated query the actual Gmail API query, server-enforced. Then C's "looked at" line is provably true and cheap.
3. Ship B with fixed-width, whitelisted interpolation (sender ≤ 24 chars, instruction paraphrased by template category, never verbatim).

PICKS: D, C, B

### The First Principles Thinker

The real question isn't "which three of twelve additions are good for production," it's "what does the user hand over, when, and what have they gotten back before they hand it over?"

Strip the framing. The bot "must collect four things." Three of those four are the bot's needs, not the user's. Only one, the stated need, is the user's. And one of them, Gmail, is not a fact but an irreversible transfer of power: read access to a decade of a stranger's life. Everything already built (value moment, ledger, quarantine) happens after that transfer. The onboarding as designed asks for the keys first and proves trustworthiness second. That ordering is the assumption nobody on the shortlist questions except E.

Second stripped assumption: "originality as tiebreaker." Originality is a demo metric. The production metric is reversibility. A user should be able to undo every step of onboarding in one sentence, from either channel, and see that it happened. Ten of twelve clusters add surface; only D and L add an undo.

Third: the clusters aren't twelve things. They're three families: do-real-work (A, E, H), make-trust-legible (B, C, D, L), and texture (F, G, I, J, K). Picking three from one family is the actual failure mode. Texture is what the current build already has most of.

Rebuilt problem: sequence the onboarding so value precedes permission, permission is a stated and revocable plan, and the one hostile event in the demo inbox is visibly caught rather than silently handled.

Recommendations:
1. Move the first task before OAuth (E): the user pastes the gym email, gets the cancellation, and Gmail becomes an upsell, not a gate. Quarantine pasted text identically to bodies.
2. Make the Gmail grant a stated, reported, one-sentence-revocable plan (D). This is the reversibility the whole product's credibility rests on.
3. Say the catch out loud (B), server-templated, once. It converts the injection email from a hidden test into the moment the user learns the rule "emails can't instruct me, only you can."

PICKS: E, D, B

### The Expansionist

You're calling this "onboarding for an email assistant." It's not. You've built the rarest thing in agents: one that arrives in the same thread as your mother and your landlord, remembers across voice and text, and keeps a signed record of who told it what. That is not a funnel. That is a personal chief of staff with an audit trail, and the four-field intake is a keyhole you're squinting through.

At $500K this becomes three things:

1. Work-before-permission. Cluster A is the seed: the agent's first act is finishing a task from your own life, not asking a question. Scale it and every channel is an entry point: forward one email to an address, paste a screenshot, read a receipt aloud on a call, and the agent has already drafted the cancellation before OAuth exists. E is that wedge. OAuth becomes the upsell after value, which inverts every consent funnel in the industry.
2. Provenance as the product. Your append-only ledger with per-source trust and quarantine is the thing nobody else has. L makes it user-facing; B is its loudest bubble. Extend it and you have a consumer-grade "what my agent knows, who told it, what it refused" record, the first agent that shows you the attacks it deflected. Enterprises will pay for that trail long before consumers notice they want it.
3. The thread as the OS. No buttons, no forms, only what iMessage carries. That constraint is a moat: it forces the agent to be legible in the medium humans already trust.

Start now, with current resources:
- Ship A as a pluggable "stakes scanner" interface, not a Gmail-specific function; the next input is a pasted email (E), then a forwarded one.
- Make the ledger's per-fact source a first-class API today (L), so the brain view, confirmations, and B's catch-bubble all read from one seam.
- Treat every quarantine event as a product moment, not a log line.

PICKS: A, E, L

### The Outsider

I don't understand why…
- …a piece of software is calling my phone during signup. If I wanted to talk to a robot on the phone I'd ring my bank. Where's the "text me instead" escape hatch, and why isn't that the default?
- …I have to name the thing before it's done anything for me. I name pets after they've shown a personality. Naming a stranger feels like homework dressed as fun.
- …"read-only Gmail" is supposed to reassure me when the very next sentence is "draft the cancellation." Draft where? Did it write into my Gmail? "Read-only" and "draft" sound contradictory to a normal person.
- …option B brags about catching a fake IT Helpdesk. My gut reaction isn't "wow, safe," it's "wait, emails can talk to this thing? What else gets through?" You've told me about a danger I didn't know existed.
- …K spends effort on a poster image. I'm signing up for an email helper, not adopting a Tamagotchi.
- …J turns my inbox into a guessing game with a score. It's my money and deadlines; I don't want it gamified.

As a prospect, I wonder…
- …what "graduate" means. Graduate to where? Is there an app? A website? I'm still in Messages.
- …E: can I just paste one email and not connect Gmail, ever? If yes, that's the first version of this I'd actually try.
- …C: "looked at 3 subject lines, nothing sent" is the first sentence in this whole brief that made me relax. Why isn't that everywhere?
- …D: who is Peak Fitness to you? How did you know before I told you? A stated plan beforehand would have stopped that "how did it know" chill.
- …L: "forget" button — does it actually delete, or just hide?

Should be obvious in 5 seconds but isn't:
1. Whether this thing can send anything on my behalf. Yes/no, up front.
2. That I can do the whole thing by text and never take the call.
3. What I get if I stop halfway — is there a "just the gym cancellation, thanks, bye" exit?

PICKS: E, C, D

### The Executor

One developer, one evaluator incoming, real inboxes after. Rule: build only what reuses code you already verified, adds no new input surface, and would be embarrassing to lack in production.

B — the catch, said out loud. Cost S, one to two days. The quarantine already fires; you add a server-side templated bubble keyed off that event with a once-per-session flag in Postgres. No model in the loop, so no new injection path. It converts your poisoned email from a hidden defense into the single most memorable moment an evaluator will see.

D — consent as a stated plan. Cost S–M. This is not a nice-to-have: Google's restricted-scope review and any real user will ask "what did you search?" The pre-card plan is a template filled from the stated need; the post-card "executed query" line subsumes the useful half of C's receipts. "Disconnect Gmail" must exist before the first real inbox anyway. Build it now, in both channels, one handler.

A — inbox-derived stakes. Cost S–M, the one with real complexity. You already have the Peak Fitness value moment; A generalizes it into a deterministic ranker (money posted, money pending, dated asks, named people) plus a three-item "which first?" bubble and a precomputed draft. It replaces the form question with the product's actual job.

Rejected: C (covered by D+A), H (depends on A, do it after), E (new paste surface, M cost), K (gimmick), I/F/G/J (polish, later).

Week 1: Ship B and D. Test: 20 runs with the injection email, bubble appears exactly once in 20/20; "disconnect Gmail" leaves zero gmail-sourced ledger rows (verified by SQL) and revokes the token.
Month 1: Ship A against the 20-email inbox plus three real inboxes. Criterion: top-ranked item is money or a dated deadline in at least 80 percent of runs; need stated within two user turns in at least 70 percent of sessions. Then H.
Month 3: Ten-user real-inbox pilot. Criteria: Gmail connect rate above 60 percent, zero instruction leakage across 50 seeded poisoned emails, then decide on I and C.

PICKS: A, B, D

### Vote tally

| Cluster | Votes | From |
|---|---|---|
| D. Consent as a stated plan | 4 | Contrarian, First Principles, Outsider, Executor |
| B. The catch, said out loud | 3 | Contrarian, First Principles, Executor |
| E. Paste one email first | 3 | First Principles, Expansionist, Outsider |
| A. Inbox-derived stakes | 2 | Expansionist, Executor |
| C. Receipts | 2 | Contrarian, Outsider |
| L. Provenance made visible | 1 | Expansionist |
| F, G, H, I, J, K | 0 | |

## 4. Anonymisation mapping used for peer review

Response A = Executor · Response B = Outsider · Response C = Contrarian · Response D = Expansionist · Response E = First Principles Thinker.

## 5. Peer reviews

Reviewers were five fresh subagents (not the advisors), each shown all five responses anonymised.

### Reviewer 1

1. Strongest: A (Executor). It's the only response with cost tags, a build sequence, rejection rationale for every excluded cluster, and falsifiable success criteria (20/20 bubble fires, SQL-verified revoke, 80% top-item accuracy). It treats B/D/A as a dependency chain rather than three isolated picks.
2. Biggest blind spot: D (Expansionist). A vision pitch that never engages the brief's core constraint, surviving hostile users and poisoned emails. It picks A and E (both new or expanded input surfaces) without addressing the fatal-flaw critique that a stakes-ranker and a pre-OAuth paste box are exactly what injection content is optimized to exploit.
3. What all five missed: several favored features conflict with "no proactive messages after graduation": H's dated open loop and E's "watch for the rest" both imply the agent re-initiates later. L's page and the Outsider's "graduate to where?" expose that a per-fact-source page is an out-of-thread surface, in tension with "thread can only carry what iMessage carries". None considered voice or voicemail transcripts as an injection vector parallel to poisoned email.

### Reviewer 2

1. Strongest: C (Contrarian). The only response that finds a concrete technical contradiction rather than ranking preferences: A's ranker optimizes for the same signals phishing mail optimizes for, so "lead with top item" plus "draft before asked" hands the attacker the steering wheel. Backed by a falsifiable spike test, catches a second real bug (B's template interpolating attacker-controlled text), and gives a concrete fix.
2. Biggest blind spot: B (Outsider). Written entirely as user-complaint vignettes and never engages the adversarial requirement. Its picks are justified by comfort, not threat modelling.
3. What all five missed: the append-only ledger vs "delete" contradiction. D and L both promise deletion and a forget button; the Outsider even asks "does forget actually delete, or just hide?" but nobody resolves it. You cannot literally delete from an append-only store, only append a retraction. Two of the most popular picks depend on deletion being real for trust credibility. Also: none simulated their three picks as a combined end-to-end flow (E's paste-before-OAuth vs D's stated-plan-before-card: which comes first?), and none considered hostile users attacking via chat rather than via email.

### Reviewer 3

1. Strongest: C (Contrarian). The only one that stress-tests picks against the brief's own constraint. Falsifiable engineering critique, not taste.
2. Biggest blind spot: D (Expansionist). Never engages adversarial robustness; a "pluggable stakes scanner" is precisely what becomes the attacker's delivery mechanism; ignores the Outsider's channel-friction objection entirely.
3. What all five missed: (a) none checked whether their own three picks compose into one coherent conversation (does D's stated plan restate A's ranking criteria? does C's receipt duplicate D's query line?). (b) "Graduates early once a need is stated" means many real users may never reach Gmail at all, making post-Gmail picks (A, C, H, I) unreachable for a possibly-majority segment, while pre-Gmail turns are where nearly everyone lands. Nobody weighted picks by reach.

### Reviewer 4

1. Strongest: C (Contrarian). Produces a falsifiable failure mode and catches an injection surface inside B itself, then fixes it.
2. Biggest blind spot: D (Expansionist). Recommends exactly the combination C proves dangerous without acknowledging the conflict. No cost, no failure mode, no test criterion.
3. What all five missed: (a) H creates a promise the system is structurally forbidden to honour if it implies follow-through. (b) Every pick is reasoned about in the text thread; none discuss how a stated plan, a catch-bubble, or a stakes ranking works for a user who only ever calls. (c) Nobody raises that Gmail-derived ranking and ledger data is largely about third parties (senders, named people "waiting") who never consented to being scanned, ranked, or logged.

### Reviewer 5

1. Strongest: C (Contrarian). Falsifiable catch, concrete kill-test, finds the injection surface in B, ties C's receipt to D's server-enforced query so the claim is provably true.
2. Biggest blind spot: B (Outsider). Sharp on UX friction but never engages the security brief; picks E and C without noticing E opens a new paste surface or that C's receipt is only honest if D's scoping is enforced.
3. What all five missed: every response reads "hostile" as "poisoned email", never as a hostile user or hostile voice channel. None ask whether a user's own claims ("I already connected Gmail") get trust-scored, whether transcribed call audio inherits the same quarantine as email bodies, or whether cross-channel shared state and resume can be hijacked (someone else picking up the call, or manipulating the graduation trigger to skip Gmail or name capture).

## 6. Chairman verdict

See the "Council verdict" section of `docs/engagement-proposal.md`; reproduced here for completeness.

### Question

Which three of twelve clustered additions should be built into the Persona onboarding for a production product, judged as genuinely good rather than demo gimmicks, with originality as tiebreaker?

### Where the council agrees

- D (consent as a stated plan, one-sentence disconnect) is the only cluster four of five advisors chose independently. The Executor calls it mandatory for Google review and real users; the First Principles Thinker calls reversibility the production metric; the Outsider says it would have prevented the "how did it know" chill.
- B (the catch, said out loud) got three votes and is the highest-originality viable candidate (4/5). Everyone who picked it noted it costs a template and a hook and puts no model in the loop.
- Value should precede permission. First Principles, Expansionist and Outsider all converge on E; the Executor's plan also front-loads the trust items before the inbox scan.
- Texture (F, G, I, J, K) is not where the next effort belongs. Zero votes across five advisors; the build already has the most texture.

### Where the council clashes

- A (inbox-derived stakes). Executor and Expansionist see it as the product's actual job. The Contrarian calls it the fatal flaw: an urgency ranker is a phishing delivery mechanism, and a whole-inbox scan reads more than any user consented to. Four of five reviewers sided with the Contrarian. Resolution: A does not ship until the poisoned email is run through a prototype ranker and stays out of the top three.
- E (paste one email first). First Principles, Expansionist and Outsider want it as the wedge that inverts the consent funnel. The Executor rejects it on cost and as a new input surface; the Contrarian does not pick it. Originality is only 2/5 (Pine AI, Carly). Reasonable advisors disagree because E's value is production reach (everyone hits the pre-Gmail turns) while its cost is a second quarantine path.
- Stacking trust features. The Contrarian warns B, C, D and L together make the bot "a narrator of its own paperwork". First Principles agrees: three picks from one family is the failure mode.

### Blind spots the peer review caught

- Append-only means "retract", not "delete". D and L must say "I've dropped it and kept a note that you asked" rather than "deleted"; token revocation at Google and deleting the `oauth_tokens` row are real deletions and can be stated flatly.
- Reach. Many users graduate before Gmail. Post-Gmail features (A, C, H, I) are invisible to them; pre-Gmail features (D's plan, E) are seen by nearly everyone.
- Nobody scripted the three picks as one conversation, or as a call-only flow. Sequencing E before D before the card needs a written script.
- Voice transcripts and user claims ("I already connected") are injection vectors too. The current design trust-scores `user_call` at 0.6 and gates `search_gmail` on server state, which covers the second; the first should be verified.
- Third-party consent: senders and "people waiting" are logged and ranked without consenting. Keep third-party data display-only and out of the ledger unless the user confirms it.
- B's template interpolates attacker-controlled text; whitelist and truncate. The Outsider's reaction ("emails can talk to this thing?") means the bubble must state the rule, not dramatise the danger.

### Recommendation

Build D, B, and a reshaped E. Not A, despite two votes, until the spike passes.

1. **Consent as a stated plan, with one-sentence disconnect (D).** Highest agreement, needed for production regardless, seen by every user who reaches the Gmail ask, and the reversibility the product's credibility rests on. Word retraction honestly.
2. **The catch, said out loud (B).** Highest originality among viable picks, smallest build, server-authored so it cannot be forged, and it turns the evaluator's injection test into the product's best trust moment. Ship with whitelisted interpolation, rule-stating wording, and fire it on pasted content as well as email.
3. **One email before the keys (E, reshaped).** Take the paste/screenshot step from E, run A's deterministic stakes extraction on that single user-chosen artifact (where the Contrarian's ranking attack does not apply because the user picked the item), deliver the draft, then hand off to D's stated plan for Gmail. This keeps A's best mechanic, reaches every user, answers the "cancel consent → still useful" test, and defers the whole-inbox ranker behind the spike. Originality of the combination is a 3: Pine and Carly do try-before-link, nobody does stakes extraction plus draft plus a stated Gmail plan in one thread.

Runners-up in order: A after the poisoned-email spike, L as the natural extension of D once a memory page exists, H after A, C's call-notes receipt as polish.

### One thing to do first

Before writing code, write the three picks as one script: the text flow and the call-only flow, from opener through paste, draft, stated plan, OAuth, catch bubble, and "disconnect Gmail". This is the gap every reviewer found (nobody composed the picks), it costs an hour, and it decides the sequencing questions (E before D, how the catch reads on a call) that would otherwise be decided by accident in the prompt files.
