import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, test } from 'node:test'

import { DATABASE_NAME, DATABASE_TYPE, openDatabase } from '../src/database.js'
import { mirror } from '../src/mirror.js'

/**
 * The read path, run for real against a real OrbitDB - and with no network.
 *
 * This service hands OrbitDB three members of an IPFS node instead of a Helia
 * instance, because in Node a Helia import drags a native WebRTC module in
 * behind it and the reader has no use for WebRTC at all. That saving is only
 * safe while the assumption behind it holds, and the assumption is about
 * somebody else's library: *OrbitDB reaches for `libp2p`, `blockstore` and
 * `pins`, and nothing more.* A version that wanted a fourth would fail here
 * rather than in a deployment.
 *
 * `sync: false` is what makes the whole thing offline: the sync protocol is
 * the only part that needs a working libp2p, so without it a stub suffices and
 * the log, the identities, the keystore, the blockstore shim and the iterator
 * are all exercised as they really are.
 *
 * The test writes to the database. The service never does - that is the point
 * of it - so the write is here, in the test, standing in for the publisher.
 */

/** Everything OrbitDB touches on a libp2p when its sync is not started. */
const stubLibp2p = {
  peerId: { toString: () => '12D3KooWStubbedReaderPeer' },
  services: { pubsub: {} }
}

const published = (over = {}) => ({
  v: 1,
  id: 'm9k2x1-ab3c',
  at: '2026-11-01T21:00:00Z',
  scenario: 'across-networks',
  role: 'offering',
  outcome: 'connected',
  country: 'DE',
  provider: 'Telekom',
  engine: 'Gecko',
  version: '146',
  ms: 8421,
  review: 'sound',
  ...over
})

let directory
let database

before(async () => {
  directory = await mkdtemp(join(tmpdir(), 'webrtc-qr-reader-'))
  database = await openDatabase({ libp2p: stubLibp2p, directory, sync: false })
})

after(async () => {
  await database?.close()
  await rm(directory, { recursive: true, force: true })
})

test('OrbitDB opens on the three members this service provides', () => {
  // If this throws rather than fails, the library now wants something the shim
  // does not have, and the comment in database.js about why Helia is absent
  // has stopped being true.
  assert.match(database.address, /^\/orbitdb\/zdpu/)
  assert.equal(database.db.name, DATABASE_NAME)
  assert.equal(database.db.type, DATABASE_TYPE)
})

test('the address is the hash of the agreement, not of this machine', async () => {
  // Opened twice in two directories with two identities, and the address is
  // the same both times - which is the property the whole design rests on: a
  // publisher and a reader that have never met land on one database with
  // nothing to configure.
  const elsewhere = await mkdtemp(join(tmpdir(), 'webrtc-qr-reader-'))
  const second = await openDatabase({ libp2p: stubLibp2p, directory: elsewhere, sync: false })

  try {
    assert.equal(second.address, database.address)
  } finally {
    await second.close()
    await rm(elsewhere, { recursive: true, force: true })
  }
})

test('entries come back oldest first, each with who signed it', async () => {
  await database.db.add(published({ id: 'aaa-1111' }))
  await database.db.add(published({ id: 'bbb-2222' }))

  const entries = await database.entries()

  assert.deepEqual(entries.map(entry => entry.value.id), ['aaa-1111', 'bbb-2222'])
  // The reason for reading the oplog rather than `db.all()`: the events
  // store's own iterator drops the identity, and the identity is the column
  // that makes an open-write dataset auditable.
  assert.ok(entries.every(entry => typeof entry.identity === 'string' && entry.identity.length > 0))
  assert.ok(entries.every(entry => typeof entry.hash === 'string'))
})

test('the whole path holds: a written row comes back as a table row', async () => {
  const { rows, stats } = mirror(await database.entries())

  assert.equal(stats.rejected, 0)
  assert.equal(rows.length, 2)
  assert.equal(rows[0].provider, 'Telekom')
  assert.equal(rows[0].scenario, 'across-networks')
  assert.equal(rows[0].author, (await database.entries())[0].identity)
})

test('what was written survives a restart, because that is the service', async () => {
  // The finding this whole file exists under: nothing else holds this
  // database, so a reader whose storage did not survive a restart would lose
  // every row anybody had published to it.
  await database.close()

  database = await openDatabase({ libp2p: stubLibp2p, directory, sync: false })

  const { rows } = mirror(await database.entries())

  assert.equal(rows.length, 2)
})
