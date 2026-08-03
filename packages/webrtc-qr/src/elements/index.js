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
export { QrInviteElement } from './qr-invite.js'
export { QrScannerElement } from './qr-scanner.js'
export { QrStatusElement } from './qr-status.js'
export {
  DEFAULT_RTC_CONFIGURATION,
  isGlobalUnicastV6,
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
