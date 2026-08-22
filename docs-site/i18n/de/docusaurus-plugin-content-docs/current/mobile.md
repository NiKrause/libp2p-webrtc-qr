---
id: mobile
title: Mobil
sidebar_label: Mobil
---

Die folgenreichste Tatsache dieses Projekts und der Grund, warum es mehrere
Merkmale überhaupt gibt.

## Ein Telefon tötet eine wartende Einladung in Sekunden

Ein Browser schließt die `RTCPeerConnection`, wenn er die Seite suspendiert —
siehe [w3c/webrtc-pc#2489](https://github.com/w3c/webrtc-pc/issues/2489), wo
Chrome das **ohne jedes Ereignis** tat. Auf einem Telefon ist der Wechsel in
einen Messenger, um einen Einladungslink einzufügen, genau das.

Feldtest mit zwei Android-Telefonen: **wenige Sekunden**, dann ist die Einladung
tot. Nur **DuckDuckGo und Safari** wurden dabei beobachtet, eine etwa zehn
Sekunden zu halten.

Auf dem Schreibtisch tritt das nicht auf.

In der Bibliothek gibt es dafür keine Lösung. Ein Relay würde es beheben, nichts
innerhalb der Seite.

## Was daraus folgt

| in der Demo | warum |
| --- | --- |
| `leavingSuspendsUs()` | benannt nach dem, worauf es ankommt, nicht nach „ist das ein Telefon" |
| der *Hurry-back*-Hinweis | erscheint bei der Berührung, die jemanden fortschickt — eine Warnung auf dem Rückweg ist eine Obduktion |
| die Verbindungsanzeige | hält den Zustand beim Hinausgehen und beim Zurückkommen fest; niemand kann einen Bildschirm im Hintergrund beobachten |
| `BROWSERS_THAT_HOLD` | die eine Stelle, die zu ändern ist, wenn das nicht mehr stimmt |

**Ein Wake Lock hilft dagegen nicht.** Er hält den Bildschirm, nicht die Seite,
und der Browser gibt ihn frei, sobald die Seite verborgen ist. Fürs Scannen ist
er trotzdem richtig — ein Bildschirm, der mitten im Scan einschläft, ist ein
eigenes Problem —, aber er behebt das hier nicht.

## Was helfen kann: die Seite Ton abspielen lassen

Eine Seite, die Ton abspielt, friert Chromium nicht ein. Das ist der ganze
Mechanismus, und `createKeepAlive()` ist er.

```js
import { createKeepAlive } from '@le-space/libp2p-webrtc-qr'

const keepAlive = createKeepAlive({
  track: 'audio/warten.mp3',
  metadata: { title: 'Warten auf das andere Telefon', artist: '…' }
})

// In der Geste, die die Einladung erzeugt - vor jedem await.
await keepAlive.start()

// Sobald die Verbindung steht oder der Versuch aufgegeben wird.
await keepAlive.stop()
```

| Option | Vorgabe | Bedeutung |
| --- | --- | --- |
| `track` | — | URL einer Audiodatei für die Schleife. Ohne sie läuft es fast stumm |
| `silent` | `false` | unhörbar laufen, auch mit `track` |
| `volume` | `0.35` | gilt nur für `track` |
| `metadata` | — | `{ title, artist }` für die Medienbenachrichtigung der Plattform |

Eigenschaften: `running`, `supported`. Methoden: `start()` → `Promise<boolean>`,
`stop()`.

Drei Dinge daran sind Absicht:

- **`start()` gehört in eine Nutzergeste.** Ein `AudioContext` beginnt
  suspendiert, und ein Resume außerhalb einer Geste wird abgelehnt. Bis ICE
  fertig gesammelt hat, ist keine Geste mehr übrig.
- **Hörbar als Vorgabe.** Stille ist der Fehlerfall: was der Browser für
  unhörbar hält, zählt irgendwann nicht mehr als Wiedergabe — dann friert die
  Seite trotzdem ein, und die Batterie war umsonst. Hörbar bringt außerdem eine
  Medienbenachrichtigung, und die ist ein beschrifteter Weg mit einem Tipp
  zurück in die App.
- **Es ist kein Wake Lock, und keines ersetzt das andere.** Das eine hält den
  Bildschirm, das andere die Seite am Leben.

**Ob das einen echten App-Wechsel auf Android übersteht, ist offen.** Verifiziert
ist der Mechanismus — der Audiograph startet, läuft in Schleife und wird
freigegeben —, mehr nicht. Die Klärung braucht zwei Telefone und einen
Messenger; das Experiment steht ausformuliert in
[AGENTS.md](https://github.com/NiKrause/libp2p-webrtc-qr/blob/main/AGENTS.md).
## Der Rest des Werkzeugkastens

`createKeepAlive()` oben ist einer von vier Teilen desselben Problems. Die übrigen:

| | |
| --- | --- |
| `leavingSuspendsUs()` | suspendiert das Verlassen diese Seite — die Bedingung dafür, überhaupt zur Eile zu mahnen |
| `BROWSERS_THAT_HOLD` | Browser, die eine wartende Einladung ~10 s halten. **Diese Liste lesen, nicht kopieren** — zwei Kopien laufen auseinander |
| `createWakeLock()` | den *Bildschirm* wach halten: `sync(active)`, dazu `supported` / `wanted` / `held` |
| `stateOf(peerConnection)` | ein Wort dafür, was eine Verbindung gerade tut |
| `pendingConnections(session)` | jede Verbindung einer Session — `offers` **und** `inbound` |

```js
import { leavingSuspendsUs, createWakeLock, stateOf, pendingConnections } from '@le-space/libp2p-webrtc-qr'

if (leavingSuspendsUs()) {
  // Nur hier stimmt eine Mahnung zur Eile. Wer sie am Schreibtisch sieht,
  // lernt, Warnungen zu übergehen.
}

const wakeLock = createWakeLock()
await wakeLock.sync(codeIstSichtbar)         // auch aus `visibilitychange`

const tot = pendingConnections(session).some(c => stateOf(c.peerConnection) === 'closed')
```

`pendingConnections` deckt **beide** Hälften ab, und es ist leicht, nur eine zu
erinnern: `offers` sind Einladungen, die auf eine Antwort warten, `inbound` sind
Verbindungen aus einem angenommenen Angebot. Wer nur über eine iteriert, meldet
für die Hälfte der Verbindungen Gesundheit und für die andere Stille.

`wanted` und `held` am Wake Lock sind getrennt, weil nur das erste in deiner
Hand liegt — ein Headless-Browser bietet die Schnittstelle an und lehnt dann
jede Anfrage ab, weil er keinen Bildschirm hat, den er wach halten könnte.

## Es vorher erklären

`<qr-intro>` stellt die obigen Vorbehalte jemandem voran, bevor er sie braucht,
neben einem live gemessenen Urteil — und `createIntroPolicy()` entscheidet, wann.

```js
import { createIntroPolicy } from '@le-space/libp2p-webrtc-qr/elements'

const policy = createIntroPolicy({ storageKey: 'meineapp.introSeen' })

if (policy.shouldOpen({ arrivedViaInvite })) {
  await intro.open()          // misst einmal, mit probeNetwork
}

intro.addEventListener('close', event => {
  if (event.detail.remember) policy.remember()
})
```

Die eigene Erklärung der App kommt in den Slot; Vorbehalte und Urteil liefert das
Element. `technical` zeigt die Vorbehaltsliste — in einer App mit einfacher und
technischer Ansicht ist dieses Attribut das, was der Umschalter steuert.

Drei Regeln der Politik, die man beim ersten Anlauf jeweils andersherum
entscheiden würde:

- **Wer über eine Einladung kommt, sieht sie nicht.** Diese Person kam, um etwas
  anzunehmen, und ein Dialog davor steht dem Einzigen im Weg, weswegen sie kam.
  Sie sieht die Einführung beim nächsten normalen Besuch — Unterdrücken zählt
  deshalb **nicht** als gesehen.
- **Blockierter Speicher zeigt sie.** Eine zweimal gezeigte Einführung wiegt
  weniger als ein Erstbesucher, der nie eine bekommt.
- **`forget()` gibt es.** Wegklicken darf keine Einbahnstraße sein.

Sein Text ist übersetzbar wie der jedes anderen Elements: `QR_INTRO_STRINGS`
trägt die englischen Vorgaben, `QR_INTRO_STRINGS_DE` die deutschen.
`QrIntroElement` ist für Framework-Hüllen und die Registrierung unter einem
anderen Tag-Namen exportiert.

### Platz für die eigene Umrahmung der App

Eine Einführung gehört selten allein der Bibliothek. Die erste App, die dieses
Element übernimmt, trägt neben ihrem Titel einen Sprach- und einen
Ansichtsumschalter, einen ausdrücklichen Schließen-Knopf und — in der
technischen Ansicht — ein Urteil mit einem Link darin sowie darunter eine Reihe
`qr-status`-Chips. Nichts davon ist Sache des Transports, und ohne einen Ort
dafür hätte die Übernahme des Elements bedeutet, alle vier zu streichen.

```html
<qr-intro>
  <p>Wofür diese App da ist.</p>
  <language-switcher slot="header"></language-switcher>
  <p slot="advice">Im selben Netz klappt es. Fürs Internet <a href="…">ein VPN</a>.</p>
  <button slot="footer">Schließen</button>
</qr-intro>
```

`advice` sitzt unmittelbar unter dem Urteil, und genau darauf kommt es an: Ein
Rat unter einem Urteil, aus dem er nicht folgt, ist ein Rat für eine andere
Lage. Es gibt ihn, weil die String-Tabellen bewusst kein Markup tragen können —
sie werden mit `resolveText` gelesen und in `textContent` geschrieben, was die
Interpolationsgewohnheit von einer Stelle fernhält, auf die später ein
nutzereingegebener String zeigt. Ein Rat, der einen Link braucht, ist Markup,
das die App schreibt.

Ungefüllte Slots kosten nichts: keine Lücke, kein leerer Knoten, von dem ein
Stylesheet wissen müsste.

### Einen Relay anbieten, ohne ihn zum Standard zu machen

Ein gescannter Code setzt voraus, dass die andere Person hier ist. Geht die
Liste über einen Messenger zwei Städte weiter, führt der Weg über einen Relay —
diese Wahl trägt deshalb derselbe Dialog, **aus**, solange niemand danach fragt.

```js
import { findReachableRelays } from '@le-space/libp2p-webrtc-qr'

intro.relay = {
  check: () => findReachableRelays({ baked, probe, discover }),
  storageKey: 'myapp.relayOptIn'
}

intro.addEventListener('relay-check', event => {
  // { source: 'baked' | 'aleph' | 'none', addresses }
})
```

Das Anhaken prüft **sofort**. Ein Opt-in, dessen Wirkung erst beim nächsten
Verbindungsversuch sichtbar wird, lässt die Person raten — genau der Zustand,
den das hier ersetzt. Ein gemerktes Ja wird bei `open()` geprüft und nicht bei
der Zuweisung von `relay`, damit der erste Aufruf nach draußen dann geschieht,
wenn jemand auf die Antwort schaut.

Das Element wählt nichts: `check` gehört der App, denn nur sie kennt ihre
mitgelieferten Adressen und ihren Ping. Bleibt `relay` ungesetzt, ist der
Dialog genau der von vorher — so übernimmt ihn eine App ganz ohne Relay. Ohne
`storageKey` hält die Wahl für die Sitzung.

Eigene Prosa neben der Wahl kommt durch den Slot `relay` — was ein eigener
Relay kostet, wer eueren betreibt. Das ist die Geschichte der App, dasselbe
Argument wie beim Standard-Slot.

## Die Lage erkennen

```js
navigator.userAgentData?.mobile === true ||
  window.matchMedia('(hover: none) and (pointer: coarse)').matches
```

Keine User-Agent-Zeichenkette. Die Frage ist, ob das Verlassen der Seite sie
suspendiert — und genau die beantworten diese beiden Signale.

## Chrome auf Android und IPv6

Chrome auf Android als installierte PWA meldet keinen IPv6-Reflexivkandidaten,
wo Firefox und DuckDuckGo auf *demselben Telefon im selben WLAN* einen melden. Im
Mobilfunk mit Carrier-NAT und ohne IPv6 bleibt damit überhaupt kein Weg aus dem
Netz heraus — wofür `offNetworkRisk() === 'unreliable'` da ist. Siehe
[Netzbereitschaft](network).

## Warnungen gehören dorthin, wo sie stimmen

Ein Schreibtischrechner stellt keinen dieser Hinweise dar, damit ein
Bildschirmleser dort keinen Rat findet, der falsch ist. Eine überall gezeigte
Warnung ist eine, die man getrost übergeht.
