# Für Fachleute — Deutsch

*Sprechtext, etwa 55 Sekunden. Für Web2-, Web3- und Krypto-Publikum gleichermaßen.*

---

Jede WebRTC-Anwendung braucht einen Signalisierungsserver.
Irgendetwas muss zwei Peers einander vorstellen.

**Wir haben ihn gelöscht.**

Offer und Answer reisen als QR-Code über den Tisch.
Signiert mit dem libp2p-Schlüssel, der den DTLS-Fingerabdruck an die Peer-ID bindet —
und genau deshalb darf der Noise-Handshake entfallen. Der Code *ist* der Vertrauensanker.

Kein Relay. Kein TURN. Kein Konto. Keine Registrierung.

Ehrlich bleiben: STUN sieht eure IP, und die Seite selbst kommt von einem Webserver.

Und wo das Hole Punching scheitert, liegt es fast nie am Code.
Es liegt an IPv4-Knappheit. Mit IPv6 auf beiden Seiten fällt der Umweg weg.

Quelloffen, Apache und MIT.

---

## Was jeder Satz trägt

- **„Wir haben ihn gelöscht"** ist der Haken. Wer schon einmal WebRTC gebaut hat, hält
  hier an — der Signalisierungsserver ist die Sache, die man nicht loswird.
- **Die Signatur ist kein Beiwerk.** Sie ist der Grund, warum das Weglassen des
  Handshakes zulässig ist, und nicht bloß ein Sicherheitsmerkmal obendrauf. Wer das
  auslässt, klingt nach „Verschlüsselung abgeschaltet".
- **Der Ehrlichkeits-Halbsatz kauft Glaubwürdigkeit, statt sie zu kosten.** Ohne ihn
  zerlegt der erste Fachkommentar das Video, und zwar zu Recht.
- **Nicht Netzbetreiber beschuldigen.** Symmetrisches NAT ist die vernünftige Antwort auf
  IPv4-Knappheit, kein Schlendrian; WLAN-Client-Isolation ist eine bewusste
  Sicherheitsmaßnahme. Fehlendes IPv6 ist der behebbare Mangel — das ist die starke
  Fassung des Arguments und die einzige, die vor Fachleuten trägt.
- **Kein Relay, wörtlich gemeint.** Diese Demo ruft keines auf. Die Bibliothek bietet
  Konsumenten eine Naht dafür an, für den Fall, dass Hole Punching scheitert.
