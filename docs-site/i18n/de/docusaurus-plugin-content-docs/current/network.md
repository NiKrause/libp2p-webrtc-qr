---
id: network
title: Netzbereitschaft
sidebar_label: Netzbereitschaft
---

Ohne jedes DOM benutzbar.

```js
import { probeNetwork, summariseNetwork, offNetworkRisk } from '@le-space/libp2p-webrtc-qr/elements'
```

| | liefert |
| --- | --- |
| `probeNetwork(rtcConfiguration)` | `{ ipv4, ipv6, overall }`, je `{ state, text }` |
| `summariseNetwork(ipv4, ipv6)` | das zusammengefasste Urteil |
| `offNetworkRisk(result)` | `'blocked'` \| `'unreliable'` \| `null` |
| `offNetworkBlocked(result)` | eng: nur `blocked` |
| `isGlobalUnicastV6(address)` | ist diese Adresse routbar |
| `probeBrowser()` | `{ state, text }` — ob dieser Browser überhaupt WebRTC hat und einen Datenkanal öffnen kann |
| `probeCamera()` | `{ state, text }` — Kameraverfügbarkeit, über die Permissions-API gelesen, ohne zu fragen |

Zustände: `open`, `relay`, `symmetric`, `blocked`.

## Woran man sperrt

An `offNetworkRisk` — `unreliable` ist der Fall Carrier-NAT ohne IPv6, den ein
Telefon im Mobilfunk zeigt und den `blocked` verfehlt. Er blieb unbemerkt, bis er
von einem echten Gerät gemeldet wurde.

```js
if (offNetworkRisk(result) === 'blocked') { /* dieses Netz erreicht niemanden anderswo */ }
```

`<qr-status>` spiegelt dasselbe Urteil als Attribut:
`off-network-risk="blocked|unreliable"`.

## Ein Urteil beschreibt diesen Browser, nicht das Netz

Dasselbe Telefon im selben WLAN meldet IPv6 in DuckDuckGo und Firefox als
nutzbar und in Chrome als installierte PWA als abwesend. Ob ein
IPv6-Reflexivkandidat erscheint, hängt ebenso vom Browser-Build und seiner
WebRTC-IP-Richtlinie ab wie von der Route.

Der Wortlaut in der Bibliothek wurde genau deswegen korrigiert: er sagte einmal
„dieses Netz bietet nur IPv4", was zwei Bildschirmfotos widerlegten.

**Ein Urteil nicht** als Tatsache über das Netz darstellen — und auf ein
schlechtes Urteil hin **nichts sperren**: ein symmetrisches NAT verbindet Peers
im selben Netz weiterhin.

## Die Elemente übersetzen

Jedes Element nimmt eine `strings`-Tabelle, die über seine Vorgaben **gemerged**
wird — drei ersetzte Beschriftungen verlieren also den Rest nicht.

**Deutsch liegt dem Paket bei.** Zwei Verbraucher übersetzten dieselben drei
Dutzend Beschriftungen von Hand, aus denselben englischen Vorgaben, ohne zu
bemerken, wenn oben eine dazukam.

```js
import { QR_STATUS_STRINGS_DE } from '@le-space/libp2p-webrtc-qr/elements'

status.strings = QR_STATUS_STRINGS_DE                      // alles
status.strings = { ...QR_STATUS_STRINGS_DE, blocked: '—' } // mit eigener Stimme
```

`QR_STATUS_STRINGS_DE`, `QR_SCANNER_STRINGS_DE`, `QR_INVITE_STRINGS_DE`,
`QR_LISTEN_STRINGS_DE` und `QR_PEERS_STRINGS_DE` sind Vorgaben für eine Sprache, keine fertige Übersetzung
Ihrer App.

Eine zweite Sprache verrottet anders als ein README: ein fehlender deutscher
Schlüssel ist unsichtbar, weil `mergeStrings` aufs Englische durchfällt und der
Bildschirm fertig aussieht. Das Paket sichert dagegen ab — gleiche Schlüssel,
gleiche Form je Eintrag, und kein Eintrag identisch zum Englischen.

## Was die Prüfung nicht sehen kann

**Wi-Fi-Client-Isolation.** Gästenetze in Cafés, Hotels und auf Konferenzen
verbieten es Clients routinemäßig, einander zu adressieren. STUN bleibt davon
unberührt – es spricht mit dem Internet, und das ist erlaubt –, beide Peers
sammeln also Reflexivkandidaten, `summariseNetwork` liefert `open`, und dann
kommt kein einziges Kandidatenpaar zustande.

Das ist keine Lücke, die sich durch bessere Messung schließen ließe. Die Prüfung
fragt *erreicht dieser Browser das Internet*; bei Client-Isolation geht es darum,
ob er **einen anderen Client am selben Zugangspunkt** erreicht, und das kann kein
einzelner Browser für sich beantworten.

Zwei Folgerungen, auf denen sich aufbauen lässt:

- **Ein `open`-Urteil ist kein Versprechen.** Es sagt, dass nichts im Weg
  gefunden wurde – nicht, dass ein Peer erreichbar sein wird.
- **Das Erkennungsmerkmal liegt im Fehlschlag, nicht davor.** Haben beide Seiten
  `srflx`-Kandidaten von *derselben* öffentlichen Adresse gesammelt – stehen also
  hinter demselben NAT – und ICE kam trotzdem nie über `checking` hinaus, ist
  Client-Isolation die wahrscheinlichere Ursache als die NAT-Art.
  `describeIce()` trägt die Kandidatensätze, die eine solche Meldung braucht.

Unabhängig berichtet von
[vbocan/webrtc-oob-pairing](https://github.com/vbocan/webrtc-oob-pairing), wo
auch Browser-Richtlinien, die WebRTC ganz abschalten, als zweite Ursache mit
demselben Symptom genannt werden.

## STUN-Konfiguration

`DEFAULT_RTC_CONFIGURATION` fragt vier STUN-Server, zwei davon über
**IPv6-Literale**: einen Reflexivkandidaten gibt es nur für die Familie, die eine
STUN-Transaktion tatsächlich benutzt hat. Nur IPv4-erreichbare Server zu fragen
ist der Weg, auf dem ein Dual-Stack-Netz als reines IPv4 gemeldet wird.

## Welcher Relay zuerst

Ein gescannter Code setzt voraus, dass die andere Person hier ist. Ist sie es
nicht, führt der zweite Weg über einen Relay — und dann stellt sich in jedem
Konsumenten dieselbe Frage: welche Adressen zuerst, in welcher Reihenfolge, und
wann überhaupt ein Verzeichnis gefragt werden darf.

```js
import { findReachableRelays, readRelayOptIn, writeRelayOptIn } from '@le-space/libp2p-webrtc-qr'
```

| | |
| --- | --- |
| `findReachableRelays({ baked, probe, discover })` | `{ source: 'baked' \| 'aleph' \| 'none', addresses, askedAleph }` |
| `readRelayOptIn(storage, key)` | die gemerkte Wahl, `false` wenn keine vorliegt |
| `writeRelayOptIn(storage, key, value)` | ob tatsächlich gespeichert wurde |

Das ist die Regel, nicht der Mechanismus. `probe` und `discover` kommen vom
Aufrufer; das Modul weiß nichts von libp2p und nichts von einem Verzeichnis und
lässt sich ohne beides testen.

**Eingebackene Adressen kommen vor der Suche.** Nicht nur, weil es schneller
ist: So spricht eine App genau dann mit einem Verzeichnis, wenn die
mitgelieferten Adressen verstummt sind — und in einem Raum, in dem der bekannte
Relay läuft, überhaupt nicht. Für Anwendungen, deren Zusage lautet, ohne Server
auszukommen, ist dieser Unterschied der Punkt und keine Optimierung.

**Auch Gefundenes wird geprüft.** Eine Registrierung überlebt die Maschine, die
sie beschreibt — ein öffentliches Verzeichnis kann eine Waise nicht vergessen —,
*gefunden* heißt also nicht *lebendig*. Eine Adresse zurückzugeben, die niemand
beantwortet hat, verschöbe den Fehler auf den ersten Verbindungsversuch, wo er
wie ein Fehler der Verbindung aussieht statt wie ein leeres Verzeichnis.

Der Speicher wird übergeben statt geholt, und wer keinen Schlüssel übergibt,
bekommt keine Persistenz: unter einem selbst erfundenen Schlüssel zu speichern
hieße, den eigenen Namensraum in fremdem Origin abzulegen. Ein blockierter
Speicher liest sich als *aus* — die sichere Richtung; die Wahl hält dann für die
Sitzung und nicht länger.
