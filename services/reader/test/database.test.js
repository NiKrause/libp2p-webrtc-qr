import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, test } from 'node:test'

import { DATABASE_NAME, DATABASE_TYPE, openDatabase } from '../src/database.js'
import { mirror } from '../src/mirror.js'

/**
 * The read path, run for real - the real Helia, the real OrbitDB, the real
 * on-disk stores - and with no network.
 *
 * Offline without being fake: the libp2p below has **no transports and no
 * listen addresses**, so it cannot reach anything and nothing can reach it,
 * while still being a genuine libp2p that `withLibp2p` accepts and gossipsub
 * attaches to. `sync: false` keeps the sync protocol from starting, which is
 * the only part that would want peers. Everything else - the blockstore, the
 * datastore, the keystore, the manifest, the log, the iterator and the
 * identity on each entry - is exactly what runs in production.
 *
 * The test writes to the database. The service never does - that is the point
 * of it - so the write is here, standing in for the publisher.
 */

/**
 * A real libp2p that cannot talk to anybody.
 *
 * Not a stub: an earlier version of this test passed a hand-made object with a
 * `peerId` and an empty `pubsub`, which worked only while the service was
 * handing OrbitDB three members of an IPFS node instead of a Helia. Helia's
 * `withLibp2p` checks what it is given and builds its own node when the answer
 * is no, which would have quietly turned this into a networked test.
 */
const offlineLibp2p = async () => {
  const [{ createLibp2p }, { noise }, { yamux }, { identify }, { gossipsub }] = await Promise.all([
    import('libp2p'),
    import('@chainsafe/libp2p-noise'), import('@chainsafe/libp2p-yamux'),
    import('@libp2p/identify'), import('@libp2p/gossipsub')
  ])

  return createLibp2p({
    addresses: { listen: [] },
    transports: [],
    connectionEncrypters: [noise()],
    streamMuxers: [yamux()],
    services: { identify: identify(), pubsub: gossipsub({ allowPublishToZeroTopicPeers: true }) }
  })
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
let libp2p
let database

before(async () => {
  directory = await mkdtemp(join(tmpdir(), 'webrtc-qr-reader-'))
  libp2p = await offlineLibp2p()
  database = await openDatabase({ libp2p, directory, sync: false })
})

after(async () => {
  await database?.close()
  await libp2p?.stop()
  await rm(directory, { recursive: true, force: true })
})

test('the production composition opens the published database', () => {
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
  const other = await offlineLibp2p()
  const second = await openDatabase({ libp2p: other, directory: elsewhere, sync: false })

  try {
    assert.equal(second.address, database.address)
  } finally {
    await second.close()
    await other.stop()
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

  database = await openDatabase({ libp2p, directory, sync: false })

  const { rows } = mirror(await database.entries())

  assert.equal(rows.length, 2)
})
