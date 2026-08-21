import assert from 'node:assert/strict'
import test from 'node:test'

import { findReachableRelays, readRelayOptIn, writeRelayOptIn } from '../src/elements/relay-choice.js'

const BAKED = ['/dns4/relay.example/tcp/443/tls/ws/p2p/12D3KooWBaked']
const FOUND = ['/dns4/found.example/tcp/443/tls/ws/p2p/12D3KooWFound']

test('a baked-in relay that answers ends the search before discovery', async () => {
  let discoverCalls = 0
  const result = await findReachableRelays({
    baked: BAKED,
    probe: async addresses => addresses,
    discover: async () => { discoverCalls++; return FOUND }
  })

  assert.deepEqual(result, { source: 'baked', addresses: BAKED, askedAleph: false })
  // The point of the order: a working known relay means no third party learns
  // that this device opened the app.
  assert.equal(discoverCalls, 0, 'discovery must not run when a shipped address answers')
})

test('discovery runs once the shipped addresses are silent', async () => {
  const result = await findReachableRelays({
    baked: BAKED,
    probe: async addresses => (addresses[0] === BAKED[0] ? [] : addresses),
    discover: async () => FOUND
  })

  assert.deepEqual(result, { source: 'aleph', addresses: FOUND, askedAleph: true })
})

test('what discovery returns is probed rather than trusted', async () => {
  // A registration outlives the machine it describes: a public registry cannot
  // forget an orphan, so "discovered" is not "alive".
  const result = await findReachableRelays({
    baked: [],
    probe: async () => [],
    discover: async () => FOUND
  })

  assert.deepEqual(result, { source: 'none', addresses: [], askedAleph: true })
})

test('no discover function means no discovery, not a thrown error', async () => {
  const result = await findReachableRelays({ baked: BAKED, probe: async () => [] })

  assert.deepEqual(result, { source: 'none', addresses: [], askedAleph: false })
})

test('blank entries never reach the probe', async () => {
  let probed = false
  const result = await findReachableRelays({
    baked: ['', '   '],
    probe: async () => { probed = true; return [] }
  })

  assert.equal(probed, false)
  assert.equal(result.source, 'none')
})

test('a choice is off until stored, and survives being stored either way', () => {
  const store = new Map()
  const storage = {
    getItem: key => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => store.set(key, value)
  }

  assert.equal(readRelayOptIn(storage, 'app.relay'), false)

  assert.equal(writeRelayOptIn(storage, 'app.relay', true), true)
  assert.equal(readRelayOptIn(storage, 'app.relay'), true)

  writeRelayOptIn(storage, 'app.relay', false)
  assert.equal(readRelayOptIn(storage, 'app.relay'), false)
})

test('no key means no persistence, and no exception either', () => {
  const storage = { getItem: () => 'true', setItem: () => { throw new Error('must not be called') } }

  // Storing under a key we invented would put our namespace in their origin,
  // so a consumer that passes none gets a switch that lasts the session.
  assert.equal(readRelayOptIn(storage, null), false)
  assert.equal(writeRelayOptIn(storage, null, true), false)
})

test('a blocked store reads as off rather than throwing into the page', () => {
  const blocked = {
    getItem () { throw new Error('SecurityError') },
    setItem () { throw new Error('SecurityError') }
  }

  assert.equal(readRelayOptIn(blocked, 'app.relay'), false)
  assert.equal(writeRelayOptIn(blocked, 'app.relay', true), false)
})
