# @le-space/libp2p-webrtc-qr

A libp2p transport that takes a WebRTC session whose SDP was exchanged
out-of-band - typically as a scanned QR code - and upgrades it into a libp2p
connection. No circuit relay, no signaling server.

```bash
pnpm add @le-space/libp2p-webrtc-qr libp2p @multiformats/multiaddr
```

## Signaling codec

The codec signs a payload with the local libp2p private key and verifies a
scanned payload against the public key embedded in the Peer ID it claims.

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

Signed payloads are valid for five minutes by default. Verification allows two
minutes of clock skew between devices. Pass `{ lifetimeMs }` when encoding or
`{ clockSkewMs }` when decoding to override either default; both functions also
accept `now` for deterministic callers and tests.

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

Payload validity timestamps are covered by the signature. Verification rejects
expired and not-yet-valid payloads before their SDP reaches the caller.

## Vendored upstream code

`src/vendor` copies the `@libp2p/webrtc` internals that upstream does not put in
its `exports` map. See [`src/vendor/README.md`](src/vendor/README.md).

## License

Apache 2.0 OR MIT.
