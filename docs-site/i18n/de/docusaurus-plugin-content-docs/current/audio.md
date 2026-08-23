---
id: audio
title: Ton
sidebar_label: Ton
---

Ein dritter Träger für den Handschlag, neben dem Code und dem Link — und der
einzige, der eine Asymmetrie behebt, an der die anderen beiden nichts ändern.

## Warum überhaupt Ton

Der Handschlag ist symmetrisch, die Geräte sind es nicht. Zwei Telefone gehen
gut: jedes hat Kamera und Bildschirm, kann also einen Code zeigen und einen
lesen. **Ein Laptop und ein Telefon nicht.** Der Laptop zeigt das Angebot, das
Telefon scannt es — und dann soll das Telefon seine Antwort in eine Webcam
halten, die schlecht sitzt, schlecht ist oder fehlt. In der Praxis weichen Leute
auf Kopieren und Einfügen aus, also genau auf den Fall, den dieses Projekt
mühelos machen will.

Also: QR in die eine Richtung, Ton in die andere. Die Idee stammt von
[vbocan/webrtc-oob-pairing](https://github.com/vbocan/webrtc-oob-pairing), wo
eine Workstation sich mit einem Telefon paart, das über einen hörbaren Ton
antwortet.

**Träger, kein Format.** Es sind dieselben signierten Bytes, die auch in einen
Code oder einen Link gehen, und beglaubigt wird weiterhin durch die Signatur in
der Nutzlast — hier wie überall sonst. Ein Mikrofon ist kein vertrauenswürdiger
Kanal und wird auch nicht als einer behandelt.

## Was es kostet

Gemessen bei 48 kHz, für eine volle Sendung von 140 Byte:

| Protokoll | Sekunden | Byte/s |
| --- | ---: | ---: |
| `normal` | 13,5 | 10,3 |
| `fast` | 9,3 | 15,1 |
| `fastest` | 5,0 | 28,0 |

Eine kompakte Antwort (v3) misst rund **207 Byte**, also zwei Sendungen: etwa
**8 Sekunden** mit `fastest`, **14** mit `fast`. Eine volle Antwort (v2) misst
rund 758 Byte — sechs Sendungen, bestenfalls dreißig Sekunden —, weshalb dieser
Träger das kompakte Format will statt des Formats der Einladung.

`fast` ist der Vorgabewert. Der Unterschied zu `fastest` sind fünf Sekunden gegen
einen Raum: das schnellste Protokoll packt seine Symbole am dichtesten, und genau
das lässt es als erstes an einem Echo oder einem Lüfter scheitern.

## Die Rate, auf die sich beide Seiten einigen müssen

**Der Codec ist bei 44,1 kHz stumm.** Gemessen über die Raten, mit denen Browser
tatsächlich starten: 16000, 24000, 32000, 48000 und 96000 tragen eine Nutzlast
hin und zurück; 8000, 11025, 22050, 44100 und 88200 kodieren eine Wellenform, die
zu nichts dekodiert — ohne Fehlermeldung in beide Richtungen.

Das ist keine Laborkuriosität. Die Vorgaberate eines Browsers folgt dem
Ausgabegerät, und 44,1 kHz meldet ein großer Teil von ihnen; auf diesen Rechnern
wäre jede Übertragung stillschweigend gescheitert. Beide Seiten **fordern** die
Rate deshalb an, statt die vorgefundene zu nehmen:

```js
import { AUDIO_SAMPLE_RATE } from '@le-space/libp2p-webrtc-qr'

const context = new AudioContext({ sampleRate: AUDIO_SAMPLE_RATE })
```

Der Browser rechnet zwischen ihr und der Hardware um, worin Browser gut sind.
`encodeToAudio` und `createAudioReceiver` verweigern eine Rate, die sie nicht
tragen können, mit einer Meldung, die den Ausweg nennt — lautes Scheitern ist
besser als getragene Stille.

`<qr-listen>` fordert sie von sich aus an.

## Die Grenze, die sich nicht meldet

Der Codec trägt **höchstens 140 Byte pro Sendung und kürzt alles Längere
stillschweigend** — eine gültige Wellenform, die sauber zu den ersten 140 Byte
dekodiert, und der Verlust steht nur auf stdout. Eine halbe Antwort, die als
halbe Antwort verifiziert, ist das Schlimmste, was dieser Träger zu bieten hat.
Deshalb wird hier gerahmt und zerlegt, und ein Rahmen, der die Grenze erreichen
würde, wirft stattdessen.

Der Rahmenkopf ist `<Index><Anzahl><Id><Id><Id>:` — je eine Ziffer für Position
und Anzahl, also höchstens neun Sendungen, dann drei Zeichen, die benennen, um
*welche* Nutzlast es sich handelt. `AUDIO_TRANSMISSION_LIMIT`,
`AUDIO_HEADER_LENGTH` und `AUDIO_CHUNK_LIMIT` sind exportiert, damit ein
Konsument, der seine eigene Nutzlast bemisst, die Zahl lesen kann statt sie
abzuschreiben.

**Beide Hälften des Kopfes verdienen ihre Bytes.** Die Grenze ist eine
*Byte*-Zahl, und die Aufteilung zählt Bytes, keine Zeichen: `String.length` zählt
UTF-16-Einheiten, weshalb eine Nutzlast mit irgendetwas außerhalb von ASCII in
Stücke geschnitten wurde, die hier richtig aussahen und drüben abgeschnitten
ankamen. Und die Id trennt eine Nutzlast von der anderen — hört man Teil 1 der
einen und Teil 2 der anderen Antwort, setzt der Empfänger ohne sie etwas
zusammen, das es nie gab, und meldet es als vollständig. Zwei Antworten sind sehr
oft gleich lang, die Anzahl konnte sie also nie unterscheiden. Die Id wird aus
der Nutzlast abgeleitet, sodass ein zweites Abspielen derselben Antwort die
Lücken des ersten füllt, statt von vorn zu beginnen.

## Senden

```js
import { encodeToAudio } from '@le-space/libp2p-webrtc-qr'

const context = new AudioContext()
const { frames, seconds } = await encodeToAudio(answerPayload, {
  protocol: 'fast',           // AUDIO_PROTOCOLS: normal, fast, fastest
  sampleRate: context.sampleRate,
  volume: 15
})

for (const samples of frames) {
  const buffer = context.createBuffer(1, samples.length, context.sampleRate)
  buffer.copyToChannel(samples, 0)
  const source = context.createBufferSource()
  source.buffer = buffer
  source.connect(context.destination)
  source.start()
  await new Promise(resolve => { source.onended = resolve })
}
```

Ein Puffer je Sendung, nicht einer für alle. Die Lücke dazwischen ist die Stelle,
an der ein Empfänger, der ein Stück verpasst hat, die nächste Präambel sauber
hört — und an der jemand das Telefon näher halten kann, ohne das schon
Angekommene zu verlieren.

`AUDIO_DEFAULT_PROTOCOL` ist das, worauf `protocol` zurückfällt.

## Zuhören

```js
import { createAudioReceiver } from '@le-space/libp2p-webrtc-qr'

const receiver = await createAudioReceiver({ sampleRate: context.sampleRate })

// Gefüttert mit Blöcken von Mikrofon-Samples — aus einem AudioWorklet, einem
// ScriptProcessor oder einem aufgezeichneten Puffer. Die Antwort ist null,
// solange die Nutzlast nicht vollständig ist.
const payload = receiver.push(samples)
if (payload != null) {
  receiver.close()
  await session.acceptAnswer(payload)
}
```

Stücke dürfen in beliebiger Reihenfolge und mehrfach ankommen — dass jemand den
Ton noch einmal abspielt, weil der erste Versuch übertönt wurde, ist der
Normalfall und kein Fehler. Eine Wiederholung wird deshalb ignoriert und setzt
nichts zurück. `missing()` nennt die noch ausstehenden Sendungen und `total()`, wie viele es
insgesamt sind — die beiden Hälften einer Anzeige „2 von 3". Beide werden
gebraucht: wer die Gesamtzahl allein aus den fehlenden Indizes ableitet, liegt
falsch, sobald die Lücke nicht am Ende ist. `reset()` vergisst eine halb empfangene Nutzlast,
`close()` gibt den Codec frei.

## Die Abhängigkeit

Der Codec ist [ggwave](https://github.com/ggerganov/ggwave) (MIT), eine
**optionale Peer-Abhängigkeit**, geladen per `await import()` in dem Moment, in
dem jemand den Kanal öffnet. Wer nur den Transport will, zahlt keine 150 KB
WebAssembly für ein Merkmal, das er nie öffnet, und niemandem bricht der Build,
weil ein Paket fehlt, das er nicht benutzt. Wer den Kanal ohne es erreicht,
bekommt einen Fehler, der das Paket benennt und sagt, dass jeder andere Träger
weiter funktioniert.

`loadAudioCodec()` ist genau dieses Laden, exportiert für Konsumenten, die es vor
einer Geste vorwärmen wollen. `resetAudioCodec()` vergisst es wieder, was für
Tests gedacht ist. `frameForAudio()` und `parseAudioFrame()` sind die Rahmung für
sich, für alle, die diese Nutzlasten über eine andere Tonbibliothek tragen.

## Was nicht bewiesen ist

Der Rundlauf ist als Schleife getestet: die Wellenform, die dieses Paket erzeugt,
zurück in seinen eigenen Empfänger. Das beweist Rahmung, Zerlegung und
Zusammensetzen. **Es beweist keinen Raum.** Ein Laptop-Lautsprecher in ein
Telefon-Mikrofon auf Gesprächsabstand, mit Echo und Lüfter, ist eine Messung und
Handarbeit — siehe
[#3](https://github.com/NiKrause/libp2p-webrtc-qr/issues/3).
