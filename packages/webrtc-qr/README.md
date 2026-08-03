# @le-space/libp2p-webrtc-qr

A libp2p transport that takes a WebRTC session whose SDP was exchanged
out-of-band - typically as a scanned QR code - and upgrades it into a libp2p
connection. No circuit relay, no signaling server.

```bash
pnpm add @le-space/libp2p-webrtc-qr libp2p @multiformats/multiaddr
```

## Session

Start here. `QRSession` owns the handshake, and what it handles is exactly what
every consumer gets wrong once - this state machine had been written three times
independently before it lived in the package.

```js
import { QRSession } from '@le-space/libp2p-webrtc-qr'

const session = new QRSession(node, { rtcConfiguration })

// one side
const offer = await session.createOffer()               // show this
const { peerId } = await session.acceptAnswer(reply)
const stream = await session.dialProtocol(peerId, '/my/protocol/1.0.0')

// the other side
const answer = await session.acceptOffer(offer)         // show this back
session.addEventListener('connect', event => { /* event.detail.peerId */ })
```

`acceptOffer` returns as soon as the answer is signed, because the offering peer
cannot finish until it reads that answer. The connection completes afterwards and
reports itself through `connect`, or `error` if it never does.

### What it handles that the transport API does not tell you

- **The init data channel is negotiated.** WebRTC gathers no candidates without a
  channel, but a normal one fires `datachannel` on the remote and the libp2p
  muxer adopts that unframed channel as an incoming stream - after which no real
  protocol stream ever arrives.
- **The upgrade waits for `connected`, in the right direction.** The offering peer
  attaches its muxer only when it reads the answer, so upgrading earlier writes
  an identify stream into a connection with nothing behind it. A wrong
  `direction` leaves the answering side blind to incoming streams.
- **The first dial is retried.** Both peers reach `connected` at the same moment,
  but the answering peer still has to attach its muxer, and anything opened into
  that gap negotiates and is immediately reset.

`session.forget(peerId)` drops the libp2p connection *and* the offer session for
a peer. Both have to go: a stale session hands the transport a closed peer
connection, and the next dial then fails with `Remote closed connection during
opening`, which points nowhere near the cause.

Errors carry an ICE summary - `local: 6 host, 1 srflx; remote: …; ice: failed` -
because a failure after clean signalling is almost always about candidate types.

## Signaling codec

Used by the session, and exposed for callers that want to sign or verify a
payload themselves. The codec signs with the local libp2p private key and
verifies a scanned payload against the public key embedded in the Peer ID it
claims.

```js
import { encodeSignedPayload, decodeSignedPayload, QR_TYPE_OFFER, PAYLOAD_VERSION } from '@le-space/libp2p-webrtc-qr'

const text = await encodeSignedPayload(node.components.privateKey, {
  version: PAYLOAD_VERSION,
  type: QR_TYPE_OFFER,
  sessionId: crypto.randomUUID(),
  peerId: node.peerId.toString(),
  sdp: peerConnection.localDescription.sdp
})

// throws if the signature does not match the claimed peer id
const payload = await decodeSignedPayload(text, QR_TYPE_OFFER)
```

`encodeSignedPayload` deflate-compresses the result so it stays inside a
scannable QR size. Fields outside the canonical set are dropped, so a verified
payload never carries data the signature did not cover.

Use `parsePayload` only to decide how to route a scanned code - it does **not**
verify anything.

## Transport

```js
import { createLibp2p } from 'libp2p'
import { webRTCQR, createWebRTCUpgradeContext } from '@le-space/libp2p-webrtc-qr'

const node = await createLibp2p({
  transports: [
    webRTCQR({
      // return the upgrade context for a peer whose answer you already verified
      getOutboundSession: remotePeerId => sessions.get(remotePeerId)
    })
  ]
})
```

The transport handles `/webrtc/p2p/<peer-id>` addresses and never listens - a QR
session is always established by the application before a dial happens. Once
the `RTCPeerConnection` is connected, build the upgrade context and dial:

```js
const context = createWebRTCUpgradeContext(node.components, peerConnection, addr)
const stream = await node.dialProtocol(addr, '/my/protocol/1.0.0')
```

The answering side upgrades inbound instead:

```js
await node.components.upgrader.upgradeInbound(context.connection, {
  skipEncryption: true,
  skipProtection: true,
  muxerFactory: context.muxerFactory
})
```

## Why encryption is skipped

`skipEncryption` is safe here **only because the SDP was signed**. The SDP
carries the DTLS fingerprint, so a valid signature binds the DTLS session to the
Peer ID - the same binding `certhash` provides in WebRTC-Direct. If you accept
unsigned SDP, this guarantee is gone and you must run a normal encryption
handshake instead.

Payloads expire. `encodeSignedPayload` stamps a `notBefore`/`notAfter` pair -
ten minutes by default, `lifetimeMs` to change it - and `decodeSignedPayload`
rejects anything outside that window, allowing two minutes of clock skew.

Both fields are part of the signed canonical form, so rewriting them
invalidates the signature instead of extending the payload. Pass `now` to
either function to test the behaviour without waiting.

## Vendored upstream code

`src/vendor` copies the `@libp2p/webrtc` internals that upstream does not put in
its `exports` map. See [`src/vendor/README.md`](src/vendor/README.md).

## License

Apache 2.0 OR MIT.
