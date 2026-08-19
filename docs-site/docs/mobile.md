---
id: mobile
title: Mobile
sidebar_label: Mobile
---

The single most consequential fact in this project, and the reason several
features exist.

## A phone kills a waiting invite within seconds

A browser closes an `RTCPeerConnection` when it suspends the page — see
[w3c/webrtc-pc#2489](https://github.com/w3c/webrtc-pc/issues/2489), where Chrome
did it **without firing any event**. On a phone, switching to a messenger to paste
an invite link is exactly that.

Field testing on two Android phones: **a couple of seconds** before the invite is
dead. Only **DuckDuckGo and Safari** have been seen to hold one for around ten.

Desktop is unaffected.

There is no fix in the library. A relay would fix it; nothing in the page can.

## What follows from it

| in the demo | why |
| --- | --- |
| `leavingSuspendsUs()` | named for what matters, not for "is this a phone" |
| the *hurry back* hint | shown at the tap that sends someone away — a warning on the way *back* is a post-mortem |
| the connection-health readout | records state on the way out and on the way back; nobody can watch a backgrounded screen |
| `BROWSERS_THAT_HOLD` | the single place to change when this stops being true |

**A wake lock does not help.** It holds the screen, not the page, and the browser
drops it the moment the page is hidden. It is worth having for scanning — a
screen that sleeps mid-scan is its own problem — but it is not a fix for this.

## What can help: keep the page playing audio

A page that is playing audio is not a page Chromium freezes. That is the whole
mechanism, and `createKeepAlive()` is it.

```js
import { createKeepAlive } from '@le-space/libp2p-webrtc-qr'

const keepAlive = createKeepAlive({
  track: 'audio/waiting.mp3',
  metadata: { title: 'Waiting for the other phone', artist: '…' }
})

// Inside the gesture that produces the invite - before anything awaits.
await keepAlive.start()

// The moment the connection is up, or the attempt is abandoned.
await keepAlive.stop()
```

| option | default | meaning |
| --- | --- | --- |
| `track` | — | URL of an audio file to loop. Without one it runs near-silent |
| `silent` | `false` | run inaudibly even with a `track` |
| `volume` | `0.35` | applies to `track` only |
| `metadata` | — | `{ title, artist }` for the platform's media notification |

Properties: `running`, `supported`. Methods: `start()` → `Promise<boolean>`,
`stop()`.

Three things about it are deliberate:

- **`start()` must be called from a user gesture.** An `AudioContext` begins
  suspended under the autoplay policy and a resume outside a gesture is refused.
  By the time ICE has gathered there is no gesture left to spend.
- **Audible by default.** Silence is the failure mode: a stream the browser
  judges inaudible stops counting as playback, and the page is frozen anyway
  with nothing to show for the battery. Audible also earns a media notification,
  which is a labelled one-tap way back into the app.
- **It is not a wake lock, and neither substitutes for the other.** One holds the
  screen, the other keeps the page alive.

**Whether this survives a real app switch on Android is unsettled.** The
mechanism is verified — the graph starts, loops and is released — and that is
all. Settling it needs two phones and a messenger; the experiment is written out
in [AGENTS.md](https://github.com/NiKrause/libp2p-webrtc-qr/blob/main/AGENTS.md).
## The rest of the toolkit

`createKeepAlive()` above is one of four parts of the same problem. The others:

| | |
| --- | --- |
| `leavingSuspendsUs()` | does leaving suspend this page - the gate for showing any hurry-back warning |
| `BROWSERS_THAT_HOLD` | browsers observed to hold a waiting invite ~10s. **Read this list rather than copying it** - two copies stop matching |
| `createWakeLock()` | keep the *screen* awake: `sync(active)`, plus `supported` / `wanted` / `held` |
| `stateOf(peerConnection)` | one word for what a connection is doing |
| `pendingConnections(session)` | every connection a session owns - `offers` **and** `inbound` |

```js
import { leavingSuspendsUs, createWakeLock, stateOf, pendingConnections } from '@le-space/libp2p-webrtc-qr'

if (leavingSuspendsUs()) {
  // Only here is a hurry-back warning true. A desktop shown one learns to
  // ignore warnings.
}

const wakeLock = createWakeLock()
await wakeLock.sync(codeIsOnScreen)          // also from `visibilitychange`

const died = pendingConnections(session).some(c => stateOf(c.peerConnection) === 'closed')
```

`pendingConnections` covers **both** halves and it is easy to remember only one:
`offers` are invites waiting for an answer, `inbound` are connections built from
an offer this peer accepted. Iterating one reports health for half the
connections and silence for the other.

`wanted` and `held` on the wake lock are separate because only the first is
yours to get right - a headless browser exposes the API and then refuses every
request, having no screen to keep awake.

## Explaining it first

`<qr-intro>` puts the caveats above in front of somebody before they need them,
next to a live verdict — and `createIntroPolicy()` decides when.

```js
import { createIntroPolicy } from '@le-space/libp2p-webrtc-qr/elements'

const policy = createIntroPolicy({ storageKey: 'myapp.introSeen' })

if (policy.shouldOpen({ arrivedViaInvite })) {
  await intro.open()          // measures once, with probeNetwork
}

intro.addEventListener('close', event => {
  if (event.detail.remember) policy.remember()
})
```

The app's own explanation goes in the slot; the caveats and the verdict come
from the element. Set `technical` to show the caveat list — in an app with a
simple and a technical view, that attribute is what the switch drives.

Three rules in the policy, each a decision somebody would otherwise make the
other way:

- **Arriving by invite suppresses it.** That person came to accept something,
  and a dialog in front of it is in the way of the only thing they came for.
  They see it on their next plain visit — so suppressing does *not* mark it seen.
- **Blocked storage shows it.** An introduction seen twice is a smaller problem
  than a first-time user who never gets one.
- **`forget()` exists.** Dismissing must not be a one-way door.

Its text is translatable like every other element's: `QR_INTRO_STRINGS` holds the
English defaults, `QR_INTRO_STRINGS_DE` the German. `QrIntroElement` is exported
for framework wrappers and for registering under another tag name.

## Detecting the situation

```js
navigator.userAgentData?.mobile === true ||
  window.matchMedia('(hover: none) and (pointer: coarse)').matches
```

Not a user-agent string. The question is whether leaving the page suspends it,
which is what those two signals answer.

## Chrome on Android and IPv6

Chrome on Android as an installed PWA reports no IPv6 reflexive candidate where
Firefox and DuckDuckGo on the *same phone and same Wi-Fi* report one. On mobile
data with carrier NAT and no IPv6, that leaves no path off the network at all —
which is what `offNetworkRisk() === 'unreliable'` is for. See
[Network readiness](network).

## Warnings belong where they are true

A desktop renders none of these hints, so a screen reader cannot find advice that
is false there. A warning shown everywhere is a warning worth ignoring.
