import { generateKeyPair, privateKeyFromProtobuf, privateKeyToProtobuf } from '@libp2p/crypto/keys'
import { fromString, toString } from 'uint8arrays'

/**
 * A Peer ID that survives a reload.
 *
 * Without this the node gets a fresh key on every page load, which is fine right
 * up until something interrupts the page. A phone that slept long enough for the
 * tab to be discarded came back not merely disconnected but *unrecognisable* -
 * nothing on either side could tell it was the same person who was in the
 * session a minute earlier.
 *
 * Session storage, not local storage, and the distinction is the whole design:
 *
 *  - it survives a reload, and it survives the browser discarding a background
 *    tab and restoring it, which is exactly the standby case this is for
 *  - it is scoped to *one tab*, so two tabs of the same browser stay two
 *    different peers and can still connect to each other. Local storage would
 *    have made every tab the same peer, and a peer refusing to dial itself
 *    would have quietly broken the two-tab flow this demo depends on
 *  - it does not outlive the tab, so an identifier is not left behind on a
 *    machine after the session it belonged to
 *
 * It is still a stored identifier while it lasts: the same Peer ID appears in
 * every invite from this tab until it is reset. The demo shows it and offers a
 * reset rather than leaving that implicit.
 */
const STORAGE_KEY = 'libp2p-webrtc-qr:identity:v1'

export async function loadOrCreateIdentity () {
  const stored = read()

  if (stored != null) {
    try {
      return { privateKey: privateKeyFromProtobuf(stored), restored: true }
    } catch {
      // A key we cannot parse is worse than no key: it would fail on every load.
      forgetIdentity()
    }
  }

  const privateKey = await generateKeyPair('Ed25519')

  write(privateKeyToProtobuf(privateKey))

  return { privateKey, restored: false }
}

export function forgetIdentity () {
  try {
    sessionStorage.removeItem(STORAGE_KEY)
  } catch {
    // Storage denied - there was nothing to forget.
  }
}

export function identityIsPersisted () {
  return read() != null
}

function read () {
  try {
    const stored = sessionStorage.getItem(STORAGE_KEY)

    return stored == null ? null : fromString(stored, 'base64')
  } catch {
    // Storage can be denied outright. That is not an error worth surfacing -
    // the node simply gets a fresh key, which is what it always used to do.
    return null
  }
}

function write (bytes) {
  try {
    sessionStorage.setItem(STORAGE_KEY, toString(bytes, 'base64'))
  } catch {
    // As above: a peer that cannot persist still works, it just will not be
    // recognised after a reload.
  }
}
