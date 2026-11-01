/**
 * The table over HTTP.
 *
 * Deliberately small. The reader's job is to make a distributed log into
 * something a person can query, and the cheapest honest way to do that is to
 * serve a CSV and let a real query engine do the querying - DuckDB reads one
 * straight off a URL, so "every mobile-data attempt in DE with Chrome" is the
 * line of SQL #179 asks for and this service owns no query engine at all.
 *
 * Everything served here is a mirror of a public, append-only log. There is no
 * route that writes, because there is nothing a reader should be able to
 * change: correcting the dataset would mean a service deciding what the
 * dataset says, which is the opposite of the point. The way to change what is
 * published is to publish.
 *
 * `/rejected.json` is here for the same reason. The reader filters noise
 * because the database admits anyone, and a filter whose removals cannot be
 * inspected is just an opinion with a URL.
 */

import { createServer } from 'node:http'

import { COLUMNS, filterRows, toCsv } from './mirror.js'

const json = (response, status, body) => {
  const text = JSON.stringify(body, null, 2)

  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(text),
    // Public data, and step 7's page will fetch it from somewhere else
    // entirely. There is nothing here to protect with an origin check and no
    // credential a browser could send that would mean anything.
    'access-control-allow-origin': '*',
    'cache-control': 'no-cache'
  })
  response.end(text)
}

const INDEX = address => `webrtc-qr field results - reader

A mirror of the published OrbitDB database at
  ${address ?? '(not open yet)'}

  /results.csv      the table; filterable by any low-cardinality column,
                    e.g. /results.csv?scenario=mobile-data&country=DE
  /results.json     the same rows as JSON
  /summary.json     counts, and what the dataset does not cover
  /rejected.json    entries this reader would not mirror, and why
  /status.json      what this node is connected to

Every column is what a contributor reported. Nothing here was measured by this
service, and a flood of rows from one author is visible in the author column
rather than averaged into the totals.

One line of SQL:

  duckdb -c "select provider, count(*) filter (where outcome='connected') \\
    from read_csv_auto('http://localhost:8787/results.csv') group by 1"
`

/**
 * An HTTP front for whatever the mirror currently says.
 *
 * @param {object} options
 * @param {() => object} options.snapshot returns the latest
 *   `{ rows, rejected, replays, stats, summary, address, peerId, peers }`.
 *   A function rather than a value, so the server never holds a stale copy and
 *   the mirror can be rebuilt underneath it.
 */
export function serve ({ snapshot, port = 8787, host = '127.0.0.1' }) {
  const server = createServer((request, response) => {
    const url = new URL(request.url, `http://${request.headers.host ?? 'localhost'}`)
    const query = Object.fromEntries(url.searchParams)
    const state = snapshot()

    if (request.method !== 'GET' && request.method !== 'HEAD') {
      // Not 404: the route exists, writing to it does not. Worth saying
      // plainly rather than pretending the reader is incomplete.
      json(response, 405, { error: 'This service only reads. Entries reach the dataset by being published to the database, not by being posted here.' })
      return
    }

    switch (url.pathname) {
      case '/': {
        const body = INDEX(state.address)

        response.writeHead(200, { 'content-type': 'text/plain; charset=utf-8', 'content-length': Buffer.byteLength(body) })
        response.end(body)
        return
      }

      case '/results.csv': {
        const body = toCsv(filterRows(state.rows, query), COLUMNS)

        response.writeHead(200, {
          'content-type': 'text/csv; charset=utf-8',
          'content-length': Buffer.byteLength(body),
          'access-control-allow-origin': '*',
          'cache-control': 'no-cache'
        })
        response.end(body)
        return
      }

      case '/results.json':
        json(response, 200, { address: state.address, rows: filterRows(state.rows, query) })
        return

      case '/summary.json':
        json(response, 200, { address: state.address, ...state.summary, ...state.stats })
        return

      case '/rejected.json':
        json(response, 200, { rejected: state.rejected, replays: state.replays })
        return

      case '/status.json':
        json(response, 200, {
          address: state.address,
          peerId: state.peerId,
          addresses: state.addresses ?? [],
          connections: state.connections ?? 0,
          peers: state.peers ?? 0,
          // Peers subscribed to this database's topic. Zero while nothing
          // else holds it, which is a different failure from a publisher that
          // cannot reach what does.
          subscribers: state.subscribers ?? 0,
          // The one number that says whether publishing works right now: a
          // publisher waits for a peer to join before it writes, and this node
          // is that peer.
          holding: state.address != null,
          entries: state.stats?.entries ?? 0,
          updatedAt: state.updatedAt ?? null
        })
        return

      default:
        json(response, 404, { error: 'No such route.', routes: ['/', '/results.csv', '/results.json', '/summary.json', '/rejected.json', '/status.json'] })
    }
  })

  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, host, () => {
      resolve({
        port: server.address().port,
        close: () => new Promise(done => server.close(done))
      })
    })
  })
}
