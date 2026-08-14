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
