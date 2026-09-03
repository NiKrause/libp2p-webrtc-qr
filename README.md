# libp2p WebRTC over QR

**[Deutsch](README.de.md)** · English

> ### ⚠️ Experimental
>
> This works, and it is not finished. Use it where a failed connection is an
> inconvenience rather than a loss. The security property holds - a signature
> binds the DTLS fingerprint to the Peer ID, traced end to end in a review - but
> the API still moves, and most failures live in the environment rather than in
> this code.
>
> <details>
> <summary><strong>What browsers and networks do not provide</strong></summary>
>
> Exchanging an SDP as a QR code removes the signalling server. It does not
> remove everything else a direct connection needs:
>
> - a **NAT that allows hole punching** - symmetric and carrier-grade NAT do
>   not, and with no relay in the design there is nowhere else to go
> - a **network that lets two clients address each other** - conference, hotel
>   and café Wi-Fi routinely forbid exactly that
> - a **secure origin**, without which there is no camera and no microphone
> - a **page that survives being left** - sending the invite means switching to
>   a messenger, and phones suspend what is not in front
>
> Where any of those is missing, the handshake still verifies and the connection
> still never forms. Bug reports from real devices are the most useful thing
> anybody can send - most of this list was found that way rather than by a test.
>
> </details>

Two browsers connect directly as libp2p peers with **no relay and no signaling
server**. The WebRTC offer and answer are exchanged out-of-band as signed,
compressed QR codes that the two phones scan off each other's screens - once in each
direction, because there is no server to carry the answer back.

**Live demo: <https://webrtc-qr.le-space.de>** · **[Documentation](https://nikrause.github.io/libp2p-webrtc-qr/)** · **[Roadmap](ROADMAP.md)** · **[Privacy](PRIVACY.md)** · **[Notes for agents](AGENTS.md)**

| Package | Description |
| --- | --- |
| [`packages/webrtc-qr`](packages/webrtc-qr) | `@le-space/libp2p-webrtc-qr` - the transport and the signed payload codec |
| [`examples/demo`](examples/demo) | Browser demo: QR camera scanning, copy/paste fallback, chat over a libp2p stream |
| [`examples/helia-file-transfer`](examples/helia-file-transfer) | Two Helia (IPFS) nodes transferring a file over the QR-negotiated connection, bitswap only |

**Elsewhere:** [libp2p-webrtc-qr-meshtastic](https://github.com/NiKrause/libp2p-webrtc-qr-meshtastic)
carries the handshake over a Meshtastic LoRa mesh. It lives in its own repository
and under **GPL-3.0**, because `@meshtastic/core` is GPL-3.0-only and this
package is Apache-2.0 OR MIT — a permissive library cannot pull copyleft into its
consumers' builds. It depends on this one; the reverse would not be allowed.

## How it works

Each QR payload carries an SDP description, a session id and the sender's libp2p
Peer ID. It is signed with the sender's libp2p private key and verified against
the public key embedded in that Peer ID before the SDP is accepted.

The signature is what makes it safe to skip the usual libp2p Noise handshake.
DTLS still encrypts - that never goes away - but in WebRTC, Noise is there to
*authenticate*, and signing the SDP has already done that: the SDP contains the
DTLS fingerprint, so a valid signature binds the WebRTC session to the Peer ID,
the same idea that `certhash` uses in WebRTC-Direct. A tampered payload fails
verification before any dial happens.
[`docs/connection-security.md`](docs/connection-security.md) works through this
in full, including when it stops being safe.

Payloads are deflate-compressed before rendering so the code stays inside the
size a phone camera can still resolve. One that still does not fit is split into
an animated BC-UR sequence rather than sent to copy/paste - fountain-coded, so
frames can be read in any order and a missed one costs nothing.

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
pnpm test    # unit + both e2e suites, on Chromium, Firefox and WebKit
```

The documentation site is deliberately outside the pnpm workspace - nobody
working on the transport should have to install Docusaurus to run the tests:

```bash
cd docs-site && pnpm install && pnpm start
```

## Status and known limits

- **No TURN server.** Two peers behind restrictive or symmetric NATs can still
  fail to connect over IPv4. Carrier-grade NAT is an IPv4 problem, though - if
  both peers have a global IPv6 address they connect regardless, and the demo
  reports per family which of the two you have before you scan anything.
- **Wi-Fi client isolation breaks the connection while every check passes.**
  Guest networks in cafes, hotels and conference venues routinely forbid clients
  from addressing each other. STUN still works, so both peers gather reflexive
  candidates and the readiness panel reports the network as open - and then no
  candidate pair ever succeeds. This is a distinct failure from restrictive or
  symmetric NAT, and in the settings this project advertises it is arguably the
  likelier one. It is **not** detectable before a peer is on the other end: the
  probe measures whether this browser can reach *the internet*, not whether it
  can reach *another client on the same access point*. Reported independently by
  [vbocan/webrtc-oob-pairing](https://github.com/vbocan/webrtc-oob-pairing).
- **Payloads expire after ten minutes**, with two minutes of clock skew
  tolerated. The window is part of the signed canonical form, so rewriting it
  invalidates the signature rather than extending the payload.
- **The e2e suite runs with `?ice=host`**, which exercises the loopback path.
  Real ICE with STUN candidates produces larger SDP, and therefore larger QR
  payloads, than the suite measures. Measured on the live demo: 933 characters
  host-only, 1057 with STUN, against a 2200 budget - and **266 characters** for
  the same offer as a compact (v3) payload, which is **off by default** - see
  below. The compact figure barely moves with STUN, because it
  carries candidates as 7 or 19 bytes each rather than as SDP lines.
- **The compact payload is opt-in, and no longer because of a known defect.** A
  connection built from a reconstructed SDP was once seen to go silent under
  load - four of eight runs against zero of eight on v2 - and that measurement
  did not survive scrutiny: 68 runs across three conditions, including a
  deliberately overloaded machine and all three engines, delivered every message
  ([the measurement](https://github.com/NiKrause/libp2p-webrtc-qr/issues/83#issuecomment-5530131612)).
  The original result appears to have recorded the state of the laptop rather
  than of the format. What remains is a difference in kind rather than a fault -
  v3 rebuilds the SDP instead of carrying it - and a default nobody has revisited
  since its reason went away. Reading is unaffected: a peer accepts either format
  regardless, so turning it on only changes what a device hands out.
- **What a smaller payload buys is one code, not a sparser one.** Above 600
  characters the invite is split into a BC-UR animation whose frames are small
  by construction, so a v2 payload draws several codes of roughly the same
  density rather than one dense code. Measured in the browser: compact 284
  characters in **1** frame of 65 modules, v2 994 characters in **5** frames of
  69. The difference a person feels is a single glance instead of holding a
  phone steady through a sequence.
- **WebKit's WebRTC is only verified on macOS.** Playwright's WebKit build for
  Linux has no working WebRTC, so CI runs every WebKit spec that does not need
  a peer connection and skips the ones that do. Chromium and Firefox are
  verified end to end in CI; WebKit end to end only locally on macOS.
- **The camera path is not covered by any test.** Every automated test exchanges
  payloads by copy/paste or programmatically. `getUserMedia`, `BarcodeDetector`
  and the `jsQR` fallback are only ever exercised by hand. Adding more browsers
  to CI did not change this - it is the one part a headless browser cannot run.
- **This channel is observable, and nothing here claims otherwise.** "No server
  involved" is not "invisible on the network": the same defensive-security study
  ships working Sigma detection signatures and reports full detection across its
  test scenarios. A QR code scanned off a screen is out-of-band, but the WebRTC
  traffic that follows is ordinary traffic on an ordinary network. Anyone whose
  threat model needs a covert channel should not infer one from the absence of a
  signaling server.
- `packages/webrtc-qr/src/vendor` is a copy of `@libp2p/webrtc` internals that
  the upstream package does not export. See
  [the vendor README](packages/webrtc-qr/src/vendor/README.md).

## What is next

The payload is the binding constraint on everything else: how far away a code
scans, on what camera, and how many ICE candidates a peer can have before it
stops fitting. The most promising answer is not a bigger or animated code but a
much smaller one - [QWBP](https://magarcia.github.io/qwbp/) does the same
handshake in 41-100 bytes by sending a raw DTLS fingerprint plus binary-packed
candidates and deriving the ICE credentials with HKDF, then upgrading over the
DataChannel it opens.

See the **[roadmap](ROADMAP.md)** for that and the rest: multi-frame BC-UR as a
fallback, removing the vendored subtree, moving the session orchestration into
the package, a replay window, multi-peer mesh bootstrapping, and TURN.

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
  by [Martin Garcia Monterde](https://github.com/magarcia) ([magarcia.io](https://magarcia.io)) -
  argues that semantic compression beats generic compression,
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
  by [Valer Bocan](https://github.com/vbocan) ([bocan.ro](https://www.bocan.ro),
  Politehnica University of Timisoara) (MIT) - a defensive-security study of the same out-of-band
  pairing idea, using QR in one direction and an acoustic chirp in the other. It
  is the counter-perspective: it documents that such a channel works through
  TLS-intercepting proxies and with DNS blocked, and ships detection signatures
  for it.

## License

Licensed under either of Apache 2.0 ([LICENSE-APACHE](LICENSE-APACHE)) or MIT
([LICENSE-MIT](LICENSE-MIT)), at your option.
