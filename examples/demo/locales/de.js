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
  // Der Hebel und die drei Dinge daran, die der Schalter nicht verrät. Jedes
  // davon würde man sonst durch eine Überraschung herausfinden: dass er auch
  // gilt, was dieses Gerät annimmt; dass eine Einladung ohne Angebot
  // abgelehnt statt gezeigt wird; und dass eine zurückgehaltene Adresse zu
  // keiner der beiden Familien zählt.
  family: {
    label: 'Welche Adressen anbieten',
    both: 'Beide — was dieses Gerät findet',
    v4: 'nur IPv4',
    v6: 'nur IPv6',
    'both-ways': ({ family }) => `In beide Richtungen: dieses Gerät bietet nur ${family}-Kandidaten an und nimmt nur ${family} an. Das genügt, um auch das andere Gerät auf ${family} festzulegen — dort ist keine Einstellung nötig.`,
    refuses: ({ family }) => `Hat dieses Gerät keinen ${family}-Kandidaten, wird die Einladung abgelehnt statt gezeigt. Diese Ablehnung ist die Antwort, und sie wird als solche aufgezeichnet.`,
    mdns: 'Adressen, die der Browser als .local-Namen zurückhält, fallen weg: der Name verbirgt, für welche Familie er steht, und ein Lauf, der das nicht ausschließen kann, ist keine Messung. Alle Engines halten lokale Adressen standardmäßig zurück — ohne STUN-Server können das alle Kandidaten sein, und dann bleibt nichts zum Anbieten übrig.'
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
    familyFilter: ({ family }) => `nur ${family}`,
    pair: ({ pair }) => `Paar ${pair}`,
    published: 'veröffentlicht',
    outcome: {
      connected: 'verbunden',
      failed: 'gescheitert',
      abandoned: 'abgebrochen'
    }
  },
  /**
   * Prüfen, was aufgezeichnet wurde (#179) - die Stufe zwischen Messen und
   * Veröffentlichen.
   *
   * Die Texte haben über das Benennen der drei Urteile hinaus eine Aufgabe: zu
   * sagen, dass das Urteil der Person gehört und nichts anderes es fällen kann.
   * „Bedienfehler" muss bequem zu wählen sein, sonst wählt es niemand - und
   * dann füllt sich der Datensatz mit verpatzten Läufen, die wie Befunde
   * aussehen.
   */
  review: {
    heading: 'Prüfen, was aufgezeichnet wurde',
    hint: 'Ein Urteil pro Zeile, und fällen kann es nur ein Mensch. Von Hand gesammelte Ergebnisse sind voll von verwackelten Kameras, Codes, die auf dem Weg ins andere Zimmer abgelaufen sind, und halb abgebrochenen Läufen - und kein Detail einer Aufzeichnung unterscheidet das von einem Netz, das es nicht kann. Nur als sauber markierte Zeilen könnten je veröffentlicht werden; der Rest bleibt hier als Ihre eigene Aufzeichnung. Ihre Notizen bleiben ohnehin hier — mitreisen würde das Urteil.',
    show: 'Anzeigen',
    all: 'Alle Läufe',
    unreviewed: 'Noch nicht geprüft',
    sound: 'Sauber — eine echte Messung',
    'operator-error': 'Bedienfehler — mein Fehler, nicht der des Netzes',
    retest: 'Muss erneut getestet werden',
    verdictLabel: 'Was dieser Lauf wert war',
    noteLabel: 'Notiz zu diesem Lauf',
    noteHint: 'was schiefging — zum Nachlesen nächste Woche…',
    tally: ({ total, reviewed, sound }) =>
      `${reviewed} von ${total} ${total === 1 ? 'Lauf' : 'Läufen'} geprüft, ${sound} davon sauber.`,
    tallyNone: 'Noch nichts aufgezeichnet, also nichts zu prüfen.',
    unlabelled: ({ runs }) =>
      `${runs === 1 ? 'Ein sauberer Lauf trägt' : `${runs} saubere Läufe tragen`} kein Szenario: wahre Beobachtungen, aber nichts sagt, was sie prüfen sollten — in einer Auswertung nach Szenario können sie deshalb nicht auftauchen.`,
    nomatch: 'Kein Lauf passt zu diesem Filter. Das Protokoll ist nicht leer — ändern Sie oben „Anzeigen".',
    publish: 'Dieses Gerät hat nichts verlassen, und nichts hier hat sich mit irgendetwas verbunden. Bis dieser Knopf gedrückt wird, ist die einzige Verbindung, die diese Seite je geöffnet hat, die zu dem Gerät, mit dem Sie getestet haben.'
  },
  /**
   * Veröffentlichen (#179 Schritt 6) - das Erste und Einzige hier, das sich
   * verbindet.
   *
   * Die Texte haben eine Aufgabe, die die anderen nicht haben: die
   * Unwiderruflichkeit *vor* dem Druck lesbar zu machen, nicht danach. Ein
   * Append-only-Log kann weder löschen noch korrigieren, und jeder Satz hier
   * ist darauf geschrieben, dass jemand ihn einmal und schnell liest und dann
   * handelt.
   */
  publish: {
    none: 'Es wartet nichts. Eine Zeile wird veröffentlichbar, sobald Sie sie als sauber markieren.',
    count: ({ rows }) => `${rows} saubere ${rows === 1 ? 'Zeile wartet' : 'Zeilen warten'} auf die Veröffentlichung.`,
    preview: 'Genau zeigen, was hinausginge',
    withheldHeading: 'Bleibt hier:',
    goesHeading: 'Geht hinaus, genau so:',
    withheld: [
      'Alles Getippte: wo Sie waren, welches Gerät die Gegenstelle war, und Ihre Notizen aus der Prüfung.',
      'Kandidaten-Adressen und -Ports, und die öffentliche IP dahinter.',
      'Koordinaten, Stadt und Region — die letzten beiden sind nicht bloß zu fein, sie sind falsch: eine IP-Abfrage verortet ein Gerät bei seinem Anbieter, nicht bei sich selbst.',
      'Die genaue Zeit. Veröffentlicht wird die Stunde, nicht die Minute.'
    ],
    button: 'Die sauberen Zeilen veröffentlichen',
    buttonCount: ({ rows }) => `${rows} ${rows === 1 ? 'Zeile' : 'Zeilen'} veröffentlichen`,
    note: 'Das Log ist append-only, und jede Zeile ist von ihrem Urheber signiert — es lässt sich nicht nachbearbeiten und nicht zurückholen. Genau deshalb kommt das Prüfen zuerst. Schreiben darf jeder: eine Erlaubnisliste wäre Teil der Datenbankadresse, die Aufnahme einer zweiten beitragenden Person ergäbe also eine andere Datenbank und ließe alles Bisherige stranden.',
    finding: 'Suche ein Relay…',
    connecting: 'Verbinde…',
    opening: 'Öffne die Datenbank…',
    waiting: 'Warte darauf, dass jemand sie hält…',
    writing: ({ written, total }) => `Schreibe ${written} von ${total}…`,
    done: ({ rows }) => `${rows} ${rows === 1 ? 'Zeile' : 'Zeilen'} veröffentlicht. Zurückholen lässt sich das nicht.`,
    failed: ({ reason }) => `Es wurde nichts veröffentlicht: ${reason}`
  },
  /**
   * Ein Szenario absichtlich fahren (#179).
   *
   * Die Texte tragen die Voraussetzungen, und das müssen sie: ein falsch
   * aufgebauter Lauf ist schlimmer als keiner, weil er als Befund in die
   * Aufzeichnung geht. Jeder Schritt sagt deshalb, was gelten muss - nicht nur,
   * was zu drücken ist.
   */
  scenario: {
    legend: 'Ist das ein Test?',
    hint: 'Ein markierter Lauf ist ein Beleg. Ein unmarkierter ist nur ein Versuch, den jemand gemacht hat, und hinterher unterscheidet die beiden nichts mehr. Markieren Sie einen Lauf nur, wenn der Aufbau unten wirklich zutrifft.',
    none: 'Nein - ich möchte nur eine Verbindung',
    'same-lan': 'A - beide Geräte im selben WLAN',
    'across-networks': 'B - zwei Geräte in zwei Netzen, an zwei Orten',
    'mobile-data': 'C - beide Geräte im Mobilfunknetz',
    off: 'Die Aufzeichnung ist aus, ein markierter Lauf schreibt also überhaupt nichts. Setzen Sie zuerst den Haken bei „Aufzeichnen, was hier passiert" - auf beiden Geräten.',
    steps: {
      'same-lan': [
        'Bringen Sie beide Geräte ins selbe WLAN.',
        'Schalten Sie die Aufzeichnung auf beiden Geräten ein. Jedes schreibt seine eigene Zeile, und das Paar ist die Messung.',
        'Erzeugen Sie hier eine Einladung und scannen Sie sie mit dem anderen Gerät. Der Link trägt die Markierung mit, die zweite Zeile ist also auch markiert.',
        'Scannen Sie die Antwort hier zurück.'
      ],
      'across-networks': [
        'Sie brauchen eine zweite Person, woanders, in deren eigenem Netz. Nicht Ihr WLAN und nicht Ihr Hotspot - das wäre Szenario A mit Umweg.',
        'Schalten Sie beide die Aufzeichnung ein. Jedes Gerät schreibt seine eigene Zeile, und beide tragen dieselbe Kopplungs-ID, damit sich die Hälften hinterher zuordnen lassen.',
        'Erzeugen Sie hier eine Einladung und schicken Sie den Link über den Chat, den Sie ohnehin benutzen. Der Link trägt die Markierung, die ID und die Anleitung mit.',
        'Die andere Person öffnet ihn, ihre Seite erzeugt einen Antwort-Link, und den schickt sie zurück. Fügen Sie ihn hier ein.',
        'Seien Sie beide gleichzeitig am Gerät. Eine Einladung wird binnen Minuten schal, weil die NAT-Bindungen dahinter ablaufen - ein heute Abend beantworteter Link verbindet sich mit nichts mehr.',
        'Um das zu fragen, wofür B da ist - geht IPv6 zwischen diesen beiden Netzen? -, stellen Sie hier „Welche Adressen anbieten" ein, bevor Sie die Einladung erzeugen. Eine Seite genügt; die Gegenstelle braucht keine eigene Einstellung.'
      ],
      'mobile-data': [
        'Schalten Sie das WLAN auf beiden Geräten aus, damit beide wirklich im Mobilfunknetz sind.',
        'Benutzen Sie kein Gerät als Hotspot für das andere. Das ist Szenario A über einen Mobilfunkanbieter, es gelingt meist - und landet als Mobilfunk-Erfolg in der Aufzeichnung.',
        'Schalten Sie die Aufzeichnung auf beiden Geräten ein.',
        'Erzeugen Sie hier eine Einladung, scannen Sie sie mit dem anderen Gerät und scannen Sie die Antwort zurück. Die Bildschirme tragen das Signalling, eine Verbindung zwischen den Geräten braucht es dafür nicht.',
        'Rechnen Sie mit Fehlschlägen. Wie es scheitert, ist die Messung - halten Sie deshalb fest, welcher Browser auf welchem Gerät läuft, denn genau da gehen sie auseinander.'
      ]
    },
    tally: ({ runs, connected }) => `${runs} markierte ${runs === 1 ? 'Messung' : 'Messungen'} auf diesem Gerät, davon ${connected} verbunden.`,
    tallyNone: 'Unter dieser Markierung ist noch nichts aufgezeichnet.',
    pairing: 'Die Zeile der anderen Person bleibt auf deren Gerät. Hier wird sie nicht eingesammelt: die beiden Hälften zusammenzubringen heißt, dass Sie beide exportieren und die Kopplungs-ID von Hand abgleichen - bis es einen absichtlichen Ort zum Veröffentlichen gibt (#179).'
  },
  /**
   * Einen Lauf an jemanden übergeben, der nicht im Raum ist (#179 Schritt 5).
   *
   * `message` ist die einzige Zeichenkette in beiden Katalogen, die sich nicht
   * an die Person vor dem Bildschirm richtet, sondern an deren Gegenüber im
   * Chat - deshalb dort das Du, und deshalb erklärt sie sich aus dem Nichts.
   * Sie sagt auch wann, nicht nur was: eine Einladung läuft in Minuten ab.
   */
  pair: {
    sending: 'Die andere Person steht nicht neben Ihnen, der Link geht deshalb mit einer Anleitung hinaus. Kopieren oder Senden nimmt beides mit.',
    replying: 'Schicken Sie das an die Person zurück, die Ihnen den Link geschickt hat - und zwar jetzt: deren Einladung läuft binnen Minuten ab.',
    message: 'Ich teste gerade, ob sich zwei Telefone in verschiedenen Netzen direkt miteinander verbinden können. Öffne diesen Link auf deinem Telefon, in deinem eigenen Netz - nicht in meinem. Du bekommst dann einen Antwort-Link: schick mir den in den nächsten Minuten zurück, sonst müssen wir von vorn anfangen.'
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
