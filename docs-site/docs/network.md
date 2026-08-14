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

## STUN configuration

`DEFAULT_RTC_CONFIGURATION` asks four STUN servers, two of them over **IPv6
literals**: a reflexive candidate exists only for a family a STUN transaction
actually used. Asking only IPv4-reachable servers is how a dual-stack network
gets reported as IPv4-only.
