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
