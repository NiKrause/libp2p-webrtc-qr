/**
 * The public page: the dataset, and what it cannot say yet (#179, step 7).
 *
 * Three pieces, and none of them knows about the others' problems:
 *
 * - `@le-space/libp2p-webrtc-qr-reader/mirror` folds entries into rows. The
 *   *same* module the reader service runs, imported rather than reimplemented,
 *   because a page that filtered differently from the service would publish a
 *   second, quietly disagreeing version of the dataset.
 * - `results-view.js` turns a summary into gaps and headline numbers. Pure, so
 *   the Playwright suite drives the whole page from seeded rows.
 * - `results-network.js` opens the database. Imported dynamically, so the page
 *   renders its explanation before it fetches a libp2p stack, and so a visitor
 *   who never gets a relay still reads a page rather than a spinner.
 */

import { COLUMNS, FILTERABLE, mirror, summarise, toCsv } from '@le-space/libp2p-webrtc-qr-reader/mirror'

import { applyBrowserTheme } from './browser-theme.js'
import { initialLocale, setLocale, t, translateDocument } from './i18n.js'
import { filterOptions, gaps, headline, networkRows } from './results-view.js'

applyBrowserTheme().catch(() => {})

/**
 * The columns on screen, out of the thirty-eight in the CSV.
 *
 * A table nobody can read horizontally is a table nobody reads, and the full
 * set is one button away. These are the ones that carry the argument: what was
 * attempted, where, on what, and how it went.
 */
const DISPLAY_COLUMNS = [
  'at', 'scenario', 'role', 'carrier', 'outcome', 'ms',
  'engine', 'version', 'platform', 'country', 'provider', 'ipv4', 'ipv6', 'families', 'reason'
]

/** Columns whose empty value should read as "not recorded" rather than blank. */
const EMPTY = '—'

const el = id => document.getElementById(id)

const state = {
  rows: [],
  rejected: [],
  stats: {},
  summary: null,
  filters: {}
}

function applyLocale (next) {
  setLocale(next)
  document.documentElement.lang = next
  translateDocument()
  render()
}

el('locale-de').addEventListener('click', () => applyLocale('de'))
el('locale-en').addEventListener('click', () => applyLocale('en'))

applyLocale(initialLocale())

/** The line that says what the page is doing, in the page's own language. */
function say (key, params = {}) {
  el('results-state').textContent = t(key, params)
}

/**
 * Fold entries into the table and draw everything.
 *
 * Separated from the network so a test can call it with rows it made up, and
 * so every arriving entry redraws through exactly the same path as the first
 * batch - a second rendering path is how a page ends up correct only on load.
 *
 * @param {{ hash: string, identity: unknown, value: unknown }[]} entries
 */
function load (entries) {
  const result = mirror(entries)

  state.rows = result.rows
  state.rejected = result.rejected
  state.stats = result.stats
  state.summary = summarise(result.rows)
  state.filters = {}

  render()
}

function render () {
  if (state.summary == null) return

  renderGaps()
  renderHeadline()
  renderNetworks()
  renderRows()
  renderRejected()
}

function show (id) {
  el(id).hidden = false
}

function renderGaps () {
  const list = el('results-gaps')

  list.replaceChildren(...gaps(state.summary).map(gap => {
    const item = document.createElement('li')

    item.textContent = t(gap.key, gap.params)
    return item
  }))

  show('results-gaps-card')
}

function renderHeadline () {
  const list = el('results-headline')
  const nodes = []

  for (const item of headline(state.summary, state.stats)) {
    const label = document.createElement('dt')
    const value = document.createElement('dd')

    label.textContent = t(item.key)
    value.textContent = String(item.value)
    if (item.warn) value.classList.add('results-warn')

    nodes.push(label, value)
  }

  list.replaceChildren(...nodes)

  // The scenarios as a sentence rather than a chart: with a handful of rows a
  // chart is decoration that implies a distribution nobody measured.
  const scenarios = Object.entries(state.summary.scenarios)
    .map(([name, counts]) => `${name === 'unlabelled' ? t('results.unlabelled') : name} ${counts.runs}`)
    .join(' · ')

  el('results-scenarios').textContent = scenarios
  show('results-headline-card')
}

function table (node, columns, rows, header) {
  const head = document.createElement('tr')

  for (const column of columns) {
    const cell = document.createElement('th')

    cell.scope = 'col'
    cell.textContent = header(column)
    head.append(cell)
  }

  const body = rows.map(row => {
    const line = document.createElement('tr')

    for (const column of columns) {
      const cell = document.createElement('td')
      const value = row[column]

      cell.textContent = value == null || value === '' ? EMPTY : String(value)
      // The reason column is clipped to keep rows one line high, so the whole
      // sentence has to stay reachable without a download.
      if (cell.textContent !== EMPTY) cell.title = cell.textContent
      line.append(cell)
    }

    return line
  })

  const thead = document.createElement('thead')
  const tbody = document.createElement('tbody')

  thead.append(head)
  tbody.append(...body)
  node.replaceChildren(thead, tbody)
}

function renderNetworks () {
  const columns = ['country', 'provider', 'runs', 'connected', 'failed', 'engines', 'offeredV6', 'reflexiveV6', 'reflexiveV4']

  table(el('results-networks'), columns, networkRows(state.summary), column => t(`results.column.${column}`))
  show('results-networks-card')
}

function visibleRows () {
  const active = Object.entries(state.filters).filter(([, value]) => value !== '')

  return state.rows.filter(row => active.every(([column, value]) => String(row[column] ?? '') === value))
}

function renderRows () {
  renderFilters()

  const rows = visibleRows()

  el('results-count').textContent = t('results.rows.count', { shown: rows.length, total: state.rows.length })
  table(el('results-rows'), DISPLAY_COLUMNS, rows, column => t(`results.column.${column}`))
  show('results-rows-card')
}

function renderFilters () {
  const options = filterOptions(state.rows, FILTERABLE)
  const container = el('results-filters')

  container.replaceChildren(...Object.entries(options).map(([column, values]) => {
    const label = document.createElement('label')
    const select = document.createElement('select')
    const any = document.createElement('option')

    any.value = ''
    any.textContent = t('results.filters.any')
    select.append(any)

    for (const value of values) {
      const option = document.createElement('option')

      option.value = value
      option.textContent = value
      option.selected = state.filters[column] === value
      select.append(option)
    }

    select.addEventListener('change', () => {
      state.filters[column] = select.value
      renderRows()
    })

    label.append(document.createTextNode(t(`results.column.${column}`)), select)
    label.className = 'results-filter'

    return label
  }))
}

function renderRejected () {
  const list = el('results-rejected')

  if (state.rejected.length === 0) {
    el('results-rejected-card').hidden = true
    return
  }

  list.replaceChildren(...state.rejected.map(item => {
    const line = document.createElement('li')

    line.textContent = `${item.entry} — ${item.problems.join('; ')}`
    return line
  }))

  show('results-rejected-card')
}

function download (name, type, body) {
  const url = URL.createObjectURL(new Blob([body], { type }))
  const link = document.createElement('a')

  link.href = url
  link.download = name
  link.click()
  URL.revokeObjectURL(url)
}

// The full column set, not the fifteen on screen: somebody downloading this is
// going to query it, and the columns a page left out for width are exactly the
// ones a query wants.
el('results-csv').addEventListener('click', () => {
  download('webrtc-qr-field-results.csv', 'text/csv', toCsv(visibleRows(), COLUMNS))
})

el('results-json').addEventListener('click', () => {
  download('webrtc-qr-field-results.json', 'application/json', JSON.stringify({
    address: el('results-address').textContent,
    summary: state.summary,
    rows: visibleRows()
  }, null, 2))
})

/**
 * The test seam.
 *
 * The page's whole job is to read a database over a relay, which a test suite
 * for a project that connects to nothing has no business doing. So the fold
 * and the rendering are reachable without a network, and `tests/results.spec.js`
 * drives them with entries of its own.
 */
window.__libp2pQrResultsTest = {
  load,
  rows: () => state.rows,
  summary: () => state.summary,
  gaps: () => gaps(state.summary).map(gap => gap.key)
}

const PROGRESS = {
  finding: 'results.state.finding',
  connecting: 'results.state.connecting',
  opening: 'results.state.opening',
  waiting: 'results.state.waiting',
  reading: 'results.state.reading'
}

let unverified = {}

/**
 * Say which of the three situations this is.
 *
 * "Nothing published", "n rows" and "something arrived that cannot be
 * checked" look identical from the table - it is empty in two of them - and
 * only the third is a fault. Conflating them is how a reader concludes the
 * project has no data.
 */
function report (entries, database) {
  // An empty table with a peer on the other side is not an empty dataset.
  // Measured on the first published row: the entry reaches this tab and never
  // becomes a row, because checking it means fetching the author's identity
  // block over bitswap and nobody a browser can reach is serving it. OrbitDB
  // reports that on a queue task and the log simply stays empty. So the test
  // here is the one thing that is reliably observable from outside: somebody
  // is holding this database, and nothing readable came back.
  if (state.rows.length === 0 && database.peers() > 0) {
    say('results.state.unverified', { peers: database.peers(), announced: unverified.announced ?? 0 })
    return
  }

  say(entries.length === 0 ? 'results.state.empty' : 'results.state.loaded', {
    rows: state.rows.length,
    peers: database.peers()
  })
}

async function start () {
  say('results.state.starting')

  let database

  try {
    const { openPublishedDatabase } = await import('./results-network.js')

    database = await openPublishedDatabase({
      onProgress: (event, detail = {}) => {
        if (detail.address) el('results-address').textContent = detail.address
        say(PROGRESS[event] ?? 'results.state.starting')
      },
      onUpdate: (detail = {}) => {
        if (detail.announced) unverified = detail
        // The line is rewritten on every update, not only at the end of this
        // function: the entries that fail to verify keep arriving for as long
        // as the tab is open, and a state line written once is a state line
        // that is wrong a minute later.
        database?.entries().then(entries => { load(entries); report(entries, database) }).catch(() => {})
      }
    })
  } catch (error) {
    // A page that cannot reach a relay still has something true to say, and
    // saying it beats a spinner that never resolves.
    say('results.state.offline', { reason: error?.message ?? String(error) })
    load([])
    return
  }

  el('results-address').textContent = database.address

  const entries = await database.entries()

  load(entries)

  report(entries, database)
}

start().catch(error => say('results.state.offline', { reason: error?.message ?? String(error) }))
