---
id: index
title: libp2p WebRTC over QR
sidebar_label: Overview
slug: /
---

Two browsers connect directly as libp2p peers with **no relay and no signaling
server**. The WebRTC offer and answer travel out-of-band as signed, compressed QR
codes — each phone scans one off the other's screen, once in each direction, because
there is no server to carry the answer back.

**[Live demo](https://webrtc-qr.le-space.de)** · [npm](https://www.npmjs.com/package/@le-space/libp2p-webrtc-qr) · [GitHub](https://github.com/NiKrause/libp2p-webrtc-qr)

```bash
pnpm add @le-space/libp2p-webrtc-qr libp2p @multiformats/multiaddr
```

## The handshake

```
Browser A                             Browser B
  |  create offer -> sign -> QR          |
  |------------- camera scan ----------->|
  |                                      verify signature, create answer
  |<------------ camera scan ------------|
  verify signature -> WebRTC connected -> libp2p stream
```

Each payload carries an SDP description, a session id and the sender's Peer ID,
signed with that peer's libp2p private key and verified against the public key
inside the Peer ID before any dial happens.

## Two entry points

| import | contains |
| --- | --- |
| `@le-space/libp2p-webrtc-qr` | transport, session, payload codecs |
| `@le-space/libp2p-webrtc-qr/elements` | custom elements, network probe, QR framing |

Deep imports are not supported. If something is not re-exported from one of
these two, it is not public API.

## Smallest thing that works

```js
import { createLibp2p } from 'libp2p'
import { QRSession, webRTCQR } from '@le-space/libp2p-webrtc-qr'

const sessions = new Map()
const node = await createLibp2p({
  transports: [webRTCQR({ getOutboundSession: peerId => sessions.get(peerId.toString()) })]
})

const session = new QRSession(node)

// A shows this as a QR code
const offer = await session.createOffer()

// B scans it and shows the reply
const answer = await session.acceptOffer(offer)

// A scans the reply
const { peerId, connection } = await session.acceptAnswer(answer)
```

## Where to go next

| page | answers |
| --- | --- |
| [Session](session) | the handshake API, its options and events |
| [Payload formats](payloads) | v2 vs the compact `q3:` codes, and why v3 is opt-in |
| [Transport](transport) | wiring it into libp2p, and why Noise is skipped |
| [Elements](elements) | four custom elements, and translating them |
| [Network readiness](network) | what this browser can reach, and how to gate on it |
| [Security](security) | what the signature binds, and when it stops holding |
| [Mobile](mobile) | the constraint that shapes everything else |

## Known limits

- **No TURN server.** Two peers behind symmetric NATs can fail over IPv4.
  Global IPv6 on both sides connects regardless.
- **Wi-Fi client isolation** breaks the connection while every check passes -
  common on guest networks, and invisible to the readiness probe. See
  [Network readiness](network).
- **Payloads expire after ten minutes**, two minutes of clock skew tolerated.
  The window is signed, so rewriting it invalidates the payload.
- **The camera path is not covered by any test.** `getUserMedia`,
  `BarcodeDetector` and the `jsQR` fallback are exercised by hand only.
- **WebKit WebRTC is verified on macOS only** — Playwright's Linux WebKit has no
  working WebRTC, so CI skips the specs that need a peer connection.

The full engineering record lives in the repository:
[roadmap](https://github.com/NiKrause/libp2p-webrtc-qr/blob/main/ROADMAP.md),
[notes for agents](https://github.com/NiKrause/libp2p-webrtc-qr/blob/main/AGENTS.md).
