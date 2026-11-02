import assert from 'node:assert/strict'
import { test } from 'node:test'

import { DATABASE_NAME as PUBLISHED_NAME, DATABASE_TYPE as PUBLISHED_TYPE } from '../../../examples/demo/publish-network.js'
import { projectForPublication } from '../../../examples/demo/publish.js'
import { COLUMNS, validateRow } from '../src/mirror.js'

/**
 * The two sides of the dataset, checked against each other.
 *
 * This is the only test here that reaches outside the service, and it is worth
 * the reach: the publisher and the reader have to agree on two things that no
 * runtime error would ever report.
 *
 * **The address.** An OrbitDB address is the hash of its manifest - the name,
 * the type and the access controller - so a typo on either side does not fail,
 * it opens a second, empty database and replicates happily with nobody. That
 * is the worst failure mode available to this design: a publisher writing into
 * a void while a reader holds an empty table, both reporting success. The
 * cheapest defence is importing both constants here and refusing to let them
 * drift.
 *
 * **The fields.** The reader mirrors fields it was taught, which is what keeps
 * a publisher's free text out of a public CSV - and the same property means a
 * field *added* to the projection is silently not mirrored. So a real
 * projected row goes through the real validator, and every key it produces has
 * to be a column.
 *
 * Both of the demo's modules are importable in Node because their own
 * network imports are dynamic, which is the same property that keeps the relay
 * stack out of the demo's page.
 */

test('the publisher and the reader name the same database', async () => {
  const { DATABASE_NAME, DATABASE_TYPE } = await import('../src/replicate.js')

  // Not a tidiness check. A mismatch here is two services agreeing that
  // everything is fine while nothing is being published.
  assert.equal(DATABASE_NAME, PUBLISHED_NAME)
  assert.equal(DATABASE_TYPE, PUBLISHED_TYPE)
})

test('every field the publisher projects has a column to land in', () => {
  // A logbook entry with every field filled, so nothing is missed by being
  // null in the fixture.
  const projected = projectForPublication({
    id: 'm9k2x1-ab3c',
    at: '2026-11-01T21:14:37.221Z',
    pairId: 'abcd1234',
    scenario: 'across-networks',
    familyFilter: 'v6',
    families: ['v4', 'v6'],
    role: 'answering',
    carrier: 'link',
    format: 'v3',
    frames: 7,
    engine: 'Gecko',
    version: '146',
    browser: 'DuckDuckGo',
    platform: 'Android',
    mobile: true,
    provider: 'Telekom',
    country: 'DE',
    network: { ipv4: 'open', ipv6: 'unproven', overall: 'open' },
    outcome: 'connected',
    reason: null,
    ms: 8421,
    review: 'sound',
    reviewNote: 'camera aim was fine this time',
    place: "Anna's flat",
    peer: 'Anna',
    candidates: [{ type: 'host', address: '192.168.1.4' }, { type: 'srflx', address: '2001:db8::1' }],
    reported: { engine: 'Chrome', version: '142', browser: null, platform: 'Android', provider: 'Vodafone', country: 'DE', region: 'Saxony' },
    publishedAt: null,
    publishedTo: null
  })

  const result = validateRow(projected)

  assert.deepEqual(result.ok ? [] : result.problems, [])
  // Nothing the publisher invented afterwards is sitting unmirrored.
  assert.deepEqual(result.unknown, [])
  assert.deepEqual(Object.keys(result.row).filter(key => !COLUMNS.includes(key)), [])

  // And the two the reader is right to swallow: `review` says `sound` for
  // every row in this log, so a column of it separates nothing.
  assert.equal(Object.keys(result.row).includes('review'), false)
  assert.equal(result.row.at, '2026-11-01T21:00:00Z')
})

test('what the projection withholds stays withheld after mirroring', () => {
  // The same fixture's typed free text and nested region, which the projection
  // drops and the mirror could only reintroduce by taking a field it was not
  // taught. Asserted on the mirrored row rather than on the projection,
  // because this is the last point before the data is on a public URL.
  const row = validateRow(projectForPublication({
    id: 'm9k2x1-ab3c',
    at: '2026-11-01T21:14:37.221Z',
    outcome: 'connected',
    place: "Anna's flat",
    peer: 'Anna',
    reviewNote: 'she was holding the other phone',
    reported: { engine: 'Chrome', region: 'Saxony', country: 'DE' },
    candidates: [{ type: 'srflx', address: '203.0.113.9' }]
  })).row

  const serialised = JSON.stringify(row)

  for (const secret of ['Anna', 'Saxony', '203.0.113.9', 'holding the other phone']) {
    assert.equal(serialised.includes(secret), false, secret)
  }

  // The candidate survives as a count, which is the whole of what it is for.
  assert.equal(row.srflxV4, 1)
})
