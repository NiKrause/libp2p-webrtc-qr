import assert from 'node:assert/strict'
import { test } from 'node:test'

import { bothSidesSymmetric, describeIce } from '../src/session.js'

/** Just enough of an RTCPeerConnection for the two functions under test. */
function fakeConnection (localCandidates, remoteCandidates, iceConnectionState = 'disconnected') {
  const sdp = candidates => ({
    sdp: candidates.map((c, i) => `a=candidate:${i + 1} 1 udp 1 ${c}`).join('\r\n')
  })

  return {
    localDescription: sdp(localCandidates),
    remoteDescription: sdp(remoteCandidates),
    iceConnectionState
  }
}

const HOST = 'aa1b2c3d-4e5f-6071-8293-a4b5c6d7e8f9.local 51820 typ host'
const V4_A = '203.0.113.7 51820 typ srflx'
const V4_B = '203.0.113.7 44001 typ srflx'
const V6 = '2001:db8::42 51821 typ srflx'

test('one reflexive per family is not symmetric, however many there are', () => {
  // The case that started this: "2 host, 2 srflx" on both sides looks alarming
  // and is perfectly healthy when the two are IPv4 and IPv6.
  const connection = fakeConnection([HOST, V4_A, V6], [HOST, V4_A, V6])

  assert.equal(bothSidesSymmetric(connection), false)
  assert.match(describeIce(connection), /local: 1 host, 2 srflx; remote: 1 host, 2 srflx/)
  assert.doesNotMatch(describeIce(connection), /symmetric/)
})

test('two public ports in one family is symmetric, and it is named', () => {
  const connection = fakeConnection([HOST, V4_A, V4_B], [HOST, V4_A, V4_B])

  assert.equal(bothSidesSymmetric(connection), true)
  assert.match(describeIce(connection), /local: 1 host, 2 srflx, symmetric IPv4/)
})

test('one side symmetric is not both sides', () => {
  // Only fatal when neither side can be reached. One cone NAT is enough.
  const connection = fakeConnection([HOST, V4_A, V4_B], [HOST, V4_A])

  assert.equal(bothSidesSymmetric(connection), false)
})

test('no reflexive candidates at all is not reported as symmetric', () => {
  const connection = fakeConnection([HOST], [HOST])

  assert.equal(bothSidesSymmetric(connection), false)
  assert.match(describeIce(connection), /local: 1 host; remote: 1 host/)
})

test('the ice state is carried through', () => {
  assert.match(describeIce(fakeConnection([HOST], [HOST], 'failed')), /ice: failed/)
})
