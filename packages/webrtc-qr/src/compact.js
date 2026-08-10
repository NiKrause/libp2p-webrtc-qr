// A payload small enough that the code stays sparse.
//
// The v2 payload transports the whole SDP. That is honest but wasteful: almost
// every byte of an SDP is boilerplate both peers already know, and the parts
// that actually differ - a fingerprint and a handful of candidates - are a few
// hundred bits. QWBP (https://magarcia.github.io/qwbp/) makes the observation
// that you can therefore send *nothing but those*, derive the ICE credentials
// from the fingerprint on both sides, and rebuild the SDP locally.
//
// What QWBP does not have is an identity binding, and that is the whole
// security argument here: `skipEncryption` is only sound because a signature
// ties the DTLS fingerprint to a Peer ID. So this is QWBP's packing with our
// signature over it - see docs/compact-payload.md.
//
// The one rule this file must never break: **the signature covers the packed
// bytes, and the fingerprint is one of them.** Not the reconstruction. A
// reconstruction is something the receiver computes, and signing it would mean
// signing a value the sender never saw.

import { peerIdFromMultihash, peerIdFromString } from '@libp2p/peer-id'
import { decode as decodeMultihash } from 'multiformats/hashes/digest'
import { fromString, toString } from 'uint8arrays'

import { CLOCK_SKEW_MS, DEFAULT_LIFETIME_MS, QR_TYPE_ANSWER, QR_TYPE_OFFER } from './signaling.js'

export const COMPACT_VERSION = 3

/**
 * Distinct from the v2 prefix on purpose. A peer decides which decoder to use by
 * looking, not by being told, so a 0.6.0 peer meeting a v3 code fails with
 * "unknown format" rather than by mis-parsing it as JSON.
 */
export const COMPACT_PREFIX = 'q3:'

const SIGNING_CONTEXT = fromString('libp2p-webrtc-qr-payload-v3:')

const KIND_IPV4 = 0
const KIND_IPV6 = 1
const KIND_MDNS = 2

const CANDIDATE_TYPES = ['host', 'srflx', 'prflx', 'relay']

/** RFC 8445 type preferences, so a rebuilt candidate keeps its natural ordering. */
const TYPE_PREFERENCE = { host: 126, srflx: 100, prflx: 110, relay: 0 }

/**
 * ICE credentials, derived rather than transmitted.
 *
 * Both peers run this over the *same* input - the fingerprint that already has
 * to travel - so neither has to send its ufrag or pwd. HKDF rather than a plain
 * hash because the two outputs must be independent: deriving pwd as a slice of
 * the same digest that produced ufrag would publish half the password with the
 * username.
 *
 * @param {Uint8Array} fingerprint raw 32-byte SHA-256
 */
export async function deriveIceCredentials (fingerprint) {
  const key = await crypto.subtle.importKey('raw', fingerprint, 'HKDF', false, ['deriveBits'])
  const derive = async (label, bits) => {
    const out = await crypto.subtle.deriveBits(
      { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(0), info: fromString(label) },
      key,
      bits
    )
    return toString(new Uint8Array(out), 'base64url')
  }

  // RFC 5245 sizes: ufrag at least 4 characters, pwd at least 22.
  return {
    ufrag: (await derive('libp2p-webrtc-qr/ice-ufrag', 128)).slice(0, 8),
    pwd: (await derive('libp2p-webrtc-qr/ice-pwd', 256)).slice(0, 32)
  }
}

/** @param {string} hex `AB:CD:...` as it appears in an SDP */
export function fingerprintToBytes (hex) {
  const bytes = hex.trim().split(':')

  if (bytes.length !== 32) {
    throw new Error(`A SHA-256 fingerprint has 32 bytes, got ${bytes.length}`)
  }

  return Uint8Array.from(bytes.map(byte => parseInt(byte, 16)))
}

/** @param {Uint8Array} bytes */
export function bytesToFingerprint (bytes) {
  return [...bytes].map(byte => byte.toString(16).padStart(2, '0').toUpperCase()).join(':')
}

/**
 * One candidate, packed.
 *
 * Only the parts that cannot be recomputed survive: where to send packets, over
 * what, and of what kind. Foundation, component and priority are all derivable
 * from those, and a candidate line is mostly those three.
 *
 * Host candidates in a browser are mDNS-masked - `<uuid>.local` rather than an
 * address - so a third kind carries the UUID as its 16 raw bytes instead of 36
 * characters of hex and hyphens. Dropping them instead would quietly cost the
 * same-network case, which is the one that works most reliably.
 *
 * @param {string} line the `candidate:...` body of an a=candidate attribute
 */
export function packCandidate (line) {
  const parts = line.replace(/^(a=)?candidate:/u, '').trim().split(/\s+/u)
  const [, , protocol, , address, port, , type] = parts

  if (parts.length < 8 || parts[6] !== 'typ') {
    throw new Error(`Unrecognised ICE candidate: ${line}`)
  }

  const typeIndex = CANDIDATE_TYPES.indexOf(type)

  if (typeIndex < 0) {
    throw new Error(`Unknown ICE candidate type: ${type}`)
  }

  const packedAddress = packAddress(address)
  const flags = packedAddress.kind | (typeIndex << 2) | (protocol.toLowerCase() === 'tcp' ? 16 : 0)
  const out = new Uint8Array(1 + packedAddress.bytes.length + 2)

  out[0] = flags
  out.set(packedAddress.bytes, 1)
  new DataView(out.buffer).setUint16(1 + packedAddress.bytes.length, Number(port))

  return out
}

/** @param {Uint8Array} bytes @param {number} index which candidate this is, for the foundation */
export function unpackCandidate (bytes, index) {
  const kind = bytes[0] & 3
  const type = CANDIDATE_TYPES[(bytes[0] >> 2) & 3]
  const protocol = bytes[0] & 16 ? 'tcp' : 'udp'
  const size = kind === KIND_IPV4 ? 4 : 16
  const address = unpackAddress(kind, bytes.subarray(1, 1 + size))
  const port = new DataView(bytes.buffer, bytes.byteOffset).getUint16(1 + size)

  // Component 1 (RTP) always: this transport carries one data channel and never
  // negotiates RTCP, so there is no component 2 to distinguish.
  const priority = (TYPE_PREFERENCE[type] << 24) + (65535 << 8) + 255

  return `candidate:${index + 1} 1 ${protocol} ${priority} ${address} ${port} typ ${type}`
}

/** @param {Uint8Array} bytes */
export function candidateSize (bytes) {
  return 1 + ((bytes[0] & 3) === KIND_IPV4 ? 4 : 16) + 2
}

function packAddress (address) {
  if (address.endsWith('.local')) {
    const hex = address.slice(0, -'.local'.length).replace(/-/gu, '')

    if (hex.length !== 32) {
      throw new Error(`Not an mDNS candidate address: ${address}`)
    }

    return { kind: KIND_MDNS, bytes: fromString(hex, 'base16') }
  }

  if (address.includes(':')) {
    const groups = expandIpv6(address)
    const bytes = new Uint8Array(16)

    groups.forEach((group, index) => new DataView(bytes.buffer).setUint16(index * 2, group))

    return { kind: KIND_IPV6, bytes }
  }

  const octets = address.split('.').map(Number)

  if (octets.length !== 4 || octets.some(octet => !Number.isInteger(octet) || octet < 0 || octet > 255)) {
    throw new Error(`Not an IPv4 address: ${address}`)
  }

  return { kind: KIND_IPV4, bytes: Uint8Array.from(octets) }
}

function unpackAddress (kind, bytes) {
  if (kind === KIND_IPV4) {
    return [...bytes].join('.')
  }

  if (kind === KIND_MDNS) {
    const hex = toString(bytes, 'base16')

    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}.local`
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const groups = []

  for (let index = 0; index < 8; index++) {
    groups.push(view.getUint16(index * 2).toString(16))
  }

  return compressIpv6(groups)
}

function expandIpv6 (address) {
  const [head, tail = ''] = address.split('::')
  const left = head ? head.split(':') : []
  const right = tail ? tail.split(':') : []
  const middle = new Array(8 - left.length - right.length).fill('0')
  const groups = address.includes('::') ? [...left, ...middle, ...right] : left

  if (groups.length !== 8) {
    throw new Error(`Not an IPv6 address: ${address}`)
  }

  return groups.map(group => parseInt(group || '0', 16))
}

function compressIpv6 (groups) {
  // Longest run of zeroes wins, per RFC 5952. Only cosmetic - both forms parse -
  // but a rebuilt candidate that reads like the original is easier to compare
  // against a browser's own when something does not connect.
  let best = { start: -1, length: 0 }
  let run = { start: -1, length: 0 }

  groups.forEach((group, index) => {
    if (group === '0') {
      run = run.start < 0 ? { start: index, length: 1 } : { ...run, length: run.length + 1 }
      if (run.length > best.length) best = run
    } else {
      run = { start: -1, length: 0 }
    }
  })

  if (best.length < 2) {
    return groups.join(':')
  }

  const head = groups.slice(0, best.start).join(':')
  const tail = groups.slice(best.start + best.length).join(':')

  return `${head}::${tail}`
}

/**
 * Everything the wire needs, read off a real SDP.
 *
 * @param {string} sdp
 */
export function extractCompact (sdp) {
  const fingerprint = sdp.match(/^a=fingerprint:sha-256 (.+)$/mu)?.[1]

  if (fingerprint == null) {
    throw new Error('The SDP carries no SHA-256 fingerprint')
  }

  const candidates = [...sdp.matchAll(/^a=candidate:(.+)$/gmu)]
    .map(match => match[1].trim())
    // A candidate this codec cannot represent is skipped rather than fatal: it
    // costs one path, and refusing the whole payload would cost the connection.
    .flatMap(line => {
      try {
        return [packCandidate(line)]
      } catch {
        return []
      }
    })

  return { fingerprint: fingerprintToBytes(fingerprint), candidates }
}

/**
 * The SDP both sides agree on without either sending it.
 *
 * The candidates go **inside** this description rather than arriving afterwards
 * through `addIceCandidate`. That looked like a free choice and is not: adding
 * them after the description is set makes the connection usable a moment later
 * than the caller believes it is, and anything that starts talking immediately -
 * bitswap sending its first wantlist - can do so before a pair has been checked.
 * Measured, not reasoned: with trickled candidates the file-transfer test passed
 * 2 of 8 against 8 of 8 on the format that carries them in the SDP.
 *
 * `a=end-of-candidates` matters for the same reason. Without it the agent waits
 * for more that will never come, and the connection never leaves `checking`.
 *
 * @param {object} options
 * @param {Uint8Array} options.fingerprint
 * @param {string} options.ufrag
 * @param {string} options.pwd
 * @param {'offer'|'answer'} options.type
 * @param {string[]} [options.candidates] `candidate:...` lines
 */
export function buildSdp ({ fingerprint, ufrag, pwd, type, candidates = [] }) {
  return [
    'v=0',
    'o=- 1 2 IN IP4 127.0.0.1',
    's=-',
    't=0 0',
    'a=group:BUNDLE 0',
    'a=msid-semantic: WMS',
    'm=application 9 UDP/DTLS/SCTP webrtc-datachannel',
    'c=IN IP4 0.0.0.0',
    `a=ice-ufrag:${ufrag}`,
    `a=ice-pwd:${pwd}`,
    'a=ice-options:trickle',
    `a=fingerprint:sha-256 ${bytesToFingerprint(fingerprint)}`,
    // The offerer keeps both roles open; the answerer takes the client role, so
    // exactly one side runs the DTLS handshake as client.
    `a=setup:${type === QR_TYPE_OFFER ? 'actpass' : 'active'}`,
    'a=mid:0',
    'a=sctp-port:5000',
    'a=max-message-size:262144',
    ...candidates.map(candidate => `a=${candidate}`),
    'a=end-of-candidates',
    ''
  ].join('\r\n')
}

/**
 * A session id small enough to carry.
 *
 * `crypto.randomUUID()` is 36 characters for 122 bits. Sixteen raw bytes carry
 * 128 and cost 22 characters in base64url - and inside a binary payload, none at
 * all beyond the eight it actually occupies. Eight bytes is plenty: the id only
 * has to be unique among the handful of offers one peer has open at a time.
 */
export function compactSessionId () {
  return toString(crypto.getRandomValues(new Uint8Array(8)), 'base64url')
}

function writePeerId (peerId) {
  const bytes = peerIdFromString(peerId).toMultihash().bytes

  if (bytes.length > 255) {
    throw new Error('Peer id too long for the compact payload')
  }

  return bytes
}

function readPeerId (bytes) {
  return peerIdFromMultihash(decodeMultihash(bytes)).toString()
}

/**
 * Pack everything but the signature. Split out because both signing and
 * verifying need exactly these bytes and must not disagree about them.
 */
function packBody (payload) {
  const peerId = writePeerId(payload.peerId)
  const offerPeerId = payload.type === QR_TYPE_ANSWER ? writePeerId(payload.offerPeerId) : null
  const sessionId = fromString(payload.sessionId, 'base64url')

  if (sessionId.length !== 8) {
    throw new Error('A compact session id is eight bytes')
  }

  const candidateBytes = payload.candidates.reduce((total, one) => total + one.length, 0)
  const body = new Uint8Array(
    1 + 1 + 32 + 8 + 4 + 2 + 1 + peerId.length +
      (offerPeerId ? 1 + offerPeerId.length : 0) +
      1 + candidateBytes
  )
  const view = new DataView(body.buffer)
  let at = 0

  body[at++] = COMPACT_VERSION
  body[at++] = payload.type === QR_TYPE_ANSWER ? 1 : 0
  body.set(payload.fingerprint, at); at += 32
  body.set(sessionId, at); at += 8

  // Seconds, not milliseconds: four bytes reach 2106, and a validity window
  // measured to the millisecond was always a fiction across two devices whose
  // clocks are allowed to differ by minutes.
  view.setUint32(at, Math.floor(payload.notBefore / 1000)); at += 4
  view.setUint16(at, Math.min(65535, Math.round((payload.notAfter - payload.notBefore) / 1000))); at += 2

  body[at++] = peerId.length
  body.set(peerId, at); at += peerId.length

  if (offerPeerId) {
    body[at++] = offerPeerId.length
    body.set(offerPeerId, at); at += offerPeerId.length
  }

  body[at++] = payload.candidates.length

  for (const candidate of payload.candidates) {
    body.set(candidate, at)
    at += candidate.length
  }

  return body
}

function unpackBody (body) {
  const view = new DataView(body.buffer, body.byteOffset, body.byteLength)
  let at = 0

  const version = body[at++]

  if (version !== COMPACT_VERSION) {
    throw new Error(`Expected a version ${COMPACT_VERSION} payload, got ${version}`)
  }

  const type = body[at++] & 1 ? QR_TYPE_ANSWER : QR_TYPE_OFFER
  const fingerprint = body.slice(at, at + 32); at += 32
  const sessionId = toString(body.slice(at, at + 8), 'base64url'); at += 8
  const notBefore = view.getUint32(at) * 1000; at += 4
  const notAfter = notBefore + view.getUint16(at) * 1000; at += 2

  const peerIdLength = body[at++]
  const peerId = readPeerId(body.slice(at, at + peerIdLength)); at += peerIdLength

  let offerPeerId

  if (type === QR_TYPE_ANSWER) {
    const length = body[at++]
    offerPeerId = readPeerId(body.slice(at, at + length))
    at += length
  }

  const count = body[at++]
  const candidates = []

  for (let index = 0; index < count; index++) {
    const bytes = body.slice(at, at + candidateSize(body.subarray(at)))
    candidates.push(unpackCandidate(bytes, index))
    at += bytes.length
  }

  if (at !== body.length) {
    throw new Error('The compact payload has trailing bytes')
  }

  return { version, type, fingerprint, sessionId, notBefore, notAfter, peerId, offerPeerId, candidates }
}

/**
 * Sign and pack.
 *
 * The signature covers the packed body and a context string, so a payload
 * cannot be replayed as some other kind of signed message - and the fingerprint
 * is inside that body as a first-class field rather than as a substring of an
 * SDP. That is a stronger version of the same guarantee v2 gives, not a weaker
 * one: see docs/compact-payload.md.
 */
export async function encodeCompactPayload (privateKey, payload, options = {}) {
  const now = options.now ?? Date.now()
  const notBefore = payload.notBefore ?? now
  const body = packBody({
    ...payload,
    notBefore,
    notAfter: payload.notAfter ?? notBefore + (options.lifetimeMs ?? DEFAULT_LIFETIME_MS)
  })
  const signature = await privateKey.sign(concat(SIGNING_CONTEXT, body))
  const out = concat(body, signature)

  return `${COMPACT_PREFIX}${toString(out, 'base64url')}`
}

/**
 * Verify and unpack. Mirrors decodeSignedPayload: signature first, window
 * second, so a rewritten window is reported as forgery rather than as expiry.
 */
export async function decodeCompactPayload (text, expectedType, options = {}) {
  if (!isCompactPayload(text)) {
    throw new Error('Not a compact QR payload')
  }

  let raw

  try {
    raw = fromString(text.slice(COMPACT_PREFIX.length), 'base64url')
  } catch (error) {
    throw new Error(`The QR payload cannot be decoded: ${error.message}`)
  }

  if (raw.length < 64 + 48) {
    throw new Error('The compact payload is too short to contain a signature')
  }

  const body = raw.slice(0, raw.length - 64)
  const signature = raw.slice(raw.length - 64)
  const payload = unpackBody(body)

  if (payload.type !== expectedType) {
    throw new Error(`Expected a ${expectedType} payload`)
  }

  const peerId = peerIdFromString(payload.peerId)

  if (peerId.publicKey == null) {
    throw new Error('The QR peer id does not contain a public key')
  }

  if (!await peerId.publicKey.verify(concat(SIGNING_CONTEXT, body), signature)) {
    throw new Error('The QR payload signature is invalid')
  }

  const now = options.now ?? Date.now()

  if (now + CLOCK_SKEW_MS < payload.notBefore) {
    throw new Error('The QR payload is not valid yet - check the clocks on both devices')
  }

  if (now - CLOCK_SKEW_MS > payload.notAfter) {
    throw new Error('The QR payload has expired - ask for a freshly created one')
  }

  return payload
}

/**
 * Read a compact payload *without* verifying it.
 *
 * Same contract as parsePayload: only for deciding how to route a scanned code,
 * never for accepting what it says. Nothing here is trustworthy - the signature
 * has not been checked - which is why it returns the same shape the verified
 * path does rather than a friendlier one, so the two cannot be confused at a
 * glance.
 *
 * @param {string} text
 */
export function inspectCompactPayload (text) {
  const raw = fromString(text.slice(COMPACT_PREFIX.length), 'base64url')

  if (raw.length < 64) {
    throw new Error('The compact payload is too short to contain a signature')
  }

  return unpackBody(raw.slice(0, raw.length - 64))
}

/** @param {string} text */
export function isCompactPayload (text) {
  return typeof text === 'string' && text.startsWith(COMPACT_PREFIX)
}

function concat (...parts) {
  const out = new Uint8Array(parts.reduce((total, part) => total + part.length, 0))
  let at = 0

  for (const part of parts) {
    out.set(part, at)
    at += part.length
  }

  return out
}
