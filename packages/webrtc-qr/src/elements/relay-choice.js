// Asking for a relay, and finding one - without a DOM and without libp2p.
//
// This is the rule rather than the mechanism. Which addresses to try, in what
// order, and when a third party may be asked at all: that is the same decision
// in every consumer, and it was about to be written a third time. What it is
// *not* is a dialer - `probe` and `discover` arrive as arguments, so this file
// knows nothing about libp2p, nothing about Aleph, and can be tested without
// either.
//
// The default is off. These apps connect by having a code scanned; a relay is
// the second way in, for when the other person is not here to scan anything.
// A default of on would quietly make every start reach a server, which is the
// property the apps are chosen for.

/** What a check found. */
/**
 * @typedef {object} RelayCheck
 * @property {'baked' | 'aleph' | 'none'} source Where the answering relays came from.
 * @property {string[]} addresses The addresses that answered, in the order probed.
 * @property {boolean} askedAleph Whether discovery ran at all.
 */

/**
 * Find a relay that answers, cheapest source first.
 *
 * Baked-in addresses before discovery, and the order is not only about speed:
 * it means a consumer contacts a discovery service exactly when the addresses
 * it shipped with have gone quiet. Somebody opening the app in a room where the
 * known relay is up never talks to a third party at all.
 *
 * Discovered addresses are probed too. A registration can outlive the machine
 * it describes - a public registry has no way to forget an orphan - so
 * "discovered" is not "alive", and handing back an address nobody answered
 * would move the failure to the first dial, where it reads as a bug.
 *
 * @param {object} options
 * @param {readonly string[]} [options.baked] Addresses this build shipped with.
 * @param {(addresses: string[]) => Promise<string[]>} options.probe Returns those that answered.
 * @param {() => Promise<string[]>} [options.discover] Asked only if no baked-in address answers.
 * @returns {Promise<RelayCheck>}
 */
export async function findReachableRelays ({ baked = [], probe, discover }) {
  const seed = [...baked].map(address => address.trim()).filter(Boolean)

  if (seed.length > 0) {
    const reachable = await probe(seed)
    if (reachable.length > 0) return { source: 'baked', addresses: reachable, askedAleph: false }
  }

  if (discover == null) return { source: 'none', addresses: [], askedAleph: false }

  const discovered = await discover()
  const candidates = discovered.map(address => address.trim()).filter(Boolean)
  if (candidates.length === 0) return { source: 'none', addresses: [], askedAleph: true }

  const reachable = await probe(candidates)
  return reachable.length > 0
    ? { source: 'aleph', addresses: reachable, askedAleph: true }
    : { source: 'none', addresses: [], askedAleph: true }
}

/**
 * Read a remembered choice.
 *
 * Storage is passed in rather than reached for, so this is callable where there
 * is none - a worker, a test, a page that blocked it. A key without a stored
 * value is off, which is also what a blocked store gives: the safe direction.
 *
 * @param {Pick<Storage, 'getItem'> | null | undefined} storage
 * @param {string | null | undefined} key
 * @returns {boolean}
 */
export function readRelayOptIn (storage, key) {
  if (storage == null || key == null) return false
  try {
    return storage.getItem(key) === 'true'
  } catch {
    return false
  }
}

/**
 * Remember a choice, if there is anywhere to remember it.
 *
 * A consumer that passes no key gets no persistence, deliberately: storing
 * under a key we invented would put our namespace in their origin.
 *
 * @param {Pick<Storage, 'setItem'> | null | undefined} storage
 * @param {string | null | undefined} key
 * @param {boolean} value
 * @returns {boolean} Whether it was actually stored.
 */
export function writeRelayOptIn (storage, key, value) {
  if (storage == null || key == null) return false
  try {
    storage.setItem(key, String(value))
    return true
  } catch {
    // Blocked: the choice holds for this session and no longer.
    return false
  }
}
