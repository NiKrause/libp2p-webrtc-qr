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

Full derivation: [`docs/connection-security.md`](https://github.com/NiKrause/libp2p-webrtc-qr/blob/main/docs/connection-security.md).
