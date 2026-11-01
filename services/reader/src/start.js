/**
 * The three halves wired together: hold the database, fold it into a table,
 * serve the table.
 *
 * The order matters on startup and is the opposite of what it looks like. The
 * HTTP server comes up *first*, before any relay is contacted, so that
 * `/status.json` can say "not holding anything yet" out loud instead of
 * refusing connections while a bootstrap list is fetched. A monitoring check
 * that cannot distinguish "starting" from "down" produces exactly the kind of
 * silence this service exists to prevent.
 */

import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { mirror, summarise, toCsv } from './mirror.js'
import { replicate } from './replicate.js'
import { serve } from './serve.js'

/** Rebuilding on every single entry of a bulk replication would be waste. */
const REBUILD_DEBOUNCE_MS = 500

const empty = {
  rows: [],
  rejected: [],
  replays: [],
  stats: { entries: 0, rows: 0, rejected: 0, replays: 0, forgedReplays: 0, truncated: 0, unknownFields: {} },
  summary: { runs: 0 },
  address: null,
  peerId: null,
  addresses: [],
  peers: 0,
  updatedAt: null
}

/**
 * Where the relays come from.
 *
 * Not a constant: these are redeployed and their peer ids change with the
 * deployment, so a hardcoded multiaddr is a time bomb with a long fuse. The
 * same discovery the browser uses, for the same reason - and with
 * `browserDialableOnly`, so this node takes its reservations on exactly the
 * relays a browser can reach. A relay only this service could dial would be a
 * relay no publisher could ever meet it on.
 */
async function discoverRelays () {
  const { discoverAlephBootstrapMultiaddrs } = await import('@le-space/aleph-bootstrap')

  return discoverAlephBootstrapMultiaddrs({ browserDialableOnly: true })
}

export async function start ({
  directory,
  mirrorDirectory = null,
  port = 8787,
  host = '127.0.0.1',
  relays = null,
  log = () => {}
} = {}) {
  let state = { ...empty }

  /**
   * Reachability is read at the moment it is asked for, not folded into the
   * table.
   *
   * These two have different clocks and conflating them was a bug: the mirror
   * is rebuilt when the log changes, which on a quiet database is once at
   * startup - so a snapshot carrying the connection count reported zero
   * connections for hours while the node sat happily on a relay reservation.
   * The rows are a snapshot of something that only changes when it changes;
   * the network is not.
   */
  let reach = () => ({ connections: 0, subscribers: 0, addresses: [] })

  const http = await serve({ snapshot: () => ({ ...state, ...reach() }), port, host })

  log({ type: 'serving', port: http.port, host })

  const list = relays ?? await discoverRelays()

  log({ type: 'relays', count: list.length })

  if (mirrorDirectory != null) await mkdir(mirrorDirectory, { recursive: true })

  const replication = await replicate({ directory, relays: list, onEvent: log })

  reach = replication.reach

  let timer = null
  let rebuilding = false

  const rebuild = async () => {
    if (rebuilding) return

    rebuilding = true

    try {
      const result = mirror(await replication.entries())

      state = {
        ...result,
        summary: summarise(result.rows),
        address: replication.address,
        peerId: replication.peerId,

        peers: replication.db.peers?.size ?? 0,
        updatedAt: new Date().toISOString()
      }

      log({ type: 'mirrored', ...result.stats })

      // A copy on disk as well as in memory, so the table outlives the process
      // and can be served by a plain web server, or committed, or attached to
      // a mail. The mirror is derived data - deleting it is always safe,
      // because the log is the store.
      if (mirrorDirectory != null) {
        await writeFile(join(mirrorDirectory, 'results.csv'), toCsv(state.rows))
        await writeFile(join(mirrorDirectory, 'results.json'), `${JSON.stringify(state.rows, null, 2)}\n`)
        await writeFile(join(mirrorDirectory, 'summary.json'), `${JSON.stringify({ ...state.summary, ...state.stats }, null, 2)}\n`)
      }
    } catch (error) {
      log({ type: 'error', message: `mirror failed: ${error?.message ?? error}` })
    } finally {
      rebuilding = false
    }
  }

  const scheduleRebuild = () => {
    clearTimeout(timer)
    timer = setTimeout(() => { rebuild().catch(() => {}) }, REBUILD_DEBOUNCE_MS)
  }

  replication.db.events.on('update', scheduleRebuild)
  // A join is not an update, and waiting for one would leave the table empty
  // after a restart until somebody published again.
  replication.db.events.on('join', scheduleRebuild)

  await rebuild()

  return {
    address: replication.address,
    peerId: replication.peerId,
    port: http.port,
    snapshot: () => ({ ...state, ...reach() }),
    close: async () => {
      clearTimeout(timer)
      await http.close()
      await replication.close()
    }
  }
}
