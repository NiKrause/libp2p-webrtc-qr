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

Der Transport verhandelt selbst nichts. Er nimmt eine WebRTC-Session, deren SDP
bereits außerhalb des Netzes ausgetauscht wurde, und hebt sie zu einer
libp2p-Verbindung — `getOutboundSession` ist der Weg, über den er die Session zu
einer gewählten Peer-ID findet.

Für eine selbst verhandelte Verbindung:

```js
createWebRTCUpgradeContext(components, peerConnection, address, { direction })
```

## Warum die Verschlüsselung übersprungen wird

`skipEncryption: true` ist Absicht, keine Abkürzung.

Die Nutzlast ist mit dem libp2p-Schlüssel des Peers signiert, und das SDP darin
trägt den **DTLS-Fingerabdruck**. Eine gültige Signatur bindet die WebRTC-Session
also an die Peer-ID — dieselbe Idee, die `certhash` in WebRTC-Direct benutzt.
DTLS verschlüsselt weiterhin, das fällt nie weg. Noise entfällt, weil es nur
*authentifizieren* würde, und das hat die Signatur bereits getan.

Eine manipulierte Nutzlast fällt bei der Prüfung durch, bevor irgendetwas gewählt
wird.

Wann das aufhört zu gelten — und es gibt benannte Fälle — steht unter
[Sicherheit](security).
