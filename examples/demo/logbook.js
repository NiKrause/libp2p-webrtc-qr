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
 * ## The two fields no browser can know
 *
 * The network provider and where you are. They are asked for once and kept as
 * the current context, because somebody testing in a hotel lobby sets them at
 * the start of the evening and not once per attempt.
 */

const STORAGE_KEY = 'webrtc-qr.logbook.v1'
const CONTEXT_KEY = 'webrtc-qr.logbook.context.v1'

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
 * What this browser is, in the words the matrix needs.
 *
 * Deliberately coarse. The user agent carries more than this and none of the
 * rest distinguishes one row of the matrix from another.
 */
function describeAgent () {
  const ua = navigator.userAgent
  const brands = navigator.userAgentData?.brands ?? []
  const known = brands.find(b => !/Not.?A.?Brand/i.test(b.brand))

  const engine = known?.brand ??
    (/\bFirefox\/(\d+)/.test(ua) ? 'Firefox' : /\bChrome\/(\d+)/.test(ua) ? 'Chrome' : /\bSafari\//.test(ua) ? 'Safari' : 'unknown')
  const version = known?.version ?? (ua.match(/(?:Firefox|Chrome|Version)\/(\d+)/)?.[1] ?? '')

  const platform = navigator.userAgentData?.platform ??
    (/Android/i.test(ua) ? 'Android' : /iPhone|iPad|iPod/i.test(ua) ? 'iOS' : /Mac OS X/.test(ua) ? 'macOS' : /Windows/.test(ua) ? 'Windows' : /Linux/.test(ua) ? 'Linux' : 'unknown')

  return { engine, version, platform, mobile: navigator.userAgentData?.mobile ?? /Mobi/i.test(ua) }
}

export function createLogbook ({ now = () => Date.now() } = {}) {
  let entries = read(STORAGE_KEY, [])
  let context = read(CONTEXT_KEY, { provider: '', place: '' })
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
      context = { provider: '', place: '', ...next }
      write(CONTEXT_KEY, context)
      announce()
    },

    entries () {
      return entries.map(entry => ({ ...entry }))
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
      if (open != null) this.finish({ outcome: 'abandoned' })

      open = {
        id: `${now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
        at: new Date(now()).toISOString(),
        role,
        carrier,
        ...describeAgent(),
        ...context,
        network: null,
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

    clear () {
      entries = []
      persist()
    },

    /** Everything, as the file somebody would send by hand. */
    export () {
      return JSON.stringify({ v: 1, exportedAt: new Date(now()).toISOString(), entries }, null, 2)
    }
  }
}
