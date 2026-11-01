/**
 * Turning an append-only log that anybody may write into a table.
 *
 * This is the half of the reader that does not touch the network, and it is
 * where the consequence of one earlier decision lands. The published database
 * has `write: ['*']` because the access controller is part of the address, so
 * an allow-list would have put the contributors *into* the address and
 * admitting the second one would have stranded everything the first wrote
 * (#179, and the argument in the demo's `publish-network.js`). That decision
 * was paid for with a promise: **noise becomes something a reader filters
 * rather than something a person has to gatekeep.** This file is that filter.
 *
 * So every value here is untrusted input. Not hostile by default - the only
 * publisher today is the demo's own projection - but the log is open, signed
 * by whoever wrote it, and cannot take anything back. Three consequences run
 * through the whole file:
 *
 * 1. **The mirror copies named fields, never the row it was handed.** A
 *    spread would publish, into a public CSV, whatever somebody decided to put
 *    in an entry - including the free text the demo's projection deliberately
 *    withholds. The allow-list in `publish.js` protects the person publishing;
 *    this one protects everybody else from a publisher who does not use it.
 * 2. **The hour grain is a contract, not a courtesy.** A row carrying a
 *    timestamp finer than the hour is rejected rather than rounded. Rounding
 *    it would mean this reader had seen a fingerprint, mirrored a clean value,
 *    and said nothing - while the fingerprint stayed in the log for anyone
 *    else to read. Rejecting it makes the publisher visible.
 * 3. **Nothing is dropped silently.** A rejected row is counted, kept and
 *    served (`/rejected.json`), because "somebody is writing junk into the
 *    dataset" is itself a fact about the dataset, and a filter that hides what
 *    it removed cannot be audited.
 *
 * ## What this cannot do, and must not pretend to
 *
 * OrbitDB verifies that an entry was signed by the identity it claims. Nothing
 * verifies that the row is *true*: a contributor's provider, country and
 * outcome are what they said, not what was measured by us. The table is
 * therefore a faithful mirror of claims, and `summarise` counts claims. Every
 * column that a publisher chose is self-reported, and the author column is
 * there so that a flood of them is visible rather than averaged in.
 */

/** The row version this reader understands. */
export const ROW_VERSION = 1

/**
 * The closed vocabularies.
 *
 * A value outside one of these is not data this reader can keep: it is either
 * a publisher that has drifted ahead of the dataset or somebody writing into a
 * column other people group by, and in both cases a quiet pass-through
 * poisons every query made afterwards. The row is rejected and named.
 */
const ENUMS = {
  scenario: ['same-lan', 'mobile-data', 'across-networks'],
  role: ['offering', 'answering'],
  carrier: ['camera', 'sound', 'paste', 'link'],
  format: ['v2', 'v3'],
  outcome: ['connected', 'failed', 'abandoned'],
  familyFilter: ['v4', 'v6'],
  // Only `sound` can reach the log at all - the publish gate filters on it -
  // so a row saying anything else was not written by the demo.
  review: ['sound']
}

const NETWORK_STATES = ['open', 'relay', 'blocked', 'symmetric', 'unproven']
const FAMILIES = ['v4', 'v6', 'mdns']
const CANDIDATE_TYPES = ['host', 'srflx', 'relay', 'prflx']

/** Short typed-or-detected strings: a name, not a sentence. */
const SHORT_TEXT = 64

/**
 * `reason` is the one long field, and the one exception to "free text does not
 * travel" - it is written by the browser rather than by a person, which is
 * exactly why it is publishable (see `publish.js`). It is still arbitrary
 * length, so it is clamped.
 */
const REASON_TEXT = 200

/** Sanity ceilings. A row claiming 1e300 ms would wreck every average. */
const MAX_FRAMES = 1000
const MAX_MS = 6 * 60 * 60 * 1000
const MAX_CANDIDATES = 1000

/** The hour grain, exactly as `publish.js` writes it. */
const HOUR = /^\d{4}-\d{2}-\d{2}T\d{2}:00:00Z$/
const ROW_ID = /^[a-z0-9]{1,24}-[a-z0-9]{1,12}$/
const PAIR_ID = /^[a-z0-9]{4,16}$/
const COUNTRY = /^[A-Z]{2}$/
const VERSION = /^\d{1,8}$/

/**
 * The table's columns, in order, and the single place that order is stated.
 *
 * The CSV header, the JSON keys and the query parameters all come from here,
 * so a column cannot exist in one representation and be missing from another.
 */
export const COLUMNS = [
  // Where the row came from. First, because both answer "can I trust this one"
  // before any of the measurement does.
  'entry',
  'author',
  // When, to the hour.
  'at',
  // What was being tested.
  'scenario',
  'familyFilter',
  'families',
  'role',
  'carrier',
  'format',
  'frames',
  // By what, on what.
  'engine',
  'version',
  'browser',
  'platform',
  'mobile',
  // Where.
  'provider',
  'country',
  // What the browser made of its own network before trying.
  'ipv4',
  'ipv6',
  'network',
  // How it went.
  'outcome',
  'reason',
  'ms',
  // Which attempt, and which other row it is the other half of.
  'id',
  'pairId',
  // What the far end said about itself, when there was a connection to say it
  // over. Prefixed, because `engine` already means this side's.
  'peerEngine',
  'peerVersion',
  'peerBrowser',
  'peerPlatform',
  'peerProvider',
  'peerCountry',
  // The candidate counts, spread into columns rather than left as a nested
  // object: `srflxV6 = 0 and srflxV4 > 0` is the whole IPv6-over-mobile
  // question, and it should be one predicate, not a JSON path.
  'hostV4',
  'hostV6',
  'srflxV4',
  'srflxV6',
  'relayV4',
  'relayV6',
  'prflxV4',
  'prflxV6'
]

/** Columns a caller may filter on: the low-cardinality ones. */
export const FILTERABLE = [
  'scenario', 'familyFilter', 'role', 'carrier', 'format', 'engine', 'browser',
  'platform', 'provider', 'country', 'outcome', 'ipv4', 'ipv6',
  'network', 'author', 'pairId'
]

const isObject = value => typeof value === 'object' && value !== null && !Array.isArray(value)

/**
 * Text, clamped rather than rejected.
 *
 * The split is deliberate and it is the rule the whole validator follows:
 * **structure and vocabulary are a contract, so a violation rejects the row;
 * length is not meaning, so it is clamped.** A provider somebody typed 300
 * characters into is still a measurement of a real network, and throwing the
 * row away over the typing would lose data to tidiness. A truncation is
 * counted, so a publisher doing it systematically is visible.
 */
function clampText (value, max, state) {
  if (typeof value !== 'string') return null

  // Control characters first: they would break a CSV row in two, and C1 is
  // invisible in every tool somebody would check the result in.
  const clean = value.replace(/[\u0000-\u001f\u007f-\u009f]/gu, ' ').trim()

  if (clean === '') return null
  if (clean.length <= max) return clean

  state.truncated += 1

  return `${clean.slice(0, max - 1)}…`
}

function enumOrNull (value, allowed, field, problems) {
  if (value == null) return null
  if (typeof value === 'string' && allowed.includes(value)) return value

  problems.push(`${field}: not one of ${allowed.join(', ')}`)

  return null
}

function countOrNull (value, max, field, problems) {
  if (value == null) return null
  if (Number.isInteger(value) && value >= 0 && value <= max) return value

  problems.push(`${field}: not a count in 0..${max}`)

  return null
}

function patternOrNull (value, pattern, field, problems) {
  if (value == null) return null
  if (typeof value === 'string' && pattern.test(value)) return value

  problems.push(`${field}: does not match ${pattern.source}`)

  return null
}

/**
 * One published row, as a table row - or the reasons it is not one.
 *
 * Pure, so the whole filter can be tested without a network, a database or a
 * relay, and so a test can assert the *absence* of a field rather than
 * trusting a comment that says it is absent.
 *
 * @param {unknown} value the entry payload, exactly as it came out of the log
 * @returns {{ ok: true, row: object, unknown: string[], truncated: number }
 *   | { ok: false, problems: string[] }}
 */
export function validateRow (value) {
  const problems = []

  if (!isObject(value)) {
    return { ok: false, problems: ['not an object'] }
  }

  if (value.v !== ROW_VERSION) {
    // Not merely unrecognised. A later version may have changed what an
    // existing field *means*, and a reader that mirrored it into the same
    // column would silently mix two vocabularies - which is worse than a gap.
    return { ok: false, problems: [`v: ${JSON.stringify(value.v)} is not ${ROW_VERSION}`] }
  }

  const state = { truncated: 0 }
  const network = value.network == null ? {} : value.network
  const reported = value.reported == null ? {} : value.reported

  if (value.network != null && !isObject(value.network)) problems.push('network: not an object')
  if (value.reported != null && !isObject(value.reported)) problems.push('reported: not an object')

  let families = null

  if (value.families != null) {
    if (Array.isArray(value.families) && value.families.length <= FAMILIES.length &&
        value.families.every(family => FAMILIES.includes(family))) {
      // Sorted and joined: a column somebody can group by. The list is short
      // and closed, so the order it was offered in carries nothing.
      families = [...new Set(value.families)].sort().join('+')
    } else {
      problems.push(`families: not a subset of ${FAMILIES.join(', ')}`)
    }
  }

  const candidates = {}

  for (const type of CANDIDATE_TYPES) {
    for (const family of ['v4', 'v6']) {
      const column = `${type}${family === 'v4' ? 'V4' : 'V6'}`

      candidates[column] = value.candidates == null
        ? null
        : countOrNull(value.candidates[`${type}.${family}`] ?? 0, MAX_CANDIDATES, `candidates.${type}.${family}`, problems)
    }
  }

  if (value.candidates != null && !isObject(value.candidates)) {
    problems.push('candidates: not an object')
  }

  const row = {
    at: patternOrNull(value.at, HOUR, 'at', problems),
    scenario: enumOrNull(value.scenario, ENUMS.scenario, 'scenario', problems),
    familyFilter: enumOrNull(value.familyFilter, ENUMS.familyFilter, 'familyFilter', problems),
    families,
    role: enumOrNull(value.role, ENUMS.role, 'role', problems),
    carrier: enumOrNull(value.carrier, ENUMS.carrier, 'carrier', problems),
    format: enumOrNull(value.format, ENUMS.format, 'format', problems),
    frames: countOrNull(value.frames, MAX_FRAMES, 'frames', problems),
    engine: clampText(value.engine, SHORT_TEXT, state),
    version: patternOrNull(value.version, VERSION, 'version', problems),
    browser: clampText(value.browser, SHORT_TEXT, state),
    platform: clampText(value.platform, SHORT_TEXT, state),
    mobile: typeof value.mobile === 'boolean' ? value.mobile : null,
    provider: clampText(value.provider, SHORT_TEXT, state),
    country: patternOrNull(value.country, COUNTRY, 'country', problems),
    ipv4: enumOrNull(network.ipv4, NETWORK_STATES, 'network.ipv4', problems),
    ipv6: enumOrNull(network.ipv6, NETWORK_STATES, 'network.ipv6', problems),
    network: enumOrNull(network.overall, NETWORK_STATES, 'network.overall', problems),
    outcome: enumOrNull(value.outcome, ENUMS.outcome, 'outcome', problems),
    reason: clampText(value.reason, REASON_TEXT, state),
    ms: countOrNull(value.ms, MAX_MS, 'ms', problems),
    id: patternOrNull(value.id, ROW_ID, 'id', problems),
    pairId: patternOrNull(value.pairId, PAIR_ID, 'pairId', problems),
    peerEngine: clampText(reported.engine, SHORT_TEXT, state),
    peerVersion: patternOrNull(reported.version, VERSION, 'reported.version', problems),
    peerBrowser: clampText(reported.browser, SHORT_TEXT, state),
    peerPlatform: clampText(reported.platform, SHORT_TEXT, state),
    peerProvider: clampText(reported.provider, SHORT_TEXT, state),
    peerCountry: patternOrNull(reported.country, COUNTRY, 'reported.country', problems),
    ...candidates
  }

  // `at` and `id` are what a row is addressed by afterwards, and a table whose
  // rows cannot be told apart or placed in time is not worth mirroring.
  if (row.at == null) problems.push('at: missing (the hour grain is required)')
  if (row.id == null) problems.push('id: missing')
  if (row.outcome == null) problems.push('outcome: missing')

  // `review` is checked and then dropped: every row in this log is sound by
  // construction, so a column saying so for every row is a column that
  // separates nothing. A row claiming otherwise is still a row the demo did
  // not write, and worth rejecting over.
  enumOrNull(value.review, ENUMS.review, 'review', problems)

  if (problems.length > 0) return { ok: false, problems }

  // Named one by one above, so anything a publisher added that this reader has
  // not been taught stays out of the table by construction. Reported, because
  // a publisher running ahead of the reader is worth knowing about - it means
  // data is being written that nobody is mirroring.
  const known = new Set([
    'v', 'at', 'scenario', 'familyFilter', 'families', 'role', 'carrier', 'format',
    'frames', 'engine', 'version', 'browser', 'platform', 'mobile', 'provider',
    'country', 'network', 'outcome', 'reason', 'ms', 'id', 'pairId', 'review',
    'reported', 'candidates'
  ])

  return {
    ok: true,
    row,
    unknown: Object.keys(value).filter(key => !known.has(key)),
    truncated: state.truncated
  }
}

/**
 * The whole table, folded from the whole log.
 *
 * A fold rather than an accumulation, and rebuilt from the log every time
 * rather than updated in place. That makes it idempotent, free of migrations,
 * and repairable by deleting it - which matters for a mirror of a log that is
 * the real store. The cost is linear work per update, and on a dataset this
 * size that is not a cost.
 *
 * @param {Array<{ hash?: string, identity?: string, value?: unknown }>} entries
 *   oplog entries in log order
 */
export function mirror (entries) {
  const rows = []
  const rejected = []
  const replays = []
  const unknownFields = new Map()
  const seenEntries = new Set()
  const firstById = new Map()
  let truncated = 0

  for (const entry of entries ?? []) {
    const hash = entry?.hash

    if (typeof hash !== 'string' || seenEntries.has(hash)) continue

    seenEntries.add(hash)

    const author = typeof entry.identity === 'string' ? entry.identity : null
    const result = validateRow(entry.value)

    if (!result.ok) {
      rejected.push({ entry: hash, author, problems: result.problems })
      continue
    }

    const first = firstById.get(result.row.id)

    if (first != null) {
      // The same attempt id arriving twice. From the same author it is a
      // double publish - a cleared logbook, most likely, since `publishedAt`
      // stops the ordinary second press. From a *different* author it is
      // somebody re-signing a measurement that is not theirs, which is a
      // different thing entirely and the one worth being able to count.
      replays.push({ id: result.row.id, entry: hash, author, original: first.entry, sameAuthor: first.author === author })
      continue
    }

    for (const field of result.unknown) {
      unknownFields.set(field, (unknownFields.get(field) ?? 0) + 1)
    }

    truncated += result.truncated
    firstById.set(result.row.id, { entry: hash, author })
    rows.push({ entry: hash, author, ...result.row })
  }

  return {
    rows,
    rejected,
    replays,
    stats: {
      entries: seenEntries.size,
      rows: rows.length,
      rejected: rejected.length,
      replays: replays.length,
      forgedReplays: replays.filter(replay => !replay.sameAuthor).length,
      truncated,
      unknownFields: Object.fromEntries([...unknownFields].sort())
    }
  }
}

const countBy = (rows, column) => {
  const counts = new Map()

  for (const row of rows) {
    const key = row[column] ?? 'unknown'

    counts.set(key, (counts.get(key) ?? 0) + 1)
  }

  return Object.fromEntries([...counts].sort((a, b) => b[1] - a[1]))
}

const distinct = (rows, column) => new Set(rows.map(row => row[column]).filter(value => value != null)).size

/**
 * The counts #179 wants to be able to state, and nothing it cannot support.
 *
 * Two of these are the point of the whole exercise. `networks` answers "does
 * this carrier carry IPv6 UDP" with the two numbers that claim needs: how many
 * runs offered IPv6 at all, and how many of those got a reflexive candidate
 * back. `coverage` answers the question the issue says a dataset must answer
 * about itself - where it has nothing - because "214 runs, 9 carriers, 3
 * countries, here is what we cannot tell you yet" is worth more than a number
 * that implies the map is full.
 *
 * Everything here counts what contributors said. None of it is a measurement
 * this reader made, and the wording of any page built on it has to carry that.
 */
export function summarise (rows) {
  const scenarios = {}

  for (const scenario of [...ENUMS.scenario, 'unlabelled']) {
    const matching = rows.filter(row => (row.scenario ?? 'unlabelled') === scenario)

    if (matching.length === 0) continue

    scenarios[scenario] = { runs: matching.length, ...countBy(matching, 'outcome') }
  }

  const networks = new Map()

  for (const row of rows) {
    const key = `${row.country ?? '??'}/${row.provider ?? 'unknown'}`
    const seen = networks.get(key) ?? {
      country: row.country ?? null,
      provider: row.provider ?? null,
      runs: 0,
      connected: 0,
      failed: 0,
      engines: new Set(),
      // "Offered" means this run put an IPv6 candidate on the table at all,
      // by filter or by having one. Without that denominator, "no reflexive
      // IPv6" cannot be told apart from "IPv6 was never tried here".
      offeredV6: 0,
      reflexiveV6: 0,
      reflexiveV4: 0
    }

    seen.runs += 1
    if (row.outcome === 'connected') seen.connected += 1
    if (row.outcome === 'failed') seen.failed += 1
    if (row.engine != null) seen.engines.add(row.engine)
    if (row.familyFilter === 'v6' || (row.hostV6 ?? 0) > 0 || (row.srflxV6 ?? 0) > 0) seen.offeredV6 += 1
    if ((row.srflxV6 ?? 0) > 0) seen.reflexiveV6 += 1
    if ((row.srflxV4 ?? 0) > 0) seen.reflexiveV4 += 1

    networks.set(key, seen)
  }

  return {
    runs: rows.length,
    outcomes: countBy(rows, 'outcome'),
    scenarios,
    engines: countBy(rows, 'engine'),
    platforms: countBy(rows, 'platform'),
    countries: countBy(rows, 'country'),
    networks: [...networks.values()]
      .map(({ engines, ...rest }) => ({ ...rest, engines: engines.size }))
      .sort((a, b) => b.runs - a.runs),
    coverage: {
      countries: distinct(rows, 'country'),
      providers: distinct(rows, 'provider'),
      engines: distinct(rows, 'engine'),
      // A paired run is the only kind that measured two separate networks, so
      // this is the honest size of the scenario-B dataset however many rows
      // carry the label.
      pairs: distinct(rows, 'pairId'),
      // And the rows that cannot be matched to a second half: one-sided by
      // design for a solo scenario, incomplete for a paired one.
      unpaired: rows.filter(row => row.pairId == null).length
    }
  }
}

/**
 * CSV, which is the format this dataset is actually asked for.
 *
 * Not because CSV is good, but because it is what turns an append-only log
 * into "one line of SQL": DuckDB reads a CSV straight off a URL, so the reader
 * can serve a table and own no query engine at all.
 *
 * The leading-character guard is not decoration. Anybody may write to this
 * log, `reason` is text, and a cell beginning `=`, `+`, `-` or `@` is a
 * *formula* to every spreadsheet that opens the file - which is how a public
 * dataset turns into code execution on the machine of somebody who downloaded
 * it. Quoting does not help: the formula is detected after the CSV is
 * unquoted. The apostrophe does, and is visible, which is the right trade for
 * a field that is diagnostic text.
 */
export function toCsv (rows, columns = COLUMNS) {
  const cell = value => {
    if (value == null) return ''
    if (typeof value === 'boolean') return value ? 'true' : 'false'
    if (typeof value === 'number') return String(value)

    const text = String(value)
    const guarded = /^[=+\-@\t\r]/u.test(text) ? `'${text}` : text

    return /[",\r\n]/u.test(guarded) ? `"${guarded.replace(/"/gu, '""')}"` : guarded
  }

  return [
    columns.join(','),
    ...rows.map(row => columns.map(column => cell(row[column])).join(','))
  ].join('\n') + '\n'
}

/**
 * Exact-match filtering over the low-cardinality columns.
 *
 * The point of the reader is that querying a distributed log is tedious; this
 * is the smallest thing that makes the mirror useful over HTTP without
 * pretending to be a query engine. Anything with a shape to it - counts,
 * joins, "runs where v6 was offered and nothing came back" - belongs in the
 * SQL the CSV makes possible, not here.
 *
 * An unknown parameter is ignored rather than refused: query strings collect
 * tracking junk, and a 400 on `?fbclid=` would be a worse answer than the data.
 */
export function filterRows (rows, query = {}) {
  const active = FILTERABLE
    .filter(column => query[column] != null && query[column] !== '')
    .map(column => [column, String(query[column])])

  if (active.length === 0) return rows

  return rows.filter(row => active.every(([column, wanted]) => String(row[column] ?? '') === wanted))
}
