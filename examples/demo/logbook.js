/**
 * What worked here, what did not, and what the likely reason was.
 *
 * Before anybody else's measurements are worth collecting (#27), the person
 * building this should be able to answer that for their own devices. So this is
 * a local logbook: every connection attempt opens an entry, and the entry is
 * closed when the attempt connects or fails. **Both are kept** - a log of
 * successes says nothing about what is broken.
 *
 * ## Local is not a smaller version of public, it is a different one
 *
 * The public dataset in #27 refuses free text, IP addresses and exact
 * timestamps, because an append-only public log can neither erase nor correct.
 * None of that applies here, and what it refuses is exactly what makes a
 * failure diagnosable a week later. So this keeps the lot, and the public record
 * becomes a *projection* of this one rather than a different thing.
 *
 * ## The three fields no browser can know
 *
 * The network provider, where you are, and what the other device is. They are
 * asked for once and kept as the current context, because somebody testing in a
 * hotel lobby sets them at the start of the evening and not once per attempt.
 *
 * The peer is the one that cannot be measured even in principle. A connection
 * has two ends and an entry describes one; the other end is only ever reachable
 * over a channel that a *failed* attempt does not have. And the distinctions
 * worth recording are the ones a platform hides on purpose - Vanadium reports a
 * stock Chrome user agent, GrapheneOS reports itself as Android - so even a
 * successful exchange would answer "Chrome on Android" where the interesting
 * answer was "Vanadium on GrapheneOS". The person holding both phones knows.
 * Nothing else does. See #145.
 */

import { detectBrowser } from './browser-theme.js'

const STORAGE_KEY = 'webrtc-qr.logbook.v1'
const CONTEXT_KEY = 'webrtc-qr.logbook.context.v1'
const ENABLED_KEY = 'webrtc-qr.logbook.enabled.v1'

/**
 * Enough to see a pattern, few enough that the list stays readable and the
 * storage quota stays out of it. Oldest go first.
 */
const LIMIT = 200

const read = (key, fallback) => {
  try {
    const raw = localStorage.getItem(key)
    return raw == null ? fallback : JSON.parse(raw)
  } catch {
    // Storage blocked, or half a JSON document from a crash. Neither is worth
    // failing a connection attempt over.
    return fallback
  }
}

const write = (key, value) => {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // As above: the log is a convenience, not the app.
  }
}

/**
 * The name a Chromium fork answers to, where it has one.
 *
 * `detectBrowser` returns a slug; the log wants something a person reads back a
 * week later. Only the forks are listed - the three at the bottom fall through
 * to the brands table or the user agent, which name themselves perfectly well.
 */
const FORK_NAMES = {
  ddg: 'DuckDuckGo',
  brave: 'Brave',
  opera: 'Opera',
  edge: 'Edge'
}

/**
 * What this browser is, in the words the matrix needs.
 *
 * Deliberately coarse. The user agent carries more than this and none of the
 * rest distinguishes one row of the matrix from another.
 *
 * ## Two names, because there are two things
 *
 * Every Chromium fork puts "Chrome" in its user agent and reports "Google
 * Chrome" in `userAgentData.brands`, so asking either of them alone recorded
 * DuckDuckGo, Brave, Opera and Edge as Chrome - and DuckDuckGo is one of the two
 * browsers this project has field results about, which made it the wrong one to
 * be losing.
 *
 * So `browser` is the shell somebody chose and `engine`/`version` stay the
 * engine underneath. Both are worth having: the shell is what a person can be
 * told to install, and the engine number is what predicts whether WebRTC
 * behaves. Where they agree - plain Chrome, Firefox, Safari - `browser` is left
 * off rather than repeated.
 *
 * The slug comes from the root element where `applyBrowserTheme` stamped it,
 * because that one has already resolved Brave, whose check is a promise. Absent
 * that - a test, or a call before the stamp - it is worked out from the same
 * detector directly, minus Brave.
 */
export function describeAgent ({ browser = document.documentElement.dataset.browser } = {}) {
  const ua = navigator.userAgent
  const brands = navigator.userAgentData?.brands ?? []
  const known = brands.find(b => !/Not.?A.?Brand/i.test(b.brand))

  const engine = known?.brand ??
    (/\bFirefox\/(\d+)/.test(ua) ? 'Firefox' : /\bChrome\/(\d+)/.test(ua) ? 'Chrome' : /\bSafari\//.test(ua) ? 'Safari' : 'unknown')
  const version = known?.version ?? (ua.match(/(?:Firefox|Chrome|Version)\/(\d+)/)?.[1] ?? '')

  const platform = navigator.userAgentData?.platform ??
    (/Android/i.test(ua) ? 'Android' : /iPhone|iPad|iPod/i.test(ua) ? 'iOS' : /Mac OS X/.test(ua) ? 'macOS' : /Windows/.test(ua) ? 'Windows' : /Linux/.test(ua) ? 'Linux' : 'unknown')

  const slug = browser ?? detectBrowser(navigator)

  return {
    engine,
    version,
    browser: FORK_NAMES[slug] ?? null,
    platform,
    mobile: navigator.userAgentData?.mobile ?? /Mobi/i.test(ua)
  }
}

/** Counts by type and family, which is what survives an export. */
function summariseCandidates (candidates) {
  const counts = {}

  for (const { type, address } of candidates) {
    const family = address?.includes(':') ? 'v6' : 'v4'
    const key = `${type}.${family}`

    counts[key] = (counts[key] ?? 0) + 1
  }

  return counts
}

export function createLogbook ({ now = () => Date.now() } = {}) {
  let entries = read(STORAGE_KEY, [])
  let context = read(CONTEXT_KEY, { provider: '', place: '', peer: '' })
  /**
   * Off until somebody says otherwise.
   *
   * It records every attempt, and it holds the public address a reflexive
   * candidate carries. That was defensible while it was a count in
   * `localStorage`; it stops being defensible the moment the entry holds an
   * address, and a default that was fine for the quiet version should not be
   * inherited by the loud one.
   */
  let enabled = read(ENABLED_KEY, false) === true
  /** The attempt currently in flight, if any. */
  let open = null
  const listeners = new Set()

  const announce = () => { for (const listener of listeners) listener() }

  const persist = () => {
    entries = entries.slice(-LIMIT)
    write(STORAGE_KEY, entries)
    announce()
  }

  return {
    /** The provider and place, which are typed rather than measured. */
    get context () {
      return { ...context }
    },

    setContext (next) {
      context = { provider: '', place: '', peer: '', ...next }
      write(CONTEXT_KEY, context)
      announce()
    },

    entries () {
      return entries.map(entry => ({ ...entry }))
    },

    get enabled () {
      return enabled
    },

    /**
     * Turning it off stops the recording and keeps what is already there.
     *
     * Deleting somebody's own measurements because they closed the tap would be
     * its own surprise, and `clear()` is right beside it for anyone who means
     * that instead.
     */
    setEnabled (next) {
      enabled = next === true
      write(ENABLED_KEY, enabled)

      if (!enabled) open = null

      announce()
    },

    /** For a panel that wants to redraw when anything changes. */
    subscribe (listener) {
      listeners.add(listener)

      return () => listeners.delete(listener)
    },

    /**
     * Begin an attempt. Returns the entry so a caller can hold it, though every
     * other method here works on whichever attempt is open.
     *
     * A second `start` while one is open closes the first as abandoned: leaving
     * it dangling would silently lose the row that says somebody gave up.
     */
    start ({ role, carrier = null }) {
      // Off means off: no entry, not an empty one and not a redacted one.
      if (!enabled) return null

      if (open != null) this.finish({ outcome: 'abandoned' })

      open = {
        id: `${now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
        at: new Date(now()).toISOString(),
        role,
        carrier,
        ...describeAgent(),
        ...context,
        network: null,
        // What the far end said about itself, when there was a connection to
        // say it over. Null on every failure, by nature.
        reported: null,
        payload: null,
        ice: null,
        outcome: null,
        reason: null,
        ms: null
      }

      return { ...open }
    },

    /** Merge what has become known since. Ignored when nothing is open. */
    note (patch) {
      if (open == null) return

      open = { ...open, ...patch }
    },

    /**
     * Close the attempt, whichever way it went.
     *
     * `outcome` is one of `connected`, `failed` or `abandoned`. A reason is
     * expected for the last two and is the field that makes the log worth
     * keeping - "it did not work" is not a finding.
     */
    finish ({ outcome, reason = null }) {
      if (open == null) return null

      const entry = {
        ...open,
        outcome,
        reason,
        ms: now() - Date.parse(open.at)
      }

      open = null
      entries = [...entries, entry]
      persist()

      return entry
    },

    /** Whether an attempt is in flight, for a panel that shows it. */
    pending () {
      return open == null ? null : { ...open }
    },

    /**
     * Add to an entry that is already closed.
     *
     * The far end's own description of itself arrives *after* the connection
     * does - it needs the connection to arrive over. Holding the entry open
     * until it came would misreport how long the attempt took, and would leave
     * it dangling for a peer that never answers. So the attempt is recorded when
     * it finished, and this fills in what could only be known later.
     *
     * Silently ignores an id that is no longer there: two hundred entries is a
     * ring, and a slow peer on a busy evening can answer after its own row has
     * aged out.
     */
    amend (id, patch) {
      const index = entries.findIndex(entry => entry.id === id)

      if (index < 0) return

      // `Array.prototype.with` would read better and is ES2023. This project
      // exists because old and odd mobile browsers break things, so it is the
      // wrong place to spend a compatibility cliff on a one-line tidy.
      entries = entries.map((entry, at) => at === index ? { ...entry, ...patch } : entry)
      persist()
    },

    clear () {
      entries = []
      persist()
    },

    /**
     * The file somebody would send by hand - **projected, not copied**.
     *
     * A local entry may hold the addresses a connection actually used, because
     * that is what makes a failure diagnosable a week later on your own machine.
     * None of it may leave: a reflexive address is a public IP, and #27 refuses
     * those for reasons that do not go away because the data was convenient to
     * collect.
     *
     * So the projection happens here rather than at the far end, where it would
     * depend on somebody remembering. What is removed is named in the file, so a
     * recipient knows they are holding a projection rather than a copy.
     */
    export () {
      // Everything measured about *where* is dropped except the two fields the
      // public dataset in #27 actually asks for. A city is fine on a laptop and
      // too fine in a file that travels; coordinates are too fine anywhere but
      // here; the IP is the address this whole projection exists to withhold.
      const projected = entries.map(({ candidates, ip, coords, city, ...rest }) => ({
        ...rest,
        // The shape survives, the addresses do not: counts by type answer "what
        // kind of network was this" without answering "whose".
        candidates: candidates == null ? null : summariseCandidates(candidates)
      }))

      return JSON.stringify({
        v: 1,
        exportedAt: new Date(now()).toISOString(),
        redacted: ['candidate addresses and ports', 'public IP', 'coordinates', 'city'],
        entries: projected
      }, null, 2)
    }
  }
}
