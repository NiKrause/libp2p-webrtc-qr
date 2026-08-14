---
id: session
title: Session
sidebar_label: Session
---

`QRSession` hält den Zustandsautomaten des Handschlags. Eine Instanz pro Node;
sie verfolgt jedes erzeugte Offer und jede angenommene Verbindung.

```js
import { QRSession } from '@le-space/libp2p-webrtc-qr'

const session = new QRSession(node, { rtcConfiguration })
```

## Die beiden Seiten

```js
// anbietende Seite
const offer = await session.createOffer()
const { peerId, connection, address, ageSeconds } = await session.acceptAnswer(reply)

// antwortende Seite
const answer = await session.acceptOffer(offer)
session.addEventListener('connect', e => e.detail.peerId)
```

`acceptOffer` kehrt zurück, **sobald die Antwort signiert ist** — nicht, wenn die
Verbindung steht. Der anbietende Peer kann ohne diese Antwort nicht fertig
werden. Die Verbindung kommt danach zustande und meldet sich über `connect`, oder
über `error`, wenn sie es nie tut.

## Optionen

| Option | Vorgabe | Bedeutung |
| --- | --- | --- |
| `rtcConfiguration` | — | wird an `RTCPeerConnection` gereicht |
| `compact` | `false` | erzeugt kurze v3-Codes |
| `iceGatheringTimeout` | 5000 | Ende des Wartens auf Kandidaten |
| `connectionTimeout` | 30000 | Aufgabe von `connected` |
| `answerWaitTimeout` | — | wie lange die antwortende Seite offen hält |
| `dialAttempts`, `dialRetryDelay`, `dialSettleDelay` | — | Form der Wiederholung, während der Peer seinen Muxer anhängt |

Pro Aufruf: `createOffer({ compact })`, `acceptAnswer(text, { dial })`.

**`dial: false` übergeben**, wenn du deinen eigenen Protokoll-Stream öffnest —
sonst wird die Verbindung zweimal gewählt.

## Methoden, Zustand, Ereignisse

| | |
| --- | --- |
| `createOffer`, `acceptOffer`, `acceptAnswer` | der Handschlag |
| `dial`, `dialProtocol` | danach |
| `session.offers` | offene Angebote, nach Session-ID |
| `session.inbound` | Verbindungen aus angenommenen Angeboten |
| Ereignisse | `connect`, `error` |

`session.offers` und `session.inbound` zusammen sind jede Peer-Verbindung, für
die diese Session zuständig ist — genau das, worüber eine Lebendigkeitsanzeige
iterieren muss.

## Fehlersuche

```js
import { describeIce } from '@le-space/libp2p-webrtc-qr'

describeIce(peerConnection) // eine Zeile: beide Kandidatensätze und der ICE-Zustand
```

Diese Zeichenkette gehört in jede Fehlermeldung. Mit „Verbindung fehlgeschlagen"
allein kann niemand etwas anfangen.
