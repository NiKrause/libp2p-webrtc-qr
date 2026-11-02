/**
 * Reading the published dataset, in the browser, with nobody's server in the
 * middle.
 *
 * This is the sibling of `publish-network.js` and it is deliberately the same
 * shape: a module of its own, imported dynamically, holding every line that
 * can open a connection. The difference is which promise each one keeps.
 * `publish-network.js` exists so the *measuring* page connects to nothing
 * until somebody presses a button. This one exists so the results page is
 * honest about being a page that connects - it says so above the fold, and
 * then it does, because a page of results that makes you ask for the results
 * is a worse page.
 *
 * ## Why not fetch a CSV from a server
 *
 * `services/reader` already serves one, and a `fetch` would have been a
 * tenth of this code. It would also have made the page a client of one
 * machine: when that machine is off, the dataset is gone, and the claim that
 * nobody owns this data would be true only on paper. Opening the database
 * here means the page reads from whoever happens to hold it - the relay, the
 * reader, another visitor's tab - and the reader becomes what it says it is,
 * a second home rather than the source.
 *
 * ## It never writes
 *
 * There is no `db.add` in this file and the identity is thrown away with the
 * node. A reader that could write is a reader somebody has to be trusted not
 * to - and the access controller lets anyone write, so the restraint has to
 * be visible in the code rather than enforced by the database.
 */

import { DATABASE_NAME, DATABASE_TYPE } from './publish-network.js'

export { DATABASE_NAME, DATABASE_TYPE }

/**
 * How long to wait for somebody who has the data.
 *
 * Opening succeeds immediately and locally - the address is a hash of the
 * manifest, so it can be computed without asking anyone. An empty table after
 * a successful open therefore means nothing at all until a peer has joined,
 * which is why the page waits for one before it says the dataset is empty.
 */
const JOIN_TIMEOUT_MS = 30_000

/**
 * And how long to let entries arrive after the first peer joins.
 *
 * Heads arrive before the entries behind them, so the first `update` is not
 * the last. The page re-renders on every one; this is only the point at which
 * it stops saying "loading".
 */
const SETTLE_MS = 2_000

/**
 * Open the published database and keep it open.
 *
 * @param {object} [options]
 * @param {(event: string, detail?: object) => void} [options.onProgress] stage
 *   changes, for the line the visitor reads while this happens
 * @param {(detail?: object) => void} [options.onUpdate] called whenever
 *   entries arrive, and on a join with `{ announced }` - the heads the other
 *   peer says it has - so the page can tell an empty dataset from one it
 *   cannot read; replication does not stop when this resolves
 * @returns {Promise<{ address: string, entries: () => Promise<object[]>, peers: () => number, close: () => Promise<void> }>}
 */
export async function openPublishedDatabase ({ onProgress = () => {}, onUpdate = () => {} } = {}) {
  onProgress('finding')

  const { discoverAlephBootstrapMultiaddrs } = await import('@le-space/aleph-bootstrap')
  const list = await discoverAlephBootstrapMultiaddrs({ browserDialableOnly: true })

  if (list.length === 0) {
    throw new Error('No relay to read through: the bootstrap list came back empty.')
  }

  onProgress('connecting')

  const [
    { createLibp2p }, { createHeliaLight }, { withLibp2p }, { withBitswap }, dagCbor,
    { createOrbitDB, Identities, IPFSAccessController },
    { webSockets }, { circuitRelayTransport }, { bootstrap },
    { noise }, { yamux }, { identify }, { gossipsub }
  ] = await Promise.all([
    import('libp2p'), import('helia'), import('@helia/libp2p'), import('@helia/bitswap'), import('@ipld/dag-cbor'),
    import('@orbitdb/core'),
    import('@libp2p/websockets'), import('@libp2p/circuit-relay-v2'), import('@libp2p/bootstrap'),
    import('@chainsafe/libp2p-noise'), import('@chainsafe/libp2p-yamux'),
    import('@libp2p/identify'), import('@libp2p/gossipsub')
  ])

  const libp2p = await createLibp2p({
    // Nothing to listen on. This tab wants the entries, not visitors: a
    // circuit reservation would make it a holder other peers dial, which is
    // the reader's job and not a page's.
    addresses: { listen: [] },
    transports: [webSockets(), circuitRelayTransport()],
    connectionEncrypters: [noise()],
    streamMuxers: [yamux()],
    peerDiscovery: [bootstrap({ list })],
    services: {
      identify: identify(),
      pubsub: gossipsub({ allowPublishToZeroTopicPeers: true })
    }
  })

  let helia
  let orbitdb
  let db
  let announced = 0

  try {
    helia = await withBitswap(withLibp2p(createHeliaLight({ codecs: [dagCbor] }), libp2p))
    await helia.start()

    // In memory and thrown away with the tab, like the publisher's. Reading
    // needs no identity at all; OrbitDB wants one to exist, so it gets one
    // that outlives nothing.
    const identities = await Identities({ ipfs: helia })

    orbitdb = await createOrbitDB({ ipfs: helia, identities })

    onProgress('opening')

    // By name, not by address, and with the same three inputs the publisher
    // uses. The address is the hash of exactly these, so agreeing on them is
    // what makes this the same database - and a typo would open an empty one
    // and replicate happily with nobody.
    // `sync: false`, then started by hand below. Replication otherwise begins
    // inside `open`, and the first heads can arrive - and fail to verify -
    // before there is anywhere to attach a listener. That error is the
    // difference between "nothing has been published" and "something was
    // published and this tab cannot check it", so losing it is not an option.
    db = await orbitdb.open(DATABASE_NAME, {
      type: DATABASE_TYPE,
      sync: false,
      AccessController: IPFSAccessController({ write: ['*'] })
    })

    const address = db.address.toString()

    db.events.on('update', () => onUpdate())

    // The join carries the heads the other peer is advertising, and that is
    // the number this page needs most. Measured on the first published row:
    // an entry can arrive and never become a row, because verifying it means
    // fetching the author's identity block over bitswap - and whoever holds
    // that block may be unreachable from a browser tab. The log then stays
    // empty, which looks exactly like a dataset nobody has written to.
    //
    // Counting advertised heads is deliberately a measurement of the symptom
    // rather than of the cause. OrbitDB reports the failure through an
    // `error` event on a queue task, which can fire before `open` has
    // returned and is easy to miss; a peer saying "I have heads" while this
    // log stays empty cannot be missed.
    db.events.on('join', (peerId, heads) => {
      announced = Math.max(announced, Array.isArray(heads) ? heads.length : 0)
      onUpdate({ announced })
    })

    db.events.on('error', error => {
      onUpdate({ announced, reason: error?.message ?? String(error) })
    })

    onProgress('waiting', { address })

    await db.sync.start()

    await Promise.race([
      new Promise(resolve => db.events.once('join', resolve)),
      new Promise(resolve => setTimeout(resolve, JOIN_TIMEOUT_MS))
    ])

    await new Promise(resolve => setTimeout(resolve, SETTLE_MS))

    const entries = async () => {
      // `db.log.iterator()` rather than `db.all()`: the log carries each
      // entry's `identity`, and `all()` drops it. The author column is the
      // only thing that makes a flood visible instead of averaged in.
      const all = []

      for await (const entry of db.log.iterator()) {
        all.push({ hash: entry.hash, identity: entry.identity, value: entry.payload?.value })
      }

      return all.reverse()
    }

    const peers = () => db.peers?.size ?? 0

    /** The most heads any peer has advertised on joining. */
    const announcedHeads = () => announced

    const close = async () => {
      await db?.close().catch(() => {})
      await orbitdb?.stop().catch(() => {})
      await helia?.stop().catch(() => {})
      await libp2p.stop().catch(() => {})
    }

    onProgress('reading', { address, peers: peers() })

    return { address, entries, peers, announced: announcedHeads, close }
  } catch (error) {
    await db?.close().catch(() => {})
    await orbitdb?.stop().catch(() => {})
    await helia?.stop().catch(() => {})
    await libp2p.stop().catch(() => {})
    throw error
  }
}
