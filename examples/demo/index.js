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
import QRCode from 'qrcode'
import {
  FRAME_INTERVAL_MS,
  createFrameSource,
  createPartAccumulator,
  looksLikeUrPart,
  needsAnimation,
  preload as preloadAnimatedQr
} from './bcur.js'
import { forgetIdentity, loadOrCreateIdentity } from './identity.js'
import { state as wakeLockState, sync as syncWakeLock } from './wakelock.js'
import { fromString, toString } from 'uint8arrays'
import {
  compress,
  createWebRTCUpgradeContext,
  decodeSignedPayload,
  encodeSignedPayload,
  parsePayload,
  webRTCQR,
  PAYLOAD_VERSION,
  QR_TYPE_ANSWER,
  QR_TYPE_OFFER
} from '@le-space/libp2p-webrtc-qr'

const CHAT_PROTOCOL = '/libp2p/examples/webrtc-qr-chat/1.0.0'
const ICE_GATHERING_TIMEOUT = 15000
const CONNECTION_TIMEOUT = 30000
// How long the answering peer keeps its side open while waiting for the other
// person to open the reply. 30 seconds is right for two phones in one room and
// hopelessly short over a messenger, where switching apps and reading a message
// takes minutes - and a timeout here closes the connection, so the reply can
// never land afterwards.
const ANSWER_WAIT_TIMEOUT = 6 * 60 * 1000
const MAX_QR_PAYLOAD_LENGTH = 2200
const SCAN_INTERVAL = 140
const SCAN_CANVAS_MAX_WIDTH = 960
const QR_RENDER_OPTIONS = { errorCorrectionLevel: 'M', margin: 4, width: 1280 }

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
const stopScanButton = document.getElementById('stop-scan')
const sendButton = document.getElementById('send')
const qrImage = document.getElementById('qr-image')
const qrFrameEl = document.getElementById('qr-frame')
const qrVideo = document.getElementById('qr-video')
const scanStatus = document.getElementById('scan-status')
const dropZone = document.getElementById('drop-zone')
const fileInput = document.getElementById('file-input')
const receivedFilesEl = document.getElementById('received-files')
const inviteBoxEl = document.getElementById('invite-box')
const inviteLinkEl = document.getElementById('invite-link')
const inviteFreshnessEl = document.getElementById('invite-freshness')
const createOfferAgainButton = document.getElementById('create-offer-again')
const handoffBannerEl = document.getElementById('handoff-banner')
const peerListEl = document.getElementById('peer-list')
const peerCountEl = document.getElementById('peer-count')
const networkStateEl = document.getElementById('network-state')
const networkLineEls = {
  ipv4: document.getElementById('network-ipv4'),
  ipv6: document.getElementById('network-ipv6'),
  overall: document.getElementById('network-overall')
}
const setupCards = [document.getElementById('step-start'), document.getElementById('step-connect')]
const dataCard = document.getElementById('step-data')

const qrCanvas = document.createElement('canvas')
const qrCanvasContext = qrCanvas.getContext('2d', { willReadFrequently: true })

let node = null
let helia = null
let fs = null
// Keyed by session id until an answer names the peer, then indexed by peer id
// as well - an outgoing offer does not know who will take it.
const offerSessions = new Map()
const chatStreams = new Map()
// Kept per peer so the page can say what happened to each connection while it
// was in the background, instead of going quiet.
const peerConnections = new Map()
// Peers the user dropped on purpose, so the same teardown is not reported as a
// loss they need to do something about.
const intentionalDrops = new Set()
let scanStream = null
let scanAnimationFrame = null
let scanMode = null
let lastScanTime = 0
let scanAttempts = 0
let barcodeDetector = null
let scanSessionId = 0
let qrAnimationTimer = null
let partAccumulator = null
let receivingParts = false

const inboundPeerConnections = new Set()
const testState = {
  lastReceivedMessage: null,
  receivedMessages: [],
  receivedFiles: [],
  busyObserved: new Set()
}

function appendLog (text) {
  const line = document.createElement('div')
  line.textContent = text
  chatLogEl.appendChild(line)
  chatLogEl.scrollTop = chatLogEl.scrollHeight
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

/**
 * The *newest* matching session, not the first.
 *
 * Sessions are keyed by session id, so reconnecting to a peer leaves the dead
 * one in the map alongside the new one. Returning the first match handed the
 * transport a closed peer connection and the dial died with "Remote closed
 * connection during opening" - a failure that only became reachable once the
 * Peer ID started surviving a reload, because before that a reconnecting peer
 * never matched an older session.
 */
function getOutboundSession (remotePeerId) {
  let newest = null

  for (const session of offerSessions.values()) {
    if (session.remotePeerId === remotePeerId && (newest == null || session.createdAt >= newest.createdAt)) {
      newest = session
    }
  }

  return newest?.upgradeContext ?? null
}

function shortPeer (peerId) {
  return `${peerId.slice(0, 8)}…${peerId.slice(-6)}`
}

async function signPayload (payload) {
  return encodeSignedPayload(node.components.privateKey, payload)
}

async function parseAndVerifyPayload (text, expectedType) {
  return decodeSignedPayload(text, expectedType)
}


/**
 * A coloured dot is not a verdict anyone can read out loud, and on a touch
 * screen there is no hover to reveal the sentence behind it. So each chip
 * carries the verdict as a word, and the explanation opens on tap.
 */
const NETWORK_VERDICTS = {
  open: 'usable',
  relay: 'relayed',
  symmetric: 'local only',
  blocked: 'none'
}

function closeNetworkTips (except) {
  for (const line of Object.values(networkLineEls)) {
    const chip = line.querySelector('.network-chip')

    if (chip !== except) {
      chip.setAttribute('aria-expanded', 'false')
    }
  }
}

function renderNetwork (result) {
  for (const key of ['ipv4', 'ipv6', 'overall']) {
    const line = networkLineEls[key]

    line.className = `network-line is-${result[key].state}`
    line.querySelector('.network-text').textContent = result[key].text
    line.querySelector('.network-verdict').textContent = NETWORK_VERDICTS[result[key].state]
  }

  // The container keeps the overall state as a class so anything reading one
  // element - a test, a screenshot diff - still sees the summary verdict.
  networkStateEl.className = `network-state is-${result.overall.state}`
  networkStateEl.hidden = false
  appendLog(`Network check: IPv4 ${result.ipv4.state}, IPv6 ${result.ipv6.state} - ${result.overall.text}`)
}

for (const line of Object.values(networkLineEls)) {
  const chip = line.querySelector('.network-chip')

  chip.addEventListener('click', () => {
    const open = chip.getAttribute('aria-expanded') === 'true'

    closeNetworkTips(chip)
    chip.setAttribute('aria-expanded', open ? 'false' : 'true')
  })
}

// `pointerdown` rather than `click`: Safari does not dispatch a click for a tap
// on an element that is not itself interactive, so a document-level click
// listener never hears the tap that should dismiss the tooltip. It fires before
// the chip's own click handler, which is why a tap on a chip is excluded here
// instead of being closed and immediately reopened.
document.addEventListener('pointerdown', event => {
  if (event.target.closest('.network-chip') == null) {
    closeNetworkTips()
  }
})

document.addEventListener('keydown', event => {
  if (event.key === 'Escape') {
    closeNetworkTips()
  }
})

/**
 * 2000::/3 is the only IPv6 range routed on the public internet. Unique-local
 * (fc00::/7) and link-local (fe80::/10) addresses are as useless to a peer
 * elsewhere as a 192.168 address is.
 */
function isGlobalUnicastV6 (address) {
  if (typeof address !== 'string' || !address.includes(':')) {
    return false
  }

  return /^[23]/.test(address.replace(/^\[/, ''))
}

/**
 * Combine the two per-family verdicts into the one that answers the question
 * the user actually has: can I reach anyone from here?
 *
 * Either family being usable is enough - the peers negotiate over whichever
 * one works, and IPv6 does not care that IPv4 sits behind a carrier NAT.
 */
const NETWORK_RANK = { open: 3, relay: 3, symmetric: 2, blocked: 1 }

function summariseNetwork (ipv4, ipv6) {
  const best = NETWORK_RANK[ipv4.state] >= NETWORK_RANK[ipv6.state] ? ipv4 : ipv6

  if (NETWORK_RANK[best.state] === 3) {
    const usable = [
      NETWORK_RANK[ipv4.state] === 3 ? 'IPv4' : null,
      NETWORK_RANK[ipv6.state] === 3 ? 'IPv6' : null
    ].filter(Boolean)

    return {
      state: best.state,
      text: usable.length === 2
        ? 'Reachable over IPv4 and IPv6 - peers on other networks should be able to connect.'
        : usable[0] === 'IPv6'
          ? 'Reachable over IPv6 - a peer that also has IPv6 connects directly, with no NAT to defeat.'
          : 'Reachable over IPv4 - peers on other networks should be able to connect.'
    }
  }

  if (best.state === 'symmetric') {
    return {
      state: 'symmetric',
      text: 'Peers on this same network are fine. Reaching anyone else needs IPv6 on both sides, or a relay.'
    }
  }

  return {
    state: 'blocked',
    text: 'No usable path off this network was found. Only peers on this same network are reachable.'
  }
}

/**
 * Ask the network what it will allow, before anyone tries to connect.
 *
 * A throwaway peer connection gathers candidates against both STUN servers, and
 * the answer is read per address family. A reflexive candidate is *not* on its
 * own good news for IPv4 - a symmetric NAT hands one out too, it is simply
 * useless towards a different peer. What gives it away is the mapping: two
 * different public ports in the same family mean the NAT picks a new mapping
 * per destination, and hole punching with an arbitrary peer will not work.
 *
 * Grouping by family rather than by base address is not a simplification, it is
 * the only option: every engine masks the base behind a reflexive candidate as
 * `raddr 0.0.0.0 rport 0`. It also fixes a real misreading - keying by
 * `relatedPort` put the IPv4 and IPv6 candidates in the same bucket, whose
 * ports of course differ, so a plain cone NAT was reported as symmetric.
 *
 * The residual blind spot: two interfaces in the same family (a VPN next to
 * wifi) have different base ports, so they read as symmetric. That errs towards
 * the pessimistic label, which is the safer direction given nothing is disabled
 * on the strength of it.
 */
async function probeNetwork () {
  const probe = new RTCPeerConnection(getRtcConfiguration())
  const ports = { v4: new Set(), v6: new Set() }
  let relay = false

  probe.createDataChannel('probe')

  const gathered = new Promise(resolve => {
    const done = () => resolve()
    const timer = setTimeout(done, 6000)

    probe.addEventListener('icecandidate', event => {
      const candidate = event.candidate

      if (candidate == null) {
        clearTimeout(timer)
        done()
        return
      }

      if (candidate.type === 'relay') {
        relay = true
      }

      if (candidate.type !== 'srflx' || candidate.address == null) {
        return
      }

      if (isGlobalUnicastV6(candidate.address)) {
        ports.v6.add(candidate.port)
      } else if (!candidate.address.includes(':')) {
        ports.v4.add(candidate.port)
      }
    })
  })

  await probe.setLocalDescription(await probe.createOffer())
  await gathered
  probe.close()

  const ipv4 = relay
    ? { state: 'relay', text: 'IPv4 via the configured TURN relay - should connect from anywhere.' }
    : ports.v4.size === 0
      ? { state: 'blocked', text: 'No IPv4 reflexive candidate - STUN is blocked, or this network is IPv6 only.' }
      : ports.v4.size > 1
        ? { state: 'symmetric', text: 'IPv4 maps a new port per destination (symmetric NAT) - unusable towards a peer elsewhere.' }
        : { state: 'open', text: 'IPv4 mapping stays the same per destination - usable for hole punching.' }

  // A reflexive IPv6 candidate proves the packet reached the STUN server from a
  // routable address. There is no port translation to defeat here; the firewall
  // in front of it is stateful, so the outbound half of ICE opens it just as it
  // would a NAT binding.
  const ipv6 = ports.v6.size > 0
    ? { state: 'open', text: 'Global IPv6 confirmed by STUN - no NAT in the way on this family.' }
    : { state: 'blocked', text: 'No global IPv6 address - this network offers IPv4 only.' }

  return { ipv4, ipv6, overall: summariseNetwork(ipv4, ipv6) }
}

async function createNode () {
  if (node != null) {
    return node
  }

  const identity = await loadOrCreateIdentity()

  node = await createLibp2p({
    privateKey: identity.privateKey,
    transports: [
      webRTCQR({ getOutboundSession })
    ],
    services: {
      identify: identify(),
      identifyPush: identifyPush(),
      ping: ping()
    }
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

  probeNetwork()
    .then(renderNetwork)
    .catch(error => appendLog(`Network check failed: ${error.message}`))

  preloadAnimatedQr()

  peerIdEl.textContent = node.peerId.toString()
  identityOriginEl.textContent = identity.restored
    ? 'Restored for this tab - the same peer you were before.'
    : 'Freshly generated and kept for this tab.'
  setStatus('Browser client started. Create or scan an offer.')
  appendLog(`Started libp2p peer ${node.peerId}${identity.restored ? ' (restored)' : ''}`)
  updateControls()

  return node
}

async function waitForIceGatheringComplete (peerConnection) {
  if (peerConnection.iceGatheringState === 'complete') {
    return
  }

  await new Promise(resolve => {
    const timeout = setTimeout(done, ICE_GATHERING_TIMEOUT)

    function done () {
      clearTimeout(timeout)
      peerConnection.removeEventListener('icegatheringstatechange', onStateChange)
      resolve()
    }

    function onStateChange () {
      if (peerConnection.iceGatheringState === 'complete') {
        done()
      }
    }

    peerConnection.addEventListener('icegatheringstatechange', onStateChange)
  })
}

/**
 * Summarise what ICE actually had to work with. A failure after clean signalling
 * is almost always about candidate types, and those are invisible otherwise:
 *
 * - `.local` host candidates are mDNS-obfuscated. Browsers on the same LAN
 *   generally do resolve each other's - a phone and a laptop on one wifi have
 *   been confirmed working - so their presence alone is not a diagnosis.
 * - With only host and srflx on both sides, two peers behind the same router
 *   may need NAT hairpinning, which not every home router does.
 * - `relay` means a TURN server was available. There is none configured here,
 *   so there is no fallback when the pair above finds nothing.
 */
function describeIce (peerConnection) {
  const summarise = sdp => {
    const lines = (sdp ?? '').split(/\r?\n/).filter(line => line.startsWith('a=candidate:'))
    const types = {}

    for (const line of lines) {
      const type = line.match(/ typ (\w+)/)?.[1] ?? 'unknown'
      types[type] = (types[type] ?? 0) + 1
    }

    const mdns = lines.filter(line => /\s[0-9a-f-]{36}\.local\s/.test(line)).length
    const summary = Object.entries(types).map(([type, count]) => `${count} ${type}`).join(', ')

    return `${summary || 'none'}${mdns > 0 ? ` (${mdns} mDNS .local)` : ''}`
  }

  return `local: ${summarise(peerConnection.localDescription?.sdp)}; remote: ${summarise(peerConnection.remoteDescription?.sdp)}; ice: ${peerConnection.iceConnectionState}`
}

async function waitForConnected (peerConnection, timeoutMs = CONNECTION_TIMEOUT) {
  if (peerConnection.connectionState === 'connected') {
    return
  }

  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup()
      reject(new Error('WebRTC connection timed out'))
    }, timeoutMs)

    function cleanup () {
      clearTimeout(timeout)
      peerConnection.removeEventListener('connectionstatechange', onStateChange)
    }

    function onStateChange () {
      if (peerConnection.connectionState === 'connected') {
        cleanup()
        resolve()
        return
      }

      if (['failed', 'closed'].includes(peerConnection.connectionState)) {
        cleanup()

        if (peerConnection.connectionState === 'failed') {
          const summary = describeIce(peerConnection)
          appendLog(`ICE candidates - ${summary}`)

          if (!summary.includes('relay')) {
            appendLog('No relay candidate on either side. Networks like mobile data usually need a TURN server - see the readme for ?turn=.')
          }
        }

        reject(new Error(`WebRTC connection entered state ${peerConnection.connectionState}`))
      }
    }

    peerConnection.addEventListener('connectionstatechange', onStateChange)
  })
}

async function createOfferPayload () {
  if (node == null) {
    throw new Error('Start the browser client first')
  }

  const peerConnection = new RTCPeerConnection(getRtcConfiguration())
  const sessionId = crypto.randomUUID()

  // WebRTC needs at least one data channel before it will gather candidates.
  // Negotiate it out-of-band so the remote peer never gets a `datachannel`
  // event for it - otherwise the libp2p muxer adopts this unframed channel as
  // an incoming stream and the real protocol streams never arrive.
  const initDataChannel = peerConnection.createDataChannel('init', {
    negotiated: true,
    id: 1023
  })

  const offer = await peerConnection.createOffer()
  await peerConnection.setLocalDescription(offer)
  await waitForIceGatheringComplete(peerConnection)

  if (peerConnection.localDescription == null) {
    throw new Error('WebRTC did not create an SDP offer')
  }

  offerSessions.set(sessionId, {
    sessionId,
    createdAt: Date.now(),
    peerConnection,
    initDataChannel,
    remotePeerId: null,
    upgradeContext: null
  })

  updateControls()

  return signPayload({
    version: PAYLOAD_VERSION,
    type: QR_TYPE_OFFER,
    sessionId,
    peerId: node.peerId.toString(),
    sdp: peerConnection.localDescription.sdp
  })
}

async function acceptOfferPayload (text) {
  if (node == null) {
    throw new Error('Start the browser client first')
  }

  const offerPayload = await parseAndVerifyPayload(text, QR_TYPE_OFFER)

  if (offerPayload.peerId === node.peerId.toString()) {
    throw new Error('This offer belongs to this browser. Scan it with the second browser instead')
  }

  const peerConnection = new RTCPeerConnection(getRtcConfiguration())
  const addr = remoteAddress(offerPayload.peerId)
  // This peer answered the offer, so it is the inbound side of the session.
  const upgradeContext = createWebRTCUpgradeContext(node.components, peerConnection, addr, {
    direction: 'inbound'
  })

  inboundPeerConnections.add(peerConnection)
  peerConnection.addEventListener('connectionstatechange', () => {
    if (peerConnection.connectionState === 'connected') {
      setStatus(`WebRTC connected to ${offerPayload.peerId}`)
    }

    if (peerConnection.connectionState === 'closed') {
      inboundPeerConnections.delete(peerConnection)
    }
  })

  try {
    await peerConnection.setRemoteDescription({
      type: 'offer',
      sdp: offerPayload.sdp
    })

    const answer = await peerConnection.createAnswer()
    await peerConnection.setLocalDescription(answer)
    await waitForIceGatheringComplete(peerConnection)

    if (peerConnection.localDescription == null) {
      throw new Error('WebRTC did not create an SDP answer')
    }

    // Upgrade only once the WebRTC connection is actually up. The offering peer
    // does not attach its own muxer until it scans this answer, so upgrading
    // any earlier means our identify stream is written into a connection with
    // nothing on the other end - which tears the whole session down.
    const upgraded = waitForConnected(peerConnection, ANSWER_WAIT_TIMEOUT)
      .then(async () => {
        await node.components.upgrader.upgradeInbound(upgradeContext.connection, {
          skipEncryption: true,
          skipProtection: true,
          // Skipping encryption means no handshake tells libp2p who the remote
          // is, so it insists on being told. The peer id comes from the offer
          // whose signature we just verified - that is what makes it safe.
          remotePeer: peerIdFromString(offerPayload.peerId),
          muxerFactory: upgradeContext.muxerFactory,
          signal: AbortSignal.timeout(CONNECTION_TIMEOUT)
        })

        watchConnection(offerPayload.peerId, peerConnection)
        setStatus(`Connected to ${offerPayload.peerId}`)
      })

    upgraded.catch(error => {
      if (peerConnection.connectionState === 'failed') {
        appendLog(`ICE candidates - ${describeIce(peerConnection)}`)
      }

      inboundPeerConnections.delete(peerConnection)
      peerConnection.close()
      setStatus(/timed out/i.test(error.message)
        ? 'They never opened your reply, so this attempt expired. Ask them for a fresh invite link.'
        : explain(error))
      appendLog(`Inbound upgrade failed: ${error.message}`)
    })

    return signPayload({
      version: PAYLOAD_VERSION,
      type: QR_TYPE_ANSWER,
      sessionId: offerPayload.sessionId,
      peerId: node.peerId.toString(),
      offerPeerId: offerPayload.peerId,
      sdp: peerConnection.localDescription.sdp
    })
  } catch (error) {
    inboundPeerConnections.delete(peerConnection)
    peerConnection.close()
    throw error
  }
}

async function acceptAnswerPayload (text) {
  if (node == null || offerSessions.size === 0) {
    throw new Error('Create an offer before accepting an answer')
  }

  const answerPayload = await parseAndVerifyPayload(text, QR_TYPE_ANSWER)

  if (answerPayload.peerId === node.peerId.toString()) {
    throw new Error('This answer belongs to this browser. Use the answer QR created by the second browser')
  }

  const session = offerSessions.get(answerPayload.sessionId)

  if (session == null) {
    throw new Error('The answer belongs to a different QR session')
  }

  if (answerPayload.offerPeerId !== node.peerId.toString()) {
    throw new Error('The answer was not created for this peer')
  }

  const ageSeconds = Math.round((Date.now() - session.createdAt) / 1000)
  appendLog(`Reply arrived ${ageSeconds}s after the invite was created.`)

  await session.peerConnection.setRemoteDescription({
    type: 'answer',
    sdp: answerPayload.sdp
  })

  try {
    await waitForConnected(session.peerConnection)
  } catch (error) {
    // A NAT keeps a UDP binding open for as long as packets flow through it -
    // often well under two minutes. The candidates in an invite that sat in a
    // chat can point at bindings that no longer exist, and the connection then
    // fails with signalling that went through perfectly.
    throw ageSeconds > 90
      ? new Error(`WebRTC connection failed after the invite sat for ${ageSeconds}s - it was probably too old. Create a new invite and send it straight away.`)
      : error
  }
  session.initDataChannel.close()

  const addr = remoteAddress(answerPayload.peerId)
  session.remotePeerId = answerPayload.peerId
  session.upgradeContext = createWebRTCUpgradeContext(
    node.components,
    session.peerConnection,
    addr,
    { direction: 'outbound' }
  )

  const stream = await dialChatStream(addr)

  watchConnection(answerPayload.peerId, session.peerConnection)
  attachChatStream(stream, answerPayload.peerId, `Connected to ${shortPeer(answerPayload.peerId)}.`)
  setStatus(`Connected to ${answerPayload.peerId}`)

  return addr.toString()
}

/**
 * Both peers reach the WebRTC `connected` state at the same moment, but the
 * answering peer still has to attach its libp2p muxer. A stream opened into
 * that gap negotiates and is then reset, so retry until one stays open.
 */
async function dialChatStream (addr, attempts = 15) {
  let lastError = new Error('The remote peer never accepted a chat stream')

  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      const stream = await node.dialProtocol(addr, CHAT_PROTOCOL, {
        signal: AbortSignal.timeout(CONNECTION_TIMEOUT)
      })

      await new Promise(resolve => setTimeout(resolve, 200))

      if (stream.status === 'open') {
        return stream
      }

      lastError = new Error(`Chat stream was ${stream.status} right after opening`)
    } catch (error) {
      lastError = error
    }

    await new Promise(resolve => setTimeout(resolve, 300))
  }

  throw lastError
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
function renderPeers () {
  // Every path that gains or loses a peer ends up here, which makes it the one
  // place the wake lock has to be kept in step with.
  syncWakeLock(chatStreams.size > 0)

  peerListEl.replaceChildren()

  for (const peerId of chatStreams.keys()) {
    const row = document.createElement('div')
    row.className = 'peer-row'
    row.dataset.peer = peerId

    const name = document.createElement('span')
    name.className = 'peer-name'
    name.textContent = shortPeer(peerId)
    name.title = peerId

    const state = peerConnections.get(peerId)?.connectionState ?? 'connected'
    const health = document.createElement('span')
    health.className = `peer-health is-${state}`
    health.textContent = state === 'disconnected' ? 'reconnecting…' : state

    const drop = document.createElement('button')
    drop.type = 'button'
    drop.className = 'peer-drop'
    drop.textContent = 'Disconnect'
    drop.setAttribute('aria-label', `Disconnect from ${peerId}`)
    drop.addEventListener('click', () => {
      // Closing only the stream left the WebRTC connection open behind it.
      intentionalDrops.add(peerId)
      chatStreams.get(peerId)?.close().catch(() => {})
      peerConnections.get(peerId)?.close()
    })

    row.append(name, health, drop)
    peerListEl.appendChild(row)
  }

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
/**
 * Close what libp2p still believes it has to a peer.
 *
 * A dead `RTCPeerConnection` leaves the libp2p connection on top of it
 * registered, and since the Peer ID now survives a reload, the peer coming back
 * arrives under the *same* id. libp2p then matches the new session against the
 * stale one and the dial dies with "Remote closed connection during opening" -
 * a failure that could not happen while every reconnect brought a new identity.
 */
function dropStaleConnections (peerId) {
  for (const connection of node?.getConnections() ?? []) {
    if (connection.remotePeer.toString() === peerId) {
      connection.close().catch(() => {})
    }
  }

  // And the session that produced it, or the map grows a dead entry per drop
  // and `getOutboundSession` has more to sift through on every dial.
  for (const [sessionId, session] of offerSessions) {
    if (session.remotePeerId === peerId) {
      session.peerConnection?.close()
      offerSessions.delete(sessionId)
    }
  }
}

function resumeAfterLoss (peerId) {
  meshAttempts.delete(peerId)

  // The stream's own cleanup runs when its read loop unwinds, which is later
  // than this. Until it does, `meshConnect` would see the peer as still
  // connected and decline to do anything - so record the truth now.
  chatStreams.delete(peerId)
  dropStaleConnections(peerId)
  renderPeers()

  const routes = [...chatStreams.keys()].filter(id => id !== peerId)

  if (routes.length === 0) {
    // Nothing left to signal over. Every automatic path needs a live connection
    // somewhere, so this one genuinely has to go back through a human.
    setStatus(`Lost the connection to ${shortPeer(peerId)} - reconnect below.`)
    offerReconnect(peerId)
    return
  }

  // Both ends see the drop, so without an order both would offer at once. The
  // same rule as first contact decides it, and the other side simply waits.
  if (!shouldInitiateTo(peerId)) {
    appendLog(`Lost ${shortPeer(peerId)} - waiting for them to come back through the mesh.`)
    return
  }

  setStatus(`Lost ${shortPeer(peerId)} - putting the connection back through the others…`)
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
    setStatus(`Could not reach ${shortPeer(target)} through anyone still connected - reconnect below.`)
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
          dropStaleConnections(parsed.peerId)
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
      appendLog(`${shortPeer(from)} is offering ${message.name} (${message.size} bytes)`)
      receiveFile(message).catch(error => {
        appendLog(`Could not fetch ${message.name}: ${error.message}`)
      })
      continue
    }

    testState.lastReceivedMessage = message.text
    testState.receivedMessages.push({ from, text: message.text })
    appendLog(`${shortPeer(from)}: ${message.text}`)
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
  appendLog(`You: ${message}`)
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
    return 'This invite is probably too old to connect - create a new one.'
  }

  return `This invite stays fresh for about ${Math.ceil(remaining / 60000)} more minute(s).`
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
  inviteBoxEl.hidden = false
  startInviteCountdown()

  stopQrAnimation()

  if (link.length > MAX_QR_PAYLOAD_LENGTH) {
    qrImage.style.display = 'none'
    appendLog('Link is too long for a reliable QR code - send it as a link instead.')
    return link
  }

  if (needsAnimation(link)) {
    await startQrAnimation(link)
    appendLog(`QR payload size: ${payload.length} characters - shown as an animated sequence.`)
    return link
  }

  qrImage.src = await QRCode.toDataURL(link, QR_RENDER_OPTIONS)
  qrImage.style.display = 'block'
  appendLog(`QR payload size: ${payload.length} characters.`)

  return link
}

/**
 * Cycle BC-UR frames on the displayed code.
 *
 * Frames are rendered up front rather than inside the tick: encoding a QR to a
 * data URL takes long enough that doing it per tick makes the sequence stutter,
 * and a stuttering sequence is one a camera misses parts of. Fountain frames
 * beyond the pure ones are added as the loop runs, up to a ceiling, so a
 * scanner that joined late has something to catch without the cache growing
 * without bound.
 */
async function startQrAnimation (link) {
  const source = await createFrameSource(link)
  const rendered = [await QRCode.toDataURL(source.next(), QR_RENDER_OPTIONS)]
  const ceiling = source.total * 2
  let index = 0

  qrImage.src = rendered[0]
  qrImage.style.display = 'block'
  qrFrameEl.hidden = false
  qrFrameEl.textContent = `Part 1 of ${source.total} — hold the phone still`

  const tick = async () => {
    index++

    if (index >= rendered.length && rendered.length < ceiling) {
      rendered.push(await QRCode.toDataURL(source.next(), QR_RENDER_OPTIONS))
    }

    const slot = index % rendered.length

    qrImage.src = rendered[slot]
    qrFrameEl.textContent = slot < source.total
      ? `Part ${slot + 1} of ${source.total} — hold the phone still`
      : 'Recovery frame — hold the phone still'
  }

  qrAnimationTimer = setInterval(() => { tick() }, FRAME_INTERVAL_MS)
}

function stopQrAnimation () {
  if (qrAnimationTimer != null) {
    clearInterval(qrAnimationTimer)
    qrAnimationTimer = null
  }

  qrFrameEl.hidden = true
}

async function handleReceivedPayload (input, expectedType) {
  const text = payloadFrom(input)
  const parsed = await parsePayload(text)
  const type = expectedType ?? parsed.type

  if (type === QR_TYPE_OFFER) {
    const answerPayload = await acceptOfferPayload(text)
    await renderOutbound(answerPayload, QR_TYPE_ANSWER)
    setStatus('Verified. Send the reply link back and keep this tab open.')
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
  createOfferButton.disabled = !started
  createOfferAgainButton.disabled = !started
  scanOfferButton.disabled = !started
  scanAnswerButton.disabled = !started || offerSessions.size === 0
  processPayloadButton.disabled = !started || payloadFrom(payloadDisplay.value).length === 0
  copyPayloadButton.disabled = inviteLinkEl.value.length === 0
}

async function startQrScanner (expectedType) {
  if (navigator.mediaDevices?.getUserMedia == null) {
    throw new Error('Camera access is not supported by this browser')
  }

  stopQrScanner()
  const sessionId = scanSessionId
  scanMode = expectedType
  scanAttempts = 0
  lastScanTime = 0
  barcodeDetector = null

  if ('BarcodeDetector' in window) {
    try {
      barcodeDetector = new window.BarcodeDetector({ formats: ['qr_code'] })
    } catch {}
  }

  try {
    scanStatus.textContent = `Starting camera for the ${expectedType} QR code…`
    const mediaStream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: { ideal: 'environment' },
        width: { ideal: 1280 },
        height: { ideal: 720 },
        frameRate: { ideal: 30, max: 30 }
      },
      audio: false
    })

    if (sessionId !== scanSessionId) {
      mediaStream.getTracks().forEach(track => track.stop())
      return
    }

    scanStream = mediaStream
    const videoTrack = scanStream.getVideoTracks()[0]
    const capabilities = videoTrack?.getCapabilities?.()

    if (capabilities?.focusMode?.includes('continuous')) {
      await videoTrack.applyConstraints({
        advanced: [{ focusMode: 'continuous' }]
      }).catch(() => {})
    }

    qrVideo.srcObject = scanStream
    qrVideo.style.display = 'block'
    stopScanButton.style.display = 'inline-block'
    await qrVideo.play()
    scanStatus.textContent = `Looking for the ${expectedType} QR code… Hold it steady and fill about half of the frame.`
    scheduleNextScan(sessionId)
  } catch (error) {
    if (sessionId !== scanSessionId) {
      return
    }

    stopQrScanner()
    scanMode = null
    throw error
  }
}

function stopQrScanner ({ clearStatus = true } = {}) {
  scanSessionId++

  if (scanAnimationFrame != null) {
    cancelAnimationFrame(scanAnimationFrame)
    scanAnimationFrame = null
  }

  scanStream?.getTracks().forEach(track => track.stop())
  scanStream = null
  qrVideo.srcObject = null
  qrVideo.style.display = 'none'
  stopScanButton.style.display = 'none'
  barcodeDetector = null
  scanAttempts = 0
  lastScanTime = 0

  // Half a sequence is worthless to the next scan, and keeping it would make a
  // fresh invite look like it was already partly received.
  partAccumulator?.reset()
  receivingParts = false

  if (clearStatus) {
    scanStatus.textContent = ''
  }
}

function scheduleNextScan (sessionId) {
  if (scanStream != null && sessionId === scanSessionId) {
    scanAnimationFrame = requestAnimationFrame(timestamp => scanLoop(timestamp, sessionId))
  }
}

async function scanLoop (timestamp, sessionId) {
  if (sessionId !== scanSessionId) {
    return
  }

  if (scanStream == null || qrVideo.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
    scheduleNextScan(sessionId)
    return
  }

  if (timestamp - lastScanTime < SCAN_INTERVAL) {
    scheduleNextScan(sessionId)
    return
  }

  lastScanTime = timestamp
  scanAttempts++

  // Not while a sequence is coming in. Reading an animated code takes many
  // attempts by design, so the nudge fires constantly - and "move a little
  // closer" is exactly the wrong advice for someone whose scan is going fine.
  // It also stamps over the part counter they are watching.
  if (scanAttempts % 8 === 0 && !receivingParts) {
    scanStatus.textContent = `Still looking… ${scanAttempts} attempts. Move a little closer, hold steady, and avoid reflections.`
  }

  let decodedText = null

  if (barcodeDetector != null) {
    try {
      const codes = await barcodeDetector.detect(qrVideo)
      decodedText = codes.find(code => code.format === 'qr_code')?.rawValue ?? codes[0]?.rawValue ?? null
    } catch {
      barcodeDetector = null
    }
  }

  if (sessionId !== scanSessionId) {
    return
  }

  if (decodedText == null) {
    const scale = Math.min(1, SCAN_CANVAS_MAX_WIDTH / qrVideo.videoWidth)
    qrCanvas.width = Math.max(1, Math.round(qrVideo.videoWidth * scale))
    qrCanvas.height = Math.max(1, Math.round(qrVideo.videoHeight * scale))
    qrCanvasContext.drawImage(qrVideo, 0, 0, qrCanvas.width, qrCanvas.height)

    const image = qrCanvasContext.getImageData(0, 0, qrCanvas.width, qrCanvas.height)
    const result = jsQR(image.data, image.width, image.height, {
      inversionAttempts: 'attemptBoth'
    })
    decodedText = result?.data ?? null
  }

  // A multi-frame invite arrives one part at a time, and no single part is a
  // payload. Feed them to the accumulator and keep the camera running until the
  // message is whole - only then does it go down the normal path, which cannot
  // tell it was ever split.
  if (decodedText != null && looksLikeUrPart(decodedText)) {
    partAccumulator = partAccumulator ?? await createPartAccumulator()

    const progress = partAccumulator.receive(decodedText)

    if (sessionId !== scanSessionId) {
      return
    }

    if (progress.state === 'complete') {
      receivingParts = false
      decodedText = progress.payload
    } else {
      receivingParts = true
      scanStatus.textContent = progress.total > 0
        ? `Animated code: ${progress.received} of ${progress.total} parts. Keep holding steady.`
        : 'Animated code detected. Keep holding steady.'
      scheduleNextScan(sessionId)
      return
    }
  }

  if (decodedText != null) {
    const expectedType = scanMode
    const classified = await classifyScanned(decodedText, expectedType)

    if (!classified.ok) {
      scanStatus.textContent = classified.reason
      scheduleNextScan(sessionId)
      return
    }

    stopQrScanner({ clearStatus: false })
    scanMode = null
    scanStatus.textContent = 'Correct QR type detected. Verifying signature…'

    try {
      await handleReceivedPayload(classified.payloadText, expectedType)
      scanStatus.textContent = 'QR accepted.'
      updateControls()
    } catch (error) {
      scanStatus.textContent = `QR detected, but rejected: ${error.message}`
      setStatus(`QR processing failed: ${error.message}`)
      appendLog(`QR processing failed: ${error.message}`)
    }
    return
  }

  scheduleNextScan(sessionId)
}

startButton.addEventListener('click', async () => {
  startButton.disabled = true

  try {
    await createNode()
  } catch (error) {
    startButton.disabled = false
    setStatus(`Start failed: ${error.message}`)
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
  // Clear the previous link first. Gathering ICE takes seconds, and a stale
  // link sitting in the box the whole time is one someone will copy and send.
  inviteLinkEl.value = ''
  qrImage.style.display = 'none'
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
    setStatus('Invite ready. Send the link, then keep this tab open until they reply.')
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

// Reachable without reopening the folded card: once connected, inviting the
// next person is the natural next thing, not a step you have to go back for.
document.getElementById('invite-another').addEventListener('click', () => {
  setStepsCollapsed(false)
  document.getElementById('step-connect').scrollIntoView({ block: 'start', behavior: 'smooth' })
  createInvite(createOfferButton)
})

scanOfferButton.addEventListener('click', () => {
  startQrScanner(QR_TYPE_OFFER).catch(error => {
    setStatus(`Camera failed: ${error.message}`)
  })
})

scanAnswerButton.addEventListener('click', () => {
  startQrScanner(QR_TYPE_ANSWER).catch(error => {
    setStatus(`Camera failed: ${error.message}`)
  })
})

stopScanButton.addEventListener('click', () => {
  stopQrScanner()
  scanMode = null
  setStatus('QR scan cancelled.')
})

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
  const result = await shareOrCopy(inviteLinkEl.value, 'invite link')

  if (result === 'copied') {
    setStatus('Link copied. Paste it into your chat with the other person.')
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
 * Coming back from the background is the moment to say what happened. Phones
 * suspend timers and let radios sleep, so a connection can be mid-recovery, or
 * already gone, and the page would otherwise sit there looking fine.
 */
document.addEventListener('visibilitychange', () => {
  // The browser drops the wake lock whenever the page stops being visible, so
  // coming back has to ask for it again - and going away has to stop wanting it.
  syncWakeLock(document.visibilityState === 'visible' && chatStreams.size > 0)

  if (document.visibilityState !== 'visible') {
    return
  }

  renderPeers()

  const lost = [...chatStreams.keys()].filter(peerId => {
    const state = peerConnections.get(peerId)?.connectionState

    return state === 'failed' || state === 'closed'
  })

  if (lost.length > 0) {
    setStatus(`${lost.length === 1 ? 'A connection was' : `${lost.length} connections were`} lost while you were away - create a new invite to reconnect.`)
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
  wakeLockState,
  // Exposed so the LED truth table can be asserted without depending on the
  // network the test happens to run on.
  summariseNetwork: (ipv4State, ipv6State) =>
    summariseNetwork({ state: ipv4State, text: '' }, { state: ipv6State, text: '' }),
  isGlobalUnicastV6,
  createOfferPayload,
  acceptOfferPayload,
  acceptAnswerPayload,
  decodePayload: async text => parsePayload(text),
  encodePayload: payload => compress(JSON.stringify(payload)),
  decodeQrDataUrl: async dataUrl => {
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

  if (kind !== 'reply' || offerSessions.size === 0) {
    return
  }

  handoff.postMessage({ kind: 'reply-taken' })
  appendLog('A reply arrived from another tab.')
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
    setStatus('Reply handed to the tab where you created the invite.')
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
    await createNode()
    await useIncoming(incoming)
  } catch (error) {
    setStatus(explain(error))
    appendLog(`Opening the link failed: ${error.message}`)
  }
}

consumeLink()
