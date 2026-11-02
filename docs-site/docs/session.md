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

## What an invite says about you

An invite carries the addresses a peer can reach you at, and a person showing
one is entitled to see them first.

```js
const candidates = session.candidatesFor(sessionId)
// [{ key, address, port, type, transport, family, offered }, …]

const payload = await session.reissue(sessionId, {
  exclude: candidates.filter(c => c.type === 'srflx').map(c => c.key)
})
```

`candidatesFor` reports what the browser **gathered**, including candidates
already left out, so a list drawn from it does not make an address vanish when
it is deselected. `family` is `'mdns'` for the `.local` stand-ins every engine
substitutes for a host address.

`reissue` signs the same invite again. The peer connection is untouched — it has
gathered, it is waiting for a reply, and the session id does not change, so a
reply to the earlier rendering still arrives. It throws when the exclusion
leaves no candidate at all: refusing the last one beats emitting a code that
describes no route. `candidateKey` and `omitSdpCandidates` are the underlying
pieces.

### This is disclosure, not protection

Leaving a candidate out of the payload decides what the invite offers *as a
route*. It does not keep that address off the wire. The local ICE agent
gathered it and still pairs it against everything the other side sent, so
binding requests leave from it anyway — measured in
[#192](https://github.com/NiKrause/libp2p-webrtc-qr/issues/192): with both host
candidates removed from the payload, all four of the offerer's candidate pairs
were sourced from candidates it had never advertised, 24–25 requests each. The
far end sees such an address as the source of a packet whether or not its stack
files it as peer-reflexive.

What does keep an address off the wire: not gathering it (`{ iceServers: [] }`),
and the operating system's own routing.

And the cost runs the other way too. The `.local` host candidates are the ones
that disclose nothing *and* the ones that carry the same-room, same-Wi-Fi case.
Dropping them buys no privacy and loses the direct path.
