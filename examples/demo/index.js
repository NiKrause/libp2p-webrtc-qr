import { withBitswap } from '@helia/bitswap'
import { withLibp2p } from '@helia/libp2p'
import { unixfs } from '@helia/unixfs'
import { createHeliaLight } from 'helia'
import { identify, identifyPush } from '@libp2p/identify'
import { peerIdFromString } from '@libp2p/peer-id'
import { ping } from '@libp2p/ping'
import { multiaddr } from '@multiformats/multiaddr'
import jsQR from 'jsqr'
import { createLibp2p } from 'libp2p'

import '@le-space/libp2p-webrtc-qr/elements'
import {
  createFrameSource,
  createPartAccumulator,
  looksLikeUrPart,
  needsAnimation,
  preload as preloadAnimatedQr
} from '@le-space/libp2p-webrtc-qr/elements'
import { createIntroPolicy } from '@le-space/libp2p-webrtc-qr/elements'
import { applyBrowserTheme } from './browser-theme.js'
import { elementStrings, initialLocale, locale, setLocale, t, translateDocument } from './i18n.js'
import { applyViewMode, isSimple } from './view-mode.js'
import { forgetIdentity, launchedStandalone, loadOrCreateIdentity } from './identity.js'

// Cosmetic and independent of everything else, so it runs the moment the module
// loads rather than waiting on a node. The tint is up before the first paint
// settles, which is the point - you should know which window this is at a glance.
applyBrowserTheme().catch(() => {})

/**
 * Put the whole page in one language.
 *
 * The elements are handed their tables here rather than reaching for a locale
 * themselves: `strings` is the seam the library offers, and a library that read
 * a global would be a library with an opinion about how an app stores one.
 *
 * Runs before the first paint for the same reason `applyBrowserTheme` does -
 * nobody should watch the page change language after it has settled.
 */
function applyLocale (next) {
  setLocale(next)

  const strings = elementStrings()
  qrImage.strings = strings.invite
  introEl.strings = strings.intro
  scanModalEl.strings = strings.scanner
  listenModalEl.strings = strings.listen
  networkStateEl.strings = strings.status
  peerListEl.strings = strings.peers

  document.documentElement.lang = locale()

  // `aria-pressed` rather than a class, because that is what a screen reader
  // reads out; the dimming in the stylesheet follows from it.
  for (const [code, button] of Object.entries(localeButtons)) {
    button.setAttribute('aria-pressed', String(code === locale()))
  }

  writeViewLabel()
  // The play button's label carries a number and is written from here, so the
  // pass that writes the language writes it too - the same trap the copy button
  // is in, one control over.
  labelPlayButton()

  // Everything that names a key in the markup - the flags' `aria-label` among
  // them, so the language names come from the catalogue like every other word.
  translateDocument()

  // The copy button carries its own state in its label, so it is not repainted
  // by anything else and has to be told the language changed.
  resetCopied()
}

/**
 * Name the view the switch goes to, not the one it is in.
 *
 * A control labelled with its current state reads as a claim rather than an
 * offer. The label is one of the page's words *and* one of its states, so both
 * passes end here rather than each writing their own version of it.
 */
function writeViewLabel () {
  viewModeEl.textContent = isSimple() ? t('view.technical') : t('view.simple')
}

import { fromString, toString } from 'uint8arrays'
import {
  QRSession,
  compress,
  createAudioReceiver,
  createWebRTCUpgradeContext,
  decodePayload,
  AUDIO_SAMPLE_RATE,
  encodeSignedPayload,
  encodeToAudio,
  frameForAudio,
  parsePayload,
  createKeepAlive,
  createWakeLock,
  leavingSuspendsUs,
  pendingConnections,
  stateOf,
  webRTCQR,
  BROWSERS_THAT_HOLD,
  PAYLOAD_VERSION,
  QR_TYPE_ANSWER,
  QR_TYPE_OFFER
} from '@le-space/libp2p-webrtc-qr'

const CHAT_PROTOCOL = '/libp2p/examples/webrtc-qr-chat/1.0.0'
const CONNECTION_TIMEOUT = 30000
// How long the answering peer keeps its side open while waiting for the other
// person to open the reply. 30 seconds is right for two phones in one room and
// hopelessly short over a messenger, where switching apps and reading a message
// takes minutes - and a timeout here closes the connection, so the reply can
// never land afterwards.
const ANSWER_WAIT_TIMEOUT = 6 * 60 * 1000
const MAX_QR_PAYLOAD_LENGTH = 2200

/*
 * The last two are reached by literal address on purpose.
 *
 * A reflexive candidate only exists for an address family that a STUN
 * transaction actually used - the browser reports the address the server saw,
 * it does not enumerate the interfaces it has. The hostnames above only produce
 * an IPv6 transaction if the browser's own resolver returns AAAA for them, and
 * the IPv6 host candidate that would otherwise give the game away is hidden
 * behind an mDNS `.local` name. So on a machine with perfectly good IPv6, an
 * IPv4-only STUN round trip makes the whole family invisible.
 *
 * That is not only a wrong LED: without a reflexive IPv6 candidate the two
 * peers never exchange IPv6 addresses at all, so the one path that defeats
 * carrier-grade NAT without a relay never gets tried.
 */
const RTC_CONFIGURATION = {
  iceServers: [
    { urls: 'stun:stun.cloudflare.com:3478' },
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:[2001:4860:4864:5:8000::1]:19302' },
    { urls: 'stun:[2606:4700:49::]:3478' }
  ]
}

const statusEl = document.getElementById('status')
const peerIdEl = document.getElementById('peer-id')
const peerIdBriefEl = document.getElementById('peer-id-brief')

/**
 * The peer id, short enough to sit in a heading.
 *
 * Head and tail rather than a prefix: peer ids share their leading characters -
 * every Ed25519 one here starts `12D3KooW` - so the first eight distinguish
 * nothing. The tail is what differs, and keeping both ends is what lets someone
 * match this against the id shown on the other device.
 *
 * @param {string} peerId
 */
function showBriefPeerId (peerId) {
  peerIdBriefEl.hidden = peerId.length === 0
  peerIdBriefEl.textContent = peerId.length > 20
    ? `${peerId.slice(0, 8)}…${peerId.slice(-6)}`
    : peerId
  peerIdBriefEl.title = peerId
}
const identityOriginEl = document.getElementById('identity-origin')
const reconnectPromptEl = document.getElementById('reconnect-prompt')
const reconnectTextEl = document.getElementById('reconnect-text')
const reconnectButton = document.getElementById('reconnect')
const resetIdentityButton = document.getElementById('reset-identity')
const chatLogEl = document.getElementById('chat-log')
const messageInput = document.getElementById('message')
const payloadDisplay = document.getElementById('payload-display')
const startButton = document.getElementById('start-client')
const createOfferButton = document.getElementById('create-offer')
const scanOfferButton = document.getElementById('scan-offer')
const scanAnswerButton = document.getElementById('scan-answer')
const processPayloadButton = document.getElementById('process-payload')
const copyPayloadButton = document.getElementById('copy-payload')
const sendButton = document.getElementById('send')
const qrImage = document.getElementById('qr-image')
const dropZone = document.getElementById('drop-zone')
const fileInput = document.getElementById('file-input')
const receivedFilesEl = document.getElementById('received-files')
const inviteBoxEl = document.getElementById('invite-box')
const scanModalEl = document.getElementById('scan-modal')
const listenModalEl = document.getElementById('listen-modal')
const scanReplyButton = document.getElementById('scan-reply')
const pasteReplyButton = document.getElementById('paste-reply')
const listenReplyButton = document.getElementById('listen-reply')
const playAnswerButton = document.getElementById('play-answer')
const pasteFallbackEl = document.querySelector('.paste-fallback')
const inviteLinkEl = document.getElementById('invite-link')
const copyLinkEl = document.getElementById('copy-link')
// Beside its own control, and - the part that matters - above the
// `applyLocale` call below, which resets that button before the first paint.
// A `let` declared further down is in its temporal dead zone at that moment;
// minified it reads as "Cannot access 'w5' before initialization" and takes the
// whole app down before libp2p ever starts.
let copiedTimer = null
// What the dialog is currently showing, for the button that plays it as sound.
let outboundPayload = null
const inviteFreshnessEl = document.getElementById('invite-freshness')
const hurryBackEl = document.getElementById('hurry-back')
const browserWarningEl = document.getElementById('browser-warning')
const createOfferAgainButton = document.getElementById('create-offer-again')
const handoffBannerEl = document.getElementById('handoff-banner')
const peerListEl = document.getElementById('peer-list')
const localeButtons = { de: document.getElementById('locale-de'), en: document.getElementById('locale-en') }
const viewModeEl = document.getElementById('view-mode')
const introEl = document.getElementById('intro')
const peerCountEl = document.getElementById('peer-count')
const networkStateEl = document.getElementById('network-state')
const compactPayloadEl = document.getElementById('compact-payload')
const setupCards = [document.getElementById('step-start'), document.getElementById('step-connect')]
const dataCard = document.getElementById('step-data')

// Here rather than beside the function, which is declared above the elements it
// touches: a function declaration hoists, `const scanModalEl` does not.
applyLocale(initialLocale())

// Before the first paint, like the language and the tint: nobody should watch
// half the page disappear a moment after it settled.
applyViewMode()
introEl.technical = !isSimple()
// After the mode is read, not before: `applyLocale` above ran while the module
// still held its default, so the label it wrote was for the wrong half.
writeViewLabel()
// A toggle takes no value from its event - it flips whatever is current.
viewModeEl.addEventListener('click', () => {
  applyViewMode(!isSimple())
  introEl.technical = !isSimple()
  writeViewLabel()
  // The controls depend on the mode now - the invite button is enabled in the
  // simple view before anything has started, because there it does the starting.
  updateControls()
})


// Rendered text is refreshed by the elements themselves - they re-render when
// `strings` is assigned - so a switch costs nothing beyond the assignment.
for (const [code, button] of Object.entries(localeButtons)) {
  button.addEventListener('click', () => applyLocale(code))
}

const qrCanvas = document.createElement('canvas')
const qrCanvasContext = qrCanvas.getContext('2d', { willReadFrequently: true })

let node = null
let session = null
let helia = null
let fs = null
// Keyed by session id until an answer names the peer, then indexed by peer id
// as well - an outgoing offer does not know who will take it.
const chatStreams = new Map()
// Kept per peer so the page can say what happened to each connection while it
// was in the background, instead of going quiet.
const peerConnections = new Map()
// Peers the user dropped on purpose, so the same teardown is not reported as a
// loss they need to do something about.
const intentionalDrops = new Set()
let scanMode = null
let qrAnimationTimer = null

const testState = {
  lastReceivedMessage: null,
  receivedMessages: [],
  receivedFiles: [],
  busyObserved: new Set()
}

/**
 * One surface carries two different things, and they are not for the same
 * reader: what somebody said, and what the protocol did.
 *
 * So diagnostics are the default and chat opts out. That is the right way round
 * because there are three chat call sites and fifty-odd diagnostic ones - a
 * default of "chat" would mean marking fifty lines and forgetting one.
 *
 * Marked per line rather than by hiding the whole box: hiding it would take the
 * conversation with it, which is the one thing the simple view is *for*.
 */
function appendLog (text, { technical = true } = {}) {
  const line = document.createElement('div')
  line.textContent = text
  if (technical) line.dataset.view = 'technical'
  chatLogEl.appendChild(line)
  chatLogEl.scrollTop = chatLogEl.scrollHeight
}

/** What a person said. Visible in both views - it is the conversation. */
function appendChat (text) {
  appendLog(text, { technical: false })
}

/**
 * Put a button into a pending state: it keeps its width, shows a spinner and
 * announces itself as busy. `updateControls()` owns `disabled` afterwards, so
 * the busy flag is tracked separately and cleared in a `finally`.
 */
function setButtonBusy (button, label) {
  if (button.dataset.idleLabel == null) {
    button.dataset.idleLabel = button.textContent
  }

  button.style.minWidth = `${button.offsetWidth}px`
  button.textContent = label
  button.classList.add('is-busy')
  button.setAttribute('aria-busy', 'true')
  button.disabled = true
  testState.busyObserved.add(button.id)
}

function clearButtonBusy (button) {
  if (button.dataset.idleLabel != null) {
    button.textContent = button.dataset.idleLabel
  }

  button.style.minWidth = ''
  button.classList.remove('is-busy')
  button.setAttribute('aria-busy', 'false')
}

function setStatus (text) {
  statusEl.textContent = text
  // Colour the status dot from the message itself, so every existing call site
  // keeps working and the text the e2e suite asserts on stays untouched.
  statusEl.classList.toggle('is-live', /connected to |webrtc connected/i.test(text))
  statusEl.classList.toggle('is-error', /failed|timed out|cancelled/i.test(text))
}

/**
 * A TURN server can be supplied per visit:
 *
 *   ?turn=turn:example.org:3478&turnUser=alice&turnPass=secret
 *
 * Off by default, deliberately: a relay is infrastructure, and this project
 * exists to show a connection that needs none. But srflx candidates cannot
 * traverse the symmetric carrier-grade NAT a phone on mobile data usually sits
 * behind, and no amount of code changes that - so being able to try one turns
 * a diagnosis into an answer.
 *
 * Note the trade: TURN relays the *media*, so a third party carries the bytes.
 * It never sees the signalling, which still travels only between the two
 * people.
 */
function getRtcConfiguration () {
  const params = new URLSearchParams(window.location.search)

  if (params.get('ice') === 'host') {
    return { iceServers: [] }
  }

  const turn = params.get('turn')

  if (turn != null && turn.length > 0) {
    return {
      iceServers: [
        ...RTC_CONFIGURATION.iceServers,
        {
          urls: turn,
          username: params.get('turnUser') ?? undefined,
          credential: params.get('turnPass') ?? undefined
        }
      ]
    }
  }

  return RTC_CONFIGURATION
}

function remoteAddress (peerId) {
  return multiaddr(`/webrtc/p2p/${peerId}`)
}

function shortPeer (peerId) {
  return `${peerId.slice(0, 8)}…${peerId.slice(-6)}`
}

async function signPayload (payload) {
  return encodeSignedPayload(node.components.privateKey, payload)
}

async function parseAndVerifyPayload (text, expectedType) {
  // decodePayload, not decodeSignedPayload: the latter only knows v2, and a
  // host that verifies a code itself must accept every format the session can
  // produce or it rejects codes it could have read.
  return decodePayload(text, expectedType)
}


function renderNetwork (result) {
  // The container keeps the overall state as a class so anything reading one
  // element - a test, a screenshot diff - still sees the summary verdict.
  networkStateEl.className = `network-state is-${result.overall.state}`
  networkStateEl.hidden = false
  appendLog(`Network check: IPv4 ${result.ipv4.state}, IPv6 ${result.ipv6.state} - ${result.overall.text}`)
}

async function createNode () {
  if (node != null) {
    return node
  }

  const identity = await loadOrCreateIdentity()

  node = await createLibp2p({
    privateKey: identity.privateKey,
    transports: [
      webRTCQR({ getOutboundSession: remotePeerId => session?.getOutboundSession(remotePeerId) ?? null })
    ],
    services: {
      identify: identify(),
      identifyPush: identifyPush(),
      ping: ping()
    }
  })

  // The handshake state machine lives in the package. What is left here is what
  // this app does with a connection once it exists.
  session = new QRSession(node, {
    rtcConfiguration: getRtcConfiguration,
    answerWaitTimeout: ANSWER_WAIT_TIMEOUT,
    connectionTimeout: CONNECTION_TIMEOUT
  })

  session.addEventListener('connect', event => {
    const { peerId, peerConnection, direction } = event.detail

    if (direction === 'inbound') {
      watchConnection(peerId, peerConnection)
      setStatus(t('status.connected', { peerId }))
    }
  })

  session.addEventListener('error', event => {
    const { error } = event.detail

    setStatus(/timed out/i.test(error.message)
      ? 'They never opened your reply, so this attempt expired. Ask them for a fresh invite link.'
      : explain(error))
    appendLog(`Inbound upgrade failed: ${error.message}`)
  })

  // libp2p 3 passes the handler positional arguments, not a single object.
  node.handle(CHAT_PROTOCOL, (stream, connection) => {
    const from = connection.remotePeer.toString()
    attachChatStream(stream, from, `${shortPeer(from)} connected.`)
  })

  // Composed by hand rather than with `createHelia`, which is
  // `withBitswap(withLibp2p(withHTTP(...)))`. The HTTP layer would add trustless
  // gateways and delegated routing, so a dropped file could be fetched over the
  // public internet instead of the connection we just built by scanning a code.
  // Without it, bitswap over this one libp2p connection is the only way to get
  // the bytes. `withLibp2p` takes the node as its second argument, and the node
  // returned by `createHeliaLight` has to be started explicitly - the mixins
  // only attach their block brokers during `start()`.
  helia = withBitswap(withLibp2p(createHeliaLight(), node))
  await helia.start()
  fs = unixfs(helia)

  networkStateEl.rtcConfiguration = getRtcConfiguration()
  networkStateEl.probe()
    .then(renderNetwork)
    .catch(error => appendLog(`Network check failed: ${error.message}`))

  preloadAnimatedQr()

  peerIdEl.textContent = node.peerId.toString()
  showBriefPeerId(node.peerId.toString())
  // Where the key is kept stopped being a fixed fact when the app became
  // installable: to a home screen it outlives the launch, in a tab it does not.
  // "This tab" was true in both cases until #67 and false in one of them after.
  const kept = launchedStandalone() ? 'this installed app' : 'this tab'

  identityOriginEl.textContent = identity.restored
    ? `Restored for ${kept} - the same peer you were before.`
    : `Freshly generated and kept for ${kept}.`
  setStatus(t('status.started'))
  appendLog(`Started libp2p peer ${node.peerId}${identity.restored ? ' (restored)' : ''}`)
  updateControls()

  return node
}

async function createOfferPayload () {
  if (node == null) {
    throw new Error('Start the browser client first')
  }

  // Per offer rather than per session: the box can be changed between two
  // invites, and the person changing it means the *next* one.
  const offer = await session.createOffer({ compact: compactPayloadEl?.checked ?? false })

  // A fresh invite carries fresh candidates, so whatever the old one lived
  // through stops counting against this one.
  resetInviteHidden()
  updateControls()

  return offer
}

async function acceptOfferPayload (text) {
  if (node == null) {
    throw new Error('Start the browser client first')
  }

  const parsed = await parseAndVerifyPayload(text, QR_TYPE_OFFER)

  // Checked here rather than in the package because the useful wording depends
  // on what the user is looking at, and here that is two browser windows.
  if (parsed.peerId === node.peerId.toString()) {
    throw new Error('This offer belongs to this browser. Scan it with the second browser instead')
  }

  return session.acceptOffer(text)
}

async function acceptAnswerPayload (text) {
  if (node == null || session.offers.size === 0) {
    throw new Error('Create an offer before accepting an answer')
  }

  const parsed = await parseAndVerifyPayload(text, QR_TYPE_ANSWER)

  if (parsed.peerId === node.peerId.toString()) {
    throw new Error('This answer belongs to this browser. Use the answer QR created by the second browser')
  }

  // `dial: false` because the next line opens a protocol stream, which dials by
  // itself - this app has a protocol of its own and does not need the connection
  // dialled twice.
  const { peerId, address, ageSeconds } = await session.acceptAnswer(text, { dial: false })
    .catch(error => {
      // The library reports the age of the invite. This adds the part only the
      // page knows: whether it spent that time in the background, which is the
      // difference between "the network refused" and "we left and it went cold".
      // Not "were you away long enough" but "did it survive". The connection
      // answers that itself, and after a couple of seconds on a phone the
      // answer is often no - far sooner than any duration rule would have
      // guessed, and sometimes no after an absence a rule would have excused.
      if (inviteHiddenMs > 0) {
        const seconds = Math.round(inviteHiddenMs / 1000)

        throw new Error(`${error.message} — this tab was in the background for ${seconds}s while the invite waited, and phones suspend a page they are not showing, which closes the connection behind it. Make a new invite and send that one.`)
      }

      throw error
    })

  appendLog(`Reply arrived ${ageSeconds}s after the invite was created.`)

  const stream = await session.dialProtocol(peerId, CHAT_PROTOCOL)

  watchConnection(peerId, session.offers.get(parsed.sessionId)?.peerConnection)
  attachChatStream(stream, peerId, `Connected to ${shortPeer(peerId)}.`)
  setStatus(t('status.connected', { peerId }))

  return address.toString()
}

function watchConnection (peerId, peerConnection) {
  peerConnections.set(peerId, peerConnection)

  peerConnection.addEventListener('connectionstatechange', () => {
    const state = peerConnection.connectionState

    // 'disconnected' is not fatal - a phone whose radio slept often comes back
    // on its own once the screen is on again. Only say something on the states
    // that end it.
    if (state === 'failed' || state === 'closed') {
      peerConnections.delete(peerId)

      if (intentionalDrops.delete(peerId)) {
        appendLog(`Disconnected from ${shortPeer(peerId)}.`)
      } else {
        appendLog(`Connection to ${shortPeer(peerId)} ended (${state}).`)
        // Say it when it happens, not only when someone comes back to the tab.
        resumeAfterLoss(peerId)
      }
    }

    renderPeers()
  })
}

function attachChatStream (stream, peerId, message) {
  const existing = [...chatStreams.keys()]

  chatStreams.set(peerId, stream)
  meshAttempts.delete(peerId)
  resumeRoutes.delete(peerId)
  clearReconnectPrompt()
  // Whatever was on screen was there to get to this point.
  closeModal(inviteBoxEl)
  scanModalEl.close()
  appendLog(message)

  // Both directions, so a mesh closes itself no matter who joined last.
  announcePeers(peerId)

  for (const other of existing) {
    sendTo(other, { kind: 'peers', peers: [peerId] }).catch(() => {})
  }
  sendButton.disabled = false
  setDropZoneEnabled(true)
  setStepsCollapsed(true)
  renderPeers()
  messageInput.focus()

  readChatMessages(stream, peerId).catch(error => {
    appendLog(`Connection to ${shortPeer(peerId)} closed: ${error.message}`)
  }).finally(() => {
    chatStreams.delete(peerId)
    renderPeers()

    if (chatStreams.size === 0) {
      sendButton.disabled = true
      setDropZoneEnabled(false)
      // Connecting again is the only thing left to do, so put the steps back.
      setStepsCollapsed(false)
    }
  })
}

/**
 * One list, one conversation. Everything typed goes to every connected peer and
 * arrives labelled with its sender - with three people in a room, an unlabelled
 * line tells you nothing.
 */
/**
 * When the screen must stay awake.
 *
 * A live connection is the obvious case, but it is not the first. The moment the
 * screen most needs to stay lit is *before* there is any connection: two phones
 * held up to scan each other, and the phone showing the code sitting untouched
 * while the other person lines up the shot. A screen that sleeps there drops the
 * code mid-scan, and there is nothing yet to keep alive. So the lock follows the
 * whole connect-critical window - scanning, an invite on display, or a live
 * connection - not only its last stage.
 *
 * `sync` re-checks page visibility itself, so this is only about intent.
 */
function wantWakeLock () {
  return scanModalEl.isOpen || inviteBoxEl.open || chatStreams.size > 0
}

const wakeLock = createWakeLock()

function refreshWakeLock () {
  wakeLock.sync(wantWakeLock())
}

/**
 * The other half of the same problem, and the half a wake lock cannot reach.
 *
 * A wake lock holds the *screen*, and only while this page is visible - so it
 * does nothing for the case that actually kills invites: leaving for a
 * messenger, where the browser suspends the page and takes the peer connection
 * with it. A page that is playing audio is not a page Chromium freezes.
 *
 * Audible on purpose. Silence is the failure mode: a stream the browser judges
 * inaudible stops counting as playback, and the page is frozen anyway. The
 * media notification it earns is also a labelled one-tap way back.
 *
 * Whether this actually survives an app switch on Android is unsettled - see
 * the open experiment in AGENTS.md. This is what makes it answerable.
 */
const keepAlive = createKeepAlive({
  track: 'audio/zauberfloete-dies-bildnis-cossira-1903.mp3',
  metadata: {
    title: 'Waiting for the other phone',
    artist: 'Mozart, Die Zauberflöte - Emile Cossira, 1903'
  }
})

/**
 * Must be called from inside the gesture, before any await: `AudioContext`
 * starts suspended under the autoplay policy, and a resume outside a gesture is
 * refused. By the time ICE has gathered there is no gesture left to spend.
 */
/**
 * Stop once the code is off the screen - which is both endings at once, because
 * `attachChatStream` closes the invite the moment a stream attaches. Audio still
 * playing after that holds the CPU awake for nothing and tells the user we are
 * working on something that finished.
 *
 * Only ever stops. Starting needs a user gesture, so unlike the wake lock it
 * cannot be driven from state.
 */
/**
 * Our decision, kept apart from the platform's answer to it - the same split
 * `createWakeLock()` makes, and for the same reason. Whether audio actually plays
 * depends on an audio stack: it runs in Firefox on a desktop and not in the CI
 * container, so asserting `running` is asserting on the machine rather than on
 * this code.
 */
let keepAliveWanted = false

function refreshKeepAlive () {
  if (!keepAliveWanted || inviteBoxEl.open) {
    return
  }

  keepAliveWanted = false
  keepAlive.stop().catch(() => {})
}

function startKeepAlive () {
  keepAliveWanted = true

  keepAlive.start().then(playing => {
    appendLog(playing
      ? 'Keep-alive audio is playing - this page should survive an app switch.'
      : 'Keep-alive audio could not start; leaving the app will likely end the invite.')
  }).catch(() => {})
}

/**
 * The answering side never gets the gesture the offering side does.
 *
 * Opening an invite link auto-starts the node and renders the reply without
 * anyone pressing anything - and that person has the harder job, because they
 * are the one who has to leave for a messenger twice. So take the next touch
 * they make, whatever it is, while a code is still on screen.
 *
 * Passive and once-only: it stops listening as soon as audio is running, and it
 * never interferes with what the touch was actually for.
 */
document.addEventListener('pointerdown', () => {
  if (keepAlive.running || !inviteBoxEl.open) {
    return
  }

  startKeepAlive()
}, { capture: true, passive: true })

function renderPeers () {
  // One of the places the wake lock is kept in step - see refreshWakeLock.
  refreshWakeLock()

  peerListEl.peers = [...chatStreams.keys()].map(peerId => ({
    peerId,
    state: peerConnections.get(peerId)?.connectionState ?? 'connected'
  }))

  peerCountEl.textContent = chatStreams.size === 0
    ? 'No one connected yet.'
    : `${chatStreams.size} connected`
}

/**
 * Chat messages are JSON envelopes so plain text and file announcements can
 * share one stream. A file announcement carries only the CID and some metadata -
 * the bytes themselves are pulled separately by bitswap.
 */
function envelope (payload) {
  return fromString(JSON.stringify({ v: 1, ...payload }))
}

// libp2p 3 streams are message streams: iterate them for reads, `send()` for
// writes. The old source/sink duplex - and the it-byte-stream wrapper around
// it - is gone.

/**
 * Mesh bootstrapping.
 *
 * Scanning is only needed for the *first* link. Once a peer is reachable, the
 * signalling for further links travels over the connection that already exists:
 * B and C, both connected to A, exchange their signed payloads through A and
 * end up connected directly, with nobody lifting a phone.
 *
 * A relaying peer cannot tamper with what it forwards - the signature binds the
 * payload to its originator's Peer ID and is verified end to end. What it could
 * do is replay something old, which is why payloads expire (#9): over the wire
 * the human eye is no longer the freshness guarantee.
 */
const meshAttempts = new Set()

/** Remaining peers to try as a route back to a peer we lost, in order. */
const resumeRoutes = new Map()

async function sendTo (peerId, payload) {
  const stream = chatStreams.get(peerId)

  if (stream == null) {
    return false
  }

  await stream.send(envelope(payload))

  return true
}

function announcePeers (toPeerId) {
  const peers = [...chatStreams.keys()].filter(peerId => peerId !== toPeerId)

  if (peers.length > 0) {
    sendTo(toPeerId, { kind: 'peers', peers }).catch(() => {})
  }
}

/**
 * Both ends learn about each other at the same moment, so without a rule both
 * would offer at once and neither answer. The lower peer id initiates - any
 * total order does, as long as both sides compute the same one.
 */
function shouldInitiateTo (peerId) {
  return node.peerId.toString() < peerId
}

async function meshConnect (target, via) {
  if (chatStreams.has(target) || meshAttempts.has(target) || target === node.peerId.toString()) {
    return
  }

  meshAttempts.add(target)
  appendLog(`Reaching ${shortPeer(target)} through ${shortPeer(via)}…`)

  try {
    const offer = await createOfferPayload()

    if (!await sendTo(via, { kind: 'relay', to: target, payload: offer })) {
      throw new Error(`${shortPeer(via)} is no longer reachable`)
    }
  } catch (error) {
    meshAttempts.delete(target)
    appendLog(`Could not reach ${shortPeer(target)}: ${error.message}`)
    tryNextRoute(target)
  }
}

/**
 * A connection that dropped by itself, put back without anyone scanning.
 *
 * This is the mesh doing what it already does - it just happens to be a peer we
 * were talking to a moment ago rather than one we have never met. Any remaining
 * connection can carry the signalling, and the peer on the other end of it does
 * not have to know the two of us were ever disconnected.
 *
 * Note what this is *not*: `RTCPeerConnection.restartIce()` would be the right
 * primitive in a plain WebRTC app, because it renegotiates while keeping the
 * data channels. It does not apply here. By the time ICE reports `failed` the
 * libp2p connection on top has already been torn down, its muxer and streams
 * with it, so there is nothing left to keep. A fresh connection is both simpler
 * and, from the user's side, indistinguishable - no camera either way.
 */
function resumeAfterLoss (peerId) {
  meshAttempts.delete(peerId)

  // The stream's own cleanup runs when its read loop unwinds, which is later
  // than this. Until it does, `meshConnect` would see the peer as still
  // connected and decline to do anything - so record the truth now.
  chatStreams.delete(peerId)
  session.forget(peerId)
  renderPeers()

  const routes = [...chatStreams.keys()].filter(id => id !== peerId)

  if (routes.length === 0) {
    // Nothing left to signal over. Every automatic path needs a live connection
    // somewhere, so this one genuinely has to go back through a human.
    setStatus(t('status.lost', { peerId: shortPeer(peerId) }))
    offerReconnect(peerId)
    return
  }

  // Both ends see the drop, so without an order both would offer at once. The
  // same rule as first contact decides it, and the other side simply waits.
  if (!shouldInitiateTo(peerId)) {
    appendLog(`Lost ${shortPeer(peerId)} - waiting for them to come back through the mesh.`)
    return
  }

  setStatus(t('status.rerouting', { peerId: shortPeer(peerId) }))
  resumeRoutes.set(peerId, routes)
  tryNextRoute(peerId)
}

/**
 * When no route home exists, the way back is a human one - but it should be one
 * tap, not a walk back through the setup. The card is unfolded and the prompt
 * names who was lost, so it is obvious what the button is for.
 */
function offerReconnect (peerId) {
  reconnectTextEl.textContent = `${shortPeer(peerId)} is gone and no one else can reach them from here.`
  reconnectPromptEl.hidden = false
  setStepsCollapsed(false)
}

function clearReconnectPrompt () {
  reconnectPromptEl.hidden = true
}

/**
 * Relaying can fail for a reason the initiator cannot see: the peer we picked as
 * a route may simply not be connected to the one we are trying to reach. So the
 * routes are tried in turn rather than assuming the first one knows them.
 */
function tryNextRoute (target) {
  const routes = resumeRoutes.get(target)

  if (routes == null) {
    return
  }

  const via = routes.shift()

  if (via == null) {
    resumeRoutes.delete(target)
    setStatus(t('status.unreachable', { peerId: shortPeer(target) }))
    offerReconnect(target)
    return
  }

  if (!chatStreams.has(via)) {
    tryNextRoute(target)
    return
  }

  meshConnect(target, via)
}

async function handleMeshMessage (message, from) {
  if (message.kind === 'peers') {
    for (const peerId of message.peers) {
      if (shouldInitiateTo(peerId)) {
        meshConnect(peerId, from)
      }
    }

    return true
  }

  if (message.kind === 'relay') {
    // Forwarding only. The payload is opaque here and stays signed.
    const delivered = await sendTo(message.to, {
      kind: 'relayed',
      from,
      payload: message.payload
    })

    if (!delivered) {
      appendLog(`Cannot forward to ${shortPeer(message.to)} - not connected to them.`)
      // Tell the sender, or it sits waiting on a route that was never going to
      // work while other routes go untried.
      sendTo(from, { kind: 'relay-failed', to: message.to }).catch(() => {})
    }

    return true
  }

  if (message.kind === 'relay-failed') {
    meshAttempts.delete(message.to)
    appendLog(`${shortPeer(from)} cannot reach ${shortPeer(message.to)} - trying another route.`)
    tryNextRoute(message.to)

    return true
  }

  if (message.kind === 'relayed') {
    const parsed = await parsePayload(payloadFrom(message.payload))

    try {
      if (parsed.type === QR_TYPE_OFFER) {
        // An offer from someone we still think we are connected to means they
        // saw the connection die before we did. Theirs is the newer information.
        if (chatStreams.has(parsed.peerId)) {
          appendLog(`${shortPeer(parsed.peerId)} is re-establishing a connection we still thought was up.`)
          chatStreams.delete(parsed.peerId)
          session.forget(parsed.peerId)
          renderPeers()
        }

        const answer = await acceptOfferPayload(message.payload)
        await sendTo(from, { kind: 'relay', to: parsed.peerId, payload: answer })
      } else {
        await acceptAnswerPayload(message.payload)
        meshAttempts.delete(parsed.peerId)
      }
    } catch (error) {
      meshAttempts.delete(parsed.peerId)
      appendLog(`Mesh handshake with ${shortPeer(parsed.peerId)} failed: ${error.message}`)
    }

    return true
  }

  return false
}

async function readChatMessages (stream, from) {
  for await (const data of stream) {
    const raw = toString(data.subarray())
    let message

    try {
      message = JSON.parse(raw)
    } catch {
      appendLog(`Received an unreadable message: ${raw.slice(0, 80)}`)
      continue
    }

    if (await handleMeshMessage(message, from)) {
      continue
    }

    if (message.kind === 'file') {
      appendChat(`${shortPeer(from)} is offering ${message.name} (${message.size} bytes)`)
      receiveFile(message).catch(error => {
        appendLog(`Could not fetch ${message.name}: ${error.message}`)
      })
      continue
    }

    testState.lastReceivedMessage = message.text
    testState.receivedMessages.push({ from, text: message.text })
    appendChat(`${shortPeer(from)}: ${message.text}`)
  }
}

async function broadcast (payload, what) {
  if (chatStreams.size === 0) {
    throw new Error('Connect to someone first')
  }

  const bytes = envelope(payload)
  const failures = []

  for (const [peerId, stream] of chatStreams) {
    try {
      await stream.send(bytes)
    } catch (error) {
      failures.push(`${shortPeer(peerId)}: ${error.message}`)
    }
  }

  // One dead connection must not swallow the message for everyone else.
  if (failures.length === chatStreams.size) {
    throw new Error(`Could not send the ${what} to anyone - ${failures[0]}`)
  }

  for (const failure of failures) {
    appendLog(`Could not reach ${failure}`)
  }
}

async function sendMessage (message) {
  await broadcast({ kind: 'text', text: message }, 'message')
  appendChat(`You: ${message}`)
}

const MAX_FILE_BYTES = 32 * 1024 * 1024

function formatBytes (bytes) {
  if (bytes < 1024) {
    return `${bytes} B`
  }

  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`
  }

  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function setDropZoneEnabled (enabled) {
  dropZone.classList.toggle('is-disabled', !enabled)
  dropZone.setAttribute('aria-disabled', String(!enabled))
  fileInput.disabled = !enabled
}

/**
 * Add the file to Helia and announce its CID over the chat stream. The bytes
 * stay here - the other peer pulls them with bitswap over the same connection.
 */
async function sendFile (file) {
  if (chatStreams.size === 0) {
    throw new Error('Connect to someone before sending a file')
  }

  if (file.size > MAX_FILE_BYTES) {
    throw new Error(`${file.name} is larger than ${formatBytes(MAX_FILE_BYTES)}`)
  }

  const bytes = new Uint8Array(await file.arrayBuffer())
  const cid = await fs.addBytes(bytes)

  // Announced to everyone; bitswap then serves whoever actually asks.
  await broadcast({
    kind: 'file',
    cid: cid.toString(),
    name: file.name,
    size: bytes.byteLength,
    mime: file.type || 'application/octet-stream'
  }, 'file')

  appendLog(`Sent ${file.name} (${formatBytes(bytes.byteLength)}) as ${cid}`)

  return cid.toString()
}

/**
 * Pull an announced file out of the other peer's blockstore and offer it as a
 * download. Nothing here mentions WebRTC - bitswap just uses the only libp2p
 * connection this node has.
 */
async function receiveFile (announcement) {
  const chunks = []

  for await (const chunk of fs.cat(announcement.cid, {
    session: false,
    signal: AbortSignal.timeout(CONNECTION_TIMEOUT)
  })) {
    chunks.push(chunk)
  }

  const bytes = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0))
  let offset = 0

  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }

  renderReceivedFile(announcement, bytes)
  testState.receivedFiles.push({
    cid: announcement.cid,
    name: announcement.name,
    size: bytes.byteLength
  })
  appendLog(`Fetched ${announcement.name} (${formatBytes(bytes.byteLength)}) over bitswap`)

  return bytes
}

function renderReceivedFile (announcement, bytes) {
  const url = URL.createObjectURL(new Blob([bytes], { type: announcement.mime }))
  const row = document.createElement('div')
  row.className = 'received-file'

  const link = document.createElement('a')
  link.href = url
  link.download = announcement.name
  link.textContent = announcement.name
  link.dataset.cid = announcement.cid

  const meta = document.createElement('span')
  meta.className = 'received-file-meta'
  meta.textContent = `${formatBytes(bytes.byteLength)} · ${announcement.cid}`

  row.append(link, meta)
  receivedFilesEl.appendChild(row)
}

async function sendFiles (files) {
  for (const file of files) {
    try {
      await sendFile(file)
    } catch (error) {
      appendLog(`Could not send ${file.name}: ${error.message}`)
    }
  }
}

const INVITE_PARAM = 'i'
const REPLY_PARAM = 'r'
// An offer's ICE candidates go stale as NAT bindings expire, so a link that sat
// in a chat for half an hour will not connect. We cannot prevent that - but we
// can say it out loud instead of failing cryptically half an hour later.
const INVITE_FRESH_MS = 5 * 60 * 1000

let inviteCreatedAt = null
let inviteCountdown = null

const handoff = typeof BroadcastChannel === 'undefined'
  ? null
  : new BroadcastChannel('libp2p-webrtc-qr')

/**
 * Once a connection exists the setup steps are finished business, and on a
 * phone they push the only useful part - sending things - below the fold. They
 * fold away rather than disappear: the heading stays, and clicking it brings
 * the step back for anyone who wants to connect to someone else.
 */
/**
 * Modal plumbing.
 *
 * `showModal()` is doing the work that matters here - the focus trap, Escape,
 * the inert background and focus returning to whatever opened the dialog - so
 * this is only the bits it does not know about: stopping the camera on the way
 * out, whatever route the user took, and not calling `showModal()` twice.
 */
function openModal (dialog) {
  if (!dialog.open) {
    dialog.showModal()
  }

  // Showing the invite is showing a QR code, and that is a keep-the-screen-on
  // moment in its own right - long before any connection exists.
  refreshWakeLock()
}

function closeModal (dialog) {
  if (dialog.open) {
    dialog.close()
  }

  refreshWakeLock()
  refreshKeepAlive()
}

inviteBoxEl.addEventListener('click', event => {
  if (event.target.closest('[data-close-modal]') != null) {
    closeModal(inviteBoxEl)
  }
})

// The element releases the camera itself; this only clears what this app was
// waiting for, and lets the screen sleep again if nothing else needs it lit.
scanModalEl.addEventListener('close', () => {
  scanMode = null
  refreshWakeLock()
})

// Escape or the backdrop closes a <dialog> natively, without going through
// closeModal, so the native event is where "invite no longer shown" is caught.
// Covers a dialog dismissed by the platform - Escape, or the backdrop - which
// never goes through closeModal.
inviteBoxEl.addEventListener('close', () => {
  refreshWakeLock()
  refreshKeepAlive()
})

function setStepsCollapsed (collapsed) {
  for (const card of setupCards) {
    card.classList.toggle('is-collapsed', collapsed)
    card.querySelector('.step-heading')?.setAttribute('aria-expanded', String(!collapsed))
  }

  if (collapsed) {
    dataCard.scrollIntoView({ block: 'start', behavior: 'smooth' })
  }
}

for (const card of setupCards) {
  const heading = card.querySelector('.step-heading')

  heading?.addEventListener('click', () => {
    const nowCollapsed = !card.classList.toggle('is-collapsed')
    heading.setAttribute('aria-expanded', String(nowCollapsed))
  })

  heading?.addEventListener('keydown', event => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      heading.click()
    }
  })
}

/**
 * Decide what a scanned string is. Split out and exported to the test surface
 * because the camera path itself cannot be driven by a test - and when the QR
 * started carrying a link instead of a raw payload, this check kept rejecting
 * perfectly good codes as "not a libp2p offer".
 */
async function classifyScanned (text, expectedType) {
  const payloadText = payloadFrom(text)

  if (payloadText.length === 0) {
    return { ok: false, reason: 'That code does not contain an invite. Keep scanning.' }
  }

  let payload

  try {
    payload = await parsePayload(payloadText)
  } catch {
    return {
      ok: false,
      reason: `A QR code was detected, but it is not a libp2p ${expectedType} payload. Keep scanning.`
    }
  }

  if (payload.type !== expectedType) {
    return {
      ok: false,
      reason: `Detected a ${payload.type ?? 'different'} QR, but this browser is waiting for an ${expectedType}. Keep scanning the QR created by the other browser.`
    }
  }

  return { ok: true, payloadText }
}

function showBanner (text, state) {
  handoffBannerEl.textContent = text
  handoffBannerEl.className = `handoff-banner is-${state}`
  handoffBannerEl.hidden = false
  handoffBannerEl.scrollIntoView({ block: 'start', behavior: 'smooth' })
}

/**
 * The one sentence that can still be acted on.
 *
 * Two Android phones, Chrome and DuckDuckGo: the handover works, provided you
 * come back within a couple of seconds. That is not a rule anyone can guess, so
 * it is put next to the button that sends them away - and only there, because a
 * warning that arrives on the way back is a post-mortem.
 */
function showHurryBack () {
  if (!leavingSuspendsUs()) {
    return
  }

  // The invite dialog covers step 2 the moment it opens, so the fuller heads-up
  // shown there has usually left the screen by now. This is the sentence that
  // has to be true at the instant they leave, so the browser-specific half is
  // repeated rather than assumed to have been read.
  const holds = BROWSERS_THAT_HOLD.includes(document.documentElement.dataset.browser)

  hurryBackEl.textContent = holds
    ? 'Come straight back. While you are in another app this phone suspends the page, and the invite stops working within seconds.'
    : 'Come straight back - within seconds. This browser does not hold a waiting invite; only DuckDuckGo and Safari have been seen to keep one alive for about ten seconds.'
  hurryBackEl.hidden = false
}

/**
 * Say what this browser will do to the invite, before the invite exists.
 *
 * The moment to warn is the press of *Create invite link*: that is the last
 * point at which switching browsers is still cheap. Afterwards they are holding
 * an invite whose life is measured in seconds, and saying it then is saying it
 * too late.
 *
 * Only on phones, and only in the browsers that do not hold - on a desktop none
 * of this applies, and in DuckDuckGo or Safari the flow is workable. A warning
 * shown everywhere is a warning worth ignoring.
 */
function showBrowserWarning () {
  const browser = document.documentElement.dataset.browser

  if (!leavingSuspendsUs() || BROWSERS_THAT_HOLD.includes(browser)) {
    return
  }

  browserWarningEl.textContent =
    'Heads up: on phones, only DuckDuckGo and Safari have been seen to keep a waiting invite alive for about ten seconds. ' +
    'In this browser it dies within seconds of you leaving, so paste the link into your messenger and come straight back. ' +
    'The person you invite has the harder job - they leave twice, once to open your link and once to send their answer - and both trips have to be quick. ' +
    'There is no way around this yet.'
  browserWarningEl.hidden = false
}

const pcHealthEls = [...document.querySelectorAll('.pc-health')]

/**
 * Every half-finished connection the session is holding, on either side.
 *
 * Both roles leave one behind while the person walks off to a messenger: the
 * inviting side keeps an offer waiting for a reply, the answering side keeps
 * the connection it built from that offer. Whichever device goes away, this is
 * the object that goes with it.
 */
// What the states were on the way out, and the sentence describing what came
// back. Kept as text because it has to survive on screen: nobody can watch a
// display that is in the background, so the readout is only ever read later.
let healthOnHide = null
let healthReport = ''

function noteHealthHidden () {
  const pending = pendingConnections(session)

  if (pending.length === 0) {
    return
  }

  healthOnHide = {
    at: Date.now(),
    states: new Map(pending.map(item => [`${item.role} ${item.label}`, stateOf(item.peerConnection)]))
  }
}

function noteHealthVisible () {
  if (healthOnHide == null) {
    return
  }

  const away = Math.round((Date.now() - healthOnHide.at) / 1000)
  const now = new Map(pendingConnections(session).map(item => [`${item.role} ${item.label}`, stateOf(item.peerConnection)]))
  const lines = []

  for (const [key, before] of healthOnHide.states) {
    // Gone from the set entirely is its own answer, and a different one from
    // "still here but closed".
    const after = now.get(key) ?? 'gone'

    lines.push(before === after ? `${key} survived (${after})` : `${key} ${before} → ${after}`)
  }

  healthReport = `after ${away}s away: ${lines.join('; ')}`
  healthOnHide = null
  appendLog(healthReport)
  renderPeerHealth()
}

function renderPeerHealth () {
  const pending = pendingConnections(session)
  const live = pending.map(item => `${item.role} ${item.label}: ${stateOf(item.peerConnection)}`)
  const dead = pending.some(item => stateOf(item.peerConnection) === 'closed')
  const parts = [
    live.length > 0 ? live.join(' · ') : 'no half-finished connection',
    healthReport
  ].filter(part => part.length > 0)

  for (const el of pcHealthEls) {
    el.textContent = parts.join(' — ')
    el.className = `pc-health is-${pending.length === 0 ? 'idle' : dead ? 'dead' : 'alive'}`
    el.hidden = parts.length === 0
  }
}

// Polled rather than evented, because the event does not exist: a connection
// closed by page suspension announces nothing. Two seconds is often enough to
// catch the transition on the way back without being a busy loop.
setInterval(() => {
  if (session != null) {
    renderPeerHealth()
  }
}, 2000)

const openProgressEl = document.getElementById('open-progress')
const openProgressBarEl = document.getElementById('open-progress-bar')
const openProgressStepEl = document.getElementById('open-progress-step')

/**
 * Say what opening someone's link is doing.
 *
 * Three things happen before there is anything to look at - the peer starts,
 * the invite is verified, ICE gathers for the answer - and on a phone that is
 * several seconds of a page that looks like it failed to load. Reported as
 * numbered steps rather than a spinner, because *which* step is slow is the
 * useful part: gathering is the one that takes seconds, and the one that fails.
 *
 * @param {number} step 1-3, or 0 to finish and hide
 * @param {string} [text]
 */
function openProgress (step, text) {
  if (step === 0) {
    openProgressEl.hidden = true

    return
  }

  openProgressBarEl.value = step
  openProgressStepEl.textContent = t('progress.step', { step, text })
  openProgressEl.hidden = false

  // Awaited by the caller, and it has to be. Starting the node generates keys
  // on the main thread, which blocks the renderer for long enough that step 1
  // is replaced by step 2 before either is ever painted - so the panel appears
  // already half-finished, having shown nobody the part it was added for.
  return new Promise(resolve => requestAnimationFrame(() => resolve()))
}

function linkFor (param, payload) {
  const url = new URL(window.location.href)
  url.hash = `${param}=${encodeURIComponent(payload)}`
  url.search = ''

  return url.toString()
}

/**
 * Accept anything a person might paste: a full invite or reply link, or the raw
 * payload. Messengers wrap long strings, so internal whitespace is stripped -
 * without this a wrapped paste fails as "cannot be decoded", which reads like a
 * corrupt payload rather than a line break.
 */
function payloadFrom (text) {
  const trimmed = text.trim()

  if (trimmed.length === 0) {
    return ''
  }

  try {
    const hash = new URL(trimmed).hash.replace(/^#/, '')
    const params = new URLSearchParams(hash)
    const fromLink = params.get(INVITE_PARAM) ?? params.get(REPLY_PARAM)

    if (fromLink != null) {
      return fromLink.replace(/\s+/g, '')
    }
  } catch {
    // not a URL - fall through and treat it as a raw payload
  }

  return trimmed.replace(/\s+/g, '')
}

/**
 * Turn the raw WebRTC and libp2p failures into something that says what to do.
 * The originals - "Called in wrong state: stable", "entered state failed" -
 * are accurate and useless to the person reading them.
 */
function explain (error) {
  const message = error?.message ?? String(error)

  if (/wrong state: stable/i.test(message)) {
    return 'This reply does not belong to your invite. Create a new invite and send that link instead.'
  }

  if (/Create an offer before accepting an answer/i.test(message)) {
    return 'You opened a reply, but this page has no invite waiting. Open the reply in the tab where you created the invite, or start over with a new invite.'
  }

  if (/entered state (failed|closed)/i.test(message) || /timed out/i.test(message)) {
    return 'The connection could not be established - the invite was probably too old. Create a new invite and send the fresh link.'
  }

  if (/has expired/i.test(message)) {
    return 'This link is too old to use. Ask them to create a new invite and send that one.'
  }

  if (/not valid yet/i.test(message)) {
    return 'This link is dated in the future - check the clock on both devices, then try again.'
  }

  if (/missing its validity window/i.test(message)) {
    return 'This link was made by an older version of the app. Both sides need to reload the page.'
  }

  if (/signature is invalid/i.test(message)) {
    return 'This link was altered on the way. Ask for a freshly created one.'
  }

  if (/cannot be decoded/i.test(message)) {
    return 'That does not look like an invite link. Copy the whole link, including the part after the # sign.'
  }

  if (/belongs to this browser/i.test(message)) {
    return 'That is your own link. Send it to the other person and paste the one they send back.'
  }

  return message
}

function inviteAgeLabel () {
  if (inviteCreatedAt == null) {
    return ''
  }

  const remaining = INVITE_FRESH_MS - (Date.now() - inviteCreatedAt)

  if (remaining <= 0) {
    return t('freshness.stale')
  }

  return t('freshness.fresh', { minutes: Math.ceil(remaining / 60000) })
}

function startInviteCountdown () {
  clearInterval(inviteCountdown)
  inviteCreatedAt = Date.now()

  const tick = () => {
    inviteFreshnessEl.textContent = inviteAgeLabel()
    inviteFreshnessEl.classList.toggle('is-stale', Date.now() - inviteCreatedAt >= INVITE_FRESH_MS)
  }

  tick()
  inviteCountdown = setInterval(tick, 15000)
}

/**
 * Select the whole link the moment the field is touched.
 *
 * The one thing somebody does with a read-only field is copy out of it, and on
 * a phone selecting a 1000-character string by dragging is not a thing anybody
 * manages. This is the manual path working properly, not a substitute for the
 * button.
 */
inviteLinkEl.addEventListener('focus', () => inviteLinkEl.select())

/**
 * Copy, and say so on the button that was pressed.
 *
 * Deliberately `clipboard.writeText` rather than `shareOrCopy`: the share sheet
 * is what the primary control above offers, and somebody who opened this fold
 * and reached for a button marked "Copy" asked for the clipboard.
 */
async function copyInviteLink () {
  // The same warning the share button gives, for the same reason: copying a
  // link is what somebody does immediately before leaving for a messenger. On a
  // phone whose browser has no share sheet this is the *only* way out, and
  // until now it was the one that said nothing.
  showHurryBack()

  try {
    await navigator.clipboard.writeText(inviteLinkEl.value)
    markCopied(true)
  } catch {
    // Refused - insecure origin, a permission policy, some mobile browsers.
    // The field beside the button is the answer, so point at it rather than
    // failing silently.
    markCopied(false)
    inviteLinkEl.focus()
  }
}

function markCopied (ok) {
  clearTimeout(copiedTimer)
  copyLinkEl.classList.toggle('is-done', ok)
  copyLinkEl.textContent = t(ok ? 'invite.copied' : 'invite.copyByHand')

  copiedTimer = setTimeout(resetCopied, 2500)
}

/**
 * Back to "Copy".
 *
 * Also called when a new payload is rendered: the offer and the answer are two
 * different links, and a "Copied" left standing after the link changed says
 * something that is no longer true.
 */
function resetCopied () {
  clearTimeout(copiedTimer)
  copyLinkEl.classList.remove('is-done')
  copyLinkEl.textContent = t('invite.copy')
}

copyLinkEl.addEventListener('click', copyInviteLink)

async function shareOrCopy (text, what) {
  if (navigator.share != null) {
    try {
      await navigator.share({ text })
      appendLog(`Shared the ${what}.`)
      return 'shared'
    } catch (error) {
      if (error?.name === 'AbortError') {
        return 'cancelled'
      }
      // fall through to the clipboard
    }
  }

  try {
    await navigator.clipboard.writeText(text)
    appendLog(`Copied the ${what} to the clipboard.`)
    return 'copied'
  } catch {
    appendLog(`Could not copy automatically - select the ${what} and copy it by hand.`)
    return 'failed'
  }
}

/**
 * Publish an outbound payload as a link. The QR encodes the *link*, not the raw
 * payload, so a phone's own camera app opens the page with everything loaded -
 * the in-app scanner is no longer the only way in.
 */
async function renderOutbound (payload, kind) {
  const link = linkFor(kind === QR_TYPE_OFFER ? INVITE_PARAM : REPLY_PARAM, payload)

  inviteLinkEl.value = link
  resetCopied()

  /**
   * The share sheet, only where there is one.
   *
   * `shareOrCopy` falls back to the clipboard when `navigator.share` is absent -
   * which is most desktops - and the fold below now has a Copy button of its
   * own. Two controls doing exactly the same thing, side by side, is what this
   * hides.
   *
   * On a phone they are not the same at all: the sheet goes straight into a
   * messenger, and that handover is the case this whole project is built
   * around. So it stays, where it exists.
   */
  copyPayloadButton.hidden = typeof navigator.share !== 'function'
  // Showing an offer means waiting for a reply; showing an answer means the
  // other side is about to connect. Only the first has a next step to offer -
  // and both ways of taking that step belong to it, not only the camera one.
  // `paste-reply` was left visible while showing an answer, offering to paste a
  // reply to a reply.
  const waitingForReply = kind === QR_TYPE_OFFER
  scanReplyButton.hidden = !waitingForReply
  pasteReplyButton.hidden = !waitingForReply
  listenReplyButton.hidden = !waitingForReply

  // The answering side is the one with something to play. The offer stays a
  // code or a link: the side that shows it has a screen by definition, and at
  // a thousand characters it would be half a minute of noise.
  outboundPayload = payload
  playAnswerButton.hidden = waitingForReply
  labelPlayButton()
  openModal(inviteBoxEl)
  startInviteCountdown()

  if (link.length > MAX_QR_PAYLOAD_LENGTH) {
    qrImage.value = ''
    appendLog('Link is too long for a reliable QR code - send it as a link instead.')
    return link
  }

  // The element decides whether one code fits or a sequence is needed, and
  // animates it if so. What used to be eighty lines here is now an attribute.
  qrImage.value = link
  appendLog(`QR payload size: ${payload.length} characters.`)

  return link
}

async function handleReceivedPayload (input, expectedType) {
  const text = payloadFrom(input)
  const parsed = await parsePayload(text)
  const type = expectedType ?? parsed.type

  if (type === QR_TYPE_OFFER) {
    // Only meaningful while opening a link; a no-op otherwise, since the panel
    // is hidden and this leaves it hidden.
    if (!openProgressEl.hidden) {
      await openProgress(3, t('progress.reply'))
    }

    const answerPayload = await acceptOfferPayload(text)
    await renderOutbound(answerPayload, QR_TYPE_ANSWER)
    setStatus(t('status.verified'))
    appendLog('Verified their invite and created a reply link.')
    return answerPayload
  }

  if (type === QR_TYPE_ANSWER) {
    const addr = await acceptAnswerPayload(text)
    appendLog(`Verified answer and connected to ${addr}`)
    updateControls()
    return addr
  }

  throw new Error(`Unsupported QR payload type: ${type}`)
}

function updateControls () {
  const started = node != null
  // In the simple view this button starts the peer itself, so disabling it
  // until something else has been pressed would disable the only control on
  // screen - permanently, because that something else is hidden.
  createOfferButton.disabled = !started && !isSimple()
  createOfferAgainButton.disabled = !started
  scanOfferButton.disabled = !started
  scanAnswerButton.disabled = !started || session.offers.size === 0
  processPayloadButton.disabled = !started || payloadFrom(payloadDisplay.value).length === 0
  copyPayloadButton.disabled = inviteLinkEl.value.length === 0
}

/**
 * Open the scanner element and tell it what counts as the code we want.
 *
 * The element runs the camera and the scan loop; this decides whether what it
 * read is the payload this screen is waiting for. Returning `ok: false` keeps
 * the camera going with the reason on screen, which is what turns "that is a
 * reply, not an invite" into a message rather than a dead end.
 */
function beginScan (expectedType) {
  scanModalEl.label = expectedType === QR_TYPE_OFFER ? 'Scan their code' : 'Scan their reply'
  scanMode = expectedType
  scanModalEl.validate = async text => classifyScanned(text, expectedType)

  scanModalEl.open().catch(error => {
    setStatus(t('status.cameraFailed', { reason: error.message }))
    // The dialog may have opened before the camera failed; drop the lock if it
    // closed behind the error.
    refreshWakeLock()
  })

  // `open()` runs `showModal()` synchronously before its first await, so the
  // dialog is already open here - which is the case this whole change is for:
  // hold the screen the instant the scanner is on screen, not once a connection
  // that scanning is trying to create finally exists.
  refreshWakeLock()
}

scanModalEl.addEventListener('scan', async event => {
  const expectedType = scanMode

  scanMode = null
  setStatus(t('status.verifying'))

  try {
    const classified = await classifyScanned(event.detail.text, expectedType)

    await handleReceivedPayload(classified.payloadText, expectedType)
    updateControls()
  } catch (error) {
    setStatus(t('status.qrFailed', { reason: error.message }))
    appendLog(`QR processing failed: ${error.message}`)
  }
})

startButton.addEventListener('click', async () => {
  startButton.disabled = true

  try {
    await createNode()
  } catch (error) {
    startButton.disabled = false
    setStatus(t('status.startFailed', { reason: error.message }))
    appendLog(`Start failed: ${error.message}`)
  }
})

resetIdentityButton.addEventListener('click', () => {
  forgetIdentity()

  // A running node keeps the old key in memory, and half the app holds peer ids
  // derived from it. Reloading is the honest way to start over, and it is what
  // "start over as a new peer" says on the button.
  window.location.reload()
})

async function createInvite (button) {
  // First, and synchronously: this runs inside the click that called it, which
  // is the only moment the autoplay policy will let audio start. Everything
  // below awaits.
  startKeepAlive()

  // Step 1 is technical - "start a browser peer" is not a thing anybody set out
  // to do - so in the simple view it is not on screen to press. The button that
  // *is* pressed does it instead, which is also the honest order: nobody wants
  // a peer, they want to invite somebody.
  if (node == null) {
    setButtonBusy(button, t('invite.starting'))

    try {
      await createNode()
    } catch (error) {
      clearButtonBusy(button)
      setStatus(explain(error))
      return
    }
  }

  // Before anything else, and before the seconds of gathering: this is the last
  // moment where changing browser is still a cheap decision.
  showBrowserWarning()

  // Clear the previous link first. Gathering ICE takes seconds, and a stale
  // link sitting in the box the whole time is one someone will copy and send.
  inviteLinkEl.value = ''
  qrImage.value = ''
  inviteFreshnessEl.textContent = ''
  clearInterval(inviteCountdown)
  updateControls()

  // Gathering ICE candidates can take seconds, and until it finishes there is
  // nothing on screen. Without a pending state the button looks like it was
  // never pressed, so people press it again.
  setButtonBusy(button, 'Creating link…')

  try {
    const payload = await createOfferPayload()
    await renderOutbound(payload, QR_TYPE_OFFER)
    setStatus(t('status.inviteReady'))
    appendLog('Created a signed invite link.')
  } catch (error) {
    setStatus(explain(error))
    appendLog(`Invite failed: ${error.message}`)
  } finally {
    clearButtonBusy(button)
    updateControls()
  }
}

createOfferButton.addEventListener('click', () => createInvite(createOfferButton))
createOfferAgainButton.addEventListener('click', () => createInvite(createOfferAgainButton))

reconnectButton.addEventListener('click', () => {
  clearReconnectPrompt()
  createInvite(reconnectButton)
})

// Disconnecting is the host's to do: the element asks, and the list changes
// when this says it has. Closing only the stream left the WebRTC connection
// open behind it, which is why both go.
peerListEl.addEventListener('disconnect', event => {
  const { peerId } = event.detail

  intentionalDrops.add(peerId)
  chatStreams.get(peerId)?.close().catch(() => {})
  peerConnections.get(peerId)?.close()
})

// Reachable without reopening the folded card: once connected, inviting the
// next person is the natural next thing, not a step you have to go back for.
document.getElementById('invite-another').addEventListener('click', () => {
  setStepsCollapsed(false)
  document.getElementById('step-connect').scrollIntoView({ block: 'start', behavior: 'smooth' })
  createInvite(createOfferButton)
})

scanOfferButton.addEventListener('click', () => beginScan(QR_TYPE_OFFER))
scanAnswerButton.addEventListener('click', () => beginScan(QR_TYPE_ANSWER))

// Showing an invite means waiting for a reply, so both ways of receiving one
// belong here rather than in a different part of the page.
scanReplyButton.addEventListener('click', () => {
  closeModal(inviteBoxEl)
  beginScan(QR_TYPE_ANSWER)
})

pasteReplyButton.addEventListener('click', () => {
  closeModal(inviteBoxEl)
  revealPasteField()
})

// ---- the reply, carried as sound -------------------------------------------

/**
 * The codec is handed to the element rather than imported by it.
 *
 * `<qr-listen>` deliberately does not import `createAudioReceiver`: it would
 * then be in the elements bundle for everybody, including every page that never
 * opens a microphone, and ggwave's WebAssembly glue names Node's `path` and
 * `fs` - which no browser bundle resolves. This one line is the price of that,
 * and it is the same seam `strings` and `validate` are.
 */
listenModalEl.createReceiver = createAudioReceiver
listenModalEl.validate = async text => classifyScanned(text, QR_TYPE_ANSWER)

listenModalEl.addEventListener('payload', async event => {
  setStatus(t('status.verifying'))

  try {
    const classified = await classifyScanned(event.detail.text, QR_TYPE_ANSWER)

    await handleReceivedPayload(classified.payloadText, QR_TYPE_ANSWER)
    updateControls()
  } catch (error) {
    setStatus(t('status.qrFailed', { reason: error.message }))
    appendLog(`Audio reply failed: ${error.message}`)
  }
})

listenReplyButton.addEventListener('click', () => {
  closeModal(inviteBoxEl)

  listenModalEl.open().catch(error => {
    setStatus(t('status.listenFailed', { reason: error.message }))
    appendLog(`Microphone failed: ${error.message}`)
    refreshWakeLock()
  })

  // Same reason as the scanner: hold the screen from the moment the dialog is
  // up, not from the moment something has arrived. Somebody holding two devices
  // together is not touching either of them.
  refreshWakeLock()
})

/**
 * How long this payload will take to play, without loading the codec to ask.
 *
 * Measured at 48 kHz: one full transmission of 140 bytes is 9.3 seconds on the
 * default protocol. The label rounds it, because the number is a promise about
 * how long to stand there rather than a specification.
 */
const SECONDS_PER_TRANSMISSION = 9.3

function labelPlayButton () {
  if (playAnswerButton.hidden || outboundPayload == null) return

  let transmissions

  try {
    transmissions = frameForAudio(outboundPayload).length
  } catch {
    // Longer than the framing can number. Nothing to offer, so offer nothing
    // rather than a button that throws when pressed.
    playAnswerButton.hidden = true
    return
  }

  playAnswerButton.textContent = t('invite.play', {
    seconds: Math.round(transmissions * SECONDS_PER_TRANSMISSION)
  })
}

async function playThrough (context, samples) {
  const buffer = context.createBuffer(1, samples.length, context.sampleRate)

  buffer.copyToChannel(samples, 0)

  const source = context.createBufferSource()

  source.buffer = buffer
  source.connect(context.destination)

  await new Promise(resolve => {
    source.onended = resolve
    source.start()
  })
}

playAnswerButton.addEventListener('click', async () => {
  if (outboundPayload == null) return

  // Built inside the click: an AudioContext starts suspended under the autoplay
  // policy, and this is the only gesture there will be. The rate is asked for
  // rather than accepted - a context that follows the output device lands on
  // 44.1 kHz often enough, and the codec is silent there.
  const context = new AudioContext({ sampleRate: AUDIO_SAMPLE_RATE })

  playAnswerButton.disabled = true

  try {
    const { frames } = await encodeToAudio(outboundPayload, { sampleRate: context.sampleRate })

    for (const [index, samples] of frames.entries()) {
      // One buffer at a time, and the label says which: two minutes of silence
      // followed by success is indistinguishable from two minutes of nothing.
      playAnswerButton.textContent = t('invite.playing', { part: index + 1, total: frames.length })
      await playThrough(context, samples)
    }

    appendLog(`Played the answer as sound: ${frames.length} transmissions.`)
  } catch (error) {
    setStatus(t('status.audioFailed', { reason: error.message }))
    appendLog(`Playing the answer failed: ${error.message}`)
  } finally {
    playAnswerButton.disabled = false
    labelPlayButton()
    context.close().catch(() => {})
  }
})

function revealPasteField () {
  pasteFallbackEl.open = true
  payloadDisplay.scrollIntoView({ block: 'center', behavior: 'smooth' })
  payloadDisplay.focus()
}

async function useIncoming (text) {
  setButtonBusy(processPayloadButton, 'Connecting…')

  try {
    await handleReceivedPayload(text)
  } catch (error) {
    setStatus(explain(error))
    appendLog(`Link failed: ${error.message}`)
  } finally {
    clearButtonBusy(processPayloadButton)
    updateControls()
  }
}

processPayloadButton.addEventListener('click', () => useIncoming(payloadDisplay.value))

// Pasting is the whole interaction, so it should not need a second click. The
// button stays for keyboard and for anyone who types the link by hand.
payloadDisplay.addEventListener('paste', event => {
  const pasted = event.clipboardData?.getData('text') ?? ''

  if (payloadFrom(pasted).length > 0) {
    event.preventDefault()
    payloadDisplay.value = pasted
    updateControls()
    useIncoming(pasted)
  }
})

copyPayloadButton.addEventListener('click', async () => {
  // Said *before* the messenger takes the screen. Once it has, this page is
  // suspended and anything written here is unreadable until it is too late to
  // act on - which is what made the old on-return warning a post-mortem.
  showHurryBack()

  const result = await shareOrCopy(inviteLinkEl.value, 'invite link')

  if (result === 'copied') {
    setStatus(leavingSuspendsUs()
      ? 'Link copied. Paste it and come straight back - this invite stops working seconds after you leave.'
      : 'Link copied. Paste it into your chat with the other person.')
  }
})

payloadDisplay.addEventListener('input', updateControls)

async function submitMessage () {
  const message = messageInput.value.trim()

  if (message.length === 0) {
    return
  }

  try {
    await sendMessage(message)
    messageInput.value = ''
  } catch (error) {
    appendLog(`Send failed: ${error.message}`)
  }
}

sendButton.addEventListener('click', submitMessage)

// Enter sends. In a single-line field with a Send button next to it, pressing
// Enter is what everyone tries first, and nothing happened.
messageInput.addEventListener('keydown', event => {
  if (event.key === 'Enter' && !event.isComposing) {
    event.preventDefault()
    submitMessage()
  }
})

// Drag and drop, with the whole zone as a click target for keyboard and mobile.
;['dragenter', 'dragover'].forEach(name => {
  dropZone.addEventListener(name, event => {
    event.preventDefault()

    if (chatStreams.size > 0) {
      dropZone.classList.add('is-hovered')
    }
  })
})

;['dragleave', 'drop'].forEach(name => {
  dropZone.addEventListener(name, event => {
    event.preventDefault()
    dropZone.classList.remove('is-hovered')
  })
})

dropZone.addEventListener('drop', event => {
  const files = [...(event.dataTransfer?.files ?? [])]

  if (files.length > 0) {
    sendFiles(files)
  }
})

dropZone.addEventListener('click', () => {
  if (chatStreams.size > 0) {
    fileInput.click()
  }
})

dropZone.addEventListener('keydown', event => {
  if ((event.key === 'Enter' || event.key === ' ') && chatStreams.size > 0) {
    event.preventDefault()
    fileInput.click()
  }
})

fileInput.addEventListener('change', () => {
  const files = [...fileInput.files]

  if (files.length > 0) {
    sendFiles(files).finally(() => {
      fileInput.value = ''
    })
  }
})

/**
 * How long this page spent in the background while an invite was waiting.
 *
 * Sharing a link through a messenger means leaving: the app goes away, the
 * other app comes up, and the invite sits there. The candidates in it are a
 * snapshot of NAT mappings that were open when it was made, and those close
 * after tens of seconds of silence - so an invite that has been through a
 * round trip in a chat is describing a path that no longer exists.
 *
 * Measured rather than assumed, because the same failure has two very
 * different-looking causes: a symmetric NAT no invite would cross, and a
 * perfectly good invite that simply went cold. Only one is worth retrying.
 */
let inviteHiddenSince = null
let inviteHiddenMs = 0

function noteInviteHidden () {
  if (session != null && session.offers.size > 0 && inviteHiddenSince == null) {
    inviteHiddenSince = Date.now()
  }
}

function noteInviteVisible () {
  if (inviteHiddenSince == null) {
    return
  }

  inviteHiddenMs += Date.now() - inviteHiddenSince
  inviteHiddenSince = null

  if (session.offers.size === 0) {
    return
  }

  const seconds = Math.round(inviteHiddenMs / 1000)

  // Asked of the connection rather than of the clock. A twenty-second rule was
  // wrong in both directions: two Android phones showed the connection gone
  // after *a couple* of seconds, so the rule stayed silent through the absence
  // that actually killed it - and it cried wolf after a long one that happened
  // to survive. `signalingState` knows which of those just happened.
  const died = pendingConnections(session).some(item => stateOf(item.peerConnection) === 'closed')

  appendLog(`This tab was in the background for ${seconds}s with an invite waiting.`)

  if (died) {
    showBanner(
      `Your invite did not survive the ${seconds}s you were away - this phone suspended the page and closed the connection behind it. Make a new invite and send that one.`,
      'error'
    )
  }
}

/** Forget the tally once no invite is riding on it. */
function resetInviteHidden () {
  inviteHiddenSince = null
  inviteHiddenMs = 0
}

/**
 * Coming back from the background is the moment to say what happened. Phones
 * suspend timers and let radios sleep, so a connection can be mid-recovery, or
 * already gone, and the page would otherwise sit there looking fine.
 */
document.addEventListener('visibilitychange', () => {
  // The browser drops the wake lock whenever the page stops being visible, so
  // coming back has to ask for it again - and going away has to stop wanting it.
  // `sync` applies the visibility gate; this only has to re-state the intent.
  refreshWakeLock()

  if (document.visibilityState !== 'visible') {
    noteInviteHidden()
    noteHealthHidden()

    return
  }

  noteInviteVisible()
  noteHealthVisible()
  renderPeers()

  const lost = [...chatStreams.keys()].filter(peerId => {
    const state = peerConnections.get(peerId)?.connectionState

    return state === 'failed' || state === 'closed'
  })

  if (lost.length > 0) {
    setStatus(t('status.lostWhileAway', { count: lost.length }))
  }
})

// There is deliberately no `beforeunload` teardown.
//
// This app *requires* leaving the page: you create an invite, switch to a
// messenger to send it, and come back. Mobile browsers fire beforeunload when a
// page is backgrounded or discarded, so closing peer connections there killed
// the connection at exactly the moment the flow depends on - the answering peer
// reported "entered state closed" the moment its user switched to Telegram to
// send the reply link.
//
// A page that is genuinely closing needs no help: the browser releases the
// peer connections, the camera and the sockets on its own.

window.__libp2pQrTest = {
  // Multi-frame encode/decode, exposed so the round trip can be driven without
  // pointing a camera at a screen.
  bcurFrames: async (text, options) => {
    const source = await createFrameSource(text, options)
    const frames = []

    for (let i = 0; i < source.total; i++) {
      frames.push(source.next())
    }

    return { total: source.total, frames, extra: [source.next(), source.next()] }
  },
  bcurReceive: async parts => {
    const accumulator = await createPartAccumulator()
    const steps = []

    for (const part of parts) {
      steps.push(accumulator.receive(part))
    }

    return steps
  },
  needsAnimation,
  looksLikeUrPart,
  /**
   * Do to the pending connections what a suspending browser does: close them
   * from underneath the page, firing nothing. The real thing cannot be provoked
   * from a test - a headless browser has no home button - and what is worth
   * covering is what the page shows *afterwards*, which this reaches honestly.
   */
  simulateSuspension: () => {
    const closed = []

    for (const [sessionId, offer] of session?.offers ?? []) {
      offer.peerConnection.close()
      closed.push(`invite ${sessionId.slice(0, 6)}`)
    }

    for (const peerConnection of session?.inbound ?? []) {
      peerConnection.close()
      closed.push('reply')
    }

    return closed
  },
  // The tables for the current locale, so a spec can hand the shipped German to
  // an element rather than retyping it and proving only that it retyped it.
  elementStrings,
  // The codec, so a spec can mount its own <qr-listen> and feed it a payload
  // without the demo's own answer validation standing in front of it.
  createAudioReceiver,
  encodeToAudio,
  AUDIO_SAMPLE_RATE,
  wakeLockState: () => ({ supported: wakeLock.supported, wanted: wakeLock.wanted, held: wakeLock.held }),
  /**
   * Whether the keep-alive is running, and whether it got the real recording or
   * fell back to near-silence. The second half matters in a test: Playwright's
   * Chromium ships without proprietary codecs, so the MP3 does not decode there
   * and `audible` is false while the keep-alive is working perfectly.
   */
  keepAliveState: () => ({
    wanted: keepAliveWanted,
    running: keepAlive.running,
    supported: keepAlive.supported,
    audible: navigator.mediaSession?.metadata != null
  }),
  // Whether the scanner modal is on screen. Deliberately *not* named after the
  // camera: it reports the dialog, and a dialog that has closed says nothing
  // about whether the track behind it was released. The test measures that
  // separately, by watching what getUserMedia handed out.
  scannerOpen: () => scanModalEl.isOpen,
  createOfferPayload,
  acceptOfferPayload,
  acceptAnswerPayload,
  decodePayload: async text => parsePayload(text),
  encodePayload: payload => compress(JSON.stringify(payload)),
  decodeQrDataUrl: async dataUrl => {
    // The element renders asynchronously, so a caller can read `src` before
    // there is one. WebKit throws "Missing source URL" from decode() rather
    // than resolving to nothing, which reads like a corrupt image.
    if (dataUrl == null || dataUrl === '') {
      return null
    }

    const image = new Image()
    image.src = dataUrl
    await image.decode()

    const canvas = document.createElement('canvas')
    canvas.width = image.naturalWidth
    canvas.height = image.naturalHeight
    const context = canvas.getContext('2d', { willReadFrequently: true })
    context.drawImage(image, 0, 0)
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height)

    return jsQR(pixels.data, pixels.width, pixels.height, {
      inversionAttempts: 'attemptBoth'
    })?.data ?? null
  },
  sendMessage,
  sendFile: async (name, text, mime = 'text/plain') =>
    sendFile(new File([fromString(text)], name, { type: mime })),
  getReceivedFiles: () => [...testState.receivedFiles],
  wasBusy: id => testState.busyObserved.has(id),
  readReceivedFile: async cid => {
    const link = receivedFilesEl.querySelector(`a[data-cid="${cid}"]`)

    if (link == null) {
      return null
    }

    return (await fetch(link.href)).text()
  },
  getLastReceivedMessage: () => testState.lastReceivedMessage,
  getReceivedMessages: () => testState.receivedMessages.map(entry => entry.text),
  getReceivedWithSenders: () => [...testState.receivedMessages],
  getConnections: () => node?.getConnections().length ?? 0,
  classifyScanned,
  // A local close() deliberately does *not* fire connectionstatechange - only a
  // real failure does, after roughly thirty seconds of failed consent checks.
  // The test drives the event the browser would send, so it covers the handling
  // written here rather than the browser's timing.
  simulateConnectionLoss: peerId => {
    const peerConnection = peerConnections.get(peerId)

    peerConnection?.close()
    peerConnection?.dispatchEvent(new Event('connectionstatechange'))
  },
  getPeers: () => [...chatStreams.keys()],
  debugStreams: () => [...chatStreams].map(([peerId, stream]) => ({
    peerId,
    status: stream.status,
    readStatus: stream.readStatus,
    writeStatus: stream.writeStatus
  }))
}

/**
 * A reply link belongs to the tab that created the invite - only that tab holds
 * the pending RTCPeerConnection. Tapping the link in a messenger usually opens a
 * *new* tab, which cannot finish the handshake no matter what it does. So the
 * new tab hands the reply to the original one over BroadcastChannel, and only
 * falls back to explaining itself when nobody answers.
 */
handoff?.addEventListener('message', async event => {
  const { kind, payload } = event.data ?? {}

  if (kind !== 'reply' || session.offers.size === 0) {
    return
  }

  handoff.postMessage({ kind: 'reply-taken' })
  appendLog('A reply arrived from another tab.')
  // The invite this tab was holding up has been answered, just not by anyone
  // pointing a camera at it. Leaving the code on screen would ask for a scan
  // that is no longer needed.
  closeModal(inviteBoxEl)
  await useIncoming(payload)

  // Tell the other tab how it went. Without this it waits forever on a page
  // that, by design, does nothing else.
  handoff.postMessage({
    kind: 'reply-result',
    ok: (node?.getConnections().length ?? 0) > 0,
    message: statusEl.textContent
  })
})

function handOffReply (payload) {
  if (handoff == null) {
    return Promise.resolve(false)
  }

  return new Promise(resolve => {
    const timer = setTimeout(() => {
      handoff.removeEventListener('message', onAck)
      resolve(false)
    }, 1500)

    function onAck (event) {
      if (event.data?.kind === 'reply-taken') {
        clearTimeout(timer)
        handoff.removeEventListener('message', onAck)
        resolve(true)
      }
    }

    handoff.addEventListener('message', onAck)
    handoff.postMessage({ kind: 'reply', payload })
  })
}

/**
 * Opening a link is the whole interaction: start the node and use it. Nobody
 * should have to press "start" first and then find where to paste.
 */
async function consumeLink () {
  const params = new URLSearchParams(window.location.hash.replace(/^#/, ''))
  const invite = params.get(INVITE_PARAM)
  const reply = params.get(REPLY_PARAM)
  const incoming = invite ?? reply

  if (incoming == null) {
    return
  }

  // Drop the fragment, so a reload does not replay a payload that is spent.
  history.replaceState(null, '', window.location.pathname + window.location.search)

  if (reply != null && await handOffReply(reply)) {
    setStatus(t('status.handedOver'))
    showBanner('Handed to the tab where you created the invite. Waiting for it to connect…', 'waiting')

    handoff.addEventListener('message', event => {
      if (event.data?.kind !== 'reply-result') {
        return
      }

      showBanner(
        event.data.ok
          ? 'Connected in your other tab. You can close this one.'
          : `Your other tab could not connect: ${event.data.message}`,
        event.data.ok ? 'ok' : 'error'
      )
    })

    return
  }

  startButton.disabled = true

  try {
    await openProgress(1, t('progress.starting'))
    await createNode()

    await openProgress(2, t('progress.checking'))
    // Step 3 is announced from inside handleReceivedPayload, which is where the
    // slow part actually starts - gathering candidates for the answer. Naming
    // it here would move the label seconds ahead of the work.
    await useIncoming(incoming)
    openProgress(0)
  } catch (error) {
    openProgress(0)
    setStatus(explain(error))
    appendLog(`Opening the link failed: ${error.message}`)
  }
}

// The markup ships the invite button disabled and, until now, nothing enabled it
// until "Start" had been pressed. That was invisible while step 1 was always on
// screen; with it behind the switch, the simple view would have shown one
// control and left it dead.
//
// Down here rather than beside the switch: `updateControls` reads `session`,
// which is a `let` declared further up the file than the switch is wired but
// further *down* than that wiring runs.
updateControls()

/**
 * The introduction, on a first visit only.
 *
 * `arrivedViaInvite` is the whole reason the policy takes an argument: somebody
 * who followed a link came to accept an invite, and a dialog in front of that is
 * in the way of the only thing they came for. They get it on their next plain
 * visit instead.
 */
const introPolicy = createIntroPolicy({ storageKey: 'webrtc-qr.introSeen' })

introEl.addEventListener('close', event => {
  if (event.detail.remember) introPolicy.remember()
})

/**
 * `?intro=off` keeps it shut.
 *
 * A modal blocks the page behind it, which is correct for a person and fatal
 * for a test: every spec that clicks anything would wait for a dialog it never
 * asked for. The specs open pages four different ways, so a fixture pins one
 * and misses the rest - the URL is the only handle they all share, the same
 * reason `?view=` exists.
 *
 * It is not only a test flag. A demo being screen-shared, or embedded in a page
 * that explains it already, wants the same thing.
 */
const introWanted = new URLSearchParams(location.search).get('intro') !== 'off'

if (introWanted && introPolicy.shouldOpen({ arrivedViaInvite: window.location.hash.length > 1 })) {
  introEl.open().catch(() => {})
}

consumeLink()
