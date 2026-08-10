import { generateKeyPair } from '@libp2p/crypto/keys'
import { peerIdFromPrivateKey } from '@libp2p/peer-id'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { fromString, toString } from 'uint8arrays'

import {
  COMPACT_PREFIX,
  bytesToFingerprint,
  compactSessionId,
  decodeCompactPayload,
  deriveIceCredentials,
  encodeCompactPayload,
  extractCompact,
  fingerprintToBytes,
  isCompactPayload,
  packCandidate,
  unpackCandidate
} from '../src/compact.js'
import { QR_TYPE_ANSWER, QR_TYPE_OFFER } from '../src/signaling.js'

const FINGERPRINT =
  '3E:1F:8A:0B:CC:41:92:77:AB:19:5D:E0:74:33:9C:66:12:F5:8E:20:B7:4A:D9:03:6E:81:57:C2:45:AA:10:FB'

/** An offer as a browser really produces one, trimmed to what this codec reads. */
const SDP = [
  'v=0',
  'o=- 1 2 IN IP4 127.0.0.1',
  'm=application 9 UDP/DTLS/SCTP webrtc-datachannel',
  'a=ice-ufrag:Xk2p',
  'a=ice-pwd:0123456789abcdef0123456789',
  `a=fingerprint:sha-256 ${FINGERPRINT}`,
  'a=candidate:1 1 udp 2113937151 aa1b2c3d-4e5f-6071-8293-a4b5c6d7e8f9.local 51820 typ host generation 0',
  'a=candidate:2 1 udp 1677729535 203.0.113.7 51820 typ srflx raddr 0.0.0.0 rport 0',
  'a=candidate:3 1 udp 1677729535 2001:db8::42 51821 typ srflx',
  ''
].join('\r\n')

async function identity () {
  const privateKey = await generateKeyPair('Ed25519')

  return { privateKey, peerId: peerIdFromPrivateKey(privateKey).toString() }
}

async function offerPayload (overrides = {}) {
  const { privateKey, peerId } = await identity()
  const { fingerprint, candidates } = extractCompact(SDP)

  return {
    privateKey,
    payload: {
      type: QR_TYPE_OFFER,
      sessionId: compactSessionId(),
      peerId,
      fingerprint,
      candidates,
      ...overrides
    }
  }
}

test('a fingerprint survives the trip to bytes and back', () => {
  assert.equal(bytesToFingerprint(fingerprintToBytes(FINGERPRINT)), FINGERPRINT)
})

test('a fingerprint that is not 32 bytes is refused', () => {
  assert.throws(() => fingerprintToBytes('AB:CD'), /32 bytes/)
})

test('each candidate kind survives packing', () => {
  const cases = [
    'candidate:1 1 udp 2113937151 aa1b2c3d-4e5f-6071-8293-a4b5c6d7e8f9.local 51820 typ host',
    'candidate:1 1 udp 1677729535 203.0.113.7 51820 typ srflx',
    'candidate:1 1 udp 1677729535 2001:db8::42 51821 typ srflx',
    'candidate:1 1 tcp 1677729535 198.51.100.9 9 typ host'
  ]

  for (const line of cases) {
    const rebuilt = unpackCandidate(packCandidate(line), 0)
    const [, , protocolIn, , addressIn, portIn, , typeIn] = line.split(' ')
    const [, , protocolOut, , addressOut, portOut, , typeOut] = rebuilt.split(' ')

    assert.deepEqual(
      { protocolOut, addressOut, portOut, typeOut },
      { protocolOut: protocolIn, addressOut: addressIn, portOut: portIn, typeOut: typeIn },
      line
    )
  }
})

test('an mDNS host candidate costs 19 bytes and an IPv4 one costs 7', () => {
  assert.equal(
    packCandidate('candidate:1 1 udp 1 aa1b2c3d-4e5f-6071-8293-a4b5c6d7e8f9.local 51820 typ host').length,
    19
  )
  assert.equal(packCandidate('candidate:1 1 udp 1 203.0.113.7 51820 typ srflx').length, 7)
})

test('a candidate this codec cannot represent is skipped, not fatal', () => {
  const { candidates } = extractCompact(
    `${SDP}a=candidate:9 1 udp 1 not-an-address 1 typ host\r\n`
  )

  // The three it understands, and no exception for the fourth: one lost path is
  // cheaper than a refused payload.
  assert.equal(candidates.length, 3)
})

test('ICE credentials derive alike on both sides, and pwd does not leak from ufrag', async () => {
  const fingerprint = fingerprintToBytes(FINGERPRINT)
  const mine = await deriveIceCredentials(fingerprint)
  const theirs = await deriveIceCredentials(fingerprint)

  assert.deepEqual(mine, theirs)
  assert.equal(mine.ufrag.length, 8)
  assert.equal(mine.pwd.length, 32)
  // Independent HKDF labels, not two slices of one digest - otherwise the
  // username would publish the first bytes of the password.
  assert.ok(!mine.pwd.startsWith(mine.ufrag))
})

test('a different fingerprint derives different credentials', async () => {
  const other = fingerprintToBytes(FINGERPRINT.replace(/^3E/u, '3F'))

  assert.notDeepEqual(
    await deriveIceCredentials(fingerprintToBytes(FINGERPRINT)),
    await deriveIceCredentials(other)
  )
})

test('an offer round-trips through sign and verify', async () => {
  const { privateKey, payload } = await offerPayload()
  const text = await encodeCompactPayload(privateKey, payload)
  const decoded = await decodeCompactPayload(text, QR_TYPE_OFFER)

  assert.ok(isCompactPayload(text))
  assert.equal(decoded.peerId, payload.peerId)
  assert.equal(decoded.sessionId, payload.sessionId)
  assert.equal(bytesToFingerprint(decoded.fingerprint), FINGERPRINT)
  assert.equal(decoded.candidates.length, 3)
})

test('an answer round-trips and carries the offer peer id', async () => {
  const { privateKey, payload } = await offerPayload()
  const { peerId: offerPeerId } = await identity()
  const answer = { ...payload, type: QR_TYPE_ANSWER, offerPeerId }
  const decoded = await decodeCompactPayload(
    await encodeCompactPayload(privateKey, answer),
    QR_TYPE_ANSWER
  )

  assert.equal(decoded.offerPeerId, offerPeerId)
})

test('an offer is not accepted where an answer is expected', async () => {
  const { privateKey, payload } = await offerPayload()
  const text = await encodeCompactPayload(privateKey, payload)

  await assert.rejects(() => decodeCompactPayload(text, QR_TYPE_ANSWER), /Expected a/)
})

test('a flipped fingerprint bit fails verification', async () => {
  const { privateKey, payload } = await offerPayload()
  const text = await encodeCompactPayload(privateKey, payload)
  const bytes = fromString(text.slice(COMPACT_PREFIX.length), 'base64url')

  // Byte 2 is the first byte of the fingerprint - the field the whole security
  // argument rests on. If it were ever outside the signature, this is the test
  // that would notice.
  bytes[2] ^= 1

  await assert.rejects(
    () => decodeCompactPayload(`${COMPACT_PREFIX}${toString(bytes, 'base64url')}`, QR_TYPE_OFFER),
    /signature is invalid/
  )
})

test('a rewritten validity window fails as forgery, not as expiry', async () => {
  const { privateKey, payload } = await offerPayload()
  const text = await encodeCompactPayload(privateKey, payload, { now: 1_000_000_000_000 })
  const bytes = fromString(text.slice(COMPACT_PREFIX.length), 'base64url')

  // notBefore starts at byte 42: 1 version + 1 flags + 32 fingerprint + 8 session.
  new DataView(bytes.buffer, bytes.byteOffset).setUint32(42, 2_000_000_000)

  await assert.rejects(
    () => decodeCompactPayload(`${COMPACT_PREFIX}${toString(bytes, 'base64url')}`, QR_TYPE_OFFER),
    /signature is invalid/
  )
})

test('a payload signed by one peer cannot claim another peer id', async () => {
  const { privateKey, payload } = await offerPayload()
  const { peerId: stranger } = await identity()
  const text = await encodeCompactPayload(privateKey, { ...payload, peerId: stranger })

  await assert.rejects(() => decodeCompactPayload(text, QR_TYPE_OFFER), /signature is invalid/)
})

test('an expired payload is refused', async () => {
  const { privateKey, payload } = await offerPayload()
  const text = await encodeCompactPayload(privateKey, payload, {
    now: 1_000_000_000_000,
    lifetimeMs: 60_000
  })

  await assert.rejects(
    () => decodeCompactPayload(text, QR_TYPE_OFFER, { now: 1_000_000_600_000 }),
    /expired/
  )
})

test('trailing bytes are refused rather than ignored', async () => {
  const { privateKey, payload } = await offerPayload()
  const text = await encodeCompactPayload(privateKey, payload)
  const bytes = fromString(text.slice(COMPACT_PREFIX.length), 'base64url')
  const longer = new Uint8Array(bytes.length + 1)

  longer.set(bytes)

  await assert.rejects(
    () => decodeCompactPayload(`${COMPACT_PREFIX}${toString(longer, 'base64url')}`, QR_TYPE_OFFER),
    /trailing bytes|signature is invalid/
  )
})

test('a v2 payload is not mistaken for a compact one', () => {
  assert.equal(isCompactPayload('{"version":2}'), false)
  assert.equal(isCompactPayload('libp2p-webrtc-qr:1:abc'), false)
})

test('the packed offer is an order of magnitude below the v2 payload', async () => {
  const { privateKey, payload } = await offerPayload()
  const text = await encodeCompactPayload(privateKey, payload)

  // Recorded rather than merely bounded: the number is the point of the whole
  // exercise, and a regression that doubled it while staying under a generous
  // ceiling would otherwise pass. v2 measures 933 host-only, 1057 with STUN.
  console.log(`compact offer: ${text.length} characters, three candidates`)

  assert.ok(text.length < 300, `expected under 300 characters, got ${text.length}`)
})
