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
