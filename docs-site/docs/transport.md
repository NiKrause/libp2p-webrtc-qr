---
id: transport
title: Transport
sidebar_label: Transport
---

```js
import { webRTCQR } from '@le-space/libp2p-webrtc-qr'

createLibp2p({
  transports: [webRTCQR({ getOutboundSession: peerId => sessions.get(peerId) })]
})
```

The transport does not negotiate anything itself. It takes a WebRTC session whose
SDP was already exchanged out-of-band and upgrades it into a libp2p connection —
`getOutboundSession` is how it finds the session belonging to a Peer ID being
dialled.

For a connection you negotiated yourself:

```js
createWebRTCUpgradeContext(components, peerConnection, address, { direction })
```

## Why encryption is skipped

`skipEncryption: true` is deliberate, and it is not a shortcut.

The payload is signed with the peer's libp2p key, and the SDP inside it carries
the **DTLS fingerprint**. So a valid signature binds the WebRTC session to the
Peer ID — the same idea `certhash` uses in WebRTC-Direct. DTLS still encrypts;
that never goes away. Noise is skipped because it would only *authenticate*, and
the signature already did.

A tampered payload fails verification before any dial happens.

When that stops holding — and it does, in named cases — is worked through in
[Security](security).
