---
id: security
title: Sicherheit
sidebar_label: Sicherheit
---

DTLS verschlüsselt, wie immer. Was WebRTC-Entwürfe unterscheidet, ist **wie die
DTLS-Sitzung an eine Peer-ID gebunden wird**.

| | Verschlüsselung | Authentifizierung | Bindung |
| --- | --- | --- | --- |
| libp2p-WebRTC (Standard) | DTLS | Noise über den DataChannel | Noise-Prolog = DTLS-Fingerabdrücke |
| WebRTC Direct | DTLS | `certhash` in der Multiaddr | Multiaddr fixiert Zertifikat + Peer-ID |
| **hier** | DTLS | Signatur über das SDP | Signatur deckt den DTLS-Fingerabdruck |

## Die Invariante

> **Die Signatur muss den im SDP enthaltenen DTLS-Fingerabdruck abdecken.**

Das ist tragend. Deckte die Signatur nur Session-Kennungen oder ICE-Parameter ab,
aber nicht die `a=fingerprint:`-Zeile, könnte ein Angreifer ein gültig wirkendes
SDP mit eigenem Zertifikat zusammensetzen — Signatur weiterhin gültig, Bindung
gebrochen.

`canonicalPayload` signiert genau diese Felder und nichts sonst:

```
version, type, sessionId, peerId, offerPeerId, notBefore, notAfter, sdp
```

`sdp` ist die **vollständige** Beschreibung als Zeichenkette, die
Fingerabdruck-Zeile liegt also bauartbedingt in den signierten Bytes — nicht
aufgrund einer Regel, die sich jemand merken muss. Alles außerhalb dieser Liste
wird vor der Prüfung verworfen.

**Die Änderung, auf die zu achten ist:** wird `sdp` je verengt — auf eine
Kandidatenliste, eine rekonstruierte Teilmenge, eine kompakte Binärkodierung —,
muss der Fingerabdruck ausdrücklich in die signierten Bytes gezogen werden, sonst
ist das Überspringen von Noise nicht mehr tragfähig.

## Wann Noise nicht übersprungen werden darf

- **Unsigniertes SDP** → keine Bindung. DTLS verschlüsselt weiter, womöglich zu
  einem Betrüger. Dann gehört ein normaler Noise-Handschlag hin.
- **Signatur ohne den Fingerabdruck** → wie unsigniert behandeln.
- **Kein Fingerabdruck im SDP** → nichts, woran zu binden wäre.

Faustregel: `skipEncryption === true` ist nur auf einem Pfad zulässig, der bereits
eine Signatur über ein SDP geprüft hat, dessen Fingerabdruck er dann im
DTLS-Handschlag durchsetzt.

## Wiedereinspielfenster

Nutzlasten tragen ein signiertes Zehn-Minuten-Fenster mit zwei Minuten
Uhrenversatz. Das begrenzt das Wiedereinspielen, verhindert es innerhalb des
Fensters aber nicht. Ein echtes Replay-Fenster steht auf der
[Roadmap](https://github.com/NiKrause/libp2p-webrtc-qr/blob/main/ROADMAP.md).

## Was der Transport nicht schützt

Den **Kanal, über den der Code reist**. Ein vom Bildschirm gescannter QR-Code ist
bauartbedingt außerhalb des Netzes. Ein in einen Messenger eingefügter Link ist
es nicht: wer die Nachricht lesen kann, kann das Angebot lesen. Die Signatur
verhindert Manipulation, nicht Mitlesen.

## Dieser Kanal ist beobachtbar

„Kein Server beteiligt" heißt nicht „im Netz unsichtbar". Die
Defensiv-Sicherheitsstudie
[vbocan/webrtc-oob-pairing](https://github.com/vbocan/webrtc-oob-pairing)
liefert funktionierende Sigma-Signaturen für genau dieses Muster mit und meldet
vollständige Erkennung über alle ihre Testszenarien.

Nichts hier gibt vor, verdeckt zu sein, und dabei sollte es bleiben: ein vom
Bildschirm gescannter QR-Code ist außerhalb des Netzes, aber der WebRTC-Verkehr
danach ist gewöhnlicher Verkehr in einem gewöhnlichen Netz. Wer sich in einem
überwachten Netz bewegt, sollte aus dem Fehlen eines Signaling-Servers keinen
verdeckten Kanal ableiten.

Dieselbe Studie berichtet, dass der Kanal **durch TLS-aufbrechende Proxys und
bei blockiertem DNS** funktioniert – was die Behauptung „ohne Infrastruktur"
stützt und dieselbe Beobachtung von der anderen Seite ist.

Vollständige Herleitung: [`docs/connection-security.md`](https://github.com/NiKrause/libp2p-webrtc-qr/blob/main/docs/connection-security.md).
