import assert from 'node:assert/strict'
import test from 'node:test'
import { QRSession, describeIce } from '../src/session.js'

/**
 * The parts of the session that do not need a browser.
 *
 * `createOffer` and `acceptOffer` construct an `RTCPeerConnection`, so the
 * handshake itself is exercised by the browser suites. What is here is the
 * bookkeeping that made those handshakes fail in ways that pointed somewhere
 * else entirely: the dial that has to be retried, the stale session that gets
 * handed to the transport, and what an error says when ICE is the real cause.
 */

function fakeNode (overrides = {}) {
  return {
    peerId: { toString: () => '12D3KooWLocal' },
    components: {},
    getConnections: () => [],
    dialProtocol: async () => ({ status: 'open' }),
    ...overrides
  }
}

const FAST = { dialRetryDelay: 1, dialSettleDelay: 1, connectionTimeout: 50 }

test('a dial is retried while the answering peer attaches its muxer', async () => {
  let attempts = 0
  const session = new QRSession(fakeNode({
    dialProtocol: async () => {
      attempts++

      // The real shape of this failure: the stream opens, negotiates, and is
      // reset a moment later because the remote muxer was not there yet.
      return { status: attempts < 4 ? 'reset' : 'open' }
    }
  }), FAST)

  const stream = await session.dialProtocol('12D3KooWRemote', '/chat/1.0.0')

  assert.equal(stream.status, 'open')
  assert.equal(attempts, 4)
})

test('a dial that throws every time reports the last failure, not a generic one', async () => {
  const session = new QRSession(fakeNode({
    dialProtocol: async () => { throw new Error('no transport available') }
  }), { ...FAST, dialAttempts: 3 })

  await assert.rejects(
    session.dialProtocol('12D3KooWRemote', '/chat/1.0.0'),
    /no transport available/
  )
})

test('a dial gives up after the configured number of attempts', async () => {
  let attempts = 0
  const session = new QRSession(fakeNode({
    dialProtocol: async () => {
      attempts++
      return { status: 'reset' }
    }
  }), { ...FAST, dialAttempts: 5 })

  await assert.rejects(session.dialProtocol('12D3KooWRemote', '/chat/1.0.0'), /stream was reset right after opening/)
  assert.equal(attempts, 5)
})

test('the newest session for a peer wins, not the first', async () => {
  const session = new QRSession(fakeNode())

  // What a reconnect leaves behind: the dead session is still in the map, and
  // handing its closed peer connection to the transport fails the dial with an
  // error that says nothing about the real cause.
  session.offers.set('old', {
    createdAt: 1000,
    remotePeerId: '12D3KooWRemote',
    upgradeContext: 'stale',
    peerConnection: { close () {} }
  })
  session.offers.set('new', {
    createdAt: 2000,
    remotePeerId: '12D3KooWRemote',
    upgradeContext: 'live',
    peerConnection: { close () {} }
  })

  assert.equal(session.getOutboundSession('12D3KooWRemote'), 'live')
  assert.equal(session.getOutboundSession('12D3KooWSomeoneElse'), null)
})

test('forgetting a peer closes its libp2p connection and drops its session', async () => {
  const closed = []
  const session = new QRSession(fakeNode({
    getConnections: () => [
      { remotePeer: { toString: () => '12D3KooWRemote' }, close: async () => closed.push('libp2p') },
      { remotePeer: { toString: () => '12D3KooWOther' }, close: async () => closed.push('other') }
    ]
  }))

  session.offers.set('mine', {
    createdAt: 1,
    remotePeerId: '12D3KooWRemote',
    peerConnection: { close: () => closed.push('rtc') }
  })

  session.forget('12D3KooWRemote')

  assert.deepEqual(closed, ['libp2p', 'rtc'])
  assert.equal(session.offers.size, 0)
})

test('an ICE summary counts candidate types on both sides', () => {
  const summary = describeIce({
    iceConnectionState: 'failed',
    localDescription: {
      sdp: [
        'a=candidate:1 1 udp 1 192.168.1.2 1 typ host',
        'a=candidate:2 1 udp 1 192.168.1.3 1 typ host',
        'a=candidate:3 1 udp 1 9.9.9.9 1 typ srflx'
      ].join('\r\n')
    },
    remoteDescription: {
      sdp: 'a=candidate:4 1 udp 1 8.8.8.8 1 typ relay'
    }
  })

  assert.equal(summary, 'local: 2 host, 1 srflx; remote: 1 relay; ice: failed')
})

test('an ICE summary survives a connection that never got a description', () => {
  const summary = describeIce({ iceConnectionState: 'new' })

  assert.equal(summary, 'local: none; remote: none; ice: new')
})
