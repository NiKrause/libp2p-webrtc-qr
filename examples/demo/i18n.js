/**
 * Two languages, both compiled in.
 *
 * Not fetched on demand. A language switch that needs the network fails in
 * exactly the situation this app is for - two phones in a room with no uplink -
 * and it fails quietly, showing raw keys. For two languages and a few dozen
 * strings the cost of shipping both is a rounding error next to the libp2p
 * bundle.
 *
 * The element text is not here. The library carries its own German
 * (`QR_STATUS_STRINGS_DE` and its siblings), which is the point of putting it
 * there: this file holds what is this demo's to say.
 */

import {
  QR_INTRO_STRINGS,
  QR_INTRO_STRINGS_DE,
  QR_INVITE_STRINGS,
  QR_INVITE_STRINGS_DE,
  QR_PEERS_STRINGS,
  QR_PEERS_STRINGS_DE,
  QR_SCANNER_STRINGS,
  QR_SCANNER_STRINGS_DE,
  QR_STATUS_STRINGS,
  QR_STATUS_STRINGS_DE
} from '@le-space/libp2p-webrtc-qr/elements'

import de from './locales/de.js'
import en from './locales/en.js'

export const SUPPORTED = ['en', 'de']
const STORAGE_KEY = 'webrtc-qr.locale'

const CATALOGUES = { en, de }

/** The element tables that go with each locale, kept beside the app's own. */
const ELEMENTS = {
  en: {
    intro: QR_INTRO_STRINGS,
    invite: QR_INVITE_STRINGS,
    peers: QR_PEERS_STRINGS,
    scanner: QR_SCANNER_STRINGS,
    status: QR_STATUS_STRINGS
  },
  de: {
    intro: QR_INTRO_STRINGS_DE,
    invite: QR_INVITE_STRINGS_DE,
    peers: QR_PEERS_STRINGS_DE,
    scanner: QR_SCANNER_STRINGS_DE,
    status: QR_STATUS_STRINGS_DE
  }
}

let current = 'en'

/**
 * The language to start in.
 *
 * A stored choice wins, because somebody who reached for the switch meant it
 * and should not have to reach again. Otherwise the browser decides - `de-AT`
 * and `de-CH` are speakers of German, so only the primary subtag is read.
 * Anything else lands on English.
 *
 * @returns {'en' | 'de'}
 */
export function initialLocale () {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (SUPPORTED.includes(stored)) return stored
  } catch {
    // Storage blocked; fall through to the browser's own setting.
  }

  const fromBrowser = (navigator.language ?? 'en').slice(0, 2).toLowerCase()
  return fromBrowser === 'de' ? 'de' : 'en'
}

/** @param {'en' | 'de'} next */
export function setLocale (next) {
  current = SUPPORTED.includes(next) ? next : 'en'

  try {
    localStorage.setItem(STORAGE_KEY, current)
  } catch {
    // Storage blocked: the choice holds for this session and no longer.
  }

  return current
}

export function locale () {
  return current
}

/** The element string tables for the current locale. */
export function elementStrings () {
  return ELEMENTS[current]
}

/**
 * Look a key up, and call it when it carries numbers.
 *
 * A missing key returns the key itself rather than an empty string. Blank text
 * reads as a finished screen with nothing to say; a visible `invite.ready` reads
 * as the bug it is, and says which one.
 *
 * @param {string} key dotted path into the catalogue
 * @param {Record<string, unknown>} [params]
 * @returns {string}
 */
export function t (key, params = {}) {
  const value = key.split('.').reduce((node, part) => node?.[part], CATALOGUES[current]) ??
    key.split('.').reduce((node, part) => node?.[part], CATALOGUES.en)

  if (value == null) return key
  return typeof value === 'function' ? String(value(params)) : String(value)
}
