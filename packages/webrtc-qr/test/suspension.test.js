import assert from 'node:assert/strict'
import test from 'node:test'

import { BROWSERS_THAT_HOLD, leavingSuspendsUs, pendingConnections, stateOf } from '../src/suspension.js'

/**
 * Node has neither `matchMedia` nor `userAgentData`, which is the point: these
 * run in a browser and the interesting cases are the ones where a signal is
 * missing or lying. Stubbing `globalThis` is how each of them is reached.
 */

// `defineProperty` rather than assignment: modern Node exposes `navigator` as a
// getter-only property, so `globalThis.navigator = …` throws rather than
// stubbing anything.
const withGlobals = (patch, fn) => {
  const saved = Object.keys(patch).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)])

  for (const [key, value] of Object.entries(patch)) {
    Object.defineProperty(globalThis, key, { value, configurable: true, writable: true })
  }

  try {
    return fn()
  } finally {
    for (const [key, descriptor] of saved) {
      if (descriptor == null) delete globalThis[key]
      else Object.defineProperty(globalThis, key, descriptor)
    }
  }
}

test('a phone that says so is taken at its word', () => {
  const suspends = withGlobals(
    { navigator: { userAgentData: { mobile: true } }, matchMedia: () => ({ matches: false }) },
    leavingSuspendsUs
  )

  assert.equal(suspends, true)
})

test('a coarse pointer without hover counts, even with no userAgentData', () => {
  // Safari and Firefox do not implement userAgentData at all, so this branch is
  // the only one that fires on a large share of the phones this is about.
  const suspends = withGlobals(
    { navigator: {}, matchMedia: query => ({ matches: query === '(hover: none) and (pointer: coarse)' }) },
    leavingSuspendsUs
  )

  assert.equal(suspends, true)
})

test('a desktop is not hurried', () => {
  // Including a touchscreen laptop, which a bare "does it have touch" check
  // misreads - it has hover, so the query is false.
  const suspends = withGlobals(
    { navigator: { userAgentData: { mobile: false }, maxTouchPoints: 10 }, matchMedia: () => ({ matches: false }) },
    leavingSuspendsUs
  )

  assert.equal(suspends, false)
})

test('an environment with neither signal does not hurry anybody', () => {
  const suspends = withGlobals({ navigator: undefined, matchMedia: undefined }, leavingSuspendsUs)

  assert.equal(suspends, false)
})

test('the browsers that hold are a list a consumer can read', () => {
  assert.ok(BROWSERS_THAT_HOLD.includes('ddg'))
  assert.ok(BROWSERS_THAT_HOLD.includes('safari'))
})

test('a connection closed under a suspended page reads as closed', () => {
  // The case the whole readout exists for: browsers have closed a connection
  // while the page was suspended without firing anything, so connectionState
  // can still say something reassuring while signalingState tells the truth.
  const state = stateOf({ signalingState: 'closed', connectionState: 'connected' })

  assert.equal(state, 'closed')
})

test('connectionState is preferred, with iceConnectionState behind it', () => {
  assert.equal(stateOf({ signalingState: 'stable', connectionState: 'connected' }), 'connected')
  assert.equal(stateOf({ signalingState: 'stable', iceConnectionState: 'checking' }), 'checking')
  assert.equal(stateOf({ signalingState: 'stable' }), 'new')
})

test('pending connections cover both halves of a session', () => {
  const a = { id: 'a' }
  const b = { id: 'b' }
  const pending = pendingConnections({
    offers: new Map([['abcdef012345', { peerConnection: a }]]),
    inbound: [b]
  })

  assert.deepEqual(pending, [
    { role: 'invite', label: 'abcdef', peerConnection: a },
    { role: 'reply', label: '#1', peerConnection: b }
  ])
})

test('no session, and half a session, are both survivable', () => {
  // A readout that throws before a node exists is a readout nobody can render
  // on first paint.
  assert.deepEqual(pendingConnections(), [])
  assert.deepEqual(pendingConnections(null), [])
  assert.deepEqual(pendingConnections({ offers: new Map() }), [])
  assert.deepEqual(pendingConnections({ inbound: [] }), [])
})
