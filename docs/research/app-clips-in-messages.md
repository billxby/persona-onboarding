# App Clips in iMessage for Persona onboarding

Research pass, 2026-09-25. Apple doc quotes were pulled from the JSON backing
`developer.apple.com/documentation/appclip/*`; cited URLs are the canonical pages.
Items marked UNVERIFIED were not confirmed by a primary source.

## TL;DR

Ship Gmail-connect as a **web link first**; add the **App Clip card as a progressive
enhancement on the same URL** once Persona has a real iOS app in the store.

1. The App Clip bubble in Messages requires the **sender to be in the recipient's
   Contacts**. A new assistant texting a new user fails that on first contact and
   gets a plain link (if "known") or a non-tappable URL (if "unknown").
2. The clip flow is ~2 system interstitials longer than the web flow for OAuth.
3. A clip needs an **approved full app with equivalent functionality**; the Messages
   card cannot be tested publicly before approval.
4. OAuth should be server-side (Google web client) in both variants, so the clip adds
   no security benefit for Gmail-connect.

Where a clip earns its place later: a native "name your assistant + Sign in with
Apple + allow 8-hour notifications" moment, the built-in App Store upsell, and
keychain/App Group handoff so the full app never asks the user to log in again.

## What an App Clip is

- Lightweight version of an app; not on the Home screen; removed after inactivity.
  https://developer.apple.com/documentation/appclip
- Always requires a parent app; submitted together.
  https://developer.apple.com/documentation/appclip/configuring-the-launch-experience-of-your-app-clip
- Bundle ID `<Parent>.Clip`, fixed after first upload.
- iOS/iPadOS only.
- Size: 10 MB (iOS ≤15), 15 MB (iOS 16), digital-only iOS 17+: docs say 100 MB,
  WWDC23 said 50 MB (UNVERIFIED which). Irrelevant for a Gmail-connect clip.
  https://developer.apple.com/documentation/appclip/choosing-the-right-functionality-for-your-app-clip
- Launch surfaces include "Tapping a link that someone shares in the Messages app (as a text message only)".
- Lifecycle: removed after 30 days of non-use; data deleted after 10 days (30 with Sign in with Apple).
  https://support.apple.com/en-us/102093
- Notifications for up to 8 hours after each launch (`NSAppClipRequestEphemeralUserNotification`).
  https://developer.apple.com/documentation/appclip/enabling-notifications-in-app-clips
- No background execution. Full app replaces the clip once installed.

## App Clips in Messages

- Renders as "a special app clip link bubble, which gives the user a choice to open the
  link in the app clip, or in Safari" (WWDC20). Preview image from `og:image`.
  Tapping shows the system App Clip card: header image 1800x1200, title ≤30 chars,
  subtitle ≤56 chars, verb Open / View / Play.
  https://developer.apple.com/videos/play/wwdc2020/10146/
  https://developer.apple.com/documentation/appclip/supporting-invocations-from-your-website-and-the-messages-app
  https://developer.apple.com/design/human-interface-guidelines/app-clips
- Card content is static per App Store Connect experience; no runtime personalisation.
- **Contacts requirement (Apple text):** recipient's device "Contains the sender as a
  contact in the Contacts app." Must be sent over iMessage, not SMS.
  https://developer.apple.com/forums/thread/665827
- Unknown senders: "Links aren't tappable for Unknown iMessages." Known = in Contacts
  OR you have replied at least once. iOS 26 filters unknown senders to a separate
  folder. https://developer.apple.com/forums/thread/76124
  https://support.apple.com/guide/iphone/screen-and-filter-texts-iph203ab0be4/ios
- Link previews only render when the URL is alone and at the start/end of the message.
  https://loopmessage.com/helpdesk/link-preview-behavior-on-ios
- Whether "replied once" is enough for the *App Clip* bubble (vs plain preview): UNVERIFIED.
- Whether the card renders for links sent from a Mac / iMessage API / Messages for
  Business account: UNVERIFIED. Test empirically with the real sending stack.

### Setup

- Default experience in App Store Connect → default link
  `https://appclip.apple.com/id?=<bundle_id>&key=value` (iOS 16.4+).
- Own domain: Associated Domains `appclips:yourpersona.com`; AASA
  `{"appclips":{"apps":["TEAMID.com.yourpersona.app.Clip"]}}`.
  https://developer.apple.com/documentation/appclip/associating-your-app-clip-with-your-website
- Page meta: `<meta name="apple-itunes-app" content="app-id=…, app-clip-bundle-id=…, app-clip-display=card">` + `og:image`.
- Messages invocation only works after a version with the clip is **published**.
  https://developer.apple.com/documentation/appclip/testing-the-launch-experience-of-your-app-clip

## Capabilities inside a clip

Unavailable at runtime: AppIntents, BackgroundTasks, CallKit, Contacts, EventKit,
HealthKit, HomeKit, Messages/MessageUI, PhotoKit, Speech, and more. No Calendar,
Contacts, Files, Health, Messages, Reminders, Photos data. No background networking.
Location only When-In-Use.

Allowed: SwiftUI/UIKit, Apple Pay, Sign in with Apple, camera/mic, Live Activities,
8-hour notifications, and **OAuth via `ASWebAuthenticationSession`**
(`init(url:callback:)`, `.https(host:path:)` callback needs iOS 17.4+).

Reserve for the full app: extensions, In-App Purchase, custom URL scheme registration,
requestReview.

HIG: "Avoid using web views in your App Clip… offer a quick link to your website instead."

### Google OAuth from a clip

- Google forbids embedded user agents; ASWebAuthenticationSession is fine.
  https://developers.google.com/identity/protocols/oauth2/policies
- UNVERIFIED: whether Google's console accepts `…app.Clip` as an iOS client and whether
  the reversed-client-ID scheme works in a clip. No public example found.
- Safe path: **server-side flow with a Google web client.** Clip opens
  `yourpersona.com/oauth/google/start?t=…` in ASWebAuthenticationSession with an
  `.https` callback; the server exchanges the code and stores tokens; the clip never
  touches Google tokens.
- Gmail scopes are restricted: verification "can potentially take several weeks" plus
  a CASA assessment, regardless of clip vs web.

## Data sharing, upsell, review

- Shared App Group / `UserDefaults(suiteName:)`; keychain migrates to the full app on
  iOS 15.4+. Don't store secrets in the shared container.
  https://developer.apple.com/documentation/appclip/sharing-data-between-your-app-clip-and-your-full-app
- `SKOverlay.AppClipConfiguration` for the install upsell. "Don't require users to
  install your app to complete a task."
- Review: guideline 2.5.16(a) all clip functionality must be in the main app; 4.2
  minimum functionality; 4.8 offer Sign in with Apple if Google Sign-In is the primary
  login; 3.1.1 IAP for digital goods (clips should not do IAP; a Stripe link sent
  in-thread is allowed by 3.1.3).
  https://developer.apple.com/app-store/review/guidelines/
- 90% of submissions reviewed in <24 h; clip availability can lag a day or more.

## Comparable products

Panera, ExxonMobil, ParkWhiz, Spin, Lime, Toast, DoorDash (live default link), TikTok
(WWDC21 Messages preview), Confide. **No AI-assistant product using App Clips was
found.** Poke uses Apple Messages for Business; its Gmail-connect mechanism is
UNVERIFIED. No documented "connect your account" App Clip flow anywhere.

## Alternatives for the Gmail step

| Option | Taps (sender known) | Notes |
|---|---|---|
| Plain web link | ~4–5 | No review, iterable daily, works everywhere. Same unknown-sender block. |
| App Clip card | ~6–7 | +2 system interstitials; needs approved full app; sender in Contacts; iOS only. |
| Sign in with Apple JS | n/a | Identity only, no Gmail. |
| iMessage app extension | worst | Needs install first; can't run OAuth properly. |
| Messages for Business auth message | ~3–4 | Native in-thread OAuth sheet; needs Apple-approved MSP + brand review; Google as provider UNVERIFIED. |

## Concrete flows for Persona

**A. "Meet your Persona" clip:** text `https://yourpersona.com/start?t=<token>` → (if in
Contacts) App Clip bubble → card "Persona — Set up your assistant" → one native screen:
name, Sign in with Apple, Connect Gmail (server-side OAuth) → 8-h notifications
("Your Persona will call in 2 minutes") → SKOverlay upsell.

**B. Hybrid (recommended):** the same `/start?t=` URL renders the App Clip card when
possible and is otherwise a normal web page running the identical server-side OAuth.

**C. Later steps:** calls need nothing from the clip (CallKit unavailable anyway);
payment on the web or via IAP in the full app.

## Cheap empirical tests to run first

Send an App Clip URL (e.g. DoorDash's `appclip.apple.com` link) from Persona's real
sending number to a test iPhone (a) not in Contacts, (b) after one reply, (c) after
adding to Contacts, and record what renders.
