---
id: elements
title: Elemente
sidebar_label: Elemente
---

```js
import '@le-space/libp2p-webrtc-qr/elements'
```

Registriert sechs Custom Elements. Alle sind über CSS-Custom-Properties gestaltbar
und über `strings` übersetzbar.

Die Klassen — `QrInviteElement`, `QrScannerElement`, `QrListenElement`, `QrStatusElement`,
`QrPeersElement`, `QrIntroElement` — sind für Framework-Hüllen und für die Registrierung unter
einem anderen Tag-Namen exportiert; für den Normalfall genügt der Import des
Moduls.

## `<qr-invite>` — zeigt eine Nutzlast als Code

| | |
| --- | --- |
| Attribute | `value`, `frame-interval` |
| Eigenschaften | `value`, `frameInterval`, `strings` |
| Ereignis | `render` → `{ frames, modules, characters }` |
| Zeichenketten | `alt`, `part`, `recovery` |

Oberhalb von `STATIC_QR_MAX_LENGTH` wird die Nutzlast in animierte
BC-UR-Einzelbilder zerlegt; `frames > 1` am `render`-Ereignis sagt, dass es
passiert ist. `modules` und `characters` sind das, was man protokolliert, wenn
ein Code sich nicht scannen lässt.

## `<qr-scanner>` — Kamera, Scan-Schleife, Zusammensetzung

| | |
| --- | --- |
| Attribut | `label` |
| Eigenschaften | `label`, `strings`, `validate`, `isOpen` |
| Methoden | `open()`, `close()` |
| Ereignisse | `scan` → `{ text }`, `close`, `error` → `{ error }` |
| Zeichenketten | `label`, `close`, `unsupported`, `starting`, `looking`, `stillLooking({ attempts })`, `rejected`, `animated({ received, total })`, `animatedUnknown` |

`validate` entscheidet, ob ein gescannter Code der ist, den dieser Bildschirm
will — ein `{ ok: false, reason }` lässt die Kamera weiterlaufen und zeigt den
Grund an.

Das Element gibt die Kamera auf **jedem** Weg hinaus frei, auch bei Entfernung
aus dem DOM.

## `<qr-listen>` — Mikrofon, Dekodierung, Zusammensetzung

| | |
| --- | --- |
| Attribut | `label` |
| Eigenschaften | `label`, `strings`, `validate`, `createReceiver`, `isOpen` |
| Methoden | `open()`, `close()` |
| Ereignisse | `payload` → `{ text }`, `close`, `error` → `{ error }` |
| Strings | `label`, `close`, `unsupported`, `noAudio`, `starting`, `listening`, `quiet`, `progress({ received, total })`, `rejected`, `denied` |

Die andere Hälfte von `<qr-scanner>` und von derselben Bauart: das Element
besitzt das Gerät, die Dekodierung und die Zusammensetzung, und `validate`
entscheidet, ob das Gehörte die Nutzlast ist, auf die dieser Bildschirm wartet.
`{ ok: false, reason }` lässt das Mikrofon offen und zeigt den Grund.

`createReceiver` wird übergeben statt importiert: der Codec läge sonst im
Elemente-Bundle für jede Seite, auch für die, die nie ein Mikrofon öffnen, und
ggwaves WebAssembly-Glue nennt Nodes `path` und `fs`, die kein Browser-Bundle
auflöst. Eine Zeile an der Aufrufstelle hält die optionale Abhängigkeit optional:

```js
import { createAudioReceiver } from '@le-space/libp2p-webrtc-qr'

listen.createReceiver = createAudioReceiver
```

Es fordert das Mikrofon mit `echoCancellation`, `noiseSuppression` und
`autoGainControl` **aus** an. Alle drei sind auf Sprache abgestimmt und hier
schädlich: die Rauschunterdrückung ist gebaut, um genau solche gleichmäßigen Töne
zu entfernen, die Echokompensation zieht ab, was die Lautsprecher spielen, und
die Pegelregelung verwischt die Symbolgrenzen mitten in der Übertragung.

Die Pegelanzeige ist keine Dekoration — wer zwei Geräte aneinanderhält, hat sonst
kein Mittel, ein abgelehntes Mikrofon von einem stillen Raum zu unterscheiden.
Das Mikrofon wird auf **jedem** Weg hinaus freigegeben, auch beim Entfernen aus
dem DOM.

Zum Träger selbst siehe [Ton](/audio).

## `<qr-status>` — was dieses Netz zulässt

| | |
| --- | --- |
| Attribut | `rows` — aus `browser ipv4 ipv6 camera overall`, Vorgabe `ipv4 ipv6 overall` |
| Eigenschaften | `strings`, `rtcConfiguration`, `result` |
| Methoden | `probe()`, `renderResult(result)` |
| Ereignis | `probe` → das Ergebnis |
| gespiegelt | `blocked`, `off-network-risk="blocked\|unreliable"` |
| Zeichenketten | `browser`, `ipv4`, `ipv6`, `camera`, `overall`, `open`, `relay`, `symmetric`, `blocked`, `measuring`, `alarm`, `alarmUnreliable` |

Zeigt während der Messung einen Fortschrittsbalken und schlägt Alarm, wenn das
Netz keinen Peer anderswo erreicht. `renderResult` stellt ein selbst gemessenes
Urteil dar.

**Ein Urteil ist eine Beobachtung über diesen Browser, nicht über das Netz.**
Siehe [Netzbereitschaft](network).

## `<qr-peers>` — wer verbunden ist

| | |
| --- | --- |
| Eigenschaften | `peers` — `[{ peerId, state }]`, `count`, `strings` |
| Ereignis | `disconnect` → `{ peerId }` |
| Zeichenketten | `connected`, `connecting`, `disconnected`, `failed`, `closed`, `new`, `disconnect`, `disconnectFrom` |

Das Trennen auszuführen ist Sache des Hosts; die Liste ändert sich, wenn der Host
sagt, dass er es getan hat.

## Alles Sichtbare übersetzen

Jedes Element nimmt ein `strings`-Objekt, das über die Vorgaben **gemerged**
wird — drei ersetzte Beschriftungen verlieren also den Rest nicht.

```js
import { QR_STATUS_STRINGS } from '@le-space/libp2p-webrtc-qr/elements'

status.strings = { ipv4: 'IPv4', blocked: 'keins', measuring: 'Prüfe Netzwerk…' }
```

Werte sind Zeichenketten — oder **Funktionen**, wo eine Zahl im Spiel ist
(`stillLooking({ attempts })`, `animated({ received, total })`). Das Paket zwingt
einem Verbraucher seine Wortstellung nicht auf.

Vorgaben: `QR_INVITE_STRINGS`, `QR_SCANNER_STRINGS`, `QR_LISTEN_STRINGS`,
`QR_STATUS_STRINGS`, `QR_PEERS_STRINGS`. `mergeStrings` und `resolveText` sind für alle exportiert,
die darauf aufbauen.

## QR-Rahmung

Für eine eigene Einladungsansicht statt `<qr-invite>`.

| | |
| --- | --- |
| `needsAnimation(text)` | liegt das über `STATIC_QR_MAX_LENGTH` |
| `createFrameSource(text, options)` | `{ total, next() }` — BC-UR-Einzelbilder |
| `createPartAccumulator()` | `receive(part)` → Fortschritt oder die ganze Nutzlast |
| `looksLikeUrPart(text)` | ist das ein Bild eines mehrteiligen Codes |
| `preload()` | den Encoder vor dem ersten Bild aufwärmen |
| Konstanten | `FRAME_INTERVAL_MS`, `MAX_FRAGMENT_BYTES`, `STATIC_QR_MAX_LENGTH` |

Die Einzelbilder sind fountain-codiert: sie lassen sich in beliebiger Reihenfolge
lesen, und ein verpasstes kostet nichts.

## Gestaltung

CSS-Custom-Properties am Element oder an einem Vorfahren setzen.

```css
qr-status {
  --qr-status-open: #3edc97;
  --qr-status-degraded: #ffc24b;
  --qr-status-blocked: #ff6b5b;
  --qr-status-chip-background: transparent;
  --qr-status-chip-color: inherit;
}
```

Jedes Element dokumentiert seine eigenen Variablen am Kopf seiner Quelle. Durch
das Shadow DOM dringt sonst nichts hinein oder hinaus.
