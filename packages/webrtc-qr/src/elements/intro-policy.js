/**
 * When to put an introduction in front of somebody.
 *
 * Kept apart from the element for two reasons. An app that writes its own
 * introduction still wants this rule, and the rule is the part that is easy to
 * get wrong - the element is only markup.
 *
 * Three decisions, none of them obvious the first time:
 *
 *   - **Someone who arrived by invite does not get it.** They came to accept
 *     something, and a dialog in front of that is in the way of the one thing
 *     they came for. They see it on their next plain visit.
 *   - **Storage blocked means show it.** An introduction seen twice is a smaller
 *     problem than a first-time user who never gets one.
 *   - **Dismissing is not a one-way door.** `forget()` exists so an app can put
 *     it back within reach - somebody who ticked the box on their first day may
 *     want it again in a month.
 */

const DEFAULT_KEY = 'webrtc-qr.introSeen'

/**
 * @param {{ storageKey?: string, storage?: Storage }} [options]
 */
export function createIntroPolicy ({ storageKey = DEFAULT_KEY, storage } = {}) {
  // Read lazily rather than captured: `localStorage` does not exist while a
  // page is being prerendered, and a module that touched it at import time
  // would take the whole bundle down there.
  const store = () => storage ?? globalThis.localStorage

  return {
    /**
     * @param {{ arrivedViaInvite?: boolean }} [context]
     * @returns {boolean}
     */
    shouldOpen ({ arrivedViaInvite = false } = {}) {
      if (arrivedViaInvite) return false

      try {
        return store()?.getItem(storageKey) !== 'true'
      } catch {
        return true
      }
    },

    /** Record that it has been seen and should not open by itself again. */
    remember () {
      try {
        store()?.setItem(storageKey, 'true')
      } catch {
        // Nothing to do: it reappears next time, which is the safe direction.
      }
    },

    /** Undo that. */
    forget () {
      try {
        store()?.removeItem(storageKey)
      } catch {
        // Already effectively forgotten.
      }
    }
  }
}
