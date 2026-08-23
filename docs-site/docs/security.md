---
id: security
title: Security
sidebar_label: Security
---

DTLS encrypts, as it always does. What differs between WebRTC designs is **how
the DTLS session gets bound to a Peer ID**.

| | encryption | authentication | binding |
| --- | --- | --- | --- |
| standard libp2p WebRTC | DTLS | Noise over the DataChannel | Noise prologue = DTLS fingerprints |
| WebRTC Direct | DTLS | `certhash` in the multiaddr | multiaddr pins cert + Peer ID |
| **this** | DTLS | signature over the SDP | signature covers the DTLS fingerprint |

## The invariant

> **The signature must cover the DTLS fingerprint contained in the SDP.**

This is load-bearing. If the signature covered only session identifiers or ICE
parameters but not the `a=fingerprint:` line, an attacker could re-assemble a
valid-looking SDP with their own certificate — signature still verifying, binding
broken.

`canonicalPayload` signs exactly these fields and nothing else:

```
version, type, sessionId, peerId, offerPeerId, notBefore, notAfter, sdp
```

`sdp` is the **complete** session description as a string, so the fingerprint
line is inside the signed bytes by construction rather than by a rule somebody
has to remember. Anything outside that list is dropped before verification.

**The change to watch for:** if `sdp` is ever narrowed — to a candidate list, a
reconstructed subset, a compact binary encoding — the fingerprint must be carried
into the signed bytes explicitly, or skipping Noise stops being sound.

## When skipping Noise is not safe

- **Unsigned SDP** → no binding. DTLS still encrypts, possibly to an
  impersonator. Run a normal Noise handshake.
- **Signature that does not cover the fingerprint** → treat as unsigned.
- **No fingerprint in the SDP** → nothing to bind to.

Rule of thumb: `skipEncryption === true` is permitted only on a code path that
has already verified a signature over an SDP whose fingerprint it then enforces
during the DTLS handshake.

## Replay window

Payloads carry a signed ten-minute validity window with two minutes of clock
skew. That bounds replay; it does not prevent it within the window. A proper
replay window is [roadmap](https://github.com/NiKrause/libp2p-webrtc-qr/blob/main/ROADMAP.md) work.

## What the transport does not protect

The **channel the code travels over**. A QR code scanned off a screen is
out-of-band by construction. A link pasted into a messenger is not: whoever can
read that message can read the offer. The signature stops tampering, not reading.

## What a third party still learns

"No relay, no signaling server" is a claim about **signalling**, and it is true:
nothing between the two peers holds the offer, the answer, or a byte of what
follows. It is not a claim that nobody outside the room hears anything.

`DEFAULT_RTC_CONFIGURATION` asks four STUN servers — two operated by Cloudflare,
two by Google — and a reflexive candidate exists only because one of them
answered. So **gathering candidates tells those operators the public IP address
of whoever is gathering**, on every invite and every reply. That is ordinary
WebRTC rather than anything this project invented, and it is the price of
connecting across two networks without a relay.

Three things follow, and none of them needs a code change:

- `rtcConfiguration` replaces the list, with your own STUN server or with none.
- With none, only host candidates are gathered: the same network works, across
  the internet does not.
- `?ice=host` does exactly that in the demo, which is why the test suite runs
  without contacting anyone.

Written down because the front page says *nothing in the middle*, and somebody
who took that literally would be wrong about this one thing.

## This channel is observable

"No server involved" is not "invisible on the network". The defensive-security
study [vbocan/webrtc-oob-pairing](https://github.com/vbocan/webrtc-oob-pairing)
ships working Sigma detection signatures for exactly this pattern and reports
full detection across its test scenarios.

Nothing here claims to be covert, and it should stay that way: a QR code scanned
off a screen is out-of-band, but the WebRTC traffic that follows is ordinary
traffic on an ordinary network. Someone on a monitored network should not infer
a covert channel from the absence of a signaling server.

The same study reports the channel works **through TLS-intercepting proxies and
with DNS blocked** - which supports the no-infrastructure claim, and is the same
observation from the other direction.

Full derivation: [`docs/connection-security.md`](https://github.com/NiKrause/libp2p-webrtc-qr/blob/main/docs/connection-security.md).
