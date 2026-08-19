/**
 * Surviving the moment somebody leaves the app.
 *
 * These three answer one question between them - is the pending invite still
 * going to be there when this person comes back - and they were written three
 * times in the demo before anyone noticed they were not application code. The
 * transport cannot fix the underlying behaviour, so what it can do is stop every
 * consumer rediscovering it.
 *
 * `createKeepAlive()` in `keep-alive.js` is the fourth part of the same subject:
 * it tries to prevent the suspension. These describe and observe it.
 */

/**
 * Browsers observed to hold a waiting invite long enough to be worth trying.
 *
 * Measured by hand across phones, not derived from anything - a record of what
 * was seen, not something a platform promises. Roughly ten seconds in these, and
 * seconds in the rest.
 *
 * **If that changes, this list is the only thing to change.** It is exported so
 * a consumer names the browsers from here rather than from its own copy, which
 * is how two lists drift apart.
 */
export const BROWSERS_THAT_HOLD = ['ddg', 'safari']

/**
 * Does leaving this app suspend it?
 *
 * Named for what matters rather than for "is this a phone" - the phone is only
 * a proxy. A desktop browser keeps a background tab running and a handover
 * through a chat window is unhurried there. A phone suspends whatever is not in
 * front, and the field report from two Android devices is that you have **a
 * couple of seconds** before the connection is gone.
 *
 * Hurrying a desktop user would be false, and false urgency is how people learn
 * to ignore a warning. So this is the gate for showing one at all.
 *
 * `hover: none and pointer: coarse` is true on phones and tablets and false on
 * desktops, including the touchscreen laptops a bare touch check misreads.
 *
 * @returns {boolean}
 */
export function leavingSuspendsUs () {
  try {
    return globalThis.navigator?.userAgentData?.mobile === true ||
      globalThis.matchMedia?.('(hover: none) and (pointer: coarse)').matches === true
  } catch {
    // A environment without either signal is not a phone as far as this can
    // tell, and the safe direction is not to hurry anybody.
    return false
  }
}

/**
 * What a peer connection is actually doing, in one word.
 *
 * `signalingState` is the honest one and is checked first. A connection the
 * browser closed while the page was suspended reports `closed` here, and
 * browsers have shipped versions that closed it **without firing any event**
 * ([w3c/webrtc-pc#2489](https://github.com/w3c/webrtc-pc/issues/2489)) - so this
 * is something to read, never something to await.
 *
 * @param {RTCPeerConnection} peerConnection
 * @returns {string}
 */
export function stateOf (peerConnection) {
  return peerConnection.signalingState === 'closed'
    ? 'closed'
    : peerConnection.connectionState ?? peerConnection.iceConnectionState ?? 'new'
}

/**
 * Every peer connection a session is currently responsible for, labelled.
 *
 * Both halves matter and it is easy to remember only one: `offers` are invites
 * waiting for an answer, `inbound` are connections built from an offer this peer
 * accepted. A liveness readout that iterates one of them reports health for half
 * the connections and silence for the other.
 *
 * @param {{ offers?: Map<string, { peerConnection: RTCPeerConnection }>, inbound?: Iterable<RTCPeerConnection> }} [session]
 * @returns {Array<{ role: 'invite' | 'reply', label: string, peerConnection: RTCPeerConnection }>}
 */
export function pendingConnections (session) {
  if (session == null) {
    return []
  }

  const out = []

  for (const [sessionId, offer] of session.offers ?? []) {
    out.push({ role: 'invite', label: sessionId.slice(0, 6), peerConnection: offer.peerConnection })
  }

  let n = 0

  for (const peerConnection of session.inbound ?? []) {
    n += 1
    out.push({ role: 'reply', label: `#${n}`, peerConnection })
  }

  return out
}
