// One seam for two wire formats.
//
// The session should not care which format a code is in, and a scanner must
// never care: it gets what it is handed. So decoding dispatches on what the text
// actually is, and encoding takes a flag. Everything below returns the same
// shape either way, which is what keeps the branching out of session.js.
//
// The asymmetry is deliberate. Producing is a choice - a shorter code is nicer
// but only readable by peers that speak v3 - while accepting is not a choice at
// all. Refusing a valid format you can read would be a bug with no upside.

import {
  buildSdp,
  compactSessionId,
  decodeCompactPayload,
  deriveIceCredentials,
  encodeCompactPayload,
  extractCompact,
  fingerprintToBytes,
  inspectCompactPayload,
  isCompactPayload
} from './compact.js'
import {
  PAYLOAD_VERSION,
  QR_TYPE_ANSWER,
  QR_TYPE_OFFER,
  decodeSignedPayload,
  encodeSignedPayload,
  parsePayload as parseSignedPayload
} from './signaling.js'

/** @param {string} sdp */
function fingerprintOf (sdp) {
  const hex = sdp.match(/^a=fingerprint:sha-256 (.+)$/mu)?.[1]

  if (hex == null) {
    throw new Error('The local SDP carries no SHA-256 fingerprint')
  }

  return fingerprintToBytes(hex)
}

/**
 * Set a local description, using derived ICE credentials when compact.
 *
 * This is the half of the compact format that is easy to forget: the *sender*
 * has to use derived credentials too, or the receiver - who derives them from
 * the fingerprint rather than reading them - would compute a ufrag the sender
 * never used and ICE would never match. The browser picks its own credentials,
 * so the description is rewritten before it is set.
 *
 * @param {RTCPeerConnection} peerConnection
 * @param {RTCSessionDescriptionInit} description
 * @param {boolean} compact
 */
export async function setLocalDescription (peerConnection, description, compact) {
  if (!compact) {
    return peerConnection.setLocalDescription(description)
  }

  const { ufrag, pwd } = await deriveIceCredentials(fingerprintOf(description.sdp))

  return peerConnection.setLocalDescription({
    type: description.type,
    sdp: description.sdp
      .replace(/^a=ice-ufrag:.*$/mu, `a=ice-ufrag:${ufrag}`)
      .replace(/^a=ice-pwd:.*$/mu, `a=ice-pwd:${pwd}`)
  })
}

/**
 * Apply what a decoded payload described.
 *
 * A v2 payload hands over an SDP, so it is set as it arrived. A v3 payload hands
 * over a fingerprint and candidates, so the SDP is rebuilt here and the
 * candidates are added individually - they are never written into the string.
 *
 * @param {RTCPeerConnection} peerConnection
 * @param {object} payload as returned by decodeOffer or decodeAnswer
 * @param {'offer'|'answer'} type
 */
export async function setRemoteDescription (peerConnection, payload, type) {
  if (payload.sdp != null) {
    return peerConnection.setRemoteDescription({ type, sdp: payload.sdp })
  }

  const { ufrag, pwd } = await deriveIceCredentials(payload.fingerprint)

  // Candidates go into the description, not after it - see buildSdp for the
  // measurement that settled this.
  await peerConnection.setRemoteDescription({
    type,
    sdp: buildSdp({
      fingerprint: payload.fingerprint,
      ufrag,
      pwd,
      type,
      candidates: payload.candidates
    })
  })
}

/** A session id in whichever form the chosen format can carry. */
export function newSessionId (compact) {
  return compact ? compactSessionId() : crypto.randomUUID()
}

/**
 * @param {object} options
 * @param {boolean} options.compact
 */
export async function encodeOffer ({ privateKey, peerId, sessionId, sdp, compact }) {
  if (!compact) {
    return encodeSignedPayload(privateKey, {
      version: PAYLOAD_VERSION,
      type: QR_TYPE_OFFER,
      sessionId,
      peerId,
      sdp
    })
  }

  return encodeCompactPayload(privateKey, {
    type: QR_TYPE_OFFER,
    sessionId,
    peerId,
    ...extractCompact(sdp)
  })
}

/** @param {object} options */
export async function encodeAnswer ({ privateKey, peerId, offerPeerId, sessionId, sdp, compact }) {
  if (!compact) {
    return encodeSignedPayload(privateKey, {
      version: PAYLOAD_VERSION,
      type: QR_TYPE_ANSWER,
      sessionId,
      peerId,
      offerPeerId,
      sdp
    })
  }

  return encodeCompactPayload(privateKey, {
    type: QR_TYPE_ANSWER,
    sessionId,
    peerId,
    offerPeerId,
    ...extractCompact(sdp)
  })
}

/**
 * Verify a payload of either format.
 *
 * The counterpart to parsePayload for hosts that verify a code themselves
 * rather than handing it straight to the session. Without this, reaching for
 * `decodeSignedPayload` looks right and silently means "v2 only" - which is
 * exactly what the demo did, and what turned a working v3 handshake into "that
 * does not look like an invite link".
 *
 * @param {string} text
 * @param {'offer'|'answer'} expectedType
 */
export async function decodePayload (text, expectedType, options) {
  return expectedType === QR_TYPE_ANSWER
    ? decodeAnswer(text, options)
    : decodeOffer(text, options)
}

/** @param {string} text */
export async function decodeOffer (text, options) {
  return isCompactPayload(text)
    ? decodeCompactPayload(text, QR_TYPE_OFFER, options)
    : decodeSignedPayload(text, QR_TYPE_OFFER, options)
}

/** @param {string} text */
export async function decodeAnswer (text, options) {
  return isCompactPayload(text)
    ? decodeCompactPayload(text, QR_TYPE_ANSWER, options)
    : decodeSignedPayload(text, QR_TYPE_ANSWER, options)
}

/**
 * Which format a peer should answer in.
 *
 * The answer follows the offer rather than this peer's own preference. A peer
 * that only speaks v2 sent a v2 offer and could not read a v3 answer, and a peer
 * that sent v3 has just proved it reads v3 - so the offer is the only honest
 * signal available, and no negotiation round trip is needed to get it.
 *
 * @param {string} offerText
 */
export function replyFormatFor (offerText) {
  return isCompactPayload(offerText)
}

/**
 * Parse a payload of either format without verifying it.
 *
 * This is what a host calls to decide whether a scanned code is an offer or an
 * answer, and it has to understand every format the session can produce - a
 * router that knows one format turns a readable code into "cannot be decoded",
 * which is exactly what happened when v3 landed and the demo still called the
 * v2 parser.
 *
 * @param {string} text
 */
export async function parsePayload (text) {
  return isCompactPayload(text) ? inspectCompactPayload(text) : parseSignedPayload(text)
}
