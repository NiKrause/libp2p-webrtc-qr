import { peerIdFromString } from '@libp2p/peer-id'
import { fromString, toString } from 'uint8arrays'

export const PAYLOAD_VERSION = 2
export const QR_TYPE_OFFER = 'offer'
export const QR_TYPE_ANSWER = 'answer'

/**
 * How long a payload stays valid. A signed offer used to be usable for as long
 * as the offerer's peer connection lived, so anyone who photographed a
 * displayed code, or kept a copy of a link from a chat, could replay it for
 * that whole window.
 */
export const DEFAULT_LIFETIME_MS = 10 * 60 * 1000

/**
 * Two devices that have never spoken cannot be assumed to agree on the time.
 * Without slack, a phone a minute fast would reject every payload it is given.
 */
export const CLOCK_SKEW_MS = 2 * 60 * 1000

const SIGNATURE_PREFIX = 'libp2p-webrtc-qr-payload-v2:'
const COMPRESSED_PREFIX = 'libp2p-webrtc-qr:1:'

/**
 * Only these fields are signed and transported. Anything else a caller attaches
 * to a payload object is dropped, so a verified payload never carries data that
 * the signature did not cover.
 */
function canonicalPayload (payload) {
  // notBefore/notAfter belong *inside* the canonical form. Outside it they are
  // not covered by the signature, and an attacker replaying an old payload
  // would simply rewrite the window before passing it on.
  if (payload.type === QR_TYPE_OFFER) {
    return {
      version: payload.version,
      type: payload.type,
      sessionId: payload.sessionId,
      peerId: payload.peerId,
      notBefore: payload.notBefore,
      notAfter: payload.notAfter,
      sdp: payload.sdp
    }
  }

  return {
    version: payload.version,
    type: payload.type,
    sessionId: payload.sessionId,
    peerId: payload.peerId,
    offerPeerId: payload.offerPeerId,
    notBefore: payload.notBefore,
    notAfter: payload.notAfter,
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
  const packed = `${COMPRESSED_PREFIX}${toString(compressed, 'base64url')}`

  // base64url costs 4 characters per 3 bytes, so deflate only pays off once the
  // payload is big enough to squeeze. Below that the "compressed" form is the
  // longer one - send whichever is actually shorter. decompress() accepts both.
  return packed.length < json.length ? packed : json
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

/**
 * Sign a payload and stamp it with a validity window.
 *
 * @param options.lifetimeMs - how long it stays usable, default ten minutes
 * @param options.now - the current time, injectable so tests do not have to wait
 */
export async function encodeSignedPayload (privateKey, payload, options = {}) {
  const now = options.now ?? Date.now()
  const lifetime = options.lifetimeMs ?? DEFAULT_LIFETIME_MS
  const stamped = {
    ...payload,
    notBefore: payload.notBefore ?? now,
    notAfter: payload.notAfter ?? now + lifetime
  }
  const signature = await privateKey.sign(signingBytes(stamped))

  return compress(JSON.stringify({
    ...canonicalPayload(stamped),
    signature: toString(signature, 'base64url')
  }))
}

/**
 * Verify a scanned payload against the public key embedded in the peer id it
 * claims. Because the SDP carries the DTLS fingerprint, a valid signature binds
 * the WebRTC session to that peer id - which is what lets the transport skip
 * the usual connection encryption handshake.
 */
export async function decodeSignedPayload (text, expectedType, options = {}) {
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

  if (!Number.isFinite(payload.notBefore) || !Number.isFinite(payload.notAfter)) {
    throw new Error('The QR payload is missing its validity window')
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

  // Checked after the signature, so a rewritten window is reported as forgery
  // rather than as an expiry - the more accurate of the two.
  const now = options.now ?? Date.now()

  if (now + CLOCK_SKEW_MS < payload.notBefore) {
    throw new Error('The QR payload is not valid yet - check the clocks on both devices')
  }

  if (now - CLOCK_SKEW_MS > payload.notAfter) {
    throw new Error('The QR payload has expired - ask for a freshly created one')
  }

  return payload
}
