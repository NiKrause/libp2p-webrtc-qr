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
const { peerId, connection } = await session.acceptAnswer(reply)

// only if you have a protocol of your own - pass { dial: false } above so the
// connection is not dialled twice
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

**`acceptAnswer` dials.** Until something dials there is no libp2p connection -
only a WebRTC one with an upgrade context beside it. An app with a protocol of
its own never notices, because dialling that protocol does it; an app that uses
whatever connection exists, like a replicating database or a pubsub topic, sees
the handshake succeed and no peer. That cost a second consumer an afternoon, so
the session now does it and `{ dial: false }` opts out.

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

[`docs/connection-security.md`](../../docs/connection-security.md) is the long
version: where encryption comes from, where authentication comes from, and when
this is *not* safe.

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

## Elements

The connect step, as custom elements, from a separate entry point:

```js
import '@le-space/libp2p-webrtc-qr/elements'
```

```html
<qr-invite value="https://example/#i=…"></qr-invite>
<qr-scanner id="scan" label="Scan their code"></qr-scanner>
<qr-status auto></qr-status>
<qr-peers id="peers"></qr-peers>
```

| | |
| --- | --- |
| `qr-invite` | renders a payload, splits it into an animated BC-UR sequence when one code would be too dense to read |
| `qr-scanner` | the camera, the scan loop, multi-frame reassembly, and the modal around them |
| `qr-status` | what this network will allow, before anyone tries |
| `qr-peers` | who is connected, and how each connection is doing |

The scanner asks the host what a payload means, and keeps looking if the answer
is no:

```js
scan.validate = async text => ({ ok: text.includes('#i='), reason: 'That is a reply, not an invite' })
scan.addEventListener('scan', event => use(event.detail.text))
await scan.open()
```

`qr-status` picks its own rows. The default is the two address families and a
summary; `rows` takes any subset of `browser ipv4 ipv6 camera overall` in any
order:

```html
<qr-status auto rows="browser ipv4 ipv6 camera overall"></qr-status>
```

`browser` and `camera` are cheap - one throwaway `RTCPeerConnection` and a
Permissions API query - and neither touches the camera itself, so adding them
does not raise a permission prompt on load.

`qr-peers` is told rather than asking - who is connected lives in the
application's own bookkeeping - and its `disconnect` event is a request, not an
announcement:

```js
peers.peers = [{ peerId, state: 'connected' }]
peers.addEventListener('disconnect', event => drop(event.detail.peerId))
```

### Theming

Custom properties, because they are the only thing that crosses a shadow
boundary. Each element documents its own; the shadow root is what stops a host
stylesheet from reaching in and breaking a code that has to stay scannable.

```css
qr-invite {
  --qr-invite-max-width: 320px;
  --qr-invite-caption-color: #4b5563;
}
```

### Two things worth knowing

**It ships as a bundle, and the root does not.** Importing the package root gives
the transport, the codec and the session as plain source, which you bundle and
tree-shake like any dependency. The elements are a single pre-bundled browser
file with nothing left to resolve, because they pull in a QR encoder and a CBOR
stack that are CommonJS and reach for `Buffer` and `process` - and an
application that already polyfills those otherwise resolves the same specifier
two ways and fails its build talking about externals.

**They do not render on a server.** `customElements` does not exist there, so
under SSR import them where the browser runs:

```js
onMount(async () => {
  await import('@le-space/libp2p-webrtc-qr/elements')
})
```

## Vendored upstream code

`src/vendor` copies the `@libp2p/webrtc` internals that upstream does not put in
its `exports` map. See [`src/vendor/README.md`](src/vendor/README.md).

## License

Apache 2.0 OR MIT.
