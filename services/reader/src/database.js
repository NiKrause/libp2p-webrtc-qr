/**
 * Opening the published database, and serving its blocks.
 *
 * ## Why this holds a full Helia, after an attempt not to
 *
 * OrbitDB turns out to want only three things from an IPFS node - the grep
 * over @orbitdb/core is short: `ipfs.libp2p`, `ipfs.blockstore`, `ipfs.pins` -
 * and this file briefly provided exactly those three. The motive was real: in
 * Node, importing `helia` statically pulls in `@helia/libp2p`, whose barrel
 * re-exports its default libp2p configuration, which imports `@libp2p/webrtc`,
 * which loads a **native** module. For a service with no use at all for
 * WebRTC, that is a native dependency in order to avoid using a feature.
 *
 * It was still wrong, and the relay said so. A pinning relay learns about a
 * database from a gossipsub announcement, so all it ever has is the
 * **address** - and opening a database by address means fetching its manifest
 * block, which happens over bitswap. A holder that serves no blocks therefore
 * cannot be pinned by anything: measured, the relay subscribed to the topic
 * and then never opened the database, while its sync queue showed nothing
 * stuck and nothing cooling down. Given a holder with bitswap, the same relay
 * joined the same address in under ten seconds and pinned it.
 *
 * So serving blocks is not an extra this service could do without - it is how
 * the dataset gets a second home. The native module costs a prebuilt binary at
 * install time (`allowBuilds: node-datachannel: true`), which downloads in a
 * second and needs no toolchain. The three-member shim is kept only as a note
 * in this comment, because the reasoning that led to it is the expensive part
 * to rediscover.
 *
 * ## What still never happens here
 *
 * Writing. There is no `add` in this service. Serving a block somebody asks
 * for is not authorship, and holding is not writing - which is exactly the
 * asymmetry a dataset nobody owns needs in front of it.
 */

import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'

/**
 * Name and type. The same two strings as the demo's `publish-network.js`, and
 * identical by necessity rather than by convention: an OrbitDB address is the
 * hash of its manifest, so a typo here does not fail - it opens a second,
 * empty database and replicates happily with nobody, while both sides report
 * success. `test/agreement.test.js` imports both and refuses to let them
 * drift.
 */
export const DATABASE_NAME = 'webrtc-qr-field-results'
export const DATABASE_TYPE = 'events'

/**
 * Open the published database and hand back a way to read it.
 *
 * Takes a libp2p rather than making one, so the composition below - and the
 * iterator, and the identity each entry carries - can be exercised against a
 * node with no transports and no listen addresses. That test needs no network
 * and still runs the real code path.
 *
 * @param {object} options
 * @param {import('libp2p').Libp2p} options.libp2p
 * @param {string} options.directory where blocks, heads and keys live
 * @param {boolean} [options.sync] false opens the database without starting
 *   the sync protocol, for tests
 */
export async function openDatabase ({ libp2p, directory, sync = true }) {
  await mkdir(directory, { recursive: true })

  const [
    { createOrbitDB, IPFSAccessController },
    { createHeliaLight }, { withLibp2p }, { withBitswap }, dagCbor,
    { FsBlockstore }, { FsDatastore }
  ] = await Promise.all([
    import('@orbitdb/core'),
    import('helia'), import('@helia/libp2p'), import('@helia/bitswap'), import('@ipld/dag-cbor'),
    import('blockstore-fs'), import('datastore-fs')
  ])

  let helia
  let orbitdb
  let db

  const close = async () => {
    await db?.close().catch(() => {})
    await orbitdb?.stop().catch(() => {})
    await helia?.stop().catch(() => {})
  }

  try {
    // Composed rather than configured. `createHelia` would add the HTTP layer
    // (trustless gateways and delegated routing), and Helia 7 no longer takes
    // a `libp2p` in `createHelia` at all - it builds one of its own and
    // quietly ignores yours, the first symptom being OrbitDB's sync reaching
    // for a pubsub service that is not there. `dag-cbor` is explicit because
    // OrbitDB's manifests are written with it and the light stack ships no
    // codecs.
    //
    // The stores are on disk, and that is the service: nothing else holds this
    // database, so a reader whose blocks lived in memory would read it
    // beautifully and lose it on restart.
    helia = await withBitswap(withLibp2p(createHeliaLight({
      blockstore: new FsBlockstore(join(directory, 'blocks')),
      datastore: new FsDatastore(join(directory, 'data')),
      codecs: [dagCbor]
    }), libp2p))

    await helia.start()

    // No `identities` built here on purpose. `Identities({ ipfs })` puts its
    // key storage at `./orbitdb` relative to wherever the process was
    // *started*, not under the directory it was given, which for a service
    // whose entire contract is "everything lives under --directory" surfaces
    // only as a second instance refusing to start on a level lock it cannot
    // see. Left to OrbitDB, the keystore lands with the heads and the
    // manifests, and the service keeps one identity across restarts - which it
    // signs nothing with, since it never writes, but which lets a publisher's
    // libp2p remember having reached this peer.
    orbitdb = await createOrbitDB({ ipfs: helia, directory: join(directory, 'orbitdb') })

    // Opened by name, not by address: the manifest is then built locally from
    // the name, the type and the access controller, and the address is the
    // hash of what was built. A relay only ever has the address, which is why
    // it needs the manifest block from somebody - see the top of this file.
    db = await orbitdb.open(DATABASE_NAME, {
      type: DATABASE_TYPE,
      AccessController: IPFSAccessController({ write: ['*'] }),
      sync
    })

    /**
     * Every entry in the log, oldest first, with who signed it.
     *
     * `db.log.iterator()` rather than `db.all()`: the events store's own
     * iterator yields the payload and the hash and throws the identity away,
     * and the identity is the column that makes an open-write dataset
     * auditable.
     */
    const entries = async () => {
      const all = []

      for await (const entry of db.log.iterator()) {
        all.push({ hash: entry.hash, identity: entry.identity, value: entry.payload?.value })
      }

      // The iterator walks newest first. A mirror reads better in the order
      // things happened, and `mirror()` keeps the *first* of a duplicated
      // attempt id, which should mean the earliest.
      return all.reverse()
    }

    return { orbitdb, db, address: db.address.toString(), entries, close }
  } catch (error) {
    await close()
    throw error
  }
}
