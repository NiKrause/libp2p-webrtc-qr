/**
 * This demo's own text, English.
 *
 * The elements' text is not here - the library carries it, in both languages
 * (`QR_STATUS_STRINGS` and `QR_STATUS_STRINGS_DE` and their siblings). What
 * belongs here is what this page says in its own voice.
 *
 * **The diagnostic log is deliberately absent.** Those forty-odd messages wrap
 * `error.message` from libp2p, which is English whatever this file says, so a
 * translated wrapper produces a German sentence with an English tail - for a
 * reader who is reading error text anyway, and who only sees it in the
 * technical view. The status line is here, because that one is read by
 * everybody in both views.
 */
export default {
  page: {
    title: 'libp2p WebRTC over QR',
    lede: 'Two browsers connect directly as libp2p peers — no relay, no signaling server. The WebRTC offer and answer travel out-of-band as signed QR codes: one device scans the code off the other screen.'
  },
  stun: {
    summary: 'What this sends, and to whom',
    who: 'Checking the network means asking a STUN server what address your packets arrive from. Two operators answer that question here, <strong>Cloudflare</strong> and <strong>Google</strong>, and each sees the public address the request came from: over IPv4 that is your router\u2019s address, shared with everyone behind it — over IPv6 it is this device\u2019s own address, which is not shared with anyone.',
    what: 'A STUN request carries nothing else. No page address, no cookies, no browser name — less than any website you open is told about you. It happens again whenever you create or accept an invite, because a direct connection cannot be made without those addresses.',
    stays: 'The answer comes back to this page and stays here. Nothing is sent to us: this page has no backend to send it to.'
  },
  identity: {
    label: 'Your Peer ID',
    summary: 'What your peer identity is, and where its key lives',
    what: 'Your Peer ID. It travels inside every invite you create — the other side needs it to check your signature, because the public key is embedded in it. The private key it was derived from is what actually signs, and it never leaves this device.',
    where: 'In a browser tab the key is kept for <strong>that tab</strong>, so reloading - or a phone waking from standby - comes back as the same peer instead of a stranger, while another tab stays a different peer you can still connect to. Installed to a home screen there is no second tab, so the key is kept for the app instead and survives between launches. Either way the same identifier appears in every invite from here until you reset it, and resetting clears both.',
    reset: 'Start over as a new peer'
  },
  compact: {
    label: 'Short code (<a href="https://magarcia.github.io/qwbp/spec.html" target="_blank" rel="noreferrer">QWBP</a>-style) <small>experimental, and signed rather than bare</small>'
  },
  // The lever, and the three things about it that are not obvious from the
  // control. Each is a fact somebody would otherwise discover by being
  // surprised: that it governs what this device accepts, that an invite with
  // nothing to offer is refused rather than shown, and that a withheld address
  // counts as neither family.
  family: {
    label: 'Which addresses to offer',
    both: 'Both — whatever this device finds',
    v4: 'IPv4 only',
    v6: 'IPv6 only',
    'both-ways': ({ family }) => `Both directions: this device offers only ${family} candidates and accepts only ${family} ones, which is enough to hold the other device to ${family} too — it needs no setting of its own.`,
    refuses: ({ family }) => `If this device has no ${family} candidate, the invite is refused rather than shown. That refusal is the answer, and it is recorded as one.`,
    mdns: 'Addresses the browser withholds as a .local name are dropped: the name hides which family it stands for, and a run that cannot rule that out is not a measurement. Every engine withholds local addresses by default, so without a STUN server that can be every candidate there is - and then there is nothing left to offer.'
  },
  paste: {
    summary: 'Someone sent me a link and tapping it did not work',
    label: 'Paste the link they sent you',
    use: 'Use this link',
    scanReply: 'Scan their reply'
  },
  peers: {
    label: 'Connected',
    none: 'No one connected yet.',
    inviteAnother: '+ Invite someone else'
  },
  files: {
    send: 'Send a file',
    received: 'Files in this conversation',
    empty: 'Nothing sent or received yet.',
    sent: 'you sent this',
    gotIt: 'you received this'
  },
  preview: {
    open: ({ name }) => `Show ${name}`,
    position: ({ index, total }) => `${index} of ${total}`
  },
  logbook: {
    heading: 'What worked here',
    enable: 'Record what happens here',
    enableHint: 'Off by default. Nothing is written until this is ticked, and turning it off again keeps what is already recorded - use Clear for that. What is recorded stays on this device, and the export leaves addresses behind. One thing does leave: while this is on, a peer you connect to is told exactly what the export carries - browser, system, provider, country and region - and tells you the same. Your address, your city and the notes you typed never travel.',
    hint: 'Every attempt is recorded and closed when it connects or fails. Both are kept - a log of successes says nothing about what is broken.',
    provider: 'Network provider',
    locate: 'Work out where I am',
    locating: 'Asking…',
    // "Claims" rather than "is". IP geolocation places a device at its
    // provider's egress and can be hundreds of kilometres out - measured on a
    // cable connection reported as Berlin from Bavaria. The word is the whole
    // correction: what follows is a claim by a service, and the coordinates
    // underneath are the measurement to check it against.
    located: ({ where, precise }) => `the lookup claims ${where} — ${precise}`,
    // No "claims": this one is geocoded from the measured position, so it is
    // this device's own answer rather than a service's guess about routing.
    locatedGeo: ({ where }) => `${where} — from this device's own position`,
    withPosition: 'position added',
    coords: ({ lat, lon, accuracy }) =>
      accuracy === '' ? `${lat}, ${lon} — on the map ↗` : `${lat}, ${lon} ±${accuracy} m — on the map ↗`,
    askingPosition: 'asking for a position…',
    noPosition: 'no position (refused, or not available here)',
    locateFailed: ({ reason }) => `Could not work it out: ${reason}. Type it instead.`,
    providerHint: 'Telekom, Vodafone, the hotel…',
    place: 'Where you are',
    placeHint: 'home wifi, office, hotel lobby…',
    consent: 'Ask outside services, which learn something by being asked',
    consentHint: 'Two requests, two disclosures. api.ipquery.io learns this device\'s IP address - that is what makes its answer possible. If a position is granted, nominatim.openstreetmap.org is asked what place it is in, and learns the coordinates rounded to about a kilometre - the town, not the building. Leave this off and type the fields yourself; they are the same either way.',
    peer: 'The other device',
    peerHint: 'Vanadium on GrapheneOS, iPhone 12 Safari…',
    peerRow: ({ peer }) => `other end: ${peer}`,
    peerReported: ({ peer }) => `reports itself as ${peer}`,
    empty: 'No attempts recorded yet.',
    export: 'Export as JSON',
    clear: 'Clear the log',
    frames: ({ frames }) => `${frames} frame${frames === 1 ? '' : 's'}`,
    familyFilter: ({ family }) => `${family} only`,
    pair: ({ pair }) => `pair ${pair}`,
    outcome: {
      connected: 'connected',
      failed: 'failed',
      abandoned: 'abandoned'
    }
  },
  /**
   * Reviewing what was recorded (#179), which is the stage between measuring
   * and publishing.
   *
   * The wording has one job beyond naming the three verdicts: to say that the
   * judgement is the person's and cannot be anything else. "Operator error" has
   * to be comfortable to pick, or nobody picks it and the dataset fills up with
   * fumbled runs that look like findings.
   */
  review: {
    heading: 'Review what you recorded',
    hint: 'A verdict per row, and nothing but a person can give it. Hand-collected results are full of fumbled camera aims, codes that expired on the way to the other room and runs abandoned halfway, and no detail in a record tells those apart from a network that cannot do it. Only rows you mark sound could ever be published; the rest stay here as your own record. Your notes stay here either way - the verdict is what would travel.',
    show: 'Show',
    all: 'All runs',
    unreviewed: 'Not reviewed yet',
    sound: 'Sound - a real measurement',
    'operator-error': 'Operator error - mine, not the network\'s',
    retest: 'Needs re-testing',
    verdictLabel: 'What this run was worth',
    noteLabel: 'Note on this run',
    noteHint: 'what went wrong, for you to read next week…',
    tally: ({ total, reviewed, sound }) =>
      `${reviewed} of ${total} ${total === 1 ? 'run' : 'runs'} reviewed, ${sound} sound.`,
    tallyNone: 'Nothing recorded yet, so nothing to review.',
    unlabelled: ({ runs }) =>
      `${runs === 1 ? 'One sound run carries' : `${runs} sound runs carry`} no scenario: true observations, but nothing says what they were testing, so they cannot appear in a breakdown by scenario.`,
    nomatch: 'No run matches this filter. The log is not empty - change "Show" above.',
    publish: 'Nothing is published from here and nothing here connects to anything. Publishing is a separate, deliberate step that does not exist yet (#179) - until it does, a sound verdict means "this row would be fit to publish", not "this row has been".'
  },
  /**
   * Running a scenario on purpose (#179).
   *
   * The wording carries the preconditions, and it has to: a run set up wrongly
   * is worse than no run at all, because it enters the record looking like a
   * finding. So each step says what must be true, not just what to press.
   */
  scenario: {
    legend: 'Running a test?',
    hint: 'A labelled run is evidence. An unlabelled one is just an attempt somebody made, and nothing can tell the two apart afterwards. Label a run only when the setup below is actually true.',
    none: 'No - I just want to connect',
    'same-lan': 'A - both devices on the same Wi-Fi',
    'across-networks': 'B - two devices on two networks, in two places',
    'mobile-data': 'C - both devices on mobile data',
    off: 'Recording is off, so a labelled run would write nothing at all. Tick "Record what happens here" first - on both devices.',
    steps: {
      'same-lan': [
        'Put both devices on the same Wi-Fi.',
        'Turn recording on, on both devices. Each one writes its own row, and the pair is the measurement.',
        'Create an invite here and scan it with the other device. The link carries the label, so the other row is labelled too.',
        'Scan the reply back here.'
      ],
      'across-networks': [
        'You need a second person, somewhere else, on their own network. Not your Wi-Fi and not your hotspot - that is scenario A with extra steps.',
        'Both of you turn recording on. Each device writes its own row, and both rows carry the same pairing id, so the two halves can be matched afterwards.',
        'Create an invite here and send them the link through whatever chat you already use. The link carries the label, the id and what they have to do with it.',
        'They open it, their page makes a reply link, and they send that back. Paste it here.',
        'Be at the keyboard at the same time. An invite goes stale within minutes as the NAT bindings behind it expire, so a link answered this evening connects to nothing.',
        'To ask what B is actually for - does IPv6 work between these two networks - set "Which addresses to offer" here before you create the invite. One side is enough; the other end needs no setting of its own.'
      ],
      'mobile-data': [
        'Turn Wi-Fi off on both devices, so both really are on mobile data.',
        'Do not make one device a hotspot for the other. That is scenario A over a carrier, it usually succeeds, and it would enter the record as a mobile-data success.',
        'Turn recording on, on both devices.',
        'Create an invite here, scan it with the other device, then scan the reply back. The screens carry the signalling, so no uplink between them is needed.',
        'Expect failures. How it fails is the measurement, so note which browser is on each device - this is where they differ most.'
      ]
    },
    tally: ({ runs, connected }) => `${runs} labelled ${runs === 1 ? 'run' : 'runs'} recorded on this device, ${connected} of them connected.`,
    tallyNone: 'Nothing recorded under this label yet.',
    pairing: 'The other person\'s row stays on their device. Nothing here collects it: matching the two halves means both of you exporting and lining up the pairing id by hand, until there is somewhere deliberate to publish them to (#179).'
  },
  /**
   * Handing a run over to somebody who is not in the room (#179 step 5).
   *
   * `message` is the only string in either catalogue addressed to a third
   * party rather than to the person using the page - it is pasted into a chat
   * and read by their friend. So it explains itself from nothing, and it says
   * when rather than only what: an invite expires in minutes, and a link
   * answered that evening connects to nothing.
   */
  pair: {
    sending: 'They are not in the room, so the link goes out with instructions. Copying or sending it takes both.',
    replying: 'Send this back to the person who sent you the link, and do it now - their invite stops working within minutes.',
    message: 'I am testing whether two phones on different networks can connect to each other directly. Open this link on your phone, on your own network - not mine. It will show you a reply link: send that one back to me in the next few minutes, otherwise we have to start over.'
  },
  view: {
    simple: 'Simple',
    technical: 'Technical'
  },
  language: {
    en: 'English',
    de: 'Deutsch'
  },
  step: {
    start: {
      heading: 'Start browser peer',
      hint: 'Creates a libp2p node with a fresh key pair. Its Peer ID signs every payload you show.',
      button: 'Start'
    },
    connect: {
      heading: 'Connect to someone',
      hint: 'Invite someone, or scan the code they are showing you. Either one gets you to the same place.',
      invite: 'Create invite link',
      scan: 'Scan their code',
      reconnect: 'Reconnect'
    },
    data: {
      heading: 'Talk and send files',
      hint: 'Once the handshake completes, messages travel over a libp2p protocol stream on the WebRTC data channel. Files go through Helia: the sender adds the bytes and announces the CID, the receiver pulls them with bitswap over the same connection.'
    }
  },
  intro: {
    start: 'Let\'s go',
    what: 'Two browsers connect to each other directly. There is no server in the middle holding your messages, and nothing you send passes through us.',
    how: 'Show the code on this screen to the person next to you, or send them the link. They scan or tap it, show you a code back, and you are connected.',
    who: 'Whoever holds that code can connect to you until it expires, ten minutes later. Show it to the person you mean to.'
  },
  progress: {
    step: ({ step, text }) => `Step ${step} of 3 — ${text}`,
    starting: 'starting your peer…',
    checking: 'checking their invite…',
    reply: 'building your reply — finding a network path…'
  },
  freshness: {
    fresh: ({ minutes }) => `This invite stays fresh for about ${minutes} more minute(s).`,
    stale: 'This invite is probably too old to connect - create a new one.'
  },
  hurryBack: 'Come straight back - within seconds. While you are in another app this phone suspends the page, and the invite stops working.',
  invite: {
    heading: 'Show this to the other person',
    scanHelp: 'Their phone camera opens the same link - or send it to them.',
    sendLink: 'Send link…',
    scanReply: 'Scan their reply',
    pasteReply: 'They sent a link',
    listen: 'Listen for their reply',
    play: ({ seconds }) => `Play it as sound (about ${seconds}s)`,
    playing: ({ part, total }) => `Playing part ${part} of ${total}…`,
    linkSummary: 'Or send it as a link',
    newLink: 'New link',
    copy: 'Copy',
    copied: 'Copied',
    starting: 'Starting…',
    copyByHand: 'Select and copy'
  },
  status: {
    idle: 'Not connected',
    started: 'Peer started. Create an invite, or scan the code they are showing you.',
    inviteReady: 'Invite ready. Send the link, then keep this tab open until they reply.',
    verifying: 'Correct QR type detected. Verifying signature…',
    verified: 'Verified. Send the reply link back and keep this tab open.',
    handedOver: 'Reply handed to the tab where you created the invite.',
    lostWhileAway: ({ count }) =>
      `${count === 1 ? 'A connection was' : `${count} connections were`} lost while you were away - create a new invite to reconnect.`,
    connected: ({ peerId }) => `Connected to ${peerId}`,
    lost: ({ peerId }) => `Lost the connection to ${peerId} - reconnect below.`,
    rerouting: ({ peerId }) => `Lost ${peerId} - putting the connection back through the others…`,
    unreachable: ({ peerId }) => `Could not reach ${peerId} through anyone still connected - reconnect below.`,
    startFailed: ({ reason }) => `Start failed: ${reason}`,
    cameraFailed: ({ reason }) => `Camera failed: ${reason}`,
    qrFailed: ({ reason }) => `QR processing failed: ${reason}`,
    listenFailed: ({ reason }) => `Microphone failed: ${reason}`,
    audioFailed: ({ reason }) => `Playing the answer failed: ${reason}`
  }
}
