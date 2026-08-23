/**
 * German for everything the elements show.
 *
 * The `strings` seam exists so a consumer can translate; it does not mean each
 * consumer should have to. Two of them - yogasūcī and simple-todo - were
 * translating the same three dozen labels by hand, into German, from the same
 * English defaults. That is the same work three times, and three chances for
 * one of them to fall behind when a string is added upstream.
 *
 * These are **defaults for a locale**, not a finished translation of anybody's
 * app: an app with its own voice merges its own wording over them and keeps the
 * rest. That is what `mergeStrings` is for.
 *
 * ```js
 * import { QR_STATUS_STRINGS_DE } from '@le-space/libp2p-webrtc-qr/elements'
 *
 * status.strings = QR_STATUS_STRINGS_DE
 * ```
 *
 * The wording follows the English in substance, not word by word. Where the
 * English hedges - "usually fail", "cannot reach" - the German hedges the same
 * amount, because those verdicts are observations about *this browser* and
 * overstating them is the specific mistake the English text was corrected for.
 *
 * `test/strings-de.test.js` asserts these tables carry exactly the keys the
 * English ones do, so a string added upstream cannot silently stay English.
 */

/** @type {typeof import('./qr-status.js').QR_STATUS_STRINGS} */
export const QR_STATUS_STRINGS_DE = {
  browser: 'Browser',
  ipv4: 'IPv4',
  ipv6: 'IPv6',
  camera: 'Kamera',
  overall: 'Ergebnis',
  open: 'nutzbar',
  relay: 'über TURN',
  symmetric: 'nur lokal',
  blocked: 'keins',
  measuring: 'Prüfe, was dieses Netz zulässt…',
  alarm: 'Dieses Netz erreicht keinen Peer in einem anderen Netz. Eine hier erzeugte Einladung verbindet sich nicht, bis Sie ins WLAN wechseln, IPv6 aktivieren oder ein Relay benutzen.',
  alarmUnreliable: 'Dieses Netz vergibt pro Ziel einen neuen Port und hat kein IPv6. Eine hier erzeugte Einladung erreicht Peers in diesem Netz, zu allen anderen scheitert sie meistens. WLAN, IPv6 oder ein Relay macht es verlässlich.'
}

/** @type {typeof import('./qr-scanner.js').QR_SCANNER_STRINGS} */
export const QR_SCANNER_STRINGS_DE = {
  label: 'Code scannen',
  close: 'Schließen',
  unsupported: 'Dieser Browser unterstützt keinen Kamerazugriff',
  starting: 'Kamera wird gestartet…',
  looking: 'Suche einen Code… ruhig halten und etwa das halbe Bild ausfüllen.',
  stillLooking: ({ attempts }) =>
    `Suche weiter… ${attempts} Versuche. Gehen Sie etwas näher heran, halten Sie ruhig, und vermeiden Sie Spiegelungen.`,
  rejected: 'Dieser Code ist nicht der, auf den dieser Bildschirm wartet.',
  // Zahl und Gesamtzahl stehen im Deutschen anders herum als eine
  // Vorlage mit {n} es erzwingen würde - genau deshalb ist es eine Funktion.
  animated: ({ received, total }) =>
    `Bewegter Code: Teil ${received} von ${total}. Weiter ruhig halten.`,
  animatedUnknown: 'Bewegter Code erkannt. Weiter ruhig halten.'
}

/** @type {typeof import('./qr-invite.js').QR_INVITE_STRINGS} */
export const QR_INVITE_STRINGS_DE = {
  alt: 'Einladungscode',
  part: ({ slot, total }) => `Teil ${slot} von ${total} — Telefon still halten`,
  recovery: 'Wiederherstellungsbild — Telefon still halten'
}

/** @type {typeof import('./qr-intro.js').QR_INTRO_STRINGS} */
export const QR_INTRO_STRINGS_DE = {
  title: 'Bevor Sie anfangen',
  close: 'Schließen',
  checkHeading: 'Dieser Browser, in diesem Netz',
  checking: 'Prüfe, was dieses Netz zulässt…',
  ok: 'Eine Direktverbindung aus diesem Netz heraus sieht möglich aus.',
  unreliable: 'Dieses Netz vergibt pro Ziel einen neuen Port und bietet kein IPv6. Eine Direktverbindung klappt daher meist nur zu jemandem im selben Netz.',
  none: 'Es wurde kein Weg aus diesem Netz heraus gefunden. Zu jemandem im selben Netz können Sie sich trotzdem verbinden.',
  sameNetwork: 'Zwei Geräte im selben WLAN verbinden sich unabhängig von alledem.',
  technicalHeading: 'Wissenswert',
  technical: [
    'Ein Telefon schließt eine wartende Einladung wenige Sekunden nach dem Verlassen der App. Nur bei DuckDuckGo und Safari wurde beobachtet, dass sie etwa zehn Sekunden hält.',
    'Chrome auf Android meldet kein IPv6, wo Firefox und DuckDuckGo auf demselben Telefon im selben WLAN eines melden. Ein Urteil beschreibt diesen Browser, nicht das Netz.',
    'Im Mobilfunk verhindert Carrier-NAT eine Direktverbindung zu Gegenstellen außerhalb dieses Netzes meistens.',
    'Ein VPN verlegt beide Enden woandershin — das kann ein blockiertes Netz retten und ein funktionierendes zerstören.'
  ],
  dontShow: 'Nicht mehr anzeigen',
  waysHeading: 'Wie das andere Gerät hereinkommt',
  wayQr: 'Per Kamera: Du hältst einen Code hoch, das andere Gerät scannt ihn. Nichts verlässt dieses Netz.',
  relayLabel: 'Über einen Relay verbinden',
  relayHint: 'Für den Fall, dass das andere Gerät den Code nicht scannen kann — etwa über einen Messenger. Aus, solange du nicht danach fragst.',
  relayChecking: 'Suche einen Relay, der antwortet…',
  relayReachable: ({ count }) => `${count === 1 ? 'Ein bekannter Relay hat' : count + ' bekannte Relays haben'} geantwortet. Es wurde kein Verzeichnis gefragt.`,
  relayDiscovered: ({ count }) => `${count === 1 ? 'Ein Relay' : count + ' Relays'} im Verzeichnis gefunden — die mitgelieferten schwiegen.`,
  relayNone: 'Kein Relay hat geantwortet. Der Weg über den Code funktioniert weiter.'
}

/** @type {typeof import('./qr-peers.js').QR_PEERS_STRINGS} */
export const QR_PEERS_STRINGS_DE = {
  connected: 'verbunden',
  connecting: 'verbindet…',
  disconnected: 'verbindet erneut…',
  failed: 'fehlgeschlagen',
  closed: 'geschlossen',
  new: 'verbindet…',
  disconnect: 'Trennen',
  disconnectFrom: ({ peerId }) => `Verbindung zu ${peerId} trennen`
}

/** @type {typeof import('./qr-listen.js').QR_LISTEN_STRINGS} */
export const QR_LISTEN_STRINGS_DE = {
  label: 'Auf die Antwort horchen',
  close: 'Schließen',
  unsupported: 'Dieser Browser kann kein Mikrofon öffnen',
  noAudio: 'Das Audiosystem ist nicht gestartet. Vielleicht hat dieses Gerät keine Tonausgabe, die der Browser nutzen kann.',
  starting: 'Mikrofon wird geöffnet…',
  listening: 'Ich höre zu. Halten Sie die Geräte nah zusammen und spielen Sie den Ton auf dem anderen ab.',
  quiet: 'Noch nichts gehört. Spielt das andere Gerät, und ist es laut genug?',
  progress: ({ received, total }) => `${received} von ${total} Teilen gehört. Weiterspielen lassen.`,
  rejected: 'Das ist nicht die Antwort, auf die dieser Bildschirm wartet.',
  denied: 'Das Mikrofon wurde abgelehnt. Der Code und der Link funktionieren beide weiterhin.'
}
