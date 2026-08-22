export { webRTCQR, createWebRTCUpgradeContext } from './transport.js'
export { QRSession, describeIce } from './session.js'
export { createKeepAlive } from './keep-alive.js'
export {
  AUDIO_CHUNK_LIMIT,
  AUDIO_DEFAULT_PROTOCOL,
  AUDIO_HEADER_LENGTH,
  AUDIO_PROTOCOLS,
  AUDIO_TRANSMISSION_LIMIT,
  createAudioReceiver,
  encodeToAudio,
  frameForAudio,
  loadAudioCodec,
  parseAudioFrame,
  resetAudioCodec
} from './audio.js'
export { createWakeLock } from './wake-lock.js'
export { BROWSERS_THAT_HOLD, leavingSuspendsUs, pendingConnections, stateOf } from './suspension.js'
export {
  CLOCK_SKEW_MS,
  DEFAULT_LIFETIME_MS,
  PAYLOAD_VERSION,
  QR_TYPE_OFFER,
  QR_TYPE_ANSWER,
  compress,
  decompress,
  encodeSignedPayload,
  decodeSignedPayload
} from './signaling.js'
export {
  COMPACT_PREFIX,
  COMPACT_VERSION,
  decodeCompactPayload,
  encodeCompactPayload,
  isCompactPayload
} from './compact.js'
// Deliberately the format-aware one, not signaling.js's: a host routing a
// scanned code must never be handed a parser that only knows one format.
export { parsePayload, decodePayload } from './payload.js'

// The measurement, from the root rather than only from `./elements`.
//
// `network.js` touches no DOM and imports nothing, but it lived behind the UI
// entry point — so a consumer that wanted the verdict and not the renderer had
// to import a bundle carrying a QR encoder, CBOR and a camera. That is what
// made an earlier consumer write its own smaller probe: candidate found yes or
// no, no address family, no notion of a symmetric NAT. A thinner verdict for
// the reader least able to interpret one.
//
// `relay-choice.js` is here for the same reason and none of the same history:
// it is the rule for *which relay to try first*, with the dialing passed in, so
// it belongs wherever the decision is made rather than only where it is drawn.
export {
  DEFAULT_RTC_CONFIGURATION,
  isGlobalUnicastV6,
  offNetworkBlocked,
  offNetworkRisk,
  probeBrowser,
  probeCamera,
  probeNetwork,
  summariseNetwork
} from './elements/network.js'
export { findReachableRelays, readRelayOptIn, writeRelayOptIn } from './elements/relay-choice.js'

// `intro-policy.js` completes the set, and it is the one that was asked for by
// name. Its own doc block says it is kept apart from the element so that an app
// writing its own introduction can still have the rule - and until now that app
// could not: reaching it meant importing the barrel, which declares five classes
// extending `HTMLElement` at module scope and therefore throws the moment a
// prerendering build evaluates it. The module itself imports nothing.
export { createIntroPolicy } from './elements/intro-policy.js'
