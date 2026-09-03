---
id: payloads
title: Payload formats
sidebar_label: Payload formats
---

Two wire formats. **Reading both is unconditional; producing v3 is a choice.**

| | v2 (default) | v3 compact |
| --- | --- | --- |
| prefix | deflate + base64url | `q3:` |
| carries | the whole SDP | fingerprint + packed candidates |
| ICE credentials | transmitted | derived from the fingerprint (HKDF) |
| size, measured | ~1011 chars | ~276 chars |
| signature | yes | yes |

## Why v3 is off by default

Not because it is unfinished, and no longer because of a known defect either. A
connection built from a **reconstructed** SDP was once seen to go silent under
load — four of eight runs against zero of eight on v2 — and that measurement did
not survive scrutiny: 68 runs across three conditions, including a deliberately
overloaded machine and all three engines, delivered every message
([the measurement](https://github.com/NiKrause/libp2p-webrtc-qr/issues/83#issuecomment-5530131612)).
The original result appears to have described the laptop rather than the format.

What remains is a difference in kind rather than a fault: v3 **rebuilds** the SDP
instead of carrying it, so both ends must agree on how. The default has not been
revisited since its reason went away.

Reading is unaffected: a peer accepts either format regardless, so turning it on
only changes what a device hands out.

```js
const offer = await session.createOffer({ compact: true })
```

## What a smaller payload actually buys

One code, not a sparser one. Above `STATIC_QR_MAX_LENGTH` the invite is split
into a BC-UR animation whose frames are small by construction, so a v2 payload
draws several codes of roughly the same density rather than one dense code.

Measured in the browser: compact **284 characters in 1 frame** of 65 modules; v2
**994 characters in 5 frames** of 69. The difference a person feels is a single
glance instead of holding a phone steady through a sequence.

## The answer follows the offer

An **answer follows the format of the offer it replies to**, never the answering
peer's preference — a peer that sent v2 cannot read a v3 answer.

## Reading and writing

```js
import { parsePayload, decodePayload, isCompactPayload } from '@le-space/libp2p-webrtc-qr'

parsePayload(text)                 // route only - verifies nothing
decodePayload(text, expectedType)  // verifies, both formats
isCompactPayload(text)             // is this q3:
```

| | |
| --- | --- |
| `encodeSignedPayload`, `decodeSignedPayload` | v2, signed and verified |
| `encodeCompactPayload`, `decodeCompactPayload` | v3, signed and verified |
| `compress`, `decompress` | the deflate layer v2 uses |
| `QR_TYPE_OFFER`, `QR_TYPE_ANSWER` | payload kinds |
| `PAYLOAD_VERSION`, `COMPACT_VERSION`, `COMPACT_PREFIX` | format identifiers |

## Validity window

Payloads carry a signed `notBefore`/`notAfter` window — ten minutes by default
(`DEFAULT_LIFETIME_MS`), with `CLOCK_SKEW_MS` of slack. The window is part of the
signed canonical form, so rewriting it invalidates the signature rather than
extending the payload.

Format detail: [`docs/compact-payload.md`](https://github.com/NiKrause/libp2p-webrtc-qr/blob/main/docs/compact-payload.md).
