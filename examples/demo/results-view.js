/**
 * What the dataset says, and - the point of the page - what it cannot say yet.
 *
 * #179 asks for "a page on the demo showing the current state, **including the
 * gaps**", and names the reason in the same breath: *a dataset that overstates
 * its coverage is worth less than one that says plainly "214 runs, 9 carriers,
 * 3 countries, here is what we cannot tell you yet"*. So the gaps are not a
 * disclaimer at the bottom. They are computed from the same summary as the
 * headline numbers, they sit above the table, and each one is phrased as the
 * question it blocks.
 *
 * Everything here is pure: in, a summary from `@le-space/libp2p-webrtc-qr-reader/mirror`;
 * out, plain objects naming a translation key and its numbers. No DOM, no
 * fetch, no locale - which is what lets `tests/results.spec.js` drive the whole
 * page from seeded rows with no relay in sight, and what keeps the German page
 * from being a second implementation.
 */

/** Below this, a count is an anecdote rather than a rate, and the page says so. */
const THIN = 5

/** A browser-pair finding needs at least this many distinct engines to exist. */
const ENGINES_FOR_A_PAIR = 2

/**
 * The scenarios the project set out to answer, in the order #179 lists them.
 * A scenario with no rows is the most important gap on the page, so the list
 * is fixed here rather than taken from the data - which could only ever report
 * the scenarios that are already covered.
 */
export const SCENARIOS = ['same-lan', 'across-networks', 'mobile-data']

/**
 * The gaps, worst first.
 *
 * Each is `{ key, params }` where `key` names a sentence in the catalogue.
 * Keeping them as keys rather than strings is what makes a gap translatable;
 * keeping the *order* here rather than in the markup is what makes "worst
 * first" a property of the data rather than of whoever edited the HTML last.
 *
 * @param {object} summary from `summarise()`
 * @returns {{ key: string, params: object }[]}
 */
export function gaps (summary) {
  const found = []
  const { runs, coverage, scenarios, networks, engines } = summary

  if (runs === 0) {
    return [{ key: 'results.gaps.nothing', params: {} }]
  }

  // Missing scenarios first: a scenario with no rows is a question nobody has
  // asked yet, which is worth more to a reader than any thinness in the ones
  // that have been.
  const missing = SCENARIOS.filter(scenario => scenarios[scenario] == null)

  for (const scenario of missing) {
    found.push({ key: `results.gaps.scenario.${scenario}`, params: {} })
  }

  const unlabelled = scenarios.unlabelled?.runs ?? 0

  if (unlabelled > 0) {
    found.push({ key: 'results.gaps.unlabelled', params: { runs: unlabelled } })
  }

  // The IPv6 question, which is the one #179 says we cannot ask today. Both
  // halves travel: without the denominator, "no reflexive IPv6" and "IPv6 was
  // never offered here" look identical and mean opposite things.
  const offeredV6 = networks.reduce((sum, network) => sum + network.offeredV6, 0)
  const reflexiveV6 = networks.reduce((sum, network) => sum + network.reflexiveV6, 0)

  if (offeredV6 === 0) {
    found.push({ key: 'results.gaps.noV6Offered', params: { runs } })
  } else if (offeredV6 < THIN) {
    found.push({ key: 'results.gaps.thinV6', params: { offered: offeredV6, reflexive: reflexiveV6 } })
  }

  if (coverage.countries < 2) {
    found.push({ key: 'results.gaps.countries', params: { countries: coverage.countries } })
  }

  if (coverage.providers < 2) {
    found.push({ key: 'results.gaps.providers', params: { providers: coverage.providers } })
  }

  if (coverage.engines < ENGINES_FOR_A_PAIR) {
    found.push({ key: 'results.gaps.engines', params: { engines: Object.keys(engines).join(', ') || '—' } })
  }

  // A pair is the only thing that measured two separate networks at once, so
  // an unpaired row is not a defect - it is the limit of what a solo run can
  // say, and the page should not let a reader mistake one for the other.
  if (coverage.pairs === 0 && coverage.unpaired > 0) {
    found.push({ key: 'results.gaps.pairs', params: { runs: coverage.unpaired } })
  }

  if (runs < THIN) {
    found.push({ key: 'results.gaps.thin', params: { runs } })
  }

  return found
}

/**
 * The headline counts, as label/value pairs ready to render.
 *
 * `rejected` is in here beside the runs on purpose. A reader that quietly
 * dropped malformed rows would be presenting a cleaner dataset than the one
 * that exists, and anyone may write to this log.
 *
 * @param {object} summary
 * @param {object} [stats] the mirror's own counts
 * @returns {{ key: string, value: string | number, warn?: boolean }[]}
 */
export function headline (summary, stats = {}) {
  const outcomes = summary.outcomes ?? {}

  return [
    { key: 'results.headline.runs', value: summary.runs },
    { key: 'results.headline.connected', value: outcomes.connected ?? 0 },
    { key: 'results.headline.failed', value: outcomes.failed ?? 0 },
    { key: 'results.headline.countries', value: summary.coverage?.countries ?? 0 },
    { key: 'results.headline.providers', value: summary.coverage?.providers ?? 0 },
    { key: 'results.headline.engines', value: summary.coverage?.engines ?? 0 },
    // Shown always, not only when non-zero: "0 rejected" is information, and a
    // row that appears only on bad days is a row nobody learns to read.
    { key: 'results.headline.rejected', value: stats.rejected ?? 0, warn: (stats.rejected ?? 0) > 0 }
  ]
}

/**
 * One line per network, which is where a saleable finding would first appear.
 *
 * #179: *not "IPv6 helps" but "this carrier's mobile network does not carry
 * IPv6 UDP, measured n times across m browsers"*. That sentence needs the
 * carrier, the count, the browser count and the two IPv6 numbers, so they are
 * all here and none of them is rounded away.
 *
 * @param {object} summary
 * @returns {object[]}
 */
export function networkRows (summary) {
  return (summary.networks ?? []).map(network => ({
    ...network,
    // A share is a lie below a handful of runs. The page shows the two counts
    // instead and leaves the division to whoever downloads the CSV.
    thin: network.runs < THIN
  }))
}

/**
 * The options a filter can actually offer: the values that are in the data.
 *
 * Taken from the rows rather than from the column vocabulary, because a filter
 * that offers `mobile-data` on a dataset with no mobile-data row sends the
 * reader to an empty table and tells them nothing. The gaps above say what is
 * missing; the filter says what is there.
 *
 * @param {object[]} rows
 * @param {string[]} columns the filterable column names
 * @returns {Record<string, string[]>}
 */
export function filterOptions (rows, columns) {
  const options = {}

  for (const column of columns) {
    const values = [...new Set(rows.map(row => row[column]).filter(value => value != null && value !== ''))]

    if (values.length > 1) options[column] = values.map(String).sort()
  }

  return options
}
