import { identify, identifyPush } from '@libp2p/identify'
import { withBitswap } from '@helia/bitswap'
import { unixfs } from '@helia/unixfs'
import { withLibp2p } from '@helia/libp2p'
import { createHeliaLight } from 'helia'
import { createLibp2p } from 'libp2p'
import { fromString, toString } from 'uint8arrays'
import { QRSession, parsePayload, webRTCQR } from '@le-space/libp2p-webrtc-qr'

/** How long to wait for a block. A Helia concern, not a handshake one. */
const FETCH_TIMEOUT = 30_000

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
let session = null

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

async function start () {
  if (node != null) {
    return node
  }

  node = await createLibp2p({
    transports: [webRTCQR({ getOutboundSession: remotePeerId => session?.getOutboundSession(remotePeerId) ?? null })],
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

  // Everything this example used to spell out by hand - the negotiated init
  // channel, waiting for `connected` before upgrading, the upgrade direction,
  // the dial retry - now comes from the package. It was written here and in the
  // demo separately, and then a third time in an unrelated project.
  session = new QRSession(node, { rtcConfiguration })

  session.addEventListener('connect', event => {
    setStatus(`Connected to ${event.detail.peerId}`)
    log('Bitswap can now reach the other peer.')
  })

  session.addEventListener('error', event => {
    setStatus(`Connection failed: ${event.detail.error.message}`)
  })

  peerIdEl.textContent = node.peerId.toString()
  setStatus('Helia node started. Create or paste an offer.')
  log(`Started Helia on libp2p peer ${node.peerId}`)

  return node
}

async function createOffer () {
  await start()

  return session.createOffer()
}

async function acceptOffer (text) {
  await start()

  return session.acceptOffer(text)
}

async function acceptAnswer (text) {
  await start()

  // The session dials for us: bitswap needs a libp2p connection, not a protocol
  // stream, and until something dials there is no libp2p connection at all.
  const { peerId } = await session.acceptAnswer(text)

  return peerId
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
  const options = { session: false, signal: AbortSignal.timeout(FETCH_TIMEOUT) }

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
