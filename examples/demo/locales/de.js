/**
 * Der eigene Text dieser Demo, deutsch. Siehe `en.js` für den Zuschnitt -
 * insbesondere dafür, warum das Diagnose-Log hier bewusst fehlt.
 */
export default {
  page: {
    title: 'libp2p WebRTC über QR',
    lede: 'Zwei Browser verbinden sich direkt als libp2p-Peers — ohne Relay, ohne Signaling-Server. Offer und Answer von WebRTC reisen außerhalb des Netzes als signierte QR-Codes: ein Gerät scannt den Code vom Bildschirm des anderen ab.'
  },
  stun: {
    summary: 'Was dabei wohin geht',
    who: 'Das Netz zu prüfen heißt, einen STUN-Server zu fragen, von welcher Adresse Ihre Pakete bei ihm ankommen. Zwei Betreiber beantworten das hier, <strong>Cloudflare</strong> und <strong>Google</strong>, und jeder sieht die öffentliche Adresse, von der die Anfrage kam: über IPv4 ist das die Adresse Ihres Routers, geteilt mit allen dahinter — über IPv6 die eigene Adresse dieses Geräts, die mit niemandem geteilt wird.',
    what: 'Mehr trägt eine STUN-Anfrage nicht. Keine Seitenadresse, keine Cookies, kein Browsername — weniger, als jede Website erfährt, die Sie öffnen. Es passiert erneut, sooft Sie eine Einladung erzeugen oder annehmen, weil ohne diese Adressen keine Direktverbindung zustande kommt.',
    stays: 'Die Antwort kommt zu dieser Seite zurück und bleibt hier. An uns geht nichts: diese Seite hat kein Hintersystem, an das sie etwas schicken könnte.'
  },
  identity: {
    label: 'Ihre Peer-ID',
    summary: 'Was Ihre Peer-Identität ist und wo ihr Schlüssel liegt',
    what: 'Ihre Peer-ID. Sie reist in jeder Einladung mit, die Sie erzeugen — die Gegenseite braucht sie, um Ihre Signatur zu prüfen, denn der öffentliche Schlüssel steckt darin. Unterschrieben wird mit dem privaten Schlüssel, aus dem sie abgeleitet ist, und der verlässt dieses Gerät nie.',
    where: 'In einem Browser-Tab gehört der Schlüssel <strong>diesem Tab</strong>. Ein Neuladen — oder ein Telefon, das aus dem Standby aufwacht — kommt deshalb als derselbe Peer zurück und nicht als ein Fremder, während ein anderer Tab ein anderer Peer bleibt, mit dem Sie sich trotzdem verbinden können. Auf dem Startbildschirm installiert gibt es keinen zweiten Tab; dort gehört der Schlüssel der App und überlebt zwischen den Starts. So oder so erscheint dieselbe Kennung in jeder Einladung von hier, bis Sie sie zurücksetzen — und das Zurücksetzen räumt beides ab.',
    reset: 'Als neuer Peer von vorn anfangen'
  },
  compact: {
    label: 'Kurzcode (nach <a href="https://magarcia.github.io/qwbp/spec.html" target="_blank" rel="noreferrer">QWBP</a>) <small>experimentell, und signiert statt blank</small>'
  },
  paste: {
    summary: 'Mir wurde ein Link geschickt, und Antippen hat nicht funktioniert',
    label: 'Fügen Sie den Link ein, den man Ihnen geschickt hat',
    use: 'Diesen Link benutzen',
    scanReply: 'Seine Antwort scannen'
  },
  peers: {
    label: 'Verbunden',
    none: 'Noch niemand verbunden.',
    inviteAnother: '+ Jemanden dazu einladen'
  },
  files: {
    send: 'Eine Datei schicken',
    received: 'Dateien in diesem Gespräch',
    empty: 'Noch nichts geschickt oder empfangen.',
    sent: 'von Ihnen geschickt',
    gotIt: 'Sie haben das erhalten'
  },
  preview: {
    open: ({ name }) => `${name} anzeigen`,
    position: ({ index, total }) => `${index} von ${total}`
  },
  logbook: {
    heading: 'Was hier funktioniert hat',
    enable: 'Aufzeichnen, was hier passiert',
    enableHint: 'Standardmäßig aus. Es wird nichts geschrieben, bis dies angehakt ist, und das Abschalten behält, was bereits aufgezeichnet ist — dafür gibt es „Protokoll leeren". Das Aufgezeichnete bleibt auf diesem Gerät, und der Export lässt Adressen zurück. Eines verlässt es doch: Solange dies an ist, erfährt eine verbundene Gegenstelle genau das, was auch der Export enthält — Browser, System, Netzanbieter, Land und Region — und nennt Ihnen dasselbe. Ihre Adresse, Ihre Stadt und Ihre eigenen Notizen reisen nie mit.',
    hint: 'Jeder Versuch wird aufgezeichnet und geschlossen, wenn er verbindet oder scheitert. Beides bleibt — ein Protokoll der Erfolge sagt nichts darüber, was kaputt ist.',
    provider: 'Netzanbieter',
    locate: 'Ermitteln, wo ich bin',
    locating: 'Frage nach…',
    located: ({ where, precise }) => `Die Abfrage behauptet ${where} — ${precise}`,
    locatedGeo: ({ where }) => `${where} — aus der eigenen Position dieses Geräts`,
    withPosition: 'Position ergänzt',
    coords: ({ lat, lon, accuracy }) =>
      accuracy === '' ? `${lat}, ${lon} — auf der Karte ↗` : `${lat}, ${lon} ±${accuracy} m — auf der Karte ↗`,
    askingPosition: 'frage nach der Position…',
    noPosition: 'keine Position (abgelehnt oder hier nicht verfügbar)',
    locateFailed: ({ reason }) => `Ließ sich nicht ermitteln: ${reason}. Bitte eintippen.`,
    providerHint: 'Telekom, Vodafone, das Hotel…',
    place: 'Wo Sie sind',
    placeHint: 'WLAN zu Hause, Büro, Hotellobby…',
    consent: 'Fremde Dienste fragen, die durch die Frage etwas erfahren',
    consentHint: 'Zwei Anfragen, zwei Preisgaben. api.ipquery.io erfährt die IP-Adresse dieses Geräts — genau das macht seine Antwort erst möglich. Liegt eine Position vor, wird nominatim.openstreetmap.org gefragt, welcher Ort das ist, und erfährt die auf etwa einen Kilometer gerundeten Koordinaten — den Ort, nicht das Haus. Lassen Sie dies aus und tippen Sie die Felder selbst; sie sind dieselben.',
    peer: 'Das andere Gerät',
    peerHint: 'Vanadium auf GrapheneOS, iPhone 12 Safari…',
    peerRow: ({ peer }) => `Gegenstelle: ${peer}`,
    peerReported: ({ peer }) => `meldet sich als ${peer}`,
    empty: 'Noch keine Versuche aufgezeichnet.',
    export: 'Als JSON exportieren',
    clear: 'Protokoll leeren',
    frames: ({ frames }) => `${frames} Bild${frames === 1 ? '' : 'er'}`,
    outcome: {
      connected: 'verbunden',
      failed: 'gescheitert',
      abandoned: 'abgebrochen'
    }
  },
  view: {
    simple: 'Einfach',
    technical: 'Technisch'
  },
  language: {
    en: 'English',
    de: 'Deutsch'
  },
  step: {
    start: {
      heading: 'Browser-Peer starten',
      hint: 'Erzeugt einen libp2p-Knoten mit frischem Schlüsselpaar. Seine Peer-ID signiert jede Nutzlast, die Sie zeigen.',
      button: 'Starten'
    },
    connect: {
      heading: 'Mit jemandem verbinden',
      hint: 'Laden Sie jemanden ein, oder scannen Sie den Code, den er Ihnen zeigt. Beides führt an dieselbe Stelle.',
      invite: 'Einladungslink erzeugen',
      scan: 'Anderen Code scannen',
      tag: 'Tag antippen',
      reconnect: 'Neu verbinden'
    },
    data: {
      heading: 'Reden und Dateien schicken',
      hint: 'Sobald der Handschlag steht, laufen Nachrichten über einen libp2p-Protokoll-Stream auf dem WebRTC-Datenkanal. Dateien gehen über Helia: die sendende Seite legt die Bytes ab und kündigt die CID an, die empfangende holt sie per Bitswap über dieselbe Verbindung.'
    }
  },
  intro: {
    start: 'Los geht\'s',
    what: 'Zwei Browser verbinden sich direkt miteinander. Kein Server dazwischen hält Ihre Nachrichten, und nichts, was Sie senden, läuft über uns.',
    how: 'Zeigen Sie den Code auf diesem Bildschirm der Person neben Ihnen, oder schicken Sie ihr den Link. Sie scannt oder tippt ihn an, zeigt Ihnen einen Code zurück — verbunden.',
    who: 'Wer diesen Code hat, kann sich mit Ihnen verbinden, bis er nach zehn Minuten verfällt. Zeigen Sie ihn der Person, die Sie meinen.'
  },
  progress: {
    // "Schritt 1 von 3" - die Zahlen stehen im Deutschen anders als eine
    // Vorlage mit {n} es erzwingen wuerde, deshalb eine Funktion.
    step: ({ step, text }) => `Schritt ${step} von 3 — ${text}`,
    starting: 'Ihr Peer wird gestartet…',
    checking: 'die Einladung wird geprüft…',
    reply: 'Ihre Antwort entsteht — ein Netzweg wird gesucht…'
  },
  freshness: {
    fresh: ({ minutes }) =>
      `Diese Einladung bleibt noch etwa ${minutes} ${minutes === 1 ? 'Minute' : 'Minuten'} frisch.`,
    stale: 'Diese Einladung ist vermutlich zu alt zum Verbinden — erzeugen Sie eine neue.'
  },
  hurryBack: 'Kommen Sie sofort zurück — innerhalb von Sekunden. Solange Sie in einer anderen App sind, hält dieses Telefon die Seite an, und die Einladung verfällt.',
  tag: {
    listening: 'Höre… Tag berühren',
    hold: 'Telefon an den Tag halten. Die Einladung darauf wird genau wie ein gescannter Code geprüft.',
    unreadable: ({ reason }) => `Dieser Tag ließ sich nicht lesen — ${reason}. Noch einmal versuchen.`,
    unavailable: ({ reason }) => `Tag-Lesen nicht verfügbar: ${reason}. NFC ist vielleicht aus, oder die Berechtigung wurde abgelehnt.`
  },
  invite: {
    heading: 'Zeigen Sie das der anderen Person',
    scanHelp: 'Die Telefonkamera der anderen Person öffnet denselben Link — oder schicken Sie ihn ihr.',
    sendLink: 'Link senden…',
    scanReply: 'Seine Antwort scannen',
    pasteReply: 'Man hat mir einen Link geschickt',
    listen: 'Auf die Antwort horchen',
    play: ({ seconds }) => `Als Ton abspielen (etwa ${seconds}s)`,
    playing: ({ part, total }) => `Spielt Teil ${part} von ${total}…`,
    linkSummary: 'Oder als Link senden',
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
    qrFailed: ({ reason }) => `QR-Verarbeitung fehlgeschlagen: ${reason}`,
    listenFailed: ({ reason }) => `Mikrofon fehlgeschlagen: ${reason}`,
    audioFailed: ({ reason }) => `Abspielen der Antwort fehlgeschlagen: ${reason}`
  }
}
