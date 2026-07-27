import { identify, identifyPush } from '@libp2p/identify'
import { peerIdFromString } from '@libp2p/peer-id'
import { multiaddr } from '@multiformats/multiaddr'
import { withBitswap } from '@helia/bitswap'
import { unixfs } from '@helia/unixfs'
import { withLibp2p } from '@helia/libp2p'
import { createHeliaLight } from 'helia'
import { createLibp2p } from 'libp2p'
import { fromString, toString } from 'uint8arrays'
import {
  createWebRTCUpgradeContext,
  decodeSignedPayload,
  encodeSignedPayload,
  parsePayload,
  webRTCQR,
  PAYLOAD_VERSION,
  QR_TYPE_ANSWER,
  QR_TYPE_OFFER
} from '@le-space/libp2p-webrtc-qr'

const ICE_GATHERING_TIMEOUT = 15000
const CONNECTION_TIMEOUT = 30000

const statusEl = document.getElementById('status')
const peerIdEl = document.getElementById('peer-id')
const logEl = document.getElementById('log')
const payloadEl = document.getElementById('payload')
const fileInput = document.getElementById('file')
const cidInput = document.getElementById('cid')
const contentEl = document.getElementById('content')

let node = null
let helia = null
let fs = null
let offerSession = null

const inboundPeerConnections = new Set()
const testState = { lastFetched: null }

function log (text) {
  const line = document.createElement('div')
  line.textContent = text
  logEl.appendChild(line)
  logEl.scrollTop = logEl.scrollHeight
}

function setStatus (text) {
  statusEl.textContent = text
  statusEl.classList.toggle('is-live', /connected/i.test(text))
  statusEl.classList.toggle('is-error', /failed|timed out/i.test(text))
}

// Host candidates only keeps the example deterministic on a LAN and in CI.
function rtcConfiguration () {
  return new URLSearchParams(window.location.search).get('ice') === 'host'
    ? { iceServers: [] }
    : { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] }
}

function addressFor (peerId) {
  return multiaddr(`/webrtc/p2p/${peerId}`)
}

function outboundSessionFor (remotePeerId) {
  return offerSession?.remotePeerId === remotePeerId ? offerSession.upgradeContext : null
}

async function start () {
  if (node != null) {
    return node
  }

  node = await createLibp2p({
    transports: [webRTCQR({ getOutboundSession: outboundSessionFor })],
    services: {
      identify: identify(),
      identifyPush: identifyPush()
    }
  })

  // Helia rides on the libp2p node the QR session built - bitswap has no idea
  // the connection was negotiated by scanning a code.
  //
  // Composed by hand rather than with `createHelia`, and that is the point of
  // this example. `createHelia` is `withBitswap(withLibp2p(withHTTP(...)))` - the
  // HTTP layer adds trustless gateways and a delegated routing endpoint, so a
  // file would be fetched over the public internet and prove nothing about the
  // peer-to-peer connection. Dropping `withHTTP` leaves bitswap over libp2p as
  // the only way to get a block, and the QR peer as the only peer to get it
  // from.
  // withLibp2p takes the node as its second argument - passing it in the
  // createHeliaLight init instead leaves Helia building its own libp2p.
  helia = withBitswap(withLibp2p(createHeliaLight(), node))
  // The mixins only attach their brokers while the node is starting, and
  // createHeliaLight hands back a node that has not started yet.
  await helia.start()
  fs = unixfs(helia)

  peerIdEl.textContent = node.peerId.toString()
  setStatus('Helia node started. Create or paste an offer.')
  log(`Started Helia on libp2p peer ${node.peerId}`)

  return node
}

async function waitForIceGathering (peerConnection) {
  if (peerConnection.iceGatheringState === 'complete') {
    return
  }

  await new Promise(resolve => {
    const timeout = setTimeout(done, ICE_GATHERING_TIMEOUT)

    function done () {
      clearTimeout(timeout)
      peerConnection.removeEventListener('icegatheringstatechange', onChange)
      resolve()
    }

    function onChange () {
      if (peerConnection.iceGatheringState === 'complete') {
        done()
      }
    }

    peerConnection.addEventListener('icegatheringstatechange', onChange)
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
      peerConnection.removeEventListener('connectionstatechange', onChange)
    }

    function onChange () {
      if (peerConnection.connectionState === 'connected') {
        cleanup()
        resolve()
      } else if (['failed', 'closed'].includes(peerConnection.connectionState)) {
        cleanup()
        reject(new Error(`WebRTC connection entered state ${peerConnection.connectionState}`))
      }
    }

    peerConnection.addEventListener('connectionstatechange', onChange)
  })
}

async function createOffer () {
  await start()
  offerSession?.peerConnection.close()

  const peerConnection = new RTCPeerConnection(rtcConfiguration())
  const sessionId = crypto.randomUUID()
  // Negotiated so the remote muxer never adopts this unframed channel.
  const initDataChannel = peerConnection.createDataChannel('init', { negotiated: true, id: 1023 })

  await peerConnection.setLocalDescription(await peerConnection.createOffer())
  await waitForIceGathering(peerConnection)

  offerSession = { sessionId, peerConnection, initDataChannel, remotePeerId: null, upgradeContext: null }

  return encodeSignedPayload(node.components.privateKey, {
    version: PAYLOAD_VERSION,
    type: QR_TYPE_OFFER,
    sessionId,
    peerId: node.peerId.toString(),
    sdp: peerConnection.localDescription.sdp
  })
}

async function acceptOffer (text) {
  await start()
  const offer = await decodeSignedPayload(text, QR_TYPE_OFFER)

  if (offer.peerId === node.peerId.toString()) {
    throw new Error('This offer belongs to this browser. Use the second browser')
  }

  const peerConnection = new RTCPeerConnection(rtcConfiguration())
  const addr = addressFor(offer.peerId)
  const upgradeContext = createWebRTCUpgradeContext(node.components, peerConnection, addr, {
    direction: 'inbound'
  })

  inboundPeerConnections.add(peerConnection)

  await peerConnection.setRemoteDescription({ type: 'offer', sdp: offer.sdp })
  await peerConnection.setLocalDescription(await peerConnection.createAnswer())
  await waitForIceGathering(peerConnection)

  // The offering peer only attaches its muxer once it reads this answer, so
  // upgrade after the connection is actually up.
  waitForConnected(peerConnection)
    .then(async () => {
      await node.components.upgrader.upgradeInbound(upgradeContext.connection, {
        skipEncryption: true,
        skipProtection: true,
        remotePeer: peerIdFromString(offer.peerId),
        muxerFactory: upgradeContext.muxerFactory,
        signal: AbortSignal.timeout(CONNECTION_TIMEOUT)
      })

      setStatus(`Connected to ${offer.peerId}`)
      log('Bitswap can now reach the other peer.')
    })
    .catch(error => {
      inboundPeerConnections.delete(peerConnection)
      peerConnection.close()
      setStatus(`Connection failed: ${error.message}`)
    })

  return encodeSignedPayload(node.components.privateKey, {
    version: PAYLOAD_VERSION,
    type: QR_TYPE_ANSWER,
    sessionId: offer.sessionId,
    peerId: node.peerId.toString(),
    offerPeerId: offer.peerId,
    sdp: peerConnection.localDescription.sdp
  })
}

async function acceptAnswer (text) {
  if (node == null || offerSession == null) {
    throw new Error('Create an offer first')
  }

  const answer = await decodeSignedPayload(text, QR_TYPE_ANSWER)

  if (answer.sessionId !== offerSession.sessionId) {
    throw new Error('The answer belongs to a different QR session')
  }

  if (answer.offerPeerId !== node.peerId.toString()) {
    throw new Error('The answer was not created for this peer')
  }

  await offerSession.peerConnection.setRemoteDescription({ type: 'answer', sdp: answer.sdp })
  await waitForConnected(offerSession.peerConnection)
  offerSession.initDataChannel.close()

  const addr = addressFor(answer.peerId)
  offerSession.remotePeerId = answer.peerId
  offerSession.upgradeContext = createWebRTCUpgradeContext(
    node.components,
    offerSession.peerConnection,
    addr,
    { direction: 'outbound' }
  )

  // Dialing the connection is what triggers the transport's upgrade. Retry
  // while the answering peer is still attaching its muxer.
  let lastError = new Error('The remote peer never accepted a connection')

  for (let attempt = 0; attempt < 15; attempt++) {
    try {
      const connection = await node.dial(addr, { signal: AbortSignal.timeout(CONNECTION_TIMEOUT) })
      await new Promise(resolve => setTimeout(resolve, 200))

      if (connection.status === 'open') {
        setStatus(`Connected to ${answer.peerId}`)
        log('Bitswap can now reach the other peer.')
        return addr.toString()
      }

      lastError = new Error(`Connection was ${connection.status} right after opening`)
    } catch (error) {
      lastError = error
    }

    await new Promise(resolve => setTimeout(resolve, 300))
  }

  throw lastError
}

async function addFile (name, bytes) {
  const cid = await fs.addBytes(bytes)

  log(`Added ${name} (${bytes.byteLength} bytes) as ${cid}`)
  cidInput.value = cid.toString()

  return cid.toString()
}

/**
 * Fetch a CID that only exists on the other peer. Nothing here mentions
 * WebRTC - bitswap just uses whatever libp2p connection is available, which in
 * this example is the one the QR handshake produced.
 */
async function fetchFile (cidText) {
  const chunks = []

  // `session: false` keeps bitswap broadcasting its wants to every connected
  // peer. A session would first try content routing to find providers, and this
  // node has no routers at all - the only peer it knows is the one from the QR
  // handshake, which is exactly the peer that has the block.
  const options = { session: false, signal: AbortSignal.timeout(CONNECTION_TIMEOUT) }

  for await (const chunk of fs.cat(cidText, options)) {
    chunks.push(chunk)
  }

  const total = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0)
  const bytes = new Uint8Array(total)
  let offset = 0

  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }

  const text = toString(bytes)
  testState.lastFetched = text
  contentEl.textContent = text
  log(`Fetched ${bytes.byteLength} bytes for ${cidText}`)

  return text
}

document.getElementById('start').addEventListener('click', async () => {
  try {
    await start()
    document.getElementById('start').disabled = true
  } catch (error) {
    setStatus(`Start failed: ${error.message}`)
  }
})

document.getElementById('create-offer').addEventListener('click', async () => {
  try {
    payloadEl.value = await createOffer()
    setStatus('Offer created. Paste it into the other browser.')
  } catch (error) {
    setStatus(`Offer failed: ${error.message}`)
  }
})

document.getElementById('process').addEventListener('click', async () => {
  const text = payloadEl.value.trim()

  try {
    const parsed = await parsePayload(text)

    if (parsed.type === QR_TYPE_OFFER) {
      payloadEl.value = await acceptOffer(text)
      setStatus('Answer created. Paste it back into the first browser.')
      return
    }

    await acceptAnswer(text)
  } catch (error) {
    setStatus(`Payload failed: ${error.message}`)
    log(`Payload failed: ${error.message}`)
  }
})

document.getElementById('add').addEventListener('click', async () => {
  const file = fileInput.files?.[0]

  try {
    const bytes = file == null
      ? fromString(`hello from ${node.peerId} at fixed demo content`)
      : new Uint8Array(await file.arrayBuffer())

    await addFile(file?.name ?? 'demo.txt', bytes)
  } catch (error) {
    log(`Add failed: ${error.message}`)
  }
})

document.getElementById('fetch').addEventListener('click', async () => {
  try {
    await fetchFile(cidInput.value.trim())
  } catch (error) {
    contentEl.textContent = ''
    log(`Fetch failed: ${error.message}`)
  }
})

window.__heliaQrTest = {
  start,
  createOffer,
  acceptOffer,
  acceptAnswer,
  addFile: async text => addFile('test.txt', fromString(text)),
  fetchFile,
  getLastFetched: () => testState.lastFetched,
  getConnections: () => node?.getConnections().length ?? 0
}
