# libp2p WebRTC über QR

Deutsch · **[English](README.md)**

> ### ⚠️ Experimentell
>
> Das funktioniert, und es ist nicht fertig. Nutzen Sie es dort, wo eine
> gescheiterte Verbindung ein Ärgernis ist und kein Verlust.
>
> **Was trägt.** Die Sicherheitseigenschaft lautet: eine Signatur bindet den
> DTLS-Fingerabdruck an eine Peer-ID, und nur deshalb darf der übliche
> Verschlüsselungs-Handshake entfallen. Diese Kette wurde in einem Review
> lückenlos verfolgt und hält an jeder Stelle, an der sie hätte reißen können.
>
> **Was sich nicht zusichern lässt — und nicht an uns liegt.** Ein SDP als
> QR-Code auszutauschen macht den Signalisierungsserver überflüssig. Es macht
> nicht alles andere überflüssig, was eine direkte Verbindung braucht, und
> Browser und Netze stellen das häufig nicht bereit:
>
> - ein **NAT, das Hole Punching zulässt**. Symmetrisches und Carrier-Grade-NAT
>   tun das nicht, und ohne Relay im Entwurf gibt es keinen Ausweichweg
> - ein **Netz, in dem zwei Clients einander überhaupt adressieren dürfen**.
>   Konferenz-, Hotel- und Café-WLAN verbieten genau das regelmäßig — und der
>   QR-Teil hat sichtbar funktioniert
> - eine **sichere Herkunft**, ohne die es weder Kamera noch Mikrofon gibt. Eine
>   LAN-Adresse über einfaches http hat keine, und genau so testet man zu zweit
> - eine **Seite, die das Weggehen übersteht**, denn den Link zu verschicken
>   heißt, in einen Messenger zu wechseln — und Telefone frieren ein, was nicht
>   vorn ist
>
> Fehlt eines davon, verifiziert der Handschlag weiterhin und die Verbindung
> kommt trotzdem nie zustande. Dieses Scheitern liegt in der Umgebung und nicht
> in diesem Code, und keine Arbeit hier schafft es aus der Welt.
>
> **Was unseres ist, und bekannt.** Kompakte Nutzlasten sind
> **standardmäßig aus**, weil eine aus rekonstruiertem SDP gebaute
> Verbindung unter Last verstummt — vier von acht Läufen
> ([#83](https://github.com/NiKrause/libp2p-webrtc-qr/issues/83)). Und die API
> bewegt sich noch: das akustische Rahmenformat änderte sich zwischen `0.11.0`
> und `0.12.0`.
>
> Fehlerberichte von echten Geräten sind das Nützlichste, was jemand schicken
> kann. Das meiste oben wurde so gefunden und nicht von einem Test.

Zwei Browser verbinden sich direkt als libp2p-Peers — **ohne Relay und ohne
Signaling-Server**. WebRTC-Offer und -Answer werden außerhalb des Netzes
ausgetauscht: als signierte, komprimierte QR-Codes, die beide Telefone vom
Bildschirm des jeweils anderen abscannen — einmal in jede Richtung, weil kein
Server die Answer zurückträgt.

**Live-Demo: <https://webrtc-qr.le-space.de>** · **[Dokumentation](https://nikrause.github.io/libp2p-webrtc-qr/de/)** · **[Roadmap](ROADMAP.md)** · **[Hinweise für KI-Agenten](AGENTS.md)**

| Paket | Beschreibung |
| --- | --- |
| [`packages/webrtc-qr`](packages/webrtc-qr) | `@le-space/libp2p-webrtc-qr` – der Transport und der signierte Payload-Codec |
| [`examples/demo`](examples/demo) | Browser-Demo: QR-Scan per Kamera, Kopieren/Einfügen als Rückfall, Chat über einen libp2p-Stream |
| [`examples/helia-file-transfer`](examples/helia-file-transfer) | Zwei Helia-Knoten (IPFS) übertragen eine Datei über die per QR verhandelte Verbindung, ausschließlich per Bitswap |

## Wie es funktioniert

Jede QR-Nutzlast trägt eine SDP-Beschreibung, eine Session-ID und die Peer-ID des
Absenders. Sie ist mit dessen privatem libp2p-Schlüssel signiert und wird gegen
den in der Peer-ID eingebetteten öffentlichen Schlüssel geprüft, bevor das SDP
angenommen wird.

Diese Signatur ist der Grund, warum der übliche Noise-Handschlag von libp2p
entfallen darf. DTLS verschlüsselt weiterhin – das fällt nie weg –, aber bei
WebRTC ist Noise dazu da, zu *authentifizieren*, und das hat die Signatur bereits
getan: das SDP enthält den DTLS-Fingerabdruck, eine gültige Signatur bindet die
WebRTC-Session also an die Peer-ID. Dieselbe Idee, die `certhash` bei
WebRTC-Direct benutzt. Eine manipulierte Nutzlast fällt bei der Prüfung durch,
bevor überhaupt gewählt wird.
[`docs/connection-security.md`](docs/connection-security.md) führt das
vollständig aus, einschließlich der Fälle, in denen es aufhört, sicher zu sein.

Nutzlasten werden vor dem Zeichnen deflate-komprimiert, damit der Code in der
Größe bleibt, die eine Telefonkamera noch auflösen kann. Was dann immer noch
nicht passt, wird in eine animierte BC-UR-Sequenz zerlegt statt an
Kopieren/Einfügen verwiesen – fountain-codiert, die Bilder lassen sich also in
beliebiger Reihenfolge lesen, und ein verpasstes kostet nichts.

```
Browser A                             Browser B
  |  Offer erzeugen -> signieren -> QR   |
  |------------ Kamera-Scan ------------>|
  |                                      Signatur prüfen, Answer erzeugen
  |<----------- Kamera-Scan -------------|
  Signatur prüfen -> WebRTC verbunden -> libp2p-Stream
```

## Entwicklung

```bash
pnpm install
pnpm start   # Demo auf http://localhost:5173
pnpm test    # Unit + beide E2E-Suiten, auf Chromium, Firefox und WebKit
```

Die Dokumentationsseite liegt bewusst außerhalb des pnpm-Workspace – niemand,
der am Transport arbeitet, soll dafür Docusaurus installieren müssen:

```bash
cd docs-site && pnpm install && pnpm start
```

## Stand und bekannte Grenzen

- **Kein TURN-Server.** Zwei Peers hinter restriktiven oder symmetrischen NATs
  können über IPv4 weiterhin scheitern. Carrier-Grade-NAT ist allerdings ein
  IPv4-Problem – haben beide Peers eine globale IPv6-Adresse, verbinden sie sich
  trotzdem, und die Demo meldet je Adressfamilie, welche der beiden vorliegt,
  bevor irgendetwas gescannt wird.
- **Wi-Fi-Client-Isolation bricht die Verbindung, während jede Prüfung besteht.**
  Gästenetze in Cafés, Hotels und auf Konferenzen verbieten es Clients
  routinemäßig, einander zu adressieren. STUN funktioniert weiterhin, beide Peers
  sammeln also Reflexivkandidaten, die Bereitschaftsanzeige meldet das Netz als
  offen – und dann kommt kein einziges Kandidatenpaar zustande. Das ist ein
  anderer Fehlerfall als restriktives oder symmetrisches NAT, und in genau den
  Umgebungen, für die dieses Projekt wirbt, ist er vermutlich der häufigere. Er
  ist **nicht** feststellbar, bevor ein Peer am anderen Ende steht: die Prüfung
  misst, ob dieser Browser *das Internet* erreicht, nicht ob er *einen anderen
  Client am selben Zugangspunkt* erreicht. Unabhängig berichtet von
  [vbocan/webrtc-oob-pairing](https://github.com/vbocan/webrtc-oob-pairing).
- **Nutzlasten verfallen nach zehn Minuten**, zwei Minuten Uhrenversatz werden
  toleriert. Das Fenster gehört zur signierten kanonischen Form: es umzuschreiben
  macht die Signatur ungültig, statt die Nutzlast zu verlängern.
- **Die E2E-Suite läuft mit `?ice=host`** und übt damit den Loopback-Weg. Echtes
  ICE mit STUN-Kandidaten erzeugt größeres SDP und damit größere QR-Nutzlasten,
  als die Suite misst. An der Live-Demo gemessen: 933 Zeichen nur mit
  Host-Kandidaten, 1057 mit STUN, gegen ein Budget von 2200 – und **266 Zeichen**
  für dasselbe Angebot als kompakte (v3) Nutzlast, die **standardmäßig aus ist**,
  siehe unten. Der kompakte Wert bewegt sich mit STUN kaum, weil er Kandidaten
  als 7 oder 19 Byte trägt statt als SDP-Zeilen.
- **Die kompakte Nutzlast ist optional, und der Grund ist nicht, dass sie
  unfertig wäre.** Eine Verbindung aus einem rekonstruierten SDP verstummt unter
  Last: in isolierten Worktrees gemessen, blieben in vier von acht Läufen beide
  Peers auf einem offenen Stream sitzen, der keine Bytes trug – gegen null von
  acht bei v2. Kein Fehler, kein Verbindungsabbruch, es kam schlicht nichts an.
  Die Ursache ist nicht verstanden
  ([#83](https://github.com/NiKrause/libp2p-webrtc-qr/issues/83)), und ein Code in
  Viertelgröße ist keine Verbindung wert, die unter Last in der Hälfte der Fälle
  scheitert. Das Lesen ist davon unberührt: ein Peer nimmt ohnehin beide Formate
  an, die Umstellung ändert also nur, was ein Gerät herausgibt.
- **Was eine kleinere Nutzlast bringt, ist ein Code, kein dünnerer.** Oberhalb
  von 600 Zeichen wird die Einladung in eine BC-UR-Animation zerlegt, deren
  Bilder bauartbedingt klein sind – eine v2-Nutzlast zeichnet also mehrere Codes
  ähnlicher Dichte statt eines dichten. Im Browser gemessen: kompakt 284 Zeichen
  in **1** Bild zu 65 Modulen, v2 994 Zeichen in **5** Bildern zu 69. Der
  Unterschied, den ein Mensch merkt, ist ein einziger Blick statt eines ruhig
  gehaltenen Telefons über eine ganze Sequenz.
- **WebKits WebRTC ist nur unter macOS verifiziert.** Playwrights WebKit-Build
  für Linux hat kein funktionierendes WebRTC, die CI führt dort jede
  WebKit-Spezifikation aus, die ohne Peer-Verbindung auskommt, und überspringt
  die übrigen. Chromium und Firefox sind in der CI durchgehend verifiziert,
  WebKit durchgehend nur lokal unter macOS.
- **Der Kameraweg ist von keinem Test abgedeckt.** Jeder automatisierte Test
  tauscht Nutzlasten per Kopieren/Einfügen oder programmatisch aus.
  `getUserMedia`, `BarcodeDetector` und der `jsQR`-Rückfall werden ausschließlich
  von Hand geprüft. Mehr Browser in der CI haben daran nichts geändert – das ist
  der eine Teil, den ein Headless-Browser nicht ausführen kann.
- **Dieser Kanal ist beobachtbar, und nichts hier behauptet das Gegenteil.**
  „Kein Server beteiligt" heißt nicht „im Netz unsichtbar": dieselbe
  Defensiv-Sicherheitsstudie liefert funktionierende Sigma-Signaturen mit und
  meldet vollständige Erkennung über alle ihre Testszenarien. Ein vom Bildschirm
  gescannter QR-Code ist außerhalb des Netzes, aber der WebRTC-Verkehr danach ist
  gewöhnlicher Verkehr in einem gewöhnlichen Netz. Wessen Bedrohungsmodell einen
  verdeckten Kanal braucht, sollte ihn nicht aus dem Fehlen eines
  Signaling-Servers ableiten.
- `packages/webrtc-qr/src/vendor` ist eine Kopie von `@libp2p/webrtc`-Interna,
  die das Paket flussaufwärts nicht exportiert. Siehe
  [das Vendor-README](packages/webrtc-qr/src/vendor/README.md).

## Was als Nächstes kommt

Die Nutzlast ist die bindende Randbedingung für alles Übrige: wie weit entfernt
ein Code noch scannt, mit welcher Kamera, und wie viele ICE-Kandidaten ein Peer
haben darf, bevor es nicht mehr passt. Die vielversprechendste Antwort ist kein
größerer oder animierter Code, sondern ein sehr viel kleinerer –
[QWBP](https://magarcia.github.io/qwbp/) erledigt denselben Handschlag in 41–100
Byte, indem es einen rohen DTLS-Fingerabdruck plus binär gepackte Kandidaten
sendet, die ICE-Zugangsdaten per HKDF ableitet und dann über den geöffneten
DataChannel aufsteigt.

Das und der Rest steht in der **[Roadmap](ROADMAP.md)**: mehrteilige BC-UR als
Rückfall, Entfernung des vendorierten Teilbaums, Verlagerung der
Session-Orchestrierung ins Paket, ein Replay-Fenster, Mesh-Bootstrapping für
mehrere Peers, und TURN.

## Herkunft und Verweise

Das ging aus [**AquiGorka/webrtc-qr**](https://github.com/AquiGorka/webrtc-qr)
von **Gorka Ludlow** (MIT) hervor, einem „WebRTC Connect Experiment", das
WebRTC-Signaling zwischen einem Host und einem beitretenden Gerät rein über
QR-Codes austauscht. Von dort stammt die Idee; die Anerkennung dafür gehört
dorthin. Was dieses Repository hinzufügt, ist die libp2p-Seite: die Nutzlast wird
mit dem libp2p-Schlüssel des Peers signiert, gegen den öffentlichen Schlüssel in
seiner Peer-ID geprüft, und die entstehende Session wird über einen Transport zu
einer echten libp2p-Verbindung aufgewertet.

Die unmittelbare Linie führt über das Beispiel
`js-libp2p-example-webrtc-direct-qr` in einem Fork von
[js-libp2p-examples](https://github.com/libp2p/js-libp2p-examples), hier
herausgelöst, damit der Transport unabhängig vom Beispiel-Repository
veröffentlicht werden kann.

Verwandte Arbeiten, die vor einer Erweiterung zu lesen lohnen:

- [**Air-gapped WebRTC: breaking the QR limit**](https://magarcia.io/air-gapped-webrtc-breaking-the-qr-limit/)
  von [Martin Garcia Monterde](https://github.com/magarcia) ([magarcia.io](https://magarcia.io)) –
  argumentiert, dass semantische Kompression generische
  schlägt, und erklärt, warum der Autor animierte QR-Sequenzen zugunsten einer
  kleineren Nutzlast verworfen hat.
- [**QWBP**](https://magarcia.github.io/qwbp/) und die zugehörige
  [**Spezifikation**](https://magarcia.github.io/qwbp/spec.html) – ein
  QR-WebRTC-Bootstrap-Protokoll, das die Nutzlast auf 41–100 Byte drückt, indem
  es einen rohen DTLS-Fingerabdruck plus binär gepackte ICE-Kandidaten sendet und
  die ICE-Zugangsdaten mit HKDF-SHA256 ableitet, statt sie zu übertragen. Zwei
  Größenordnungen unter dem ~1 kB signierten SDP dieses Projekts – zum Preis,
  keine eigene Identitätsbindung zu tragen.
- [**vbocan/webrtc-oob-pairing**](https://github.com/vbocan/webrtc-oob-pairing)
  von Valer Bocan (MIT) – eine Defensiv-Sicherheitsstudie derselben Idee, mit QR
  in die eine und einem akustischen Zirpen in die andere Richtung. Sie ist die
  Gegenperspektive: sie dokumentiert, dass ein solcher Kanal durch
  TLS-aufbrechende Proxys und bei blockiertem DNS funktioniert, und liefert
  Erkennungssignaturen dafür mit.

## Lizenz

Lizenziert wahlweise unter Apache 2.0 ([LICENSE-APACHE](LICENSE-APACHE)) oder MIT
([LICENSE-MIT](LICENSE-MIT)).
