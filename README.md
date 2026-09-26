# Persona onboarding simulator

Web simulator for the Persona onboarding bot: an iMessage-style thread plus a
phone-call screen, both reading and writing one session record. This is
**layer 1: UI only**. The LLM brain and the voice transport are mocks sitting
behind small interfaces so the next layers drop in without touching the UI.

```bash
npm install
npm run dev      # http://localhost:3000  (phone)   ·   http://localhost:3000/db  (behind the scenes)
npm run build    # production build
npm run lint
```

Two pages:

- `/` is just the phone on a focused backdrop, scaled to fit the window. The
  `···` button bottom-right opens the simulation menu: behind the scenes,
  ring the phone, restart (archives the run), restore a previous run.
- `/db` is "behind the scenes": the session as the backend will see it. Open
  it in a second tab and it mirrors the phone live (browser storage events
  today, a socket later).

## What's here

| Area | Path | Notes |
|---|---|---|
| iMessage simulator | `src/components/imessage/` | Thread, bubbles with tails, typing dots, composer, rich action cards, in-call green banner. Real iMessage gestures: long-press / double-tap / right-click opens the blurred tapback bar + menu (Reply, Copy); tapback badges (yours blue, theirs gray); inline replies with the hooked connector; drag the thread left to reveal timestamps; hour-gap separators; Delivered → Read receipts with time |
| Call simulator | `src/components/call/` | Incoming (ringtone, accept/decline) → live (timer, real mic meter, assistant meter, live captions, mute/speaker/messages, hang up) → ended |
| Phone shell | `src/components/phone/` | iPhone bezel, status bar with live clock, dynamic island |
| Progress chips | `src/components/progress/SlotChips.tsx` | You · Your need · Gmail · My name |
| Behind the scenes | `src/components/db/`, `src/app/db/` | Slot tracker (editable), session, call controls (ring / drop / silence / inject speech), transcript with tapbacks and replies, filterable event log, previous runs, storage note |
| Stage menu | `src/components/stage/StageMenu.tsx` | Bottom-right control on the phone page |
| Runs archive | `src/lib/session/runs.ts` | Thin repository over localStorage for previous runs; `restartSimulation()` / `restoreRun()` |
| Cross-tab sync | `src/lib/session/useCrossTabSync.ts` | Rehydrates the stores when another tab writes |
| Session store | `src/lib/session/` | Types from the design doc (slots, call state, phase, events) and a zustand store persisted to localStorage |
| **Brain seam** | `src/lib/brain/` | `OnboardingBrain` interface + `MockBrain`. Swap in `getBrain()` |
| **Voice seam** | `src/lib/voice/` | `VoiceTransport` interface + `MockVoiceTransport`. Swap in `createVoiceTransport()` |
| Call controller | `src/lib/call/controller.ts` | `ring / answer / decline / hangUp / end(reason)`. Every way a call stops is one `end(reason)` |
| Audio | `src/lib/audio/` | `useMicLevel` (getUserMedia + AnalyserNode, nothing leaves the browser), WebAudio ringtone (no assets) |

## How the pieces talk

```
 UI (iMessage thread / call screen)
   │  user text, card taps, answer/hangup, speech finals
   ▼
 OnboardingBrain  ──writes──▶  session store (zustand, persisted)  ◀──reads── every component
   ▲                                    ▲
   │ captions, connect/disconnect       │ call state, captions
 VoiceTransport ◀── callController ─────┘
```

- **Storage is still an open decision.** Everything persists to localStorage
  under one key today; the `/db` page and the runs archive read only through
  the store API, so swapping in Postgres/Redis behind it changes no UI.
- **State lives in the store, not in any component.** A hangup, a decline, a
  dropped call and a closed tab are all `endCall(reason)` transitions. On reload,
  a call that was live is marked `dropped` and the brain posts the text follow-up.
- **The brain never touches React.** It gets events and calls store actions.
  Replacing `MockBrain` with a client that hits the Next.js backend is the whole
  of layer 2.
- **The voice transport only emits captions, levels and connect/disconnect.**
  An OpenAI Realtime WebRTC transport (or Vapi) implements the same five
  callbacks.

## What the mock does today

- Posts the text opener with a "Call me / Just text" card.
- "call me" (typed or tapped) rings the phone. Accepting connects the mock
  transport, which streams the call opener as live captions.
- Hang up, decline, drop and silence each produce the matching text follow-up
  from the failure-mode table, with cards like "Keep texting / Call me back".
- Tapbacks and replies are recorded on the message and logged as events. Say
  "thanks" and it hearts your message; heart one of yours first and it hearts back.
- Any other text gets an honest "(mock) not wired yet" reply.

## Not in this layer

LLM calls, slot extraction, next-best-ask policy, OpenAI Realtime / WebRTC,
Gmail OAuth, backend/Postgres, hangup beacons and silence timers. The
interfaces for all of those exist; the implementations don't.

## Considered and rejected

App Clips and iMessage apps for the "connect Gmail" hand-off. A web link already
does OAuth with zero install, App Clips can't reach the personal data an agent
wants and can't run in the background, and iOS deletes them after ~30 days of
disuse. Links work on every channel Persona might add later.
