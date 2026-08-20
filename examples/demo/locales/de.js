/**
 * Der eigene Text dieser Demo, deutsch. Siehe `en.js` für den Zuschnitt -
 * insbesondere dafür, warum das Diagnose-Log hier bewusst fehlt.
 */
export default {
  page: {
    title: 'libp2p WebRTC über QR'
  },
  view: {
    label: 'Ansicht',
    simple: 'Einfach',
    technical: 'Technisch'
  },
  language: {
    label: 'Sprache',
    en: 'English',
    de: 'Deutsch'
  },
  step: {
    connect: {
      heading: 'Mit jemandem verbinden',
      hint: 'Laden Sie jemanden ein, oder scannen Sie den Code, den er Ihnen zeigt. Beides führt an dieselbe Stelle.',
      invite: 'Einladungslink erzeugen',
      scan: 'Seinen Code scannen'
    },
    data: {
      heading: 'Reden und Dateien schicken',
      hint: 'Sobald der Handschlag steht, laufen Nachrichten über einen libp2p-Protokoll-Stream auf dem WebRTC-Datenkanal. Dateien gehen über Helia: die sendende Seite legt die Bytes ab und kündigt die CID an, die empfangende holt sie per Bitswap über dieselbe Verbindung.'
    }
  },
  intro: {
    what: 'Zwei Browser verbinden sich direkt miteinander. Kein Server dazwischen hält Ihre Nachrichten, und nichts, was Sie senden, läuft über uns.',
    how: 'Zeigen Sie den Code auf diesem Bildschirm der Person neben Ihnen, oder schicken Sie ihr den Link. Sie scannt oder tippt ihn an, zeigt Ihnen einen Code zurück — verbunden.',
    who: 'Wer diesen Code hat, kann sich mit Ihnen verbinden, bis er nach zehn Minuten verfällt. Zeigen Sie ihn der Person, die Sie meinen.'
  },
  invite: {
    heading: 'Zeigen Sie das der anderen Person',
    linkSummary: 'Stattdessen den Link kopieren',
    newLink: 'Neuer Link',
    copy: 'Kopieren',
    copied: 'Kopiert',
    starting: 'Startet…',
    copyByHand: 'Markieren und kopieren'
  },
  status: {
    idle: 'Nicht verbunden',
    started: 'Peer gestartet. Erzeugen Sie eine Einladung, oder scannen Sie den Code, den man Ihnen zeigt.',
    inviteReady: 'Einladung fertig. Schicken Sie den Link und lassen Sie diesen Tab offen, bis geantwortet wird.',
    verifying: 'Richtige QR-Art erkannt. Signatur wird geprüft…',
    verified: 'Geprüft. Schicken Sie den Antwortlink zurück und lassen Sie diesen Tab offen.',
    handedOver: 'Antwort an den Tab übergeben, in dem Sie die Einladung erzeugt haben.',
    lostWhileAway: ({ count }) =>
      `${count === 1 ? 'Eine Verbindung ging' : `${count} Verbindungen gingen`} verloren, während Sie weg waren — erzeugen Sie eine neue Einladung.`,
    connected: ({ peerId }) => `Verbunden mit ${peerId}`,
    lost: ({ peerId }) => `Verbindung zu ${peerId} verloren — unten neu verbinden.`,
    rerouting: ({ peerId }) => `${peerId} verloren — die Verbindung wird über die anderen zurückgelegt…`,
    unreachable: ({ peerId }) => `${peerId} war über niemanden erreichbar, der noch verbunden ist — unten neu verbinden.`,
    startFailed: ({ reason }) => `Start fehlgeschlagen: ${reason}`,
    cameraFailed: ({ reason }) => `Kamera fehlgeschlagen: ${reason}`,
    qrFailed: ({ reason }) => `QR-Verarbeitung fehlgeschlagen: ${reason}`
  }
}
