# Persona App Clip (native scaffold)

> **Frozen (2026-09-27).** This scaffold is kept as-is and is not being rewritten: the project's App Clip is the
> simulated one in the web phone (DESIGN §2, §19). What follows is historical context. The clip is now the app's **onboarding**, not a tour (DESIGN §19). The web wizard in
> `src/app/clip/ClipOnboarding.tsx` (welcome → three value screens → your name → a name for Persona → Google → the
> call offer → done) is the reference for the native screens; its copy is the `onboarding` block of
> `clip_content.json`, and it writes each answer to `POST <base>/api/clip/answer` and resumes from
> `GET <base>/api/clip/state`. The SwiftUI files below still show the earlier tour and demo and have not been
> updated to the wizard yet.

`ios/PersonaClip/` is the SwiftUI source for the "Meet your Persona" App Clip: a scrollable tour of
what Persona can do, the wristband, the products and how to get them, and a preview of the full
experience. It compiles (see "Type-check" below) but there is no Xcode project in this repo yet,
because an App Clip cannot exist on its own: it ships inside a full iOS app, needs a paid Apple
Developer team, an App Store Connect record and (for the Messages card) a published parent app
(https://developer.apple.com/documentation/appclip/configuring-the-launch-experience-of-your-app-clip).
The web simulator shows the same tour at `/clip` and renders the App Clip card in the thread.

## Files

| File | Purpose |
|---|---|
| `PersonaClipApp.swift` | `@main` app; reads the invocation URL (`NSUserActivityTypeBrowsingWeb`) and its `sid`. |
| `ClipContent.swift` | `Codable` models mirroring `data/clip_content.json`; `ContentLoader` fetches `<base>/api/clip/content`, falls back to the bundled copy. |
| `ContentView.swift` | The tour: hero, features grid, wristband, products, experience steps, privacy footer. iOS 17+, no packages. |
| `TryItView.swift` | "Try your Persona" demo: task chips or a typed task → `POST <base>/api/clip/demo` → the reply bubbles in a mini thread; "Continue in Messages". |
| `NotificationPrompt.swift` | "Remind me" button: ephemeral notification permission, one reminder inside the 8-hour window. |
| `PersonaClip.entitlements` | Parent-app identifier + associated domain (placeholders marked). |
| `Info.plist.snippet` | `NSAppClip` keys to merge into the target's Info.plist. |
| `clip_content.json` | Bundled copy of `data/clip_content.json` (keep in sync). |

## Create the Xcode project (Xcode 26)

1. File → New → Project → iOS → App. Product name `Persona`, bundle id `com.persona.app` (any id you own; the clip's id must be `<parent>.Clip`, fixed after the first upload).
2. File → New → Target → iOS → **App Clip**. Name it `PersonaClip`. Xcode creates the target with bundle id `com.persona.app.Clip`, an entitlements file with `com.apple.developer.parent-application-identifiers`, and an `NSAppClip` dictionary.
3. Delete the generated `PersonaClipApp.swift` and `ContentView.swift` in the clip target and drag in all of `ios/PersonaClip/*.swift`. Add `clip_content.json` to the clip target (Target Membership → PersonaClip, Copy Bundle Resources).
4. Target → Signing & Capabilities → `+ Capability` → Associated Domains → `appclips:yourpersona.com` (replace with the real domain). Merge `PersonaClip.entitlements` and `Info.plist.snippet` into what Xcode generated.
5. Set the deployment target to iOS 17.0 for both targets.
6. Keep the clip small: 10 MB uncompressed on iOS 15, 15 MB on iOS 16, larger only for digital invocations on iOS 17+ (Apple's docs and WWDC23 disagree on 50 vs 100 MB; unverified) (https://developer.apple.com/documentation/appclip/choosing-the-right-functionality-for-your-app-clip). This tour is text and SF Symbols, well under 1 MB.

## Run it locally

- Select the `PersonaClip` scheme → Run on a simulator. Without an invocation URL the tour uses the placeholder base URL.
- To test a real invocation URL: Product → Scheme → Edit Scheme → Run → Arguments → Environment Variables → `_XCAppClipURL` = `https://yourpersona.com/clip?sid=test` (https://developer.apple.com/documentation/appclip/testing-the-launch-experience-of-your-app-clip).
- Point the content endpoint at your dev machine by using `http://<your-mac-ip>:3000/clip?sid=test` as the invocation URL; the loader derives `<base>/api/clip/content` from it. (ATS may require an exception for plain http in debug builds.)

## Make the URL an App Clip URL

1. The Next app serves `/.well-known/apple-app-site-association` with `{"appclips":{"apps":["<TEAMID>.com.persona.app.Clip"]}}`; set `APPLE_TEAM_ID` and `APP_CLIP_BUNDLE_ID` in the deployment's env. The file must be served over HTTPS with no redirects and `application/json` (https://developer.apple.com/documentation/appclip/associating-your-app-clip-with-your-website).
2. The `/clip` page carries `<meta name="apple-itunes-app" content="app-id=<APP_ID>, app-clip-bundle-id=com.persona.app.Clip, app-clip-display=card">` and an `og:image`, which is what Safari and Messages use for the banner / preview (https://developer.apple.com/documentation/appclip/supporting-invocations-from-your-website-and-the-messages-app).
3. App Store Connect → the app → App Clip → **default App Clip experience**: header image 1800×1200, title ≤ 30 characters, subtitle ≤ 56, action verb Open / View / Play (https://developer.apple.com/design/human-interface-guidelines/app-clips). The card content is static per experience; it cannot be personalised at runtime.
4. Optional advanced experiences map more URL prefixes to the clip.

## Test on a device before publishing

Settings → Developer → **Local Experiences** → Register Local Experience: URL prefix `https://yourpersona.com/clip`, the clip's bundle id, title, subtitle, action and an image. A build installed from Xcode or TestFlight then launches from a QR code, NFC tag or the Safari banner for that prefix (https://developer.apple.com/documentation/appclip/testing-the-launch-experience-of-your-app-clip). Whether a local experience also renders the card inside Messages is unverified; the research notes say Messages invocation only works once a version containing the clip is published.

## Why it is a demo, not a brochure

Apple's HIG says not to use an App Clip "to advertise services or products", review guideline
2.5.16(a) requires everything the clip does to exist in the full app, and 4.2 rejects marketing-only
apps (https://developer.apple.com/design/human-interface-guidelines/app-clips,
https://developer.apple.com/app-store/review/guidelines/). So the tour opens with **"Try your
Persona"** (`TryItView.swift`): the user picks one of three tasks or types their own, the clip posts
it to `<base>/api/clip/demo`, the server runs the real brain against the demo inbox, and the reply
comes back as iMessage-style bubbles revealed ~0.5 s apart under a "Demo inbox · nothing here is
real" caption. Errors show inline; a 429 becomes "Limit reached — continue in Messages". The
features, wristband and products sections follow as context for something the user has just used.
After the demo, "Continue in Messages" opens `sms:` on a device (the thread with Persona is already
there) or the web chat for the session. When the full app exists, present the install upsell with
`SKOverlay.AppClipConfiguration` at that same moment, after the demo, never before it; Apple's rule
is "don't require users to install your app to complete a task".

## Why the Messages card is the hard part

- The App Clip bubble in a 1:1 iMessage thread only renders when the **sender is in the recipient's Contacts** and the message is iMessage, not SMS; otherwise the link shows as a plain preview, and links from unknown senders are not tappable at all (https://developer.apple.com/forums/thread/665827, https://developer.apple.com/forums/thread/76124).
- The URL must be alone in the message for the preview to render.
- The parent app must be **published** with the clip; App Store review checks that the clip's functionality exists in the full app (guideline 2.5.16) and that it is not just a web view (HIG: "Avoid using web views in your App Clip") (https://developer.apple.com/app-store/review/guidelines/, https://developer.apple.com/design/human-interface-guidelines/app-clips).
- Clips are removed after 30 days of inactivity and their data after 10 days (https://support.apple.com/en-us/102093); nothing in this tour depends on persistence.

## What the web simulator shows instead

The bot sends the `/clip?sid=` link as a rich preview; with "Persona in Contacts" toggled on, the thread shows the App Clip bubble and tapping it presents the system-style App Clip card, then the same tour inside the phone frame. On a real device the identical URL is the App Clip invocation URL, and without the clip installed it is a normal web page.

## Type-check

```
xcrun -sdk iphonesimulator swiftc -typecheck -target arm64-apple-ios17.0-simulator -parse-as-library -module-name PersonaClip ios/PersonaClip/*.swift
```
