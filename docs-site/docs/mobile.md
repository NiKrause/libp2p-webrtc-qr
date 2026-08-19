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

Three rules in the policy are worth knowing, because each is a decision somebody
would otherwise make the other way:

- **Arriving by invite suppresses it.** That person came to accept something,
  and a dialog in front of it is in the way of the only thing they came for.
  They see it on their next plain visit — so suppressing does *not* mark it seen.
- **Blocked storage shows it.** An introduction seen twice is a smaller problem
  than a first-time user who never gets one.
- **`forget()` exists.** Dismissing must not be a one-way door.

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
