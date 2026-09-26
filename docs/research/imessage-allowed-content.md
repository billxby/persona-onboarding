# What can appear in an iMessage thread (iOS 18 / iOS 26)

Research pass, 2026-09-25. Sender = Persona texting from (A) a regular iMessage
account (Apple ID / phone number, or an API vendor such as Sendblue, LoopMessage,
Photon, Linq) or (B) Apple Messages for Business (AMB). The simulator models **case A**
and must never render anything outside the "allowed" list. UNVERIFIED = no citable source.

## Allowed in a 1:1 thread from a regular iMessage sender

| Content | Renders as | Programmatic sender? | Source |
|---|---|---|---|
| Plain text + emoji | Gray/blue bubble | Yes | https://support.apple.com/guide/iphone/send-and-reply-to-messages-iph82fb73ba3/ios |
| Links / rich link preview | A standalone URL becomes a preview card: domain, page title, OG image or site icon; no OG metadata gives a generic gray preview. **Text before the URL splits into its own bubble**; text on both sides of the URL suppresses the preview. | Yes (LoopMessage `preview: true/false`) | https://www.idownloadblog.com/2024/03/15/how-to-send-links-without-preview-imessage/ ; https://loopmessage.com/apidocs/send-message |
| Photos / videos | Inline media bubble; 2–3 items collage, 4+ stack | Yes | https://support.apple.com/guide/iphone/send-and-receive-content-iphb66cfeaad/ios |
| Files / PDFs | Document attachment | Yes | same |
| GIF file | Animates in Messages | As a file: yes | https://support.apple.com/guide/iphone/format-text-and-animate-messages-iphe5c5af4d4/ios |
| Audio message | Waveform bubble + transcript, expires 2 min after listen | Partial (LoopMessage) | https://support.apple.com/guide/iphone/send-and-receive-audio-messages-iph2e42d3117/ios |
| Stickers / Memoji stickers | Sent as message or placed on a bubble (iOS 17.2+) | Static image: yes; placement: UNVERIFIED | https://support.apple.com/guide/iphone/send-stickers-iph37b0bfe7b/ios |
| Contact card (vCard) | Contact bubble | Yes | https://www.sendblue.com/features/vcard |
| Bubble effects: Slam, Loud, Gentle, Invisible Ink. Screen effects: Echo, Spotlight, Balloons, Confetti, Love, Lasers, Fireworks, Celebration, Shooting Star | Recipient gets a **Replay** button under the message | Yes (Sendblue `send_style`, LoopMessage `effect`) | https://support.apple.com/en-us/104970 ; https://loopmessage.com/apidocs/send-message |
| Polls (iOS 26) | "any iMessage conversation", up to 12 options | Photon | https://support.apple.com/guide/iphone/poll-people-in-a-conversation-iphde1787df4/ios |
| Conversation backgrounds (iOS 26) | Behind bubbles, either party sets | Photon | https://support.apple.com/guide/iphone/add-backgrounds-iph605fa06e4/ios |
| iMessage-app / App Clip cards | See below | Linq / Photon; App Clip needs sender in Contacts | see below |

### Interactions on a bubble

| Interaction | Details | Source |
|---|---|---|
| Tapbacks | Six classic + **any emoji, sticker or Memoji** (iOS 18+). One per person per message; stacks; only your own removable. | https://support.apple.com/guide/iphone/react-with-tapbacks-iph018d3c336/ios |
| Programmatic tapbacks | Sendblue: love/like/dislike/laugh/emphasize/question + any emoji; **only on inbound (user) messages** | https://docs.sendblue.com/api-v2/reactions/ |
| Inline reply | Swipe right or long-press → Reply; quotes the original | Apple page above; LoopMessage `reply_to_id` |
| Copy / Select | Long-press; iOS 26 adds partial Select | https://www.macrumors.com/guide/ios-26-messages-app/ |
| Translate | iOS 26 Live Translation | https://9to5mac.com/2025/09/17/heres-everything-new-in-the-messages-app-with-ios-26/ |
| Undo Send | Within 2 min; note in both transcripts | https://support.apple.com/guide/iphone/unsend-or-edit-messages-iphe67195653/ios |
| Edit | 5 times within 15 min; "Edited" label | same |
| Typing indicator | 1:1 always; groups from iOS 26 | https://support.apple.com/en-us/104972 |
| Read receipts | "Delivered" then "Read <time>" under the sender's last message | https://support.apple.com/guide/iphone/turn-read-receipts-on-or-off-iph5e713a045/ios |
| Timestamps | Swipe left on the thread | Apple page above |
| Send Later (iOS 18) | Scheduled up to 14 days | https://www.macrumors.com/guide/ios-18-messages/ |

## NOT allowed in a regular iMessage thread

- **Buttons, quick-reply chips, list pickers, time pickers, forms, carousels, inline OAuth, Apple Pay merchant payments.** These are AMB `interactive` types only, delivered through an Apple-approved MSP. https://register.apple.com/resources/messages/messaging-documentation/faq
- Rich text formatting / text effects, handwriting, Digital Touch, Memoji recording, camera effects: device-only, no vendor API.
- Reacting to your own outbound message or removing a reaction on the recipient's device (Sendblue: inbound only).
- Pinned-message banners, verified-business badges, brand-coloured headers.

## Only via Apple Messages for Business

Quick Reply, List Picker, Time Picker, Apple Pay, Authentication (OAuth2), Form
(iOS 18.4+), iMessage App message, Rich Links with `title/subtitle/imageIdentifier/style`.
Requirements: Apple Business Register, sponsoring executive, Apple-approved MSP,
Experience Review; no phone number (Business ID); **customer must initiate**; proactive
messages only transactional; **bot-only deployments rejected, live-agent escalation
mandatory**; no group chats.
https://register.apple.com/resources/messages/msp-rest-api/type-interactive ;
https://register.apple.com/resources/messages/messaging-documentation/policies

Verdict: structurally incompatible with an outbound-first AI assistant. Model case A.

## iMessage apps and App Clip cards

- iMessage-app bubble (`MSMessageTemplateLayout`): app icon + image area with
  `imageTitle`/`imageSubtitle`, `caption`/`subcaption`/`trailingCaption`; Linq renders
  an "Open" button and "Get the app" if the recipient lacks it; preview renders only
  in chats with inbound activity. https://developer.apple.com/documentation/messages/msmessagetemplatelayout ;
  https://docs.linqapp.com/guides/messaging/imessage-apps/
- App Clip card in Messages: page carries `apple-itunes-app` meta with
  `app-clip-display=card` + `og:image`; recipient on iOS 14+ **and sender in Contacts**;
  card metadata (header image, title, subtitle, Open/View/Play) from App Store Connect.
  https://developer.apple.com/documentation/appclip/supporting-invocations-from-your-website-and-the-messages-app

## Visual spec notes

- **Tapback picker:** six classic glyphs; swipe left for suggested/recent emoji and
  stickers; a grayed emoji button opens the emoji keyboard; a sticker button.
  https://www.macrumors.com/how-to/ios-use-new-tapback-reactions-messages/
- **Glyph colours (iOS 18+):** the six icons "now feature color and more detail", same
  in picker and badge. Exact per-glyph palette UNVERIFIED in text sources; anecdotes:
  heart is pink, one thumb is orange. Sample from a real device before finalising.
- **Badge:** small bubble at a fixed spot at the top of the message; stacks; tap a stack
  to see who reacted. Whether iOS 18/26 keeps blue-yours/gray-theirs or uses a neutral
  frosted material: UNVERIFIED.
- **Effects:** Replay button under the bubble; "(sent with Slam Effect)" text only on
  devices that can't play it.
- **Liquid Glass (iOS 26):** "buttons have a frosted glass look"; nav bars and menus
  float, translucent, over content; compose bar frosted; details buttons are circles.
  Specifics of the "+" button and compose pill UNVERIFIED.
  https://www.macrumors.com/guide/ios-26-liquid-glass/ ; https://www.macrumors.com/guide/ios-26-messages-app/

## Corrections to earlier assumptions

1. Polls are not group-only (iOS 26+ on all participants).
2. Digital Touch was not removed.
3. Text + link splits into two bubbles only when text is on one side of the URL.
4. AMB is effectively unavailable for an AI-first, outbound-first product.
