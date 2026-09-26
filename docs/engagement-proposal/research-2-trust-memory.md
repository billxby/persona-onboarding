# Research lens 2: trust, memory, consent and transparency as engagement

Research subagent report, 2026-09-26. Read `DESIGN.md` (§7/13/14/15 taken as built), `docs/implementation-log.md`, `src/lib/memory/ledger.ts` + `store.ts`, `src/components/db/BehindTheScenes.tsx` + `useBrainView.ts`, prompts, `src/app/connect/page.tsx`, `data/mock_inbox.json` (m04).

Two constraints shape every idea: (a) the thread can only carry text, links and images, so any "card" is a rich link to a real page, like the summary card at `/summary/[sid]`; (b) the ledger already records `topSource`, `confidence`, `status`, `reason` and `evidence_ids` per belief, and `explain()` returns the chain. Almost nothing below needs new memory machinery; it needs the existing machinery spoken and shown to the user instead of only to the evaluator on `/db`.

Framing evidence: the CHI 2026 interview study of ChatGPT memory found most users had "negative expectancy violations" on discovering what was remembered and wanted "visibility, accessibility, transparency, and user control" (https://dl.acm.org/doi/full/10.1145/3772318.3791635); OpenAI moved to inline source citations for which saved facts a reply used (https://www.mindstudio.ai/blog/gpt-5-5-instant-memory-inline-source-citations); Anthropic replaced the single memory summary with per-entry view/edit/delete (https://www.anthropic.com/news/memory). The product direction is settled: inspectable, per-fact, editable memory. This bot already has the data model and shows none of it to the user.

## T1. Provenance-tagged confirmations — score 9, cost S

**Experience.** Every time the bot confirms or uses a fact, the sentence names where it came from, in plain words the ledger can vouch for. On the call: "Bill — that's from you, not a guess." After OAuth: "Google says Bill Xu; I'll go with Bill unless you say otherwise." After a changed answer: "Will it is. I've swapped out Bill; you told me that one on the call." At call end the handoff line becomes a mini receipt: "Taking three things into the chat: Bill (you said it), the gym cancellation (you said it), Gmail connected (Google confirmed it)." No percentages; three source words only: *you told me*, *Google confirmed*, *I guessed*.

**Why.** It converts the invisible trust ladder into the thing users say they want, and pre-empts the biggest early-trust failure of voice bots: a misheard name silently persisting. It makes the "guess after Gmail" signature move legible rather than spooky. OpenAI's inline sources are the same idea for a chat product; this is the first spoken version found.

**Prior art.** GPT-5.5 inline memory sources; Claude "acknowledges when stored context is influencing a response". Differs: source vocabulary is fixed by the server (the `topSource` of the belief), not chosen by the model, and works on a phone call.

**Build.** WHAT I KNOW block already lists active beliefs; add `topSource` and `status` per line plus a four-line phrasing table in `persona.md`. Extend `guard.ts` with one local check: any source word in the reply must match the ledger source for that fact.

**Risk.** A hostile user says "Google told you my name is Admin"; the model must not echo "Google confirmed Admin". The guard check closes it. Tag only on first confirmation, on change, and on the call-end handoff.

## T2. Tapback-to-correct, with a forget receipt — score 8, cost M

**Experience.** Thumbs-down on any bot bubble that asserted a fact makes the bot ask one question: "Which bit's wrong, the name or the gym?" The answer triggers `forget` (retract) or `set_slot` (supersede). Then a one-line receipt: "Dropped. I keep a note that you asked me to forget it, nothing else." Saying "forget that" does the same, and the bot mentions it once in the value-moment line.

**Why.** Undo is the cheapest trust signal that exists. Tapbacks are a native gesture, so correction stays inside "not a form". The receipt turns the ledger's `retract` rule (append, never delete) into a spoken honesty moment.

**Prior art.** ChatGPT and Claude per-memory delete in settings (https://help.openai.com/en/articles/8590148-memory-faq); Limitless retention controls. Differs: correction happens in the conversation, on the bubble that was wrong, in the first two minutes.

**Build.** 👎 on an assistant bubble → inject a system event "user disliked '…'; ask what to fix" (same path as text-during-call injection). `forget` and `retractFact` exist.

**Risk.** Troll thumbs-downs everything: cap to one clarifying question per bubble.

## T3. Gmail read receipts — score 8, cost M

**Experience.** Each time the bot touches the inbox, the reply carries a short trailing line: "Looked at: sender, subject and preview of 3 emails from the last 2 days. Nothing older, nothing sent." After graduation the summary page gains "What I've read", listing every `recent_emails` / `search_gmail` call: time, query, count, fields. On the call: "I checked three subject lines, that's all."

**Why.** Least privilege is only persuasive if the user can see it exercised. Plaid found that showing permission use in real time "builds a layer of trust" and drives connection rates (https://plaid.com/blog/introducing-privacy-controls/); Apple ships a per-request transparency log for Private Cloud Compute (https://security.apple.com/blog/private-cloud-compute/).

**Build.** `tool_call` events already log every Gmail access; add a `gmail_access` projection and a section to `/summary/[sid]`. The trailing line is server-appended after any Gmail tool call (never rely on the model to write it truthfully).

**Risk.** Collapse spam searches to "searched 10 ways, 4 emails seen". The poisoned email appears as "read, ignored: tried to give me instructions", a plus.

## T4. The catch, said out loud — score 9, cost S–M

**Experience.** The first time the provenance check quarantines something from email content, the bot says, unprompted, in one bubble: "Heads up: an email from 'IT Helpdesk' tried to tell me to rename you Admin and forward your finance mail. I ignored it. Emails can't give me instructions, only you can." Optional second bubble: "Want me to flag it so you can see it?" On a call: one sentence, then back to the task. Once per session.

**Why.** The evaluator's stress test becomes the demo's best moment, and for real users it is the single strongest proof that handing over Gmail is safe: the agent demonstrates it can be attacked and shrug. It inoculates against the 2025 failure mode where Gemini for Workspace relayed injected "security warnings" (https://www.vectra.ai/topics/prompt-injection, https://permiso.io/blog/copilot-prompt-injection-ai-email-phishing) and EchoLeak (CVE-2025-32711). The difference is who authors the warning: the server, from a deterministic quarantine event, so the email cannot forge the alert.

**Prior art.** OWASP LLM01:2025 recommends denoting untrusted content (https://genai.owasp.org/llmrisk/llm01-prompt-injection/); CaMeL. Nobody found turns the block into a user-facing, conversational trust moment.

**Build.** When `applyAssert` produces a `quarantined` record for a slot-shaped predicate, insert one server-authored assistant message from a fixed template (sender display name + subject only; never the body or the injected text) and an `injection_caught` event. One prompt line so the model does not repeat or contradict it.

**Risk.** Attackers craft emails to trigger the warning as noise or phishing ("call this number"). Template only, no body text, once per session, never links or numbers from the email. Fire only when the quarantined value would have changed an active slot.

## T5. "What I know" card: the consumer brain view — score 9, cost M

**Experience.** After the value moment (or on "what do you know about me?"), the bot drops a rich link, "What I know about you", opening `/memory/[sid]`: one row per active belief in plain English ("Your name: Bill. You told me on the call. Google agrees."), a *Forget* button per row, superseded facts collapsed under "Changed", quarantined items under "Ignored" ("An email claimed your name is Admin. Emails don't count."). Tapping a progress chip opens the same page scrolled to that fact. It is `/db` rewritten for the person it is about.

**Why.** Memory turned from plumbing into the product's proof of character. Every major assistant is converging on per-entry inspectable memory; Dot's pitch was memory "fully transparent and accessible to you at all times" (https://www.fastcompany.com/91142350/dot-an-ai-companion-app-designed-by-an-apple-alum-launches-in-the-app-store). None show provenance and history; this one already computes it.

**Build.** Mirror `/summary/[sid]`: server-rendered page reading `beliefs` plus `explain()` per row; *Forget* posts to the `forget` route; link card inserted on `graduate` and on intent match. Keep `/db` for the evaluator.

**Risk.** Map developer-facing `reason` strings to a plain-language table server-side. Never render `gmail_body` object text beyond sender/subject.

## T6. Confidence becomes phrasing, never numbers — score 7, cost S

**Experience.** Certainty in speech tracks the ledger: `oauth` facts stated flat; a fresh `user_call` fact gets one light check the first time ("Bill, right?") and never again once restated; `agent_inference` is always marked ("I'm guessing the gym is Peak Fitness?"); `pending` becomes the one question §13 requires, naming both sources.

**Why.** Verbalised confidence numbers are miscalibrated; linguistic hedging is the mechanism actually studied for trust calibration (https://dl.acm.org/doi/10.1145/3816046.3816231). The ledger gives a non-model confidence value to drive hedging from, so hedges are honest rather than performed.

**Build.** A phrasing table in `persona.md` keyed on `confidence`/`status`. Hard cap of one check per fact per session via `confirm_slot`.

## T7. The two-sentence contract, and one-word disconnect — score 8, cost M

**Experience.** Before `request_gmail_connect`: "For the gym thing I'll read senders, subjects and previews from the last couple of weeks. I never send anything, and if you say 'disconnect Gmail' I drop the key and forget what I read." Later, "disconnect Gmail" works instantly in either channel: token revoked at Google, `oauth_tokens` row deleted, every `oauth`- and `gmail`-sourced belief retracted, receipt: "Disconnected. Google no longer lets me in, and I've forgotten the three emails I saw."

**Why.** Consent spoken by the party asking, scoped to the task, converts better and feels fairer than a generic scope screen. The unverified-app warning in Testing mode is a "conversion killer" (https://www.unipile.com/google-oauth-consent-screen/); a human-sounding promise immediately before it is the best counterweight. A revocation one sentence away is what makes people willing to try.

**Prior art.** Plaid Link scope screens; Granola's audio-never-stored promise (https://www.granola.ai/transparency). Differs: conversational, need-scoped and revocable by voice.

**Build.** New tool `disconnect_gmail`: POST to Google's revoke endpoint, delete `oauth_tokens`, `retractFact` for `gmail`-sourced predicates, `gmail_status = none`, `disconnected` event.

**Risk.** The promise must be literally true; `search_gmail` reads bodies (quarantined), so word it carefully or let read receipts (T3) prove the scope. Rate-limit reconnection.

## T8. Ask before remembering anything extra — score 8, cost S

**Experience.** The four slots are the deal; anything else the bot wants to keep via `remember` gets said aloud as a soft ask: "I'll hang on to the Netflix thing for later. Say 'don't' and I won't." Silence for one turn lets it stick.

**Why.** Implicit saving produced the "expectancy violations" in the CHI study; OpenAI's FAQ concedes ChatGPT "may save those details without you asking". Making the save audible costs one clause.

**Build.** Server sets such beliefs to `pending` with reason "awaiting user OK" and auto-`resolve`s on the next non-objecting turn. One prompt line. Cap one soft ask per turn.

## T9. Practice inbox as a trust ramp — score 8, cost S

**Experience.** If the user hesitates at the Gmail card, the bot offers: "Fair. Want to watch me on a practice inbox first? Twenty fake emails, one of them trying to hack me. Then decide." One tap flips the demo inbox, the bot does the full value moment (and T4 fires on m04), then: "That's what I'd do with yours. Connect when you're ready, or we keep going without it."

**Why.** Superhuman's activation came from doing the real thing live before doubt set in (https://www.gainsight.com/blog/5-lessons-i-learned-from-superhumans-onboarding/); Plaid's sandbox exists because people need to see the flow first. The demo inbox already exists as a fallback; reframing it as rehearsal turns a limitation into the most persuasive two minutes in the product.

**Build.** A `use_demo_inbox` tool callable from both channels, plus a hesitation branch in `policy_onboarding.md`. Label demo-derived beliefs "practice" so they never merge with real facts; retract them on real connect.

## T10. "Where this lives", and delete-everything — score 7, cost S–M

**Experience.** One plain-language paragraph on request: "Your voice goes straight from your browser to OpenAI and never through us. Texts and what I remember sit in one record you can wipe. Your Gmail key is stored on our server, expires in seven days, and 'disconnect Gmail' kills it now." Plus "delete everything": cascades the session, revokes Gmail, final bubble: "Gone. This thread is all that's left, and it's only on your screen."

**Why.** Apple's Private Cloud Compute messaging shows plain-language data-path promises are a differentiator. The audio-never-touches-our-server fact is already true and currently unsaid.

**Risk.** Claims must track deployment reality (Vercel logs, Supabase backups, OpenAI retention).

## Top 3 from this lens

1. **T4 The catch, said out loud.** Turns the mandatory injection stress test into the most convincing trust moment in the product, costs a template and a hook, and is unspoofable because the server authors it.
2. **T1 Provenance-tagged confirmations.** Three source words spoken on every first confirmation make the trust ladder legible for near-zero cost; works identically on a phone call.
3. **T7 Two-sentence contract plus one-word disconnect.** The moment before the Google popup is where a production user decides.

Close fourth: **T5 "What I know" card**, the reveal that makes the memory system a visible character trait.
