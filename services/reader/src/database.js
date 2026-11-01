/**
 * Opening the published database, without an IPFS node.
 *
 * ## Why there is no Helia here
 *
 * The publisher runs OrbitDB on Helia, as everyone does. In Node that costs
 * more than it looks: importing `helia` statically pulls in `@helia/libp2p`,
 * whose barrel re-exports its default libp2p configuration, which imports
 * `@libp2p/webrtc`, which loads a **native** module (`node-datachannel`). In a
 * browser the equivalent resolves to the platform's own WebRTC and nothing is
 * compiled; in Node the service will not start without a build toolchain and a
 * binary download at install time. For a reader that has no use whatsoever for
 * WebRTC, that is a dependency on a compiler in order to avoid using a feature.
 *
 * OrbitDB turns out to want exactly three things from an IPFS node, and the
 * grep that says so is short: `ipfs.libp2p`, `ipfs.blockstore` and
 * `ipfs.pins`. So this provides those three, and the result is a service with
 * no IPFS retrieval path at all - which is not a shortcut but a better fit for
 * what it is. A reader that could fetch blocks from the wider network would be
 * a different trust story than one that can only hold what was handed to it.
 *
 * ## How entries arrive without bitswap
 *
 * They were never going to arrive by bitswap. OrbitDB's sync publishes each
 * entry's bytes on the database's pubsub topic and exchanges heads over a
 * libp2p stream - both of them direct, neither of them a content fetch. The
 * one thing a fetch would be needed for is a manifest this node does not have,
 * and that case does not arise: the database is opened **by name**, so the
 * manifest is built locally from the name, the type and the access controller,
 * and the address is the hash of what was built. Which is also why the three
 * must match the publisher's exactly - see `test/agreement.test.js`.
 */

import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'

/**
 * Name and type. The same two strings as the demo's `publish-network.js`, and
 * identical by necessity rather than by convention: an OrbitDB address is the
 * hash of its manifest, so a typo here does not fail - it opens a second,
 * empty database and replicates happily with nobody, while both sides report
 * success.
 */
export const DATABASE_NAME = 'webrtc-qr-field-results'
export const DATABASE_TYPE = 'events'

/**
 * The three members OrbitDB reaches for, and nothing else.
 *
 * `pins` is a no-op on purpose and the comment matters more than the code:
 * nothing in this service deletes a block, and there is no garbage collector
 * to protect anything from, so **being on disk is being pinned**. A pin store
 * here would be bookkeeping about a collection that never runs.
 */
export function ipfsFor (blockstore) {
  return {
    blockstore,
    pins: {
      isPinned: async () => true,
      add: async function * () {}
    }
  }
}

/**
 * Open the published database and hand back a way to read it.
 *
 * Takes a libp2p rather than making one, so the whole read path - the shim,
 * the iterator, the identity each entry carries - can be exercised against a
 * stub with no relay, no sockets and no network. That test is the only thing
 * standing between "OrbitDB wants three members from an IPFS node" and a
 * version of OrbitDB that wants four.
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
    { FsBlockstore }
  ] = await Promise.all([
    import('@orbitdb/core'),
    import('blockstore-fs')
  ])

  const blockstore = new FsBlockstore(join(directory, 'blocks'))

  await blockstore.open()

  const ipfs = { ...ipfsFor(blockstore), libp2p }

  let orbitdb
  let db

  const close = async () => {
    await db?.close().catch(() => {})
    await orbitdb?.stop().catch(() => {})
    await blockstore.close().catch(() => {})
  }

  try {
    // No `identities` built here on purpose. `Identities({ ipfs })` puts its
    // key storage at `./orbitdb/identities` relative to wherever the process
    // was *started*, which for a service whose entire contract is "everything
    // lives under --directory" is the kind of bug that surfaces only as a
    // second instance refusing to start on a level lock it cannot see. Left to
    // OrbitDB, the keystore lands under the directory with the heads and the
    // manifests, and the service keeps one identity across restarts - which it
    // signs nothing with, since it never writes, but which lets a publisher's
    // libp2p remember having reached this peer.
    orbitdb = await createOrbitDB({ ipfs, directory: join(directory, 'orbitdb') })

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
