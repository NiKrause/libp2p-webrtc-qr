/**
 * The UI layer, behind its own entry point.
 *
 * Importing the package root gives you the transport, the codec and the
 * session, and pulls in none of this - no QR encoder, no CBOR, no camera. An
 * application that only wants a connection should not carry a renderer it never
 * calls, which is why these are not exported from the root.
 *
 *   import '@le-space/libp2p-webrtc-qr/elements'
 */
import './buffer-shim.js'

export { QrIntroElement, QR_INTRO_STRINGS } from './qr-intro.js'
export { createIntroPolicy } from './intro-policy.js'
export { QrInviteElement, QR_INVITE_STRINGS } from './qr-invite.js'
export { QrPeersElement, QR_PEERS_STRINGS } from './qr-peers.js'
export { QrScannerElement, QR_SCANNER_STRINGS } from './qr-scanner.js'
export { QrStatusElement, QR_STATUS_STRINGS } from './qr-status.js'

// The seam itself, so a consumer can fold its own table the way an element
// does - useful when the translations live in a store rather than in one
// literal at the call site.
export { mergeStrings, resolveText } from './strings.js'
// German defaults for all four, so the same three dozen labels are not
// translated once per consumer. See strings-de.js.
export {
  QR_INTRO_STRINGS_DE,
  QR_INVITE_STRINGS_DE,
  QR_PEERS_STRINGS_DE,
  QR_SCANNER_STRINGS_DE,
  QR_STATUS_STRINGS_DE
} from './strings-de.js'
export {
  DEFAULT_RTC_CONFIGURATION,
  isGlobalUnicastV6,
  // Both, because a consumer gating its own connect control needs the verdict
  // without a DOM - and without these the judgement was reachable only by
  // reading an attribute off the element, which is not an API.
  offNetworkBlocked,
  offNetworkRisk,
  probeNetwork,
  summariseNetwork
} from './network.js'
export {
  FRAME_INTERVAL_MS,
  MAX_FRAGMENT_BYTES,
  STATIC_QR_MAX_LENGTH,
  createFrameSource,
  createPartAccumulator,
  looksLikeUrPart,
  needsAnimation,
  preload
} from './frames.js'
