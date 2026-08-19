/**
 * Keep the screen awake while a code is on display.
 *
 * The other half of `createKeepAlive()`, and the two are not interchangeable: a
 * wake lock holds the **screen** and only while the page is visible, a keep-alive
 * holds the **page** through an app switch. Neither substitutes for the other and
 * a consumer usually wants both.
 *
 * What this covers is the ordinary case: a phone dozing off because nobody
 * touched it while the other person lined up their camera. A screen that sleeps
 * there drops the code mid-scan. It does **not** cover somebody deliberately
 * locking their phone, and it should not pretend to.
 *
 * The browser releases the lock whenever the page stops being visible, which is
 * why coming back has to ask for it again - `sync()` is written to be called
 * from a `visibilitychange` handler as well as when the state it tracks changes.
 */

/**
 * @typedef {object} WakeLock
 * @property {boolean} supported whether this browser exposes the API at all
 * @property {boolean} wanted our decision - whether a lock should be held now
 * @property {boolean} held the browser's answer to it
 * @property {(active: boolean) => Promise<void>} sync state the intent; the
 *   visibility gate is applied here rather than by the caller
 */

/**
 * @returns {WakeLock}
 */
export function createWakeLock () {
  /** @type {any} */
  let lock = null
  let wanted = false

  const supported = () => typeof globalThis.navigator !== 'undefined' &&
    'wakeLock' in globalThis.navigator

  const visible = () => globalThis.document?.visibilityState === 'visible'

  async function release () {
    const held = lock
    lock = null

    if (held != null) {
      await held.release().catch(() => {})
    }
  }

  async function acquire () {
    if (!supported() || lock != null) {
      return
    }

    try {
      const held = await /** @type {any} */ (globalThis.navigator).wakeLock.request('screen')

      // The request can resolve after the page has already gone away again, in
      // which case holding on to it would leave a lock nobody asked for.
      if (!wanted || !visible()) {
        await held.release().catch(() => {})
        return
      }

      held.addEventListener('release', () => {
        if (lock === held) {
          lock = null
        }
      })

      lock = held
    } catch {
      // Denied, unsupported in this context, or the document was not visible
      // after all. Nothing here is worth interrupting anyone over.
    }
  }

  return {
    get supported () {
      return supported()
    },

    /**
     * `wanted` and `held` are reported separately because only the first is
     * ours to get right. A headless browser exposes the API and then refuses
     * every request, having no screen to keep awake, so asserting on `held`
     * would be asserting on the platform.
     */
    get wanted () {
      return wanted
    },

    get held () {
      return lock != null
    },

    async sync (active) {
      wanted = active

      if (!wanted || !visible()) {
        await release()
        return
      }

      await acquire()
    }
  }
}
