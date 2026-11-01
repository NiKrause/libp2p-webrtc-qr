import assert from 'node:assert/strict'
import { test } from 'node:test'

import { COLUMNS, filterRows, mirror, summarise, toCsv, validateRow } from '../src/mirror.js'

/**
 * The filter that the open database was paid for with.
 *
 * `write: ['*']` was chosen so the dataset could keep one address forever, and
 * the price was that noise has to be a reader's problem rather than a person's
 * gate. These tests are that promise, stated as assertions: a row from the
 * demo's own projection goes through, and the things an open log makes
 * possible - a finer timestamp, a word outside the vocabulary, a replay of
 * somebody else's measurement, a spreadsheet formula in a text field - do not.
 */

/** A row exactly as `publish.js` projects one, which is the only shape that should sail through. */
const published = (over = {}) => ({
  v: 1,
  id: 'm9k2x1-ab3c',
  pairId: 'abcd1234',
  scenario: 'mobile-data',
  familyFilter: 'v6',
  families: ['v6', 'v4'],
  role: 'offering',
  carrier: 'camera',
  format: 'v3',
  frames: 4,
  engine: 'Chrome',
  version: '142',
  browser: 'Vanadium',
  platform: 'Android',
  mobile: true,
  provider: 'Vodafone DE',
  country: 'DE',
  network: { ipv4: 'symmetric', ipv6: 'blocked', overall: 'symmetric' },
  outcome: 'failed',
  reason: 'ICE failed before any pair was nominated',
  ms: 31_000,
  review: 'sound',
  at: '2026-11-01T21:00:00Z',
  reported: { engine: 'Gecko', version: '146', browser: null, platform: 'Android', provider: 'Telekom', country: 'DE' },
  candidates: { 'host.v4': 2, 'srflx.v4': 1 },
  ...over
})

const entry = (value, over = {}) => ({ hash: `zdpu${Math.random().toString(36).slice(2, 10)}`, identity: 'author-one', value, ...over })

test('a row from the demo projection becomes a table row', () => {
  const result = validateRow(published())

  assert.equal(result.ok, true)
  assert.equal(result.row.provider, 'Vodafone DE')
  assert.equal(result.row.ipv6, 'blocked')
  assert.equal(result.row.peerEngine, 'Gecko')
  // Sorted and joined, so it is a column somebody can group by rather than an
  // array whose order carries a meaning it does not have.
  assert.equal(result.row.families, 'v4+v6')
  // Missing candidate types are zero rather than absent: `srflxV6 = 0` is the
  // IPv6 question, and it cannot be asked of a null.
  assert.equal(result.row.srflxV4, 1)
  assert.equal(result.row.srflxV6, 0)
  assert.equal(result.row.hostV4, 2)
})

test('nothing reaches the table that was not asked for by name', () => {
  // The case this exists for: a publisher that does not use the demo's
  // allow-list, writing the free text the projection withholds. The mirror
  // copies named fields, so the row is still mirrored - and the place name is
  // not in it.
  const result = validateRow(published({ place: "at Anna's flat", peer: 'Anna', ip: '203.0.113.9' }))

  assert.equal(result.ok, true)
  assert.deepEqual(Object.keys(result.row).filter(key => !COLUMNS.includes(key)), [])
  assert.equal(JSON.stringify(result.row).includes('Anna'), false)
  // And the drift is reported, because a publisher writing fields nobody
  // mirrors is worth knowing about.
  assert.deepEqual(result.unknown.sort(), ['ip', 'peer', 'place'])
})

test('a timestamp finer than the hour is refused, not rounded', () => {
  const result = validateRow(published({ at: '2026-11-01T21:14:37.221Z' }))

  // Rounding it would mean this reader had seen a fingerprint, mirrored a
  // clean value and said nothing, while the fingerprint stayed in the log for
  // everybody else to read.
  assert.equal(result.ok, false)
  assert.match(result.problems.join(' '), /at:/)
})

test('a word outside a closed vocabulary rejects the row', () => {
  for (const [field, value] of [['outcome', 'maybe'], ['scenario', 'office'], ['role', 'both'], ['review', 'retest']]) {
    const result = validateRow(published({ [field]: value }))

    assert.equal(result.ok, false, field)
    assert.match(result.problems.join(' '), new RegExp(field))
  }
})

test('an unreadable version is refused rather than read as this one', () => {
  for (const v of [2, '1', undefined]) {
    assert.equal(validateRow(published({ v })).ok, false, String(v))
  }
})

test('length is clamped, because length is not meaning', () => {
  const result = validateRow(published({ provider: 'x'.repeat(300), reason: 'y'.repeat(900) }))

  // A provider somebody typed 300 characters into is still a measurement of a
  // real network; throwing the row away over the typing would lose data to
  // tidiness.
  assert.equal(result.ok, true)
  assert.equal(result.row.provider.length, 64)
  assert.equal(result.row.reason.length, 200)
  assert.equal(result.truncated, 2)
})

test('control characters cannot break a row in two', () => {
  const result = validateRow(published({ reason: 'ICE failed\r\n2026-11-01T21:00:00Z,,,,,,' }))

  assert.equal(result.ok, true)
  assert.equal(/[\r\n]/u.test(result.row.reason), false)
})

test('a count that would wreck an average is refused', () => {
  assert.equal(validateRow(published({ ms: 1e300 })).ok, false)
  assert.equal(validateRow(published({ ms: -1 })).ok, false)
  assert.equal(validateRow(published({ frames: 1e6 })).ok, false)
})

test('the log order survives, and an entry seen twice is one row', () => {
  const first = entry(published({ id: 'aaa-1111' }))
  const second = entry(published({ id: 'bbb-2222' }))
  const { rows, stats } = mirror([first, second, first])

  assert.deepEqual(rows.map(row => row.id), ['aaa-1111', 'bbb-2222'])
  assert.equal(stats.entries, 2)
  assert.equal(stats.rows, 2)
})

test('a replayed attempt id keeps the first row and counts the rest', () => {
  const { rows, replays, stats } = mirror([
    entry(published({ id: 'aaa-1111', provider: 'Original' })),
    entry(published({ id: 'aaa-1111', provider: 'Overwritten' })),
    entry(published({ id: 'aaa-1111', provider: 'Forged' }), { identity: 'author-two' })
  ])

  assert.equal(rows.length, 1)
  assert.equal(rows[0].provider, 'Original')
  assert.equal(stats.replays, 2)
  // The distinction worth being able to count: a second publish by the same
  // author is a cleared logbook, a second publish by another author is
  // somebody re-signing a measurement that is not theirs.
  assert.equal(stats.forgedReplays, 1)
  assert.equal(replays.at(-1).sameAuthor, false)
})

test('a rejected entry is kept and named rather than dropped', () => {
  const { rows, rejected, stats } = mirror([
    entry(published()),
    entry({ v: 1, at: 'whenever' }),
    entry('not an object'),
    entry(null)
  ])

  assert.equal(rows.length, 1)
  // A filter whose removals cannot be inspected is an opinion with a URL.
  assert.equal(rejected.length, 3)
  assert.equal(stats.rejected, 3)
  assert.ok(rejected.every(item => item.problems.length > 0 && item.entry != null))
})

test('who signed a row travels with it', () => {
  const { rows } = mirror([entry(published(), { identity: 'did:key:zabc' })])

  // The author column is how a flood is visible instead of averaged in. It is
  // also no more than the log already shows anybody replicating it, so
  // withholding it here would protect nothing and hide abuse.
  assert.equal(rows[0].author, 'did:key:zabc')
  assert.ok(rows[0].entry.length > 0)
})

test('a formula in a text field does not reach a spreadsheet as one', () => {
  const { rows } = mirror([entry(published({ reason: '=HYPERLINK("http://example.org","click")' }))])
  const csv = toCsv(rows)

  // Anybody may write to this log, and a cell beginning `=` is code to every
  // spreadsheet that opens the file. Quoting does not help - the formula is
  // detected after the CSV is unquoted.
  assert.equal(csv.includes(',=HYPERLINK'), false)
  assert.ok(csv.includes("'=HYPERLINK"))
})

test('the CSV header is the column list, once', () => {
  const csv = toCsv(mirror([entry(published())]).rows)
  const [header, first] = csv.trim().split('\n')

  assert.equal(header, COLUMNS.join(','))
  assert.equal(first.split(',').length >= COLUMNS.length, true)
  assert.ok(csv.endsWith('\n'))
})

test('a comma or a quote in a value cannot shift the columns', () => {
  const { rows } = mirror([entry(published({ provider: 'Hey, "Telekom"' }))])
  const csv = toCsv(rows, ['provider', 'outcome'])

  assert.equal(csv, 'provider,outcome\n"Hey, ""Telekom""",failed\n')
})

test('the summary counts claims, and says what is not covered', () => {
  const { rows } = mirror([
    entry(published({ id: 'a-1', outcome: 'connected', scenario: 'same-lan', country: 'DE', provider: 'Telekom', pairId: null })),
    entry(published({ id: 'b-2', outcome: 'failed', scenario: 'mobile-data', country: 'DE', provider: 'Vodafone DE' })),
    entry(published({ id: 'c-3', outcome: 'failed', scenario: null, country: 'AT', provider: 'A1', pairId: null }))
  ])
  const summary = summarise(rows)

  assert.equal(summary.runs, 3)
  assert.deepEqual(summary.outcomes, { failed: 2, connected: 1 })
  assert.equal(summary.scenarios['mobile-data'].runs, 1)
  // An unlabelled row is counted as unlabelled rather than quietly joining a
  // scenario it was never part of.
  assert.equal(summary.scenarios.unlabelled.runs, 1)
  assert.equal(summary.coverage.countries, 2)
  assert.equal(summary.coverage.providers, 3)
  assert.equal(summary.coverage.unpaired, 2)
})

test('the two numbers the IPv6 claim needs are both there', () => {
  const { rows } = mirror([
    // Offered v6, nothing came back: the shape of the one measurement #179
    // already has.
    entry(published({ id: 'a-1', familyFilter: 'v6', candidates: { 'host.v4': 2, 'srflx.v4': 1 } })),
    entry(published({ id: 'b-2', familyFilter: 'v6', candidates: { 'host.v6': 1 } })),
    // Never asked, so it is not evidence either way.
    entry(published({ id: 'c-3', familyFilter: null, candidates: { 'srflx.v4': 1 } }))
  ])
  const [network] = summarise(rows).networks

  assert.equal(network.runs, 3)
  // Without the denominator, "no reflexive IPv6" cannot be told apart from
  // "IPv6 was never tried here" - which is the difference between a finding
  // and a gap.
  assert.equal(network.offeredV6, 2)
  assert.equal(network.reflexiveV6, 0)
  assert.equal(network.reflexiveV4, 2)
})

test('filtering is exact match, and junk in the query string is ignored', () => {
  const { rows } = mirror([
    entry(published({ id: 'a-1', country: 'DE', scenario: 'mobile-data' })),
    entry(published({ id: 'b-2', country: 'AT', scenario: 'mobile-data' })),
    entry(published({ id: 'c-3', country: 'DE', scenario: 'same-lan' }))
  ])

  assert.equal(filterRows(rows, { country: 'DE' }).length, 2)
  assert.equal(filterRows(rows, { country: 'DE', scenario: 'mobile-data' }).length, 1)
  // A 400 on `?fbclid=` would be a worse answer than the data.
  assert.equal(filterRows(rows, { fbclid: 'nonsense' }).length, 3)
  assert.equal(filterRows(rows, {}).length, 3)
})
