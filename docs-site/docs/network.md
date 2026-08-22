---
id: network
title: Network readiness
sidebar_label: Network readiness
---

Usable without any DOM.

```js
import { probeNetwork, summariseNetwork, offNetworkRisk } from '@le-space/libp2p-webrtc-qr/elements'
```

| | returns |
| --- | --- |
| `probeNetwork(rtcConfiguration)` | `{ ipv4, ipv6, overall }`, each `{ state, text }` |
| `summariseNetwork(ipv4, ipv6)` | the combined verdict |
| `offNetworkRisk(result)` | `'blocked'` \| `'unreliable'` \| `null` |
| `offNetworkBlocked(result)` | narrow: `blocked` only |
| `isGlobalUnicastV6(address)` | is this address routable |
| `probeBrowser()` | `{ state, text }` — whether this browser has WebRTC and can open a data channel at all |
| `probeCamera()` | `{ state, text }` — camera availability, read from the Permissions API without prompting |

States: `open`, `relay`, `symmetric`, `blocked`.

## Which one to gate on

`offNetworkRisk` — `unreliable` is the carrier-NAT-without-IPv6 case a phone on
mobile data shows, which `blocked` misses. It went unwarned until it was reported
from a real device.

```js
if (offNetworkRisk(result) === 'blocked') { /* this network reaches nobody elsewhere */ }
```

`<qr-status>` reflects the same judgement as an attribute:
`off-network-risk="blocked|unreliable"`.

## A verdict describes this browser, not the network

The same phone on the same Wi-Fi reports IPv6 as usable in DuckDuckGo and Firefox
and absent in Chrome as an installed PWA. Whether an IPv6 reflexive candidate
appears depends on the browser build and its WebRTC IP-handling policy as much as
on the route.

The wording in the library was corrected for exactly this: it used to say "this
network offers IPv4 only", which two screenshots disproved.

**Do not** present a verdict as a fact about the network, and **do not** disable
controls on a bad one: a symmetric NAT still connects peers on the same network.

## Translating the elements

Every element takes a `strings` table that is **merged** over its defaults, so
replacing three labels does not lose the rest.

**German ships with the package.** Two consumers were translating the same three
dozen labels by hand, from the same English defaults, with no way to notice when
a string was added upstream.

```js
import { QR_STATUS_STRINGS_DE } from '@le-space/libp2p-webrtc-qr/elements'

status.strings = QR_STATUS_STRINGS_DE                      // all of it
status.strings = { ...QR_STATUS_STRINGS_DE, blocked: '—' } // with your own voice
```

`QR_STATUS_STRINGS_DE`, `QR_SCANNER_STRINGS_DE`, `QR_INVITE_STRINGS_DE` and
`QR_PEERS_STRINGS_DE` are defaults for a locale, not a finished translation of
your app.

A second locale rots differently from a README: a missing German key is
invisible, because `mergeStrings` falls through to the English and the screen
still reads as finished. The package asserts against that — same keys, same
shape per entry, and no entry left identical to the English.

## What the probe cannot see

**Wi-Fi client isolation.** Guest networks in cafes, hotels and conference
venues routinely forbid clients from addressing each other. STUN is unaffected -
it talks to the internet, which is allowed - so both peers gather reflexive
candidates, `summariseNetwork` returns `open`, and then no candidate pair ever
succeeds.

This is not a gap that better probing closes. The probe asks *can this browser
reach the internet*; client isolation is about whether it can reach **another
client on the same access point**, and no single browser can answer that alone.

Two consequences worth building on:

- **An `open` verdict is not a promise.** It says nothing was found in the way,
  not that a peer will be reachable.
- **The signature to look for is in the failure, not before it.** If both sides
  gathered `srflx` candidates from the *same* public address - so they are behind
  the same NAT - and ICE still never left `checking`, client isolation is the
  likely cause rather than NAT type. `describeIce()` carries the candidate sets
  a message would need to say so.

Reported independently by
[vbocan/webrtc-oob-pairing](https://github.com/vbocan/webrtc-oob-pairing), which
also names browser policies that disable WebRTC outright as a second cause with
the same symptom.

## STUN configuration

`DEFAULT_RTC_CONFIGURATION` asks four STUN servers, two of them over **IPv6
literals**: a reflexive candidate exists only for a family a STUN transaction
actually used. Asking only IPv4-reachable servers is how a dual-stack network
gets reported as IPv4-only.

## Which relay to try first

A scanned code needs the other person to be here. When they are not, the second
way in is a relay — and the same decision then arises in every consumer: which
addresses to try, in what order, and when a directory may be asked at all.

```js
import { findReachableRelays, readRelayOptIn, writeRelayOptIn } from '@le-space/libp2p-webrtc-qr'
```

| | |
| --- | --- |
| `findReachableRelays({ baked, probe, discover })` | `{ source: 'baked' \| 'aleph' \| 'none', addresses, askedAleph }` |
| `readRelayOptIn(storage, key)` | a remembered choice, `false` when there is none |
| `writeRelayOptIn(storage, key, value)` | whether it was actually stored |

This is the rule, not the mechanism. `probe` and `discover` are supplied by the
caller, so the module knows nothing about libp2p and nothing about any
directory, and it can be tested without either.

**Baked-in addresses are tried before discovery.** Not only because it is
faster: it means an app contacts a directory exactly when the addresses it
shipped with have gone quiet, and never at all in a room where the known relay
is up. For applications whose case is that they need no server, that difference
is the point rather than an optimisation.

**What discovery returns is probed too.** A registration outlives the machine it
describes — a public registry has no way to forget an orphan — so *discovered*
is not *alive*. Returning an address nobody answered would move the failure to
the first dial, where it reads as a bug in the connection rather than as an
empty directory.

Storage is passed in rather than reached for, and a caller that supplies no key
gets no persistence: storing under a key the library invented would put its
namespace in somebody else's origin. A blocked store reads as *off*, which is
the safe direction — the choice then holds for the session and no longer.
