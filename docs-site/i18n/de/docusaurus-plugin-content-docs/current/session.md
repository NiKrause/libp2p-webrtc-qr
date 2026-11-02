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
| `rtcConfiguration` | `DEFAULT_RTC_CONFIGURATION` | wird an `RTCPeerConnection` gereicht; `{ iceServers: [] }` sammelt nur im eigenen Netz |
| `compact` | `false` | erzeugt kurze v3-Codes |
| `addressFamily` | `null` | bietet nur `'v4'`- oder nur `'v6'`-Kandidaten an — siehe unten |
| `iceGatheringTimeout` | 15000 | Ende des Wartens auf Kandidaten |
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

## Eine Adressfamilie messen

„Funktioniert IPv6 zwischen diesen beiden Netzen" ist keine Frage, die ein
Browser beantwortet. ICE nimmt das Kandidatenpaar, das zuerst durchkommt, und
wenn das IPv4 ist, wurde die IPv6-Frage nie gestellt.

Sie brauchen die Erlaubnis des Browsers nicht, denn die Nutzlast gehört Ihnen.
`addressFamily` entfernt die Kandidaten der anderen Familie aus dem, was dieser
Peer anbietet *und* aus dem, was er annimmt — als Wert oder als Funktion, die
einen liefert, damit ein Schalter auf dem Bildschirm keine neue Session braucht:

```js
const session = new QRSession(node, { addressFamily: () => gewaehlt })
```

Es genügt, das auf **einem** Gerät zu setzen: ein Peer prüft nur Paare, die er
kennt, und die Gegenseite hat nur eine Familie erhalten. Es reist nichts mit der
Einladung mit, und das soll auch so bleiben — ein Link, der die Verbindung des
Empfängers stillschweigend einschränkt, wäre ein Link, der dessen Anwendung
kaputt macht, um die Frage eines anderen zu beantworten.

Ein mDNS-Kandidat fällt bei jedem Filter weg: ein `.local`-Name verbirgt seine
Familie, und ein als „nur IPv6" verbuchter Lauf, der darüber zustande kam, wäre
kein Beleg für irgendetwas. Alle Engines halten Host-Adressen standardmäßig so
zurück; ein Filter braucht also Kandidaten mit echter Adresse — reflexive haben
eine, und `{ iceServers: [] }` liefert unter Umständen nur `.local`-Namen.

`createOffer` wirft einen Fehler, wenn der Filter keinen Kandidaten übrig lässt,
statt eine Einladung herauszugeben, die keine erreichbare Adresse beschreibt. Die
Meldung unterscheidet die beiden Fälle: kein Kandidat dieser Familie ist eine
Aussage über das Netz, jede Adresse zurückgehalten eine über den Browser.

```js
import {
  ADDRESS_FAMILIES,
  asAddressFamily,
  candidateAddress,
  familiesOffered,
  familyLabel,
  familyOf,
  filterCandidateLines,
  filterSdpCandidates
} from '@le-space/libp2p-webrtc-qr'
```

`familiesOffered(adressen)` ist die Hälfte, die einen gefilterten Lauf
später noch lesbar macht: halten Sie fest, was eine Nutzlast *tatsächlich*
angeboten hat — denn `['v4']` aus einem Filter und `['v4']` aus einem Netz ohne
IPv6 sind zwei verschiedene Befunde, die gleich aussehen.

## Was eine Einladung über Sie verrät

Eine Einladung trägt die Adressen, unter denen eine Gegenstelle Sie erreichen
kann — und wer sie zeigt, darf sie vorher sehen.

```js
const candidates = session.candidatesFor(sessionId)
// [{ key, address, port, type, transport, family, offered }, …]

const payload = await session.reissue(sessionId, {
  exclude: candidates.filter(c => c.type === 'srflx').map(c => c.key)
})
```

`candidatesFor` meldet, was der Browser **gesammelt** hat — auch die bereits
ausgelassenen Kandidaten, damit eine daraus gezeichnete Liste eine Adresse nicht
verschwinden lässt, sobald man sie abwählt. `family` ist `'mdns'` für die
`.local`-Platzhalter, die jede Engine anstelle einer Host-Adresse einsetzt.

`reissue` signiert dieselbe Einladung erneut. Die Peer-Verbindung bleibt
unberührt — sie hat gesammelt, sie wartet auf eine Antwort, und die Session-ID
ändert sich nicht, sodass eine Antwort auf die frühere Fassung weiterhin
ankommt. Bleibt kein Kandidat übrig, wirft die Methode: den letzten zu
verweigern ist besser als ein Code, der keinen Weg beschreibt. `candidateKey`
und `omitSdpCandidates` sind die Bausteine darunter.

### Das ist Offenlegung, kein Schutz

Einen Kandidaten aus der Nutzlast zu lassen entscheidet, was die Einladung als
**Weg** anbietet. Es hält diese Adresse nicht von der Leitung fern. Der lokale
ICE-Agent hat sie gesammelt und paart sie weiterhin mit allem, was die
Gegenstelle geschickt hat — Binding-Requests gehen also trotzdem von ihr aus.
Gemessen in
[#192](https://github.com/NiKrause/libp2p-webrtc-qr/issues/192): mit beiden
Host-Kandidaten aus der Nutzlast entfernt entsprangen alle vier Kandidatenpaare
des Anbietenden Kandidaten, die er nie angekündigt hatte — 24–25 Requests je
Paar. Die Gegenstelle sieht eine solche Adresse als Quelle eines Pakets,
gleichgültig ob ihr Stack sie als peer-reflexive verbucht.

Was eine Adresse tatsächlich von der Leitung fernhält: sie nicht zu sammeln
(`{ iceServers: [] }`) und das Routing des Betriebssystems.

Und die Kosten laufen auch in die andere Richtung. Die `.local`-Host-Kandidaten
sind genau die, die nichts verraten *und* den Fall „gleicher Raum, gleiches
WLAN" tragen. Sie wegzulassen bringt keine Privatheit und kostet den direkten
Weg.
