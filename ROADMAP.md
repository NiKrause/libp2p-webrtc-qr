# Roadmap

Where this project is heading, and why. Ordered by what would change the most
for someone using it, not by how hard it is.

Nothing here is scheduled. It is a record of the open questions, so the next
person - including future us - does not have to rediscover them.

---

## 1. Adopt QWBP-style compact payloads

**Today:** the signed offer is around **1057 characters** with STUN candidates
(933 host-only), against a 2200 budget. The whole SDP is transported, deflated
and base64url-encoded. Every ICE candidate makes it longer.

**The idea:** [QWBP](https://magarcia.github.io/qwbp/) - the QR-WebRTC Bootstrap
Protocol by Miguel García, described in
[*Air-gapped WebRTC: breaking the QR limit*](https://magarcia.io/air-gapped-webrtc-breaking-the-qr-limit/)
and specified [here](https://magarcia.github.io/qwbp/spec.html) - gets the same
handshake down to **41-100 bytes**. A 97.8% reduction, by refusing to send the
SDP at all:

- a 2-byte header, the raw 32-byte SHA-256 DTLS fingerprint, and ICE candidates
  binary-packed at 7-19 bytes each
- ICE credentials are **derived** from the fingerprint with HKDF-SHA256 rather
  than transmitted - the ufrag and password are computed on both sides
- the SDP is then reconstructed locally from those parts

### Why this matters more than it first appears

The obvious win is a smaller QR code: QWBP fits in a **version 4-5 symbol**
(33×33 to 37×37 modules) where ours is dense and large. That is not cosmetic. A
sparse code scans from further away, at worse angles, in worse light, off
smaller and dimmer screens, with older phone cameras. The single biggest source
of friction in this project is a scan that will not catch, and payload size is
the direct cause.

The less obvious win is that it **dissolves the size ceiling instead of working
around it**. QWBP is two-layer: the QR carries only bootstrap credentials, and
once the encrypted DataChannel is open, the peers exchange whatever they like
over it - the article notes full audio/video SDPs of 6 KB+. Applied here, a
peer with a long candidate list, IPv4 and IPv6 at once, or a TURN server would
no longer be a problem to be encoded; it would be an exchange that happens
*after* the connection exists.

That makes this a **more attractive path than item 2**, which only makes large
payloads scannable rather than making them unnecessary.

### What we would have to keep

QWBP carries **no identity binding of its own**. This project's entire security
argument is that the SDP - and therefore the DTLS fingerprint inside it - is
signed with the peer's libp2p key, which is what makes `skipEncryption: true`
sound. A QWBP payload that we simply adopted would drop that.

The interesting design is therefore the *combination*: QWBP's binary packing for
the connection parameters, plus a signature over those packed bytes and the
Peer ID. The Peer ID has to travel anyway (38-42 bytes for Ed25519), and an
Ed25519 signature is 64 bytes, so a signed QWBP-style payload lands somewhere
around 150-200 bytes - still an order of magnitude below where we are now.

Open questions: whether to define this as a QWBP profile or a separate payload
version; whether the signature covers the packed binary or a canonical
reconstruction; and how a peer signals which format it speaks.

---

## 2. Multi-frame QR with BC-UR

A fallback for payloads that will not fit one code: split into
[BC-UR](https://github.com/BlockchainCommons/Research/blob/master/papers/bcr-2020-005-ur.md)
parts, cycle them on the sending screen, reassemble on the scanner.
[`Le-Space/qrcode-scanner-svelte`](https://github.com/Le-Space/qrcode-scanner-svelte)
already implements both sides.

The trade-off is real and the QWBP article argues it well: an animated sequence
asks the user to hold the phone still until the sequence completes, which is
worse ergonomics than a single glance. Hence the ordering here - shrink the
payload first, and treat BC-UR as the escape hatch for whatever still does not
fit.

A size-adaptive path is the honest end state: one code while it fits, a sequence
when it does not.

---

## 3. Remove the vendored `@libp2p/webrtc` subtree

`packages/webrtc-qr/src/vendor` copies **698 lines** from
`@libp2p/webrtc@6.0.28` because that package declares only `"."` in its
`exports` map. A deep import fails with `ERR_PACKAGE_PATH_NOT_EXPORTED` in Node
and in every bundler that honours the map, and shipping a package that requires
consumers to add a bundler alias would be a broken contract.

The fix is upstream: a public subpath export for the DataChannel muxer. An issue
against `js-libp2p` making that case is worth filing - several projects want to
drive WebRTC signaling out-of-band (QR, Bluetooth, audio) and all of them need
this same piece.

There is precedent that this works. Up to libp2p 2 we also had to copy
`maconn.js` and its `util.js` dependency. libp2p 3 made their base class,
`AbstractMultiaddrConnection`, a public export of `@libp2p/utils` - and the copy
became [40 lines of our own](packages/webrtc-qr/src/maconn.js) on a supported
API. The muxer is the same story waiting to happen.

Until then, `pnpm vendor:sync` re-copies the subtree and
[the vendor README](packages/webrtc-qr/src/vendor/README.md) records the exact
upstream version.

---

## 4. Move the session orchestration into the package

The package currently ships the transport and the signaling codec. The state
machine that drives them - create offer, gather ICE, wait for `connected`,
upgrade in the right direction, retry the dial while the peer attaches its muxer
- lives in the examples, and by now **both** examples implement it separately.

That duplication is the signal. It is also where the subtle bugs were: upgrading
before the connection was up, the wrong `direction`, dialing into the gap before
the answering peer attached its muxer. Every consumer of this package will hit
all three, and none of them are obvious.

A `QRSignalingSession` that owns the peer connection lifecycle and emits events
would make the package usable without reading an example first. The work is
mostly separating that logic from the DOM and status-message glue it is
currently tangled with.

---

## 5. Add a replay window

Payloads carry a `sessionId` but no timestamp, so a signed offer stays valid for
as long as the offerer's peer connection lives. For a demo that is fine; for
production it is not. A signed `notBefore`/`notAfter` pair, checked during
verification, closes it.

This is small and self-contained - a good first contribution.

---

## 6. Firefox and WebKit in CI

CI runs Chromium only. Firefox and WebKit are untested, which for a project
whose entire premise is a browser API is a real gap. Adding the two Playwright
projects is easy; the interesting part is what breaks - `BarcodeDetector`
availability, `CompressionStream`, and negotiated data channel behaviour all
differ.

---

## 7. TURN, and being honest about NAT

There is no TURN server, so two peers behind restrictive or symmetric NATs can
still fail to connect after a perfectly good scan - which is a confusing
experience, because the QR part visibly worked.

Two separable pieces: allowing a TURN server to be configured at all, and
detecting the failure early enough to say *why* it failed rather than timing
out.

---

## Not planned

- **Replacing WebRTC.** The point of this project is that libp2p can use a
  connection whose signaling never touched a server. That is a property of the
  handshake, not of the transport underneath.
- **A signaling server as fallback.** Adding one back would remove the only
  reason this exists.

---

## Related work

Reading these first will save time on items 1 and 2:

- [*Air-gapped WebRTC: breaking the QR limit*](https://magarcia.io/air-gapped-webrtc-breaking-the-qr-limit/)
  and the [QWBP specification](https://magarcia.github.io/qwbp/spec.html) by
  Miguel García
- [`AquiGorka/webrtc-qr`](https://github.com/AquiGorka/webrtc-qr) by Gorka
  Ludlow, the sample this project started from
- [`vbocan/webrtc-oob-pairing`](https://github.com/vbocan/webrtc-oob-pairing) by
  Valer Bocan - the same idea studied from the defensive-security side, with
  detection signatures
