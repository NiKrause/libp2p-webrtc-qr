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
const MAX_QR_PAYLOAD_LENGTH = 2200
const SCAN_INTERVAL = 140
const SCAN_CANVAS_MAX_WIDTH = 960

const RTC_CONFIGURATION = {
  iceServers: [
    { urls: 'stun:stun.cloudflare.com:3478' },
    { urls: 'stun:stun.l.google.com:19302' }
  ]
}

const statusEl = document.getElementById('status')
const peerIdEl = document.getElementById('peer-id')
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
const qrVideo = document.getElementById('qr-video')
const scanStatus = document.getElementById('scan-status')
const dropZone = document.getElementById('drop-zone')
const fileInput = document.getElementById('file-input')
const receivedFilesEl = document.getElementById('received-files')
const inviteBoxEl = document.getElementById('invite-box')
const inviteLinkEl = document.getElementById('invite-link')
const inviteFreshnessEl = document.getElementById('invite-freshness')
const createOfferAgainButton = document.getElementById('create-offer-again')

const qrCanvas = document.createElement('canvas')
const qrCanvasContext = qrCanvas.getContext('2d', { willReadFrequently: true })

let node = null
let helia = null
let fs = null
let chatStream = null
let currentOfferSession = null
let scanStream = null
let scanAnimationFrame = null
let scanMode = null
let lastScanTime = 0
let scanAttempts = 0
let barcodeDetector = null
let scanSessionId = 0

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

function getRtcConfiguration () {
  if (new URLSearchParams(window.location.search).get('ice') === 'host') {
    return { iceServers: [] }
  }

  return RTC_CONFIGURATION
}

function remoteAddress (peerId) {
  return multiaddr(`/webrtc/p2p/${peerId}`)
}

function getOutboundSession (remotePeerId) {
  if (currentOfferSession?.remotePeerId !== remotePeerId) {
    return null
  }

  return currentOfferSession.upgradeContext
}

async function signPayload (payload) {
  return encodeSignedPayload(node.components.privateKey, payload)
}

async function parseAndVerifyPayload (text, expectedType) {
  return decodeSignedPayload(text, expectedType)
}

async function createNode () {
  if (node != null) {
    return node
  }

  node = await createLibp2p({
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
    attachChatStream(stream, `Incoming chat stream from ${connection.remotePeer}`)
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

  peerIdEl.textContent = node.peerId.toString()
  setStatus('Browser client started. Create or scan an offer.')
  appendLog(`Started libp2p peer ${node.peerId}`)
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

async function waitForConnected (peerConnection) {
  if (peerConnection.connectionState === 'connected') {
    return
  }

  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup()
      reject(new Error('WebRTC connection timed out'))
    }, CONNECTION_TIMEOUT)

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

  currentOfferSession?.peerConnection.close()

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

  currentOfferSession = {
    sessionId,
    peerConnection,
    initDataChannel,
    remotePeerId: null,
    upgradeContext: null
  }

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
    const upgraded = waitForConnected(peerConnection)
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

        setStatus(`Connected to ${offerPayload.peerId}`)
      })

    upgraded.catch(error => {
      inboundPeerConnections.delete(peerConnection)
      peerConnection.close()
      setStatus(`Connection failed: ${error.message}`)
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
  if (node == null || currentOfferSession == null) {
    throw new Error('Create an offer before accepting an answer')
  }

  const answerPayload = await parseAndVerifyPayload(text, QR_TYPE_ANSWER)

  if (answerPayload.peerId === node.peerId.toString()) {
    throw new Error('This answer belongs to this browser. Use the answer QR created by the second browser')
  }

  if (answerPayload.sessionId !== currentOfferSession.sessionId) {
    throw new Error('The answer belongs to a different QR session')
  }

  if (answerPayload.offerPeerId !== node.peerId.toString()) {
    throw new Error('The answer was not created for this peer')
  }

  await currentOfferSession.peerConnection.setRemoteDescription({
    type: 'answer',
    sdp: answerPayload.sdp
  })
  await waitForConnected(currentOfferSession.peerConnection)
  currentOfferSession.initDataChannel.close()

  const addr = remoteAddress(answerPayload.peerId)
  currentOfferSession.remotePeerId = answerPayload.peerId
  currentOfferSession.upgradeContext = createWebRTCUpgradeContext(
    node.components,
    currentOfferSession.peerConnection,
    addr,
    { direction: 'outbound' }
  )

  const stream = await dialChatStream(addr)

  attachChatStream(stream, `Outgoing chat stream to ${answerPayload.peerId}`)
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

function attachChatStream (stream, message) {
  chatStream = stream
  appendLog(message)
  sendButton.disabled = false
  setDropZoneEnabled(true)

  readChatMessages(stream).catch(error => {
    appendLog(`Chat stream closed: ${error.message}`)
    setDropZoneEnabled(false)
  })
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
async function readChatMessages (stream) {
  for await (const data of stream) {
    const raw = toString(data.subarray())
    let message

    try {
      message = JSON.parse(raw)
    } catch {
      appendLog(`Received an unreadable message: ${raw.slice(0, 80)}`)
      continue
    }

    if (message.kind === 'file') {
      appendLog(`Received a file announcement: ${message.name} (${message.size} bytes)`)
      receiveFile(message).catch(error => {
        appendLog(`Could not fetch ${message.name}: ${error.message}`)
      })
      continue
    }

    testState.lastReceivedMessage = message.text
    testState.receivedMessages.push(message.text)
    appendLog(`Received: ${message.text}`)
  }
}

async function sendMessage (message) {
  if (chatStream == null) {
    throw new Error('No active chat stream')
  }

  await chatStream.send(envelope({ kind: 'text', text: message }))
  appendLog(`Sent: ${message}`)
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
  if (chatStream == null) {
    throw new Error('Connect to a peer before sending a file')
  }

  if (file.size > MAX_FILE_BYTES) {
    throw new Error(`${file.name} is larger than ${formatBytes(MAX_FILE_BYTES)}`)
  }

  const bytes = new Uint8Array(await file.arrayBuffer())
  const cid = await fs.addBytes(bytes)

  await chatStream.send(envelope({
    kind: 'file',
    cid: cid.toString(),
    name: file.name,
    size: bytes.byteLength,
    mime: file.type || 'application/octet-stream'
  }))

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

  if (link.length > MAX_QR_PAYLOAD_LENGTH) {
    qrImage.style.display = 'none'
    appendLog('Link is too long for a reliable QR code - send it as a link instead.')
    return link
  }

  qrImage.src = await QRCode.toDataURL(link, {
    errorCorrectionLevel: 'M',
    margin: 4,
    width: 1280
  })
  qrImage.style.display = 'block'
  appendLog(`QR payload size: ${payload.length} characters.`)

  return link
}

async function handleReceivedPayload (input, expectedType) {
  const text = payloadFrom(input)
  const parsed = await parsePayload(text)
  const type = expectedType ?? parsed.type

  if (type === QR_TYPE_OFFER) {
    const answerPayload = await acceptOfferPayload(text)
    await renderOutbound(answerPayload, QR_TYPE_ANSWER)
    setStatus('Answer created. Send the link below back to them.')
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
  scanAnswerButton.disabled = !started || currentOfferSession == null
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

  if (scanAttempts % 8 === 0) {
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

  if (decodedText != null) {
    const expectedType = scanMode

    try {
      const payload = await parsePayload(decodedText)

      if (payload.type !== expectedType) {
        scanStatus.textContent = `Detected a ${payload.type ?? 'different'} QR, but this browser is waiting for an ${expectedType}. Keep scanning the QR created by the other browser.`
        scheduleNextScan(sessionId)
        return
      }
    } catch {
      scanStatus.textContent = `A QR code was detected, but it is not a libp2p ${expectedType} payload. Keep scanning.`
      scheduleNextScan(sessionId)
      return
    }

    stopQrScanner({ clearStatus: false })
    scanMode = null
    scanStatus.textContent = 'Correct QR type detected. Verifying signature…'

    try {
      await handleReceivedPayload(decodedText, expectedType)
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

async function createInvite (button) {
  // Gathering ICE candidates can take seconds, and until it finishes there is
  // nothing on screen. Without a pending state the button looks like it was
  // never pressed, so people press it again.
  setButtonBusy(button, 'Creating link…')

  try {
    const payload = await createOfferPayload()
    await renderOutbound(payload, QR_TYPE_OFFER)
    setStatus('Invite ready. Send the link to the other person.')
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

sendButton.addEventListener('click', async () => {
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
})

// Drag and drop, with the whole zone as a click target for keyboard and mobile.
;['dragenter', 'dragover'].forEach(name => {
  dropZone.addEventListener(name, event => {
    event.preventDefault()

    if (chatStream != null) {
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
  if (chatStream != null) {
    fileInput.click()
  }
})

dropZone.addEventListener('keydown', event => {
  if ((event.key === 'Enter' || event.key === ' ') && chatStream != null) {
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

window.addEventListener('beforeunload', () => {
  stopQrScanner()
  currentOfferSession?.peerConnection.close()
  inboundPeerConnections.forEach(peerConnection => peerConnection.close())

  if (node != null) {
    node.stop().catch(() => {})
  }
})

window.__libp2pQrTest = {
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
  getReceivedMessages: () => [...testState.receivedMessages],
  getConnections: () => node?.getConnections().length ?? 0,
  debugStream: () => chatStream == null
    ? null
    : {
        status: chatStream.status,
        readStatus: chatStream.readStatus,
        writeStatus: chatStream.writeStatus,
        protocol: chatStream.protocol
      }
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

  if (kind !== 'reply' || currentOfferSession == null) {
    return
  }

  handoff.postMessage({ kind: 'reply-taken' })
  appendLog('A reply arrived from another tab.')
  await useIncoming(payload)
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
    setStatus('Reply handed to the tab where you created the invite - switch back to it.')
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
