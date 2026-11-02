/**
 * The custom elements' own string tables, in a module of their own.
 *
 * They used to live in `i18n.js`, which was the obvious place until there was
 * a second page. Importing them pulls in `@le-space/libp2p-webrtc-qr/elements`
 * - the scanner, the QR renderer, jsQR - about half a megabyte of code that
 * exists to put a camera on screen. `i18n.js` is imported by anything that
 * wants a translated sentence, so every such page was shipping a QR scanner
 * it never used: the results page's own chunk is a few kilobytes, and that
 * import made it 500.
 *
 * So the tables moved here and the elements come with them. `index.js` is the
 * only module that needs them, because it is the only one with elements to
 * hand them to.
 */

import {
  QR_INTRO_STRINGS,
  QR_INTRO_STRINGS_DE,
  QR_INVITE_STRINGS,
  QR_INVITE_STRINGS_DE,
  QR_LISTEN_STRINGS,
  QR_LISTEN_STRINGS_DE,
  QR_PEERS_STRINGS,
  QR_PEERS_STRINGS_DE,
  QR_SCANNER_STRINGS,
  QR_SCANNER_STRINGS_DE,
  QR_STATUS_STRINGS,
  QR_STATUS_STRINGS_DE
} from '@le-space/libp2p-webrtc-qr/elements'

import { locale } from './i18n.js'

const ELEMENTS = {
  en: {
    intro: QR_INTRO_STRINGS,
    invite: QR_INVITE_STRINGS,
    listen: QR_LISTEN_STRINGS,
    peers: QR_PEERS_STRINGS,
    scanner: QR_SCANNER_STRINGS,
    status: QR_STATUS_STRINGS
  },
  de: {
    intro: QR_INTRO_STRINGS_DE,
    invite: QR_INVITE_STRINGS_DE,
    listen: QR_LISTEN_STRINGS_DE,
    peers: QR_PEERS_STRINGS_DE,
    scanner: QR_SCANNER_STRINGS_DE,
    status: QR_STATUS_STRINGS_DE
  }
}

/**
 * The tables for the language the page is in.
 *
 * Reads the current locale from `i18n.js` rather than taking one, so the two
 * cannot be set to different languages by a caller that forgot a line.
 *
 * @returns {object}
 */
export function elementStrings () {
  return ELEMENTS[locale()]
}
