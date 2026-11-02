/**
 * Holding the published database open, and never writing to it.
 *
 * ## A second home for the dataset, not the only one
 *
 * #179 describes this service as a convenience: "an append-only log is easy to
 * write and tedious to query", so something mirrors it into a table, and "it
 * may be an ordinary service, because it only reads what is already public".
 * That is true, and the first run of the publish half suggested something
 * stronger: six relays discovered, the database opened at its address, and
 * **no peer joined within thirty seconds**, so nothing was written.
 *
 * The reading that invited - "a relay forwards, it does not keep, so only this
 * service can hold the data" - is wrong, and the measurements are in
 * `README.md`. The public relay is an `orbitdb-relay`: it subscribes to every
 * `/orbitdb/` topic it hears announced and pins the database behind it. It now
 * holds this one, and a holder that opens the address gets a `join` from it in
 * about two seconds.
 *
 * What the thirty seconds of silence most likely was is the **first** holder
 * of a brand-new database paying a bootstrap cost: the relay has to hear the
 * announcement, fetch the manifest and open the database before it can join
 * anybody. That is not proven - that publish was never retried - and it is the
 * honest state of it.
 *
 * So the standing claim is the smaller one, and it still earns the service:
 * this is a second, durable home for a dataset whose other home is somebody
 * else's relay, and the only one that turns the log into a table. Persistence
 * matters for the same reason - a reader whose blocks lived in memory would
 * read the database beautifully and lose its own copy on every restart.
 *
 * ## It holds, and it does not write
 *
 * There is no `add` in this service and there must not be. Mirroring claims
 * rather than making them is the reader's entire claim to being trustworthy in
 * front of a dataset nobody owns. Holding is not writing - OrbitDB keeps the
 * entries it replicates in the blockstore, which is exactly the asymmetry the
 * design needs - and neither is serving a block somebody asked for, which is
 * what lets a pinning relay open this database at all (see `database.js`).
 *
 * ## Reachable without a public address
 *
 * The browser that publishes has WebSockets and a circuit-relay transport, and
 * OrbitDB's sync fetches heads over a libp2p stream rather than over pubsub -
 * so somebody has to be dialable. This node takes a reservation on each relay
 * and listens on the circuit address, which means no inbound port, no
 * certificate and no DNS name. It runs behind a domestic NAT, on the same
 * relays the browser bootstraps from, so neither side has an address compiled
 * into it.
 */

import { openDatabase } from './database.js'

export { DATABASE_NAME, DATABASE_TYPE } from './database.js'

/**
 * Open the published database over a relayed libp2p node, and keep it.
 *
 * @param {object} options
 * @param {string} options.directory where the blocks, the heads and the
 *   keystore live. The whole point of the service, so it has no default.
 * @param {string[]} options.relays multiaddrs to bootstrap from and to take
 *   reservations on.
 * @param {(event: object) => void} [options.onEvent] progress, as plain
 *   objects for whatever is logging.
 */
export async function replicate ({ directory, relays, onEvent = () => {} }) {
  if (relays == null || relays.length === 0) {
    throw new Error('No relays: this node has no public address of its own, so without one it cannot be reached and cannot hold anything.')
  }

  const [
    { createLibp2p },
    { webSockets }, { circuitRelayTransport }, { bootstrap },
    { noise }, { yamux }, { identify }, { ping }, { gossipsub }
  ] = await Promise.all([
    import('libp2p'),
    import('@libp2p/websockets'), import('@libp2p/circuit-relay-v2'), import('@libp2p/bootstrap'),
    import('@chainsafe/libp2p-noise'), import('@chainsafe/libp2p-yamux'),
    import('@libp2p/identify'), import('@libp2p/ping'), import('@libp2p/gossipsub')
  ])

  const libp2p = await createLibp2p({
    addresses: {
      // A bare `/p2p-circuit` rather than one listen address per relay, and
      // the difference is startup. Listening on `<relay>/p2p-circuit` for each
      // of them makes libp2p wait for a reservation on *every* one before it
      // reports started, so a single relay in the discovered list that no
      // longer answers hangs the service indefinitely - which it did, on the
      // first run against the live list. This form takes reservations as
      // relays turn up among the bootstrap connections, so a dead one costs
      // nothing. `/status.json` reports the circuit addresses once they exist.
      listen: ['/p2p-circuit']
    },
    transports: [webSockets(), circuitRelayTransport()],
    connectionEncrypters: [noise()],
    streamMuxers: [yamux()],
    peerDiscovery: [bootstrap({ list: relays })],
    services: {
      identify: identify(),
      ping: ping(),
      // How OrbitDB announces heads, and how entries themselves travel.
      // Unlike the publisher's, this node's subscription is the long-lived
      // one: it is the peer a publisher waits for before it writes anything.
      pubsub: gossipsub({ allowPublishToZeroTopicPeers: true })
    }
  })

  let database

  try {
    onEvent({ type: 'started', peerId: libp2p.peerId.toString() })

    database = await openDatabase({ libp2p, directory })

    onEvent({ type: 'open', address: database.address })

    libp2p.addEventListener('self:peer:update', () => {
      const addresses = libp2p.getMultiaddrs().map(address => address.toString())

      if (addresses.length > 0) onEvent({ type: 'reachable', addresses })
    })

    database.db.events.on('join', (peerId, heads) => {
      onEvent({ type: 'join', peerId: peerId.toString(), heads: heads?.length ?? 0 })
    })

    database.db.events.on('leave', peerId => onEvent({ type: 'leave', peerId: peerId.toString() }))
    database.db.events.on('error', error => onEvent({ type: 'error', message: error?.message ?? String(error) }))

    return {
      address: database.address,
      peerId: libp2p.peerId.toString(),
      db: database.db,
      entries: database.entries,
      /**
       * Who else is listening on this database's topic, and who we are
       * connected to at all.
       *
       * OrbitDB's topic is the database address, so this is the one number
       * that distinguishes the two ways publishing can fail: nobody holding
       * the database at all, or somebody holding it that a publisher cannot
       * reach. Without it both look identical from the outside - a publish
       * that waits and then says nobody came - and they need opposite fixes.
       */
      reach: () => ({
        connections: libp2p.getConnections().length,
        // Which relays, not just how many. The discovered list spans more than
        // one machine and they are not the same software - one of them pins
        // OrbitDB databases and one is a plain circuit relay - so "connected
        // to two relays" and "connected to the relay that can hold this" are
        // different facts, and only the second one makes publishing work.
        relays: [...new Set(libp2p.getConnections().map(connection => connection.remotePeer.toString()))],
        subscribers: libp2p.services.pubsub.getSubscribers(database.address).map(peer => peer.toString()),
        addresses: libp2p.getMultiaddrs().map(address => address.toString())
      }),
      close: async () => {
        await database.close()
        await libp2p.stop().catch(() => {})
      }
    }
  } catch (error) {
    await database?.close()
    await libp2p.stop().catch(() => {})
    throw error
  }
}
