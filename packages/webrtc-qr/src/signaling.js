import { peerIdFromString } from '@libp2p/peer-id'
import { fromString, toString } from 'uint8arrays'

export const PAYLOAD_VERSION = 1
export const QR_TYPE_OFFER = 'offer'
export const QR_TYPE_ANSWER = 'answer'

const SIGNATURE_PREFIX = 'libp2p-webrtc-qr-payload-v1:'
const COMPRESSED_PREFIX = 'libp2p-webrtc-qr:1:'

/**
 * Only these fields are signed and transported. Anything else a caller attaches
 * to a payload object is dropped, so a verified payload never carries data that
 * the signature did not cover.
 */
function canonicalPayload (payload) {
  if (payload.type === QR_TYPE_OFFER) {
    return {
      version: payload.version,
      type: payload.type,
      sessionId: payload.sessionId,
      peerId: payload.peerId,
      sdp: payload.sdp
    }
  }

  return {
    version: payload.version,
    type: payload.type,
    sessionId: payload.sessionId,
    peerId: payload.peerId,
    offerPeerId: payload.offerPeerId,
    sdp: payload.sdp
  }
}

function signingBytes (payload) {
  return fromString(`${SIGNATURE_PREFIX}${JSON.stringify(canonicalPayload(payload))}`)
}

/**
 * Deflate the JSON so the QR code stays inside the character budget a phone
 * camera can still resolve. Browsers without CompressionStream fall back to the
 * plain JSON text, which stays readable by peers that can compress.
 */
export async function compress (json) {
  if (typeof CompressionStream === 'undefined') {
    return json
  }

  const stream = new Blob([fromString(json)])
    .stream()
    .pipeThrough(new CompressionStream('deflate'))
  const compressed = new Uint8Array(await new Response(stream).arrayBuffer())

  return `${COMPRESSED_PREFIX}${toString(compressed, 'base64url')}`
}

export async function decompress (text) {
  if (!text.startsWith(COMPRESSED_PREFIX)) {
    return text
  }

  if (typeof DecompressionStream === 'undefined') {
    throw new Error('This browser cannot decompress QR signaling payloads')
  }

  const compressed = fromString(text.slice(COMPRESSED_PREFIX.length), 'base64url')
  const stream = new Blob([compressed])
    .stream()
    .pipeThrough(new DecompressionStream('deflate'))
  const decompressed = new Uint8Array(await new Response(stream).arrayBuffer())

  return toString(decompressed)
}

/**
 * Parse a payload without verifying it. Use this only to decide how to route a
 * scanned code - never to accept its SDP.
 */
export async function parsePayload (text) {
  try {
    return JSON.parse(await decompress(text))
  } catch (error) {
    throw new Error(`The QR payload cannot be decoded: ${error.message}`)
  }
}

export async function encodeSignedPayload (privateKey, payload) {
  const signature = await privateKey.sign(signingBytes(payload))

  return compress(JSON.stringify({
    ...canonicalPayload(payload),
    signature: toString(signature, 'base64url')
  }))
}

/**
 * Verify a scanned payload against the public key embedded in the peer id it
 * claims. Because the SDP carries the DTLS fingerprint, a valid signature binds
 * the WebRTC session to that peer id - which is what lets the transport skip
 * the usual connection encryption handshake.
 */
export async function decodeSignedPayload (text, expectedType) {
  const payload = await parsePayload(text)

  if (payload?.version !== PAYLOAD_VERSION || payload.type !== expectedType) {
    throw new Error(`Expected a version ${PAYLOAD_VERSION} ${expectedType} payload`)
  }

  const requiredStrings = expectedType === QR_TYPE_OFFER
    ? ['sessionId', 'peerId', 'sdp', 'signature']
    : ['sessionId', 'peerId', 'offerPeerId', 'sdp', 'signature']

  if (requiredStrings.some(field => typeof payload[field] !== 'string' || payload[field].length === 0)) {
    throw new Error('The QR payload is missing required fields')
  }

  const payloadPeerId = peerIdFromString(payload.peerId)

  if (payloadPeerId.publicKey == null) {
    throw new Error('The QR peer id does not contain a public key')
  }

  const valid = await payloadPeerId.publicKey.verify(
    signingBytes(payload),
    fromString(payload.signature, 'base64url')
  )

  if (!valid) {
    throw new Error('The QR payload signature is invalid')
  }

  return payload
}
