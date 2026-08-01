import assert from 'node:assert/strict'
import { test } from 'node:test'
import { generateKeyPair } from '@libp2p/crypto/keys'
import { peerIdFromPrivateKey } from '@libp2p/peer-id'
import {
  compress,
  DEFAULT_CLOCK_SKEW_MS,
  DEFAULT_PAYLOAD_LIFETIME_MS,
  decompress,
  decodeSignedPayload,
  encodeSignedPayload,
  parsePayload,
  PAYLOAD_VERSION,
  QR_TYPE_ANSWER,
  QR_TYPE_OFFER
} from '../src/signaling.js'

const SDP = [
  'v=0',
  'o=- 4611731400430051336 2 IN IP4 127.0.0.1',
  's=-',
  't=0 0',
  'a=fingerprint:sha-256 8F:5A:12:CD:44:7B:0E:91:A2:33:6D:BE:70:19:C8:45:2F:AA:31:60:D4:78:E2:09:1B:5C:83:F7:26:0A:9E:D1',
  'a=setup:actpass'
].join('\r\n')

async function peer () {
  const privateKey = await generateKeyPair('Ed25519')

  return { privateKey, peerId: peerIdFromPrivateKey(privateKey).toString() }
}

function offer (from, overrides = {}) {
  return {
    version: PAYLOAD_VERSION,
    type: QR_TYPE_OFFER,
    sessionId: '6f1c0b2a-0f2f-4d33-9c1f-2c4f0b9a7e51',
    peerId: from.peerId,
    sdp: SDP,
    ...overrides
  }
}

function answer (from, to, overrides = {}) {
  return {
    version: PAYLOAD_VERSION,
    type: QR_TYPE_ANSWER,
    sessionId: '6f1c0b2a-0f2f-4d33-9c1f-2c4f0b9a7e51',
    peerId: from.peerId,
    offerPeerId: to.peerId,
    sdp: SDP,
    ...overrides
  }
}

/**
 * Re-sign a payload with a chosen key. Used to build payloads that are
 * internally consistent but signed by the wrong peer.
 */
async function reencode (payload) {
  return compress(JSON.stringify(payload))
}

test('an offer survives a signing and verification round trip', async () => {
  const alice = await peer()
  const now = 1_754_000_000_000
  const text = await encodeSignedPayload(alice.privateKey, offer(alice), { now })
  const decoded = await decodeSignedPayload(text, QR_TYPE_OFFER, { now })

  assert.equal(decoded.type, QR_TYPE_OFFER)
  assert.equal(decoded.version, PAYLOAD_VERSION)
  assert.equal(decoded.peerId, alice.peerId)
  assert.equal(decoded.sdp, SDP)
  assert.equal(decoded.sessionId, '6f1c0b2a-0f2f-4d33-9c1f-2c4f0b9a7e51')
  assert.equal(decoded.notBefore, now)
  assert.equal(decoded.notAfter, now + DEFAULT_PAYLOAD_LIFETIME_MS)
})

test('an expired payload is refused with a readable error', async () => {
  const alice = await peer()
  const now = 1_754_000_000_000
  const text = await encodeSignedPayload(alice.privateKey, offer(alice, {
    notBefore: now - DEFAULT_PAYLOAD_LIFETIME_MS - DEFAULT_CLOCK_SKEW_MS - 1,
    notAfter: now - DEFAULT_CLOCK_SKEW_MS - 1
  }))

  await assert.rejects(
    decodeSignedPayload(text, QR_TYPE_OFFER, { now }),
    /payload has expired/
  )
})

test('a payload that is not yet valid is refused with a readable error', async () => {
  const alice = await peer()
  const now = 1_754_000_000_000
  const text = await encodeSignedPayload(alice.privateKey, offer(alice, {
    notBefore: now + DEFAULT_CLOCK_SKEW_MS + 1,
    notAfter: now + DEFAULT_CLOCK_SKEW_MS + DEFAULT_PAYLOAD_LIFETIME_MS
  }))

  await assert.rejects(
    decodeSignedPayload(text, QR_TYPE_OFFER, { now }),
    /payload is not yet valid/
  )
})

test('rewriting the validity window invalidates the signature', async () => {
  const alice = await peer()
  const text = await encodeSignedPayload(alice.privateKey, offer(alice))
  const payload = await parsePayload(text)
  payload.notAfter += DEFAULT_PAYLOAD_LIFETIME_MS

  await assert.rejects(
    decodeSignedPayload(await reencode(payload), QR_TYPE_OFFER),
    /signature is invalid/
  )
})

test('an answer round trip keeps the peer it was created for', async () => {
  const alice = await peer()
  const bob = await peer()
  const text = await encodeSignedPayload(bob.privateKey, answer(bob, alice))
  const decoded = await decodeSignedPayload(text, QR_TYPE_ANSWER)

  assert.equal(decoded.peerId, bob.peerId)
  assert.equal(decoded.offerPeerId, alice.peerId)
})

test('a tampered sdp fails verification', async () => {
  const alice = await peer()
  const text = await encodeSignedPayload(alice.privateKey, offer(alice))
  const payload = await parsePayload(text)
  payload.sdp = `${payload.sdp}\r\na=x-tampered:1`

  await assert.rejects(
    decodeSignedPayload(await reencode(payload), QR_TYPE_OFFER),
    /signature is invalid/
  )
})

test('a swapped fingerprint fails verification', async () => {
  // The whole security argument rests on the fingerprint being covered by the
  // signature: swapping it must not survive.
  const alice = await peer()
  const text = await encodeSignedPayload(alice.privateKey, offer(alice))
  const payload = await parsePayload(text)
  payload.sdp = payload.sdp.replace('8F:5A:12', '11:22:33')

  await assert.rejects(
    decodeSignedPayload(await reencode(payload), QR_TYPE_OFFER),
    /signature is invalid/
  )
})

test('a payload signed by one peer cannot claim another peer id', async () => {
  const alice = await peer()
  const mallory = await peer()
  // Mallory signs her own payload, then rewrites it to claim Alice's peer id.
  const text = await encodeSignedPayload(mallory.privateKey, offer(mallory))
  const payload = await parsePayload(text)
  payload.peerId = alice.peerId

  await assert.rejects(
    decodeSignedPayload(await reencode(payload), QR_TYPE_OFFER),
    /signature is invalid/
  )
})

test('a replaced session id fails verification', async () => {
  const alice = await peer()
  const text = await encodeSignedPayload(alice.privateKey, offer(alice))
  const payload = await parsePayload(text)
  payload.sessionId = '00000000-0000-4000-8000-000000000000'

  await assert.rejects(
    decodeSignedPayload(await reencode(payload), QR_TYPE_OFFER),
    /signature is invalid/
  )
})

test('an answer is not accepted where an offer is expected', async () => {
  const alice = await peer()
  const bob = await peer()
  const text = await encodeSignedPayload(bob.privateKey, answer(bob, alice))

  await assert.rejects(
    decodeSignedPayload(text, QR_TYPE_OFFER),
    /Expected a version 1 offer payload/
  )
})

test('a future payload version is refused', async () => {
  const alice = await peer()
  const text = await encodeSignedPayload(alice.privateKey, offer(alice, { version: 2 }))

  await assert.rejects(
    decodeSignedPayload(text, QR_TYPE_OFFER),
    /Expected a version 1 offer payload/
  )
})

test('a missing required field is refused before any signature check', async () => {
  const alice = await peer()
  const text = await encodeSignedPayload(alice.privateKey, offer(alice))
  const payload = await parsePayload(text)
  delete payload.sdp

  await assert.rejects(
    decodeSignedPayload(await reencode(payload), QR_TYPE_OFFER),
    /missing required fields/
  )
})

test('an answer without offerPeerId is refused', async () => {
  const alice = await peer()
  const bob = await peer()
  const text = await encodeSignedPayload(bob.privateKey, answer(bob, alice))
  const payload = await parsePayload(text)
  delete payload.offerPeerId

  await assert.rejects(
    decodeSignedPayload(await reencode(payload), QR_TYPE_ANSWER),
    /missing required fields/
  )
})

test('fields outside the canonical set never reach the caller', async () => {
  // A verified payload must not carry data the signature did not cover.
  const alice = await peer()
  const text = await encodeSignedPayload(alice.privateKey, offer(alice, {
    smuggled: 'https://attacker.example/'
  }))
  const decoded = await decodeSignedPayload(text, QR_TYPE_OFFER)

  assert.equal(decoded.smuggled, undefined)
})

test('an offerPeerId on an offer is dropped rather than signed', async () => {
  // Offers have no offerPeerId in their canonical form. Accepting one would let
  // an unsigned field ride along.
  const alice = await peer()
  const bob = await peer()
  const text = await encodeSignedPayload(alice.privateKey, offer(alice, {
    offerPeerId: bob.peerId
  }))
  const decoded = await decodeSignedPayload(text, QR_TYPE_OFFER)

  assert.equal(decoded.offerPeerId, undefined)
})

test('an unparsable payload is reported as such', async () => {
  await assert.rejects(parsePayload('not a payload at all'), /cannot be decoded/)
})

test('compression round trips a realistic payload and shortens it', async () => {
  // A real offer carries ICE candidates, which is where deflate pays off.
  const candidates = Array.from({ length: 8 }, (_, index) =>
    `a=candidate:${index} 1 udp 2113937151 192.168.1.${20 + index} 5${index}000 typ host generation 0`
  ).join('\r\n')
  const json = JSON.stringify(offer({ peerId: '12D3KooWtest' }, { sdp: `${SDP}\r\n${candidates}` }))
  const packed = await compress(json)

  assert.ok(packed.startsWith('libp2p-webrtc-qr:1:'))
  assert.equal(await decompress(packed), json)
  assert.ok(packed.length < json.length, `packed ${packed.length} vs raw ${json.length}`)
})

test('a payload too small to compress is left as plain json', async () => {
  // base64url costs 4 characters per 3 bytes, so deflate loses on short input.
  // Encoding must never hand back the longer of the two forms.
  const json = '{"version":1,"type":"offer","sessionId":"a","peerId":"b","sdp":"v=0"}'
  const packed = await compress(json)

  assert.equal(packed, json)
  assert.equal(await decompress(packed), json)
})

test('encoding is never longer than the raw json', async () => {
  const alice = await peer()

  for (const sdp of ['v=0', SDP, `${SDP}\r\n${'a=candidate:0 1 udp 1 10.0.0.1 5000 typ host\r\n'.repeat(20)}`]) {
    const text = await encodeSignedPayload(alice.privateKey, offer(alice, { sdp }))
    const raw = await decompress(text)

    assert.ok(text.length <= raw.length, `encoded ${text.length} vs raw ${raw.length} for sdp of ${sdp.length}`)
  }
})

test('uncompressed payloads are passed through unchanged', async () => {
  const json = '{"type":"offer"}'

  assert.equal(await decompress(json), json)
})

test('a real signed offer fits well inside the 2200 character QR budget', async () => {
  const alice = await peer()
  const text = await encodeSignedPayload(alice.privateKey, offer(alice))

  assert.ok(text.length < 2200, `payload was ${text.length} characters`)
})
