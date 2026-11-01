/**
 * The only code in this app that opens a connection to anything other than the
 * device on the other end of a QR code.
 *
 * It lives in a module of its own so `import()` can keep it out of the page
 * until somebody presses the button: the bundler splits it into a chunk, and a
 * page nobody publishes from never fetches that chunk. This is not an
 * optimisation. "Nothing connects by default" is the claim the whole demo
 * makes, and a claim that rests on a flag not being set is weaker than one
 * where the code is not in the page at all.
 *
 * ## A node of its own, not the one being measured
 *
 * The measuring node has one transport and no relay, and that is precisely
 * what makes its measurements mean anything. Giving it a relay in order to
 * publish would change the thing under test - every run after the first
 * publish would be measuring a different browser. So publishing starts a
 * second node, uses it, and stops it again.
 *
 * ## Where the relay comes from
 *
 * Not from a constant. These relays are redeployed and their addresses and
 * peer ids change with the deployment, so a hardcoded multiaddr is a time bomb
 * with a long fuse. `@le-space/aleph-bootstrap` publishes the current set and
 * `browserDialableOnly` drops the ones a browser cannot dial anyway.
 *
 * ## The address is the agreement, and it answers "who may write"
 *
 * An OrbitDB address is the hash of its manifest - the name, the type and the
 * access controller - so the same three produce the same address on every
 * device, with nobody to ask and nothing to configure.
 *
 * `write: ['*']` is part of that hash, which turns the governance question
 * into an arithmetic one: an allow-list would put the contributors *into the
 * address*, so admitting the second contributor would produce a different
 * database and strand everything written to the first. Open writes keep one
 * address forever. Every entry is signed by its author, so provenance
 * survives, and noise becomes something a reader filters rather than something
 * a person has to gatekeep - which is the right shape for a dataset nobody
 * owns (#179).
 */

/**
 * Name and type, the two halves of the address that are not the access
 * controller. `events` rather than `documents`: the dataset is append-only by
 * intent, and a type that offers `del` would be offering something the
 * argument above says must not exist.
 */
export const DATABASE_NAME = 'webrtc-qr-field-results'
export const DATABASE_TYPE = 'events'

/**
 * How long to wait for somebody to be listening before writing.
 *
 * Writing to OrbitDB is a local act: `db.add` returns having touched nothing
 * but this device's own storage, and the rows reach the world only when a peer
 * replicates them. A publish that reported success on the strength of a local
 * write would be the worst possible lie here, because the person would then
 * clear their log.
 */
const JOIN_TIMEOUT_MS = 30_000

/** And how long to let the heads travel once they have somewhere to go. */
const SETTLE_MS = 3_000

const timeout = (ms, message) => new Promise((resolve, reject) => {
  setTimeout(() => reject(new Error(message)), ms)
})

/**
 * Hand the projected rows to the published database.
 *
 * Resolves with the address they went to. Rejects - having written nothing, or
 * having written locally and said so - if there was no relay to reach or
 * nobody on the other side of it.
 *
 * @param {object[]} rows already projected by publish.js; this function adds
 *   nothing to them and removes nothing from them, so what the person saw in
 *   the preview is exactly what is written.
 */
export async function publishRows (rows, { onProgress = () => {} } = {}) {
  if (rows.length === 0) {
    throw new Error('Nothing to publish.')
  }

  onProgress('finding')

  const { discoverAlephBootstrapMultiaddrs } = await import('@le-space/aleph-bootstrap')
  const list = await discoverAlephBootstrapMultiaddrs({ browserDialableOnly: true })

  if (list.length === 0) {
    throw new Error('No relay to publish through: the bootstrap list came back empty. Nothing has left this device.')
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
    // Nothing to listen on: this node exists to push a handful of entries
    // through a relay and then stop. It is not reachable and does not need to
    // be.
    addresses: { listen: [] },
    transports: [webSockets(), circuitRelayTransport()],
    connectionEncrypters: [noise()],
    streamMuxers: [yamux()],
    peerDiscovery: [bootstrap({ list })],
    services: {
      identify: identify(),
      // OrbitDB's sync is pubsub. `allowPublishToZeroTopicPeers` keeps the
      // first publish from throwing while the mesh is still forming - whether
      // anybody actually heard it is decided below, by waiting for a join.
      pubsub: gossipsub({ allowPublishToZeroTopicPeers: true })
    }
  })

  let helia
  let orbitdb
  let db

  try {
    // Composed rather than configured. Helia 7 no longer takes a `libp2p` in
    // `createHelia`: it builds one of its own and quietly ignores yours, and
    // the first sign of it is OrbitDB's sync reaching for a pubsub service
    // that is not there. `dag-cbor` is explicit because OrbitDB's manifests
    // are written with it and the light stack ships no codecs by default.
    helia = await withBitswap(withLibp2p(createHeliaLight({ codecs: [dagCbor] }), libp2p))
    await helia.start()

    // Built from the ipfs instance, so the keys live in the same (in-memory)
    // store as everything else here and nothing is written to disk. The
    // consequence is deliberate: each publish signs with an identity of its
    // own, so the rows a person publishes on different evenings cannot be
    // linked to each other by anything but their contents. A durable
    // pseudonym would make a contributor filterable - and would also be a
    // durable pseudonym, which nobody asked this page for.
    const identities = await Identities({ ipfs: helia })

    orbitdb = await createOrbitDB({ ipfs: helia, identities })

    onProgress('opening')

    db = await orbitdb.open(DATABASE_NAME, {
      type: DATABASE_TYPE,
      AccessController: IPFSAccessController({ write: ['*'] })
    })

    const address = db.address.toString()

    onProgress('waiting', { address })

    // Somebody has to be on the other side. Subscribed before the write rather
    // than checked after it: a peer that joins later gets the entries by
    // ordinary replication, but a publish that *returns* before anybody has
    // joined has no basis for telling the person their rows are safe to clear.
    await Promise.race([
      new Promise(resolve => db.events.once('join', resolve)),
      timeout(JOIN_TIMEOUT_MS, 'Connected to a relay, but nobody is holding this database: no peer joined within 30 seconds. A relay forwards; it does not keep. Until something pins this address, there is nowhere for the rows to live - so nothing has been published and they are all still here.')
    ])

    onProgress('writing', { address, total: rows.length })

    let written = 0

    for (const row of rows) {
      await db.add(row)
      written += 1
      onProgress('writing', { address, written, total: rows.length })
    }

    // The heads are announced on the pubsub topic as they are written; this is
    // the grace the announcement needs to be fetched before the node that made
    // it disappears.
    await new Promise(resolve => setTimeout(resolve, SETTLE_MS))

    return { address, written }
  } finally {
    // In this order, and all of them: a node left running would keep the
    // connection this whole design exists to make momentary.
    await db?.close().catch(() => {})
    await orbitdb?.stop().catch(() => {})
    await helia?.stop().catch(() => {})
    await libp2p.stop().catch(() => {})
  }
}
