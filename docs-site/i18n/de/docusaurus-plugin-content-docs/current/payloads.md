---
id: payloads
title: Nutzlastformate
sidebar_label: Nutzlastformate
---

Zwei Formate auf der Leitung. **Beide zu lesen ist bedingungslos; v3 zu erzeugen
ist eine Entscheidung.**

| | v2 (Vorgabe) | v3 kompakt |
| --- | --- | --- |
| Präfix | deflate + base64url | `q3:` |
| trägt | das ganze SDP | Fingerabdruck + gepackte Kandidaten |
| ICE-Zugangsdaten | übertragen | aus dem Fingerabdruck abgeleitet (HKDF) |
| Größe, gemessen | ~1011 Zeichen | ~276 Zeichen |
| Signatur | ja | ja |

## Warum v3 standardmäßig aus ist

Nicht, weil es unfertig wäre – und auch nicht mehr wegen eines bekannten
Fehlers. Eine Verbindung aus einem **rekonstruierten** SDP verstummte einmal
unter Last: vier von acht Läufen gegen null von acht bei v2. Diese Messung hat
einer Überprüfung nicht standgehalten – 68 Läufe unter drei Bedingungen, darunter
eine absichtlich überlastete Maschine und alle drei Engines, lieferten jede
Nachricht aus ([die Messung](https://github.com/NiKrause/libp2p-webrtc-qr/issues/83#issuecomment-5530131612)).
Das ursprüngliche Ergebnis beschrieb offenbar den Laptop und nicht das Format.

Es bleibt ein Unterschied in der Art, kein Fehler: v3 **baut** das SDP neu, statt
es zu übertragen – beide Seiten müssen sich also einig sein, wie. Die Vorgabe hat
seit dem Wegfall ihres Grundes niemand überdacht.

Das Lesen ist davon unberührt: ein Peer nimmt ohnehin beide Formate an. Die
Umstellung ändert nur, was ein Gerät herausgibt.

```js
const offer = await session.createOffer({ compact: true })
```

## Was eine kleinere Nutzlast wirklich bringt

Einen Code, keinen dünneren. Oberhalb von `STATIC_QR_MAX_LENGTH` wird die
Einladung in eine BC-UR-Animation zerlegt, deren Bilder bauartbedingt klein sind
— eine v2-Nutzlast zeichnet also mehrere Codes ähnlicher Dichte statt eines
dichten.

Im Browser gemessen: kompakt **284 Zeichen in 1 Bild** zu 65 Modulen; v2 **994
Zeichen in 5 Bildern** zu 69. Der Unterschied, den ein Mensch merkt, ist ein
einziger Blick statt eines ruhig gehaltenen Telefons über eine ganze Sequenz.

## Die Antwort folgt dem Angebot

Eine **Antwort folgt dem Format des Angebots**, auf das sie antwortet — nie der
Vorliebe des antwortenden Peers. Wer v2 gesendet hat, kann keine v3-Antwort
lesen.

## Lesen und schreiben

```js
import { parsePayload, decodePayload, isCompactPayload } from '@le-space/libp2p-webrtc-qr'

parsePayload(text)                 // nur einordnen - prüft nichts
decodePayload(text, expectedType)  // prüft, beide Formate
isCompactPayload(text)             // ist das q3:
```

| | |
| --- | --- |
| `encodeSignedPayload`, `decodeSignedPayload` | v2, signiert und geprüft |
| `encodeCompactPayload`, `decodeCompactPayload` | v3, signiert und geprüft |
| `compress`, `decompress` | die Deflate-Schicht von v2 |
| `QR_TYPE_OFFER`, `QR_TYPE_ANSWER` | Nutzlastarten |
| `PAYLOAD_VERSION`, `COMPACT_VERSION`, `COMPACT_PREFIX` | Formatkennungen |

## Gültigkeitsfenster

Nutzlasten tragen ein signiertes `notBefore`/`notAfter`-Fenster — standardmäßig
zehn Minuten (`DEFAULT_LIFETIME_MS`), mit `CLOCK_SKEW_MS` Spielraum. Das Fenster
gehört zur signierten kanonischen Form: Umschreiben macht die Signatur ungültig,
statt die Nutzlast zu verlängern.

Format im Detail: [`docs/compact-payload.md`](https://github.com/NiKrause/libp2p-webrtc-qr/blob/main/docs/compact-payload.md).
