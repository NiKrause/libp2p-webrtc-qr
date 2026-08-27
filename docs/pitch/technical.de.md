# Für Fachleute — Deutsch

*Sprechtext, etwa 55 Sekunden. Für Web2-, Web3- und Krypto-Publikum gleichermaßen.*

---

Jede WebRTC-Anwendung braucht einen Signalisierungsserver.
Irgendetwas muss zwei Peers einander vorstellen.

**Wir haben ihn gelöscht.**

Offer und Answer reisen als QR-Code über den Tisch.
Oder als Link durch einen beliebigen Messenger.
Oder — wenn die Gegenseite keine brauchbare Kamera hat — **als hörbarer Ton zurück.**

Der Kanal ist austauschbar, weil das Vertrauen nicht im Kanal steckt.
Die Nutzlast ist mit dem libp2p-Schlüssel signiert, der den DTLS-Fingerabdruck an die
Peer-ID bindet. Genau deshalb darf der Noise-Handshake entfallen.

Kein Relay. Kein TURN. Kein Konto.

Ehrlich bleiben: STUN sieht eure IP, und die Seite kommt von einem Webserver.

Und wo Hole Punching scheitert, liegt es fast nie am Code.
Es liegt an IPv4-Knappheit. Mit IPv6 auf beiden Seiten fällt der Umweg weg.

Quelloffen, Apache und MIT.

---

## Was jeder Satz trägt

- **„Wir haben ihn gelöscht"** ist der Haken. Wer schon einmal WebRTC gebaut hat, hält
  hier an — der Signalisierungsserver ist die Sache, die man nicht loswird.
- **Die drei Träger sind keine Aufzählung, sondern der Beweis.** Code, Link und Ton
  tragen dieselbe signierte Nutzlast; dass man sie beliebig tauschen kann, *zeigt*, dass
  die Sicherheit nicht am Kanal hängt. Deshalb steht der Satz über die Signatur
  unmittelbar danach und nicht davor.
- **Die Signatur ist kein Beiwerk.** Sie ist der Grund, warum das Weglassen des
  Handshakes zulässig ist. Wer sie auslässt, klingt nach „Verschlüsselung abgeschaltet".
- **Der Ehrlichkeits-Halbsatz kauft Glaubwürdigkeit, statt sie zu kosten.** Ohne ihn
  zerlegt der erste Fachkommentar das Video, und zwar zu Recht.
- **Nicht Netzbetreiber beschuldigen.** Symmetrisches NAT ist die vernünftige Antwort auf
  IPv4-Knappheit, kein Schlendrian; WLAN-Client-Isolation ist eine bewusste
  Sicherheitsmaßnahme. Fehlendes IPv6 ist der behebbare Mangel — die starke Fassung des
  Arguments und die einzige, die vor Fachleuten trägt.
- **Kein Relay, wörtlich gemeint.** Diese Demo ruft keines auf. Die Bibliothek bietet
  Konsumenten eine Naht dafür an, für den Fall, dass Hole Punching scheitert.
