---
id: session
title: Session
sidebar_label: Session
---

`QRSession` owns the handshake state machine. One instance per node; it tracks
every offer it made and every connection it accepted.

```js
import { QRSession } from '@le-space/libp2p-webrtc-qr'

const session = new QRSession(node, { rtcConfiguration })
```

## The two sides

```js
// offering side
const offer = await session.createOffer()
const { peerId, connection, address, ageSeconds } = await session.acceptAnswer(reply)

// answering side
const answer = await session.acceptOffer(offer)
session.addEventListener('connect', e => e.detail.peerId)
```

`acceptOffer` returns **as soon as the answer is signed**, not when the
connection is up — the offering peer cannot finish until it reads that answer.
The connection completes afterwards and reports itself through `connect`, or
`error` if it never does.

## Options

| option | default | meaning |
| --- | --- | --- |
| `rtcConfiguration` | `DEFAULT_RTC_CONFIGURATION` | passed to `RTCPeerConnection`; `{ iceServers: [] }` gathers on the local network only |
| `compact` | `false` | produce v3 short codes |
| `addressFamily` | `null` | offer `'v4'` or `'v6'` candidates only — see below |
| `iceGatheringTimeout` | 15000 | stop waiting for candidates |
| `connectionTimeout` | 30000 | give up on `connected` |
| `answerWaitTimeout` | — | how long the answering side holds its side open |
| `dialAttempts`, `dialRetryDelay`, `dialSettleDelay` | — | retry shape while the peer attaches its muxer |

Per call: `createOffer({ compact })`, `acceptAnswer(text, { dial })`.

**Pass `dial: false`** when you open your own protocol stream — otherwise the
connection is dialled twice.

## Methods, state, events

| | |
| --- | --- |
| `createOffer`, `acceptOffer`, `acceptAnswer` | the handshake |
| `dial`, `dialProtocol` | after it |
| `session.offers` | pending offers, keyed by session id |
| `session.inbound` | connections built from an accepted offer |
| events | `connect`, `error` |

`session.offers` and `session.inbound` together are every peer connection this
session is responsible for — which is what a liveness readout has to iterate.

## Diagnosing a failure

```js
import { describeIce } from '@le-space/libp2p-webrtc-qr'

describeIce(peerConnection) // one line: both candidate sets and the ICE state
```

That string is what a failure message should carry. "Connection failed" without
it cannot be acted on by anyone.

## Measuring one address family

"Does IPv6 work between these two networks" is not a question a browser will
answer. ICE nominates whichever candidate pair succeeds first, and if that pair
is IPv4 the IPv6 question was never asked.

You do not need the browser's permission, because you own the payload.
`addressFamily` drops the other family's candidates from what this peer offers
*and* from what it accepts — a value, or a function returning one, so a control
on screen needs no new session:

```js
const session = new QRSession(node, { addressFamily: () => chosen })
```

Setting it on **one** device is enough: a peer only probes pairs it knows about,
and the far side received one family. Nothing travels with the invite, and
nothing should — a link that silently restricted the recipient's connection
would break their app to answer somebody else's question.

An mDNS candidate is dropped by either filter, because a `.local` name hides its
family and a run labelled "IPv6 only" that connected over one would be evidence
of nothing. Every engine withholds host addresses that way by default, so a
filter needs candidates carrying a real address — reflexive ones do, and
`{ iceServers: [] }` may produce nothing but `.local` names.

`createOffer` throws when the filter leaves no candidate at all, rather than
handing out an invite that describes no address to connect to. The message
distinguishes the two cases: no candidate of that family is an answer about the
network, every address withheld is an answer about the browser.

```js
import {
  ADDRESS_FAMILIES,
  asAddressFamily,
  candidateAddress,
  familiesOffered,
  familyLabel,
  familyOf,
  filterCandidateLines,
  filterSdpCandidates
} from '@le-space/libp2p-webrtc-qr'
```

`familiesOffered(addresses)` is the half that keeps a filtered run legible
afterwards: record what a payload actually offered, because `['v4']` from a
filter and `['v4']` from a network with no IPv6 are different findings that look
identical.
