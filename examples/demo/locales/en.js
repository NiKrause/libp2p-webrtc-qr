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
    title: 'libp2p WebRTC over QR'
  },
  view: {
    label: 'View',
    simple: 'Simple',
    technical: 'Technical'
  },
  language: {
    label: 'Language',
    en: 'English',
    de: 'Deutsch'
  },
  step: {
    connect: {
      heading: 'Connect to someone',
      hint: 'Invite someone, or scan the code they are showing you. Either one gets you to the same place.',
      invite: 'Create invite link',
      scan: 'Scan their code'
    },
    data: {
      heading: 'Talk and send files',
      hint: 'Once the handshake completes, messages travel over a libp2p protocol stream on the WebRTC data channel. Files go through Helia: the sender adds the bytes and announces the CID, the receiver pulls them with bitswap over the same connection.'
    }
  },
  intro: {
    what: 'Two browsers connect to each other directly. There is no server in the middle holding your messages, and nothing you send passes through us.',
    how: 'Show the code on this screen to the person next to you, or send them the link. They scan or tap it, show you a code back, and you are connected.',
    who: 'Whoever holds that code can connect to you until it expires, ten minutes later. Show it to the person you mean to.'
  },
  invite: {
    heading: 'Show this to the other person',
    linkSummary: 'Copy the link instead',
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
    qrFailed: ({ reason }) => `QR processing failed: ${reason}`
  }
}
