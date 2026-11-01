import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'

import { mirror, summarise } from '../src/mirror.js'
import { serve } from '../src/serve.js'

/**
 * The HTTP front, driven without a relay or a database.
 *
 * `serve` takes a snapshot *function* rather than a value precisely so this is
 * possible: the server has no opinion about where the table came from, which
 * makes the routes testable on their own and keeps a stale copy from being
 * held anywhere.
 */

const row = (over = {}) => ({
  v: 1,
  id: 'm9k2x1-ab3c',
  at: '2026-11-01T21:00:00Z',
  scenario: 'mobile-data',
  role: 'offering',
  outcome: 'failed',
  country: 'DE',
  provider: 'Vodafone DE',
  engine: 'Chrome',
  version: '142',
  review: 'sound',
  ...over
})

const entry = (value, identity = 'author-one') => ({ hash: `zdpu${Math.random().toString(36).slice(2, 10)}`, identity, value })

const result = mirror([
  entry(row({ id: 'a-1', country: 'DE' })),
  entry(row({ id: 'b-2', country: 'AT' })),
  entry({ v: 1, at: 'whenever' })
])

const state = {
  ...result,
  summary: summarise(result.rows),
  address: '/orbitdb/zdpuTestAddress',
  peerId: '12D3KooTest',
  addresses: ['/dns4/relay.example/tcp/443/wss/p2p/12D3KooRelay/p2p-circuit/p2p/12D3KooTest'],
  peers: 1,
  updatedAt: '2026-11-01T21:30:00Z'
}

let http
const url = path => `http://127.0.0.1:${http.port}${path}`

before(async () => {
  // Port 0: the OS picks a free one, so the suite does not fight whatever is
  // already listening on a developer's machine.
  http = await serve({ snapshot: () => state, port: 0 })
})

after(async () => { await http.close() })

test('the table comes out as CSV, filterable by column', async () => {
  const all = await fetch(url('/results.csv'))

  assert.equal(all.status, 200)
  assert.match(all.headers.get('content-type'), /text\/csv/)
  // Public data that step 7's page will fetch from somewhere else entirely.
  assert.equal(all.headers.get('access-control-allow-origin'), '*')

  const lines = (await all.text()).trim().split('\n')

  assert.equal(lines.length, 3)

  const filtered = (await (await fetch(url('/results.csv?country=AT'))).text()).trim().split('\n')

  assert.equal(filtered.length, 2)
  assert.match(filtered[1], /AT/)
})

test('the summary says both what is there and what is missing', async () => {
  const body = await (await fetch(url('/summary.json'))).json()

  assert.equal(body.runs, 2)
  assert.equal(body.coverage.countries, 2)
  // The mirror's own counts travel with it: a summary that hid how much was
  // rejected would read as a cleaner dataset than it is.
  assert.equal(body.rejected, 1)
  assert.equal(body.entries, 3)
})

test('what the reader would not mirror is served too', async () => {
  const body = await (await fetch(url('/rejected.json'))).json()

  assert.equal(body.rejected.length, 1)
  assert.ok(body.rejected[0].problems.length > 0)
})

test('the status says whether anything is being held', async () => {
  const body = await (await fetch(url('/status.json'))).json()

  assert.equal(body.address, '/orbitdb/zdpuTestAddress')
  // The one number that says whether publishing works at all right now: a
  // publisher waits for a peer to join before writing, and this is that peer.
  assert.equal(body.holding, true)
  assert.equal(body.entries, 3)
  assert.match(body.addresses[0], /p2p-circuit/)
})

test('the index names the routes rather than assuming somebody read the README', async () => {
  const body = await (await fetch(url('/'))).text()

  assert.match(body, /\/results\.csv/)
  assert.match(body, /\/rejected\.json/)
  assert.match(body, /zdpuTestAddress/)
  // The sentence that has to survive every future rewrite of this page.
  assert.match(body, /reported/i)
})

test('posting to it is answered with what it is, not with a 404', async () => {
  const response = await fetch(url('/results.csv'), { method: 'POST', body: '{}' })

  assert.equal(response.status, 405)
  // The route exists; writing to it does not. Saying so is better than
  // implying the reader is half-built.
  assert.match((await response.json()).error, /only reads/i)
})

test('an unknown route lists the ones there are', async () => {
  const response = await fetch(url('/nope'))

  assert.equal(response.status, 404)
  assert.ok((await response.json()).routes.includes('/results.csv'))
})
