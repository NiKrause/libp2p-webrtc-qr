# libp2p WebRTC over QR

Two browsers connect directly as libp2p peers with **no relay and no signaling
server**. The WebRTC offer and answer are exchanged out-of-band as signed,
compressed QR codes that one phone scans off another screen.

**Live demo: <https://webrtc-qr.le-space.de>**

| Package | Description |
| --- | --- |
| [`packages/webrtc-qr`](packages/webrtc-qr) | `@le-space/libp2p-webrtc-qr` - the transport and the signed payload codec |
| [`examples/demo`](examples/demo) | Browser demo: QR camera scanning, copy/paste fallback, chat over a libp2p stream |
| [`examples/helia-file-transfer`](examples/helia-file-transfer) | Two Helia (IPFS) nodes transferring a file over the QR-negotiated connection, bitswap only |

## How it works

Each QR payload carries an SDP description, a session id and the sender's libp2p
Peer ID. It is signed with the sender's libp2p private key and verified against
the public key embedded in that Peer ID before the SDP is accepted.

The signature is what makes it safe to skip the usual libp2p connection
encryption handshake: the SDP contains the DTLS fingerprint, so signing the SDP
binds the WebRTC session to the Peer ID - the same idea that `certhash` uses in
WebRTC-Direct. A tampered payload fails verification before any dial happens.

Payloads are deflate-compressed before rendering so the code stays inside the
size a phone camera can still resolve. Above that budget the UI falls back to
copy/paste.

```
Browser A                             Browser B
  |  create offer -> sign -> QR          |
  |------------- camera scan ----------->|
  |                                      verify signature, create answer
  |<------------ camera scan ------------|
  verify signature -> WebRTC connected -> libp2p stream
```

## Development

```bash
pnpm install
pnpm start   # demo on http://localhost:5173
pnpm test    # unit + both e2e suites
```

## Status and known limits

- **No TURN server.** Two peers behind restrictive or symmetric NATs can still
  fail to connect.
- **No replay window.** Payloads carry a session id but no timestamp, so a
  signed offer stays valid as long as the offerer's peer connection lives.
- **The e2e suite runs with `?ice=host`**, which exercises the loopback path.
  Real ICE with STUN candidates produces larger SDP, and therefore larger QR
  payloads, than the suite measures. Measured on the live demo: 933 characters
  host-only, 1057 with STUN, against a 2200 budget.
- **Chromium only** in CI. Firefox and WebKit are untested.
- `packages/webrtc-qr/src/vendor` is a copy of `@libp2p/webrtc` internals that
  the upstream package does not export. See
  [the vendor README](packages/webrtc-qr/src/vendor/README.md).

## TODO: multi-frame QR for large candidate sets

Everything above assumes the signed payload fits in **one** QR code. That holds
today, but the budget is finite and the SDP grows with every ICE candidate. A
peer on a multi-homed host, on IPv4 and IPv6 at once, or behind a TURN server
can produce a candidate list that no single scannable code will hold.

The intended answer is an animated sequence rather than a bigger code: split the
payload into **BC-UR** parts, cycle them on the sending screen and reassemble
them on the scanner. BC-UR is the multi-part QR encoding the Bitcoin hardware
wallet ecosystem standardised on, and
[`Le-Space/qrcode-scanner-svelte`](https://github.com/Le-Space/qrcode-scanner-svelte)
already implements both sides of it.

The trade-off is real and documented by others: an animated sequence asks the
user to hold the phone still until the sequence completes, which is why some
designs avoid it by shrinking the payload instead (see QWBP below). A
size-adaptive path - single code while it fits, BC-UR sequence when it does not
- keeps the fast case fast without a hard ceiling.

## Origin and references

This started from [**AquiGorka/webrtc-qr**](https://github.com/AquiGorka/webrtc-qr)
by **Gorka Ludlow** (MIT), a "WebRTC Connect Experiment" that exchanges WebRTC
signaling between a host and a joining device purely through QR codes. That
sample is where the idea came from; credit for it belongs there. What this
repository adds is the libp2p side: the payload is signed with the peer's libp2p
key, verified against the public key in its Peer ID, and the resulting session is
upgraded into a real libp2p connection through a transport.

The immediate lineage is the `js-libp2p-example-webrtc-direct-qr` example in a
fork of [js-libp2p-examples](https://github.com/libp2p/js-libp2p-examples),
extracted here so the transport can be released independently of the examples
repository.

Related work worth reading before extending this:

- [**Air-gapped WebRTC: breaking the QR limit**](https://magarcia.io/air-gapped-webrtc-breaking-the-qr-limit/)
  by Miguel García - argues that semantic compression beats generic compression,
  and explains why the author rejected animated QR sequences in favour of
  shrinking the payload.
- [**QWBP**](https://magarcia.github.io/qwbp/) and its
  [**specification**](https://magarcia.github.io/qwbp/spec.html) - a QR-WebRTC
  bootstrap protocol that gets the payload down to 41-100 bytes by sending a raw
  DTLS fingerprint plus binary-packed ICE candidates and deriving the ICE
  credentials with HKDF-SHA256 instead of transmitting them. Two orders of
  magnitude below this project's ~1 kB signed SDP, at the cost of carrying no
  identity binding of its own.
- [**vbocan/webrtc-oob-pairing**](https://github.com/vbocan/webrtc-oob-pairing)
  by Valer Bocan (MIT) - a defensive-security study of the same out-of-band
  pairing idea, using QR in one direction and an acoustic chirp in the other. It
  is the counter-perspective: it documents that such a channel works through
  TLS-intercepting proxies and with DNS blocked, and ships detection signatures
  for it.

## License

Licensed under either of Apache 2.0 ([LICENSE-APACHE](LICENSE-APACHE)) or MIT
([LICENSE-MIT](LICENSE-MIT)), at your option.
