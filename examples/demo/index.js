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

const qrCanvas = document.createElement('canvas')
const qrCanvasContext = qrCanvas.getContext('2d', { willReadFrequently: true })

let node = null
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
  receivedMessages: []
}

function appendLog (text) {
  const line = document.createElement('div')
  line.textContent = text
  chatLogEl.appendChild(line)
  chatLogEl.scrollTop = chatLogEl.scrollHeight
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

  readChatMessages(stream).catch(error => {
    appendLog(`Chat stream closed: ${error.message}`)
  })
}

// libp2p 3 streams are message streams: iterate them for reads, `send()` for
// writes. The old source/sink duplex - and the it-byte-stream wrapper around
// it - is gone.
async function readChatMessages (stream) {
  for await (const data of stream) {
    const message = toString(data.subarray())
    testState.lastReceivedMessage = message
    testState.receivedMessages.push(message)
    appendLog(`Received: ${message}`)
  }
}

async function sendMessage (message) {
  if (chatStream == null) {
    throw new Error('No active chat stream')
  }

  await chatStream.send(fromString(message))
  appendLog(`Sent: ${message}`)
}

async function renderPayload (text) {
  payloadDisplay.value = text

  if (text.length > MAX_QR_PAYLOAD_LENGTH) {
    qrImage.style.display = 'none'
    appendLog('Payload is too large for a reliable QR code. Use copy/paste instead.')
    return
  }

  qrImage.src = await QRCode.toDataURL(text, {
    errorCorrectionLevel: 'M',
    margin: 4,
    width: 768
  })
  qrImage.style.display = 'block'
  appendLog(`QR payload size: ${text.length} characters.`)
}

async function handleReceivedPayload (text, expectedType) {
  const parsed = await parsePayload(text)
  const type = expectedType ?? parsed.type

  if (type === QR_TYPE_OFFER) {
    const answerPayload = await acceptOfferPayload(text)
    await renderPayload(answerPayload)
    setStatus('Answer created. Return this QR to the offering browser.')
    appendLog('Verified offer and created a signed answer.')
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
  scanOfferButton.disabled = !started
  scanAnswerButton.disabled = !started || currentOfferSession == null
  processPayloadButton.disabled = !started
  copyPayloadButton.disabled = payloadDisplay.value.length === 0
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

createOfferButton.addEventListener('click', async () => {
  try {
    const payload = await createOfferPayload()
    await renderPayload(payload)
    setStatus('Offer created. Show this QR to the other browser.')
    appendLog('Created a signed WebRTC offer.')
    updateControls()
  } catch (error) {
    setStatus(`Offer failed: ${error.message}`)
    appendLog(`Offer failed: ${error.message}`)
  }
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

processPayloadButton.addEventListener('click', async () => {
  try {
    await handleReceivedPayload(payloadDisplay.value.trim())
    updateControls()
  } catch (error) {
    setStatus(`Payload failed: ${error.message}`)
    appendLog(`Payload failed: ${error.message}`)
  }
})

copyPayloadButton.addEventListener('click', async () => {
  await navigator.clipboard.writeText(payloadDisplay.value)
  appendLog('Payload copied to clipboard.')
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
