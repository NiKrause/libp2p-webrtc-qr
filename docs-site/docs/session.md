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
| `rtcConfiguration` | — | passed to `RTCPeerConnection` |
| `compact` | `false` | produce v3 short codes |
| `iceGatheringTimeout` | 5000 | stop waiting for candidates |
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
