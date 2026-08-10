# The compact payload (v3)

> Format specification for `q3:` payloads. The reasoning for wanting them is in
> [issue #6](https://github.com/NiKrause/libp2p-webrtc-qr/issues/6); this
> document is what an implementer needs.

## Why

A v2 payload transports the whole SDP: 933 characters host-only, 1057 with STUN
candidates. Almost all of it is boilerplate both peers already know. The parts
that genuinely differ between two connections are a 32-byte fingerprint and a
handful of candidates.

[QWBP](https://magarcia.github.io/qwbp/) makes the observation that you can
therefore send nothing but those, derive the ICE credentials from the
fingerprint on both sides, and rebuild the SDP locally. What QWBP has no notion
of is identity: it never says *who* the fingerprint belongs to.

That binding is the whole security argument here — `skipEncryption` is sound
only because a signature ties the DTLS fingerprint to a Peer ID
([connection-security.md](connection-security.md)). So v3 is QWBP's packing with
our signature over it, and pays about 100 bytes for the Peer ID and signature
that QWBP does not carry.

**Measured: 266 characters for an offer with three candidates**, against 933
for the same offer in v2.

## The rule that must not be broken

> **The signature covers the packed bytes, and the fingerprint is one of them.**

Not the reconstruction. A reconstruction is something the *receiver* computes,
and signing it would mean signing a value the sender never saw — a receiver with
a different rebuild would then verify a different message than the one that was
signed.

In v2 the fingerprint is inside the signed bytes because `canonicalPayload`
signs the whole `sdp` string and the fingerprint happens to be a substring of
it. In v3 it is a first-class 32-byte field at a fixed offset. That is a
stronger form of the same guarantee: it cannot be lost by a change to how the
SDP is assembled, because the SDP is no longer what is signed.

`test/compact.test.js` flips one bit of that field and requires the payload to
be rejected.

## Wire format

```
q3:<base64url of the following bytes>
```

| Offset | Size | Field |
| --- | --- | --- |
| 0 | 1 | version, `3` |
| 1 | 1 | flags — bit 0: `0` offer, `1` answer |
| 2 | 32 | DTLS fingerprint, raw SHA-256 |
| 34 | 8 | session id |
| 42 | 4 | `notBefore`, Unix **seconds**, big-endian |
| 46 | 2 | lifetime in seconds |
| 48 | 1 | Peer ID length |
| 49 | *n* | Peer ID as a multihash (38 bytes for Ed25519) |
| … | 1 + *n* | offer Peer ID, **answers only** |
| … | 1 | candidate count |
| … | 7 or 19 each | candidates |
| last 64 | 64 | Ed25519 signature |

The signature covers `"libp2p-webrtc-qr-payload-v3:"` followed by every byte
before the signature. The context string keeps a payload from being replayed as
some other signed message.

Seconds rather than milliseconds: four bytes reach 2106, and a window measured
to the millisecond was always a fiction between two devices allowed to differ by
two minutes of clock skew.

### Candidates

| Offset | Size | Field |
| --- | --- | --- |
| 0 | 1 | bits 0–1 address kind, bits 2–3 type, bit 4 protocol |
| 1 | 4 / 16 | address |
| … | 2 | port |

Address kind `0` IPv4 (4 bytes), `1` IPv6 (16), `2` mDNS (16). Type `0` host,
`1` srflx, `2` prflx, `3` relay. Protocol bit `0` UDP, `1` TCP.

An IPv4 candidate costs **7 bytes**, IPv6 and mDNS **19**.

Browser host candidates are mDNS-masked — `<uuid>.local` rather than an address
— so kind `2` carries the UUID's 16 raw bytes instead of 36 characters. Dropping
them instead would quietly cost the same-network case, which is the one that
works most reliably.

Foundation, component and priority are **not** transmitted. They are recomputed:
component is always 1 (one data channel, no RTCP), priority follows RFC 8445
type preferences, and the foundation is the candidate's index. A candidate this
codec cannot represent is skipped rather than fatal — one lost path is cheaper
than a refused payload.

## Derived ICE credentials

Neither side transmits its ufrag or pwd. Both derive them with HKDF-SHA256 from
the fingerprint that has to travel anyway:

```
ufrag = base64url(HKDF(fingerprint, info = "libp2p-webrtc-qr/ice-ufrag", 128 bits))[0..8]
pwd   = base64url(HKDF(fingerprint, info = "libp2p-webrtc-qr/ice-pwd",   256 bits))[0..32]
```

Two independent HKDF labels rather than two slices of one digest: otherwise the
username would publish the first bytes of the password.

This only closes because the *sending* side also uses derived credentials, which
means munging its own SDP before `setLocalDescription`. Browsers have been
tightening exactly that, so it was measured before anything was built —
Chromium, Firefox and WebKit all accept it today, and a connection established
in all three with nothing but fingerprint and candidates crossing. If a browser
ever stops accepting it, this format stops working on that browser and the
fallback is v2.

## Reconstruction

```
v=0
o=- 1 2 IN IP4 127.0.0.1
s=-
t=0 0
a=group:BUNDLE 0
a=msid-semantic: WMS
m=application 9 UDP/DTLS/SCTP webrtc-datachannel
c=IN IP4 0.0.0.0
a=ice-ufrag:<derived>
a=ice-pwd:<derived>
a=ice-options:trickle
a=fingerprint:sha-256 <fingerprint>
a=setup:<actpass for an offer, active for an answer>
a=mid:0
a=sctp-port:5000
a=max-message-size:262144
```

Candidates are added with `addIceCandidate`, not written into this string.

## Coexistence with v2

A peer decides which decoder to use by **looking**, not by being told: `q3:`
means compact, anything else goes to the v2 path. A 0.6.0 peer meeting a v3 code
fails with an unrecognised-format error rather than mis-parsing it as JSON.

This matters because the two are not interchangeable at the wire level and never
will be — the version byte is inside the signature, so a v3 payload cannot be
re-labelled as v2 without invalidating it.
