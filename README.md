# libp2p WebRTC over QR

Two browsers connect directly as libp2p peers with **no relay and no signaling
server**. The WebRTC offer and answer are exchanged out-of-band as signed,
compressed QR codes that one phone scans off another screen.

**Live demo: <https://webrtc-qr.le-space.de>**

| Package | Description |
| --- | --- |
| [`packages/webrtc-qr`](packages/webrtc-qr) | `@le-space/libp2p-webrtc-qr` - the transport and the signed payload codec |
| [`examples/demo`](examples/demo) | Browser demo: QR camera scanning, copy/paste fallback, chat over a libp2p stream |

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
pnpm test    # Playwright e2e: two real browser peers
```

## Status and known limits

- **No TURN server.** Two peers behind restrictive or symmetric NATs can still
  fail to connect.
- **No replay window.** Payloads carry a session id but no timestamp, so a
  signed offer stays valid as long as the offerer's peer connection lives.
- **The e2e suite runs with `?ice=host`**, which exercises the loopback path.
  Real ICE with STUN candidates produces larger SDP, and therefore larger QR
  payloads, than the suite measures.
- **Chromium only** in CI. Firefox and WebKit are untested.
- `packages/webrtc-qr/src/vendor` is a copy of `@libp2p/webrtc` internals that
  the upstream package does not export. See
  [the vendor README](packages/webrtc-qr/src/vendor/README.md).

## Origin

Grown out of the `js-libp2p-example-webrtc-direct-qr` example in a fork of
[js-libp2p-examples](https://github.com/libp2p/js-libp2p-examples), extracted
here so the transport can be released as a package independently of the
examples repository.

## License

Licensed under either of Apache 2.0 ([LICENSE-APACHE](LICENSE-APACHE)) or MIT
([LICENSE-MIT](LICENSE-MIT)), at your option.
