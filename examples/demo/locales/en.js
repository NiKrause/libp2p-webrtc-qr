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
    enableHint: 'Off by default. Nothing is written until this is ticked, and turning it off again keeps what is already recorded - use Clear for that. Everything stays on this device; the export leaves addresses behind.',
    hint: 'Every attempt is recorded and closed when it connects or fails. Both are kept - a log of successes says nothing about what is broken.',
    provider: 'Network provider',
    locate: 'Work out where I am',
    locating: 'Asking…',
    located: ({ where, precise }) => `${where} — ${precise}`,
    withPosition: 'position added',
    noPosition: 'no position (refused, or not available here)',
    locateFailed: ({ reason }) => `Could not work it out: ${reason}. Type it instead.`,
    providerHint: 'Telekom, Vodafone, the hotel…',
    place: 'Where you are',
    placeHint: 'home wifi, office, hotel lobby…',
    empty: 'No attempts recorded yet.',
    export: 'Export as JSON',
    clear: 'Clear the log',
    frames: ({ frames }) => `${frames} frame${frames === 1 ? '' : 's'}`,
    outcome: {
      connected: 'connected',
      failed: 'failed',
      abandoned: 'abandoned'
    }
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
