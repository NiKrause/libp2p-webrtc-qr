---
id: index
title: libp2p WebRTC über QR
sidebar_label: Überblick
slug: /
---

Zwei Browser verbinden sich direkt als libp2p-Peers — **ohne Relay und ohne
Signaling-Server**. WebRTC-Offer und -Answer werden außerhalb des Netzes
ausgetauscht: als signierte, komprimierte QR-Codes, die ein Telefon vom
Bildschirm des anderen abscannt.

**[Live-Demo](https://webrtc-qr.le-space.de)** · [npm](https://www.npmjs.com/package/@le-space/libp2p-webrtc-qr) · [GitHub](https://github.com/NiKrause/libp2p-webrtc-qr)

```bash
pnpm add @le-space/libp2p-webrtc-qr libp2p @multiformats/multiaddr
```

## Der Handschlag

```
Browser A                             Browser B
  |  Offer erzeugen -> signieren -> QR   |
  |------------ Kamera-Scan ------------>|
  |                                      Signatur prüfen, Answer erzeugen
  |<----------- Kamera-Scan -------------|
  Signatur prüfen -> WebRTC verbunden -> libp2p-Stream
```

Jede Nutzlast trägt eine SDP-Beschreibung, eine Session-ID und die Peer-ID des
Absenders — signiert mit dessen privatem libp2p-Schlüssel und gegen den in der
Peer-ID enthaltenen öffentlichen Schlüssel geprüft, bevor überhaupt gewählt wird.

## Zwei Einstiegspunkte

| Import | enthält |
| --- | --- |
| `@le-space/libp2p-webrtc-qr` | Transport, Session, Payload-Codecs |
| `@le-space/libp2p-webrtc-qr/elements` | Custom Elements, Netzprüfung, QR-Rahmung |

Tiefe Importe werden nicht unterstützt. Was nicht aus einem dieser beiden
re-exportiert wird, ist keine öffentliche API.

## Das kleinste, was funktioniert

```js
import { createLibp2p } from 'libp2p'
import { QRSession, webRTCQR } from '@le-space/libp2p-webrtc-qr'

const sessions = new Map()
const node = await createLibp2p({
  transports: [webRTCQR({ getOutboundSession: peerId => sessions.get(peerId.toString()) })]
})

const session = new QRSession(node)

// A zeigt das als QR-Code
const offer = await session.createOffer()

// B scannt und zeigt die Antwort
const answer = await session.acceptOffer(offer)

// A scannt die Antwort
const { peerId, connection } = await session.acceptAnswer(answer)
```

## Weiter

| Seite | beantwortet |
| --- | --- |
| [Session](session) | die Handschlag-API, ihre Optionen und Ereignisse |
| [Nutzlastformate](payloads) | v2 gegen die kompakten `q3:`-Codes, und warum v3 optional ist |
| [Transport](transport) | Einbau in libp2p, und warum Noise entfällt |
| [Elemente](elements) | vier Custom Elements, und ihre Übersetzung |
| [Netzbereitschaft](network) | was dieser Browser erreicht, und woran man sperrt |
| [Sicherheit](security) | was die Signatur bindet — und wann das aufhört zu gelten |
| [Mobil](mobile) | die Randbedingung, die alles andere formt |

## Bekannte Grenzen

- **Kein TURN-Server.** Zwei Peers hinter symmetrischen NATs können über IPv4
  scheitern. Mit globalem IPv6 auf beiden Seiten verbinden sie sich trotzdem.
- **Nutzlasten verfallen nach zehn Minuten**, zwei Minuten Uhrenversatz werden
  toleriert. Das Fenster ist mitsigniert — Umschreiben macht es ungültig, nicht
  länger.
- **Der Kameraweg ist von keinem Test abgedeckt.** `getUserMedia`,
  `BarcodeDetector` und der `jsQR`-Rückfall werden ausschließlich von Hand
  geprüft.
- **WebKit-WebRTC ist nur unter macOS verifiziert** — Playwrights Linux-WebKit
  hat kein funktionierendes WebRTC, die CI überspringt dort jede Spezifikation,
  die eine Peer-Verbindung braucht.

Die technische Aktenlage liegt im Repository:
[Roadmap](https://github.com/NiKrause/libp2p-webrtc-qr/blob/main/ROADMAP.md),
[Hinweise für KI-Agenten](https://github.com/NiKrause/libp2p-webrtc-qr/blob/main/AGENTS.md).
