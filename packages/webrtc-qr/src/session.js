import { peerIdFromString } from '@libp2p/peer-id'
import { multiaddr } from '@multiformats/multiaddr'
import { createWebRTCUpgradeContext } from './transport.js'
import {
  decodeAnswer,
  decodeOffer,
  encodeAnswer,
  encodeOffer,
  newSessionId,
  replyFormatFor,
  setLocalDescription,
  setRemoteDescription
} from './payload.js'
import { DEFAULT_RTC_CONFIGURATION } from './elements/network.js'
import { asAddressFamily, familyLabel, familyOf, filterSdpCandidates } from './families.js'
import { QR_TYPE_ANSWER, QR_TYPE_OFFER } from './signaling.js'

/**
 * The session state machine that drives the transport.
 *
 * This existed three times before it existed here: twice in this repository's
 * examples and once in an unrelated project that re-derived it, bug for bug,
 * without knowing the others existed. Three independent implementations of the
 * same fifty lines is not a coincidence, it is a missing export.
 *
 * The three things that are not obvious from the transport API, and that every
 * consumer gets wrong once:
 *
 *  1. **The init data channel must be negotiated.** WebRTC will not gather
 *     candidates without a channel, but a normal one fires `datachannel` on the
 *     remote, and the libp2p muxer adopts that unframed channel as an incoming
 *     stream - after which no real protocol stream ever arrives.
 *  2. **Upgrade only once the connection is up, and in the right direction.**
 *     The offering peer does not attach its muxer until it reads the answer, so
 *     upgrading earlier writes an identify stream into a connection with nothing
 *     behind it and tears the session down. And a wrong `direction` leaves the
 *     answering side unable to see incoming streams at all.
 *  3. **The first dial has to be retried.** Both peers reach `connected` at the
 *     same moment, but the answering peer still has to attach its muxer; a
 *     stream opened into that gap negotiates and is immediately reset.
 */

const DEFAULTS = {
  /** WebRTC needs a moment to gather; without a cap a stalled gather hangs forever. */
  iceGatheringTimeout: 15_000,
  /** How long to wait for `connected` once both descriptions are set. */
  connectionTimeout: 30_000,
  /**
   * How long an answering peer waits for the offerer to read its answer. Minutes,
   * not seconds: an invite sent through a messenger is answered at human speed,
   * and a timeout here closes the connection so the reply can never land.
   */
  answerWaitTimeout: 6 * 60 * 1000,
  dialAttempts: 15,
  dialRetryDelay: 300,
  /**
   * Produce compact (v3) payloads - one static code instead of an animated
   * sequence, and about a quarter the characters.
   *
   * **Off by default, and no longer because of a known defect.** A connection
   * built from a reconstructed SDP was once seen to go silent under load - four
   * of eight runs against zero of eight on v2 - and that measurement did not
   * survive scrutiny. Sixty-eight runs across three conditions, including a
   * deliberately overloaded machine and all three engines, delivered every
   * message; the original result appears to have recorded the state of the
   * laptop rather than of the format
   * (https://github.com/NiKrause/libp2p-webrtc-qr/issues/83#issuecomment-5530131612).
   *
   * What remains is a difference in kind rather than a fault: v3 *rebuilds* the
   * SDP instead of carrying it, so both ends have to agree on how. The default
   * has simply not been revisited since the reason for it went away, and
   * flipping it is a decision rather than a cleanup.
   *
   * *Reading* is unconditional and unaffected: a peer accepts either format
   * whatever this says, so turning it on is safe on the receiving side today.
   * Set `true` to opt in - useful for measuring, and for a controlled setting
   * where load is not a factor.
   */
  compact: false,
  /**
   * Offer one address family only - `'v4'`, `'v6'`, or `null` for everything
   * this device gathered, which is the default and what an ordinary connection
   * wants.
   *
   * A value, or a function returning one, so a host with a control on screen
   * does not have to rebuild its session when somebody flips it.
   *
   * This is a measuring instrument, not a tuning knob: see families.js for why
   * setting it on **one** device is enough to constrain both, and why it
   * deliberately does not travel with the invite. Setting it can also make a
   * connection that would have worked fail - which is the point when the
   * question is whether a family works at all, and a nuisance otherwise.
   */
  addressFamily: null,
  /** A stream can report open and be reset a moment later. Look again. */
  dialSettleDelay: 200
}

/**
 * Summarise what ICE actually had to work with. A failure after clean
 * signalling is almost always about candidate types, and those are invisible in
 * the error otherwise.
 */
/**
 * Whether a side's reflexive candidates look like symmetric NAT.
 *
 * Same rule the readiness panel uses before anyone connects: more than one
 * public port *within one address family* means the NAT picks a new mapping per
 * destination, and hole punching towards an arbitrary peer will not work. Two
 * srflx candidates are perfectly healthy when they are one IPv4 and one IPv6 -
 * which is why the count alone, as this function used to report, cannot tell the
 * two apart.
 *
 * Returns null when there is nothing to judge: no reflexive candidate at all, or
 * only one per family.
 */
function symmetricFamilies (candidates) {
  const ports = { v4: new Set(), v6: new Set() }

  for (const { type, address, port } of candidates) {
    if (type !== 'srflx') continue
    ports[address.includes(':') ? 'v6' : 'v4'].add(port)
  }

  return [
    ports.v4.size > 1 ? 'IPv4' : null,
    ports.v6.size > 1 ? 'IPv6' : null
  ].filter(Boolean)
}

/**
 * The candidates in an SDP, with their addresses.
 *
 * Exported because `describeIce` deliberately reduces this to counts - which is
 * the right shape for a status line and the wrong one for anybody asking *which
 * network was this*. A reflexive candidate carries the public address the STUN
 * transaction discovered, so a consumer keeping a local diagnostic log has it
 * already and needs no service to find out.
 *
 * It is also the field that must never leave a device unprojected, which is a
 * property of what a consumer does with it rather than of this function.
 *
 * @param {string | undefined} sdp
 * @returns {Array<{ address: string, port: string, type: 'host' | 'srflx' | 'prflx' | 'relay' }>}
 */
export function readIceCandidates (sdp) {
  return readCandidates(sdp)
}

function readCandidates (sdp) {
  const found = []

  for (const line of sdp?.split('\r\n') ?? []) {
    const match = line.match(/^a=candidate:\S+ \d+ \S+ \d+ (\S+) (\d+) typ (host|srflx|prflx|relay)/)

    if (match != null) {
      found.push({ address: match[1], port: match[2], type: match[3] })
    }
  }

  return found
}

export function describeIce (peerConnection) {
  const sides = {
    local: readCandidates(peerConnection.localDescription?.sdp),
    remote: readCandidates(peerConnection.remoteDescription?.sdp)
  }

  const render = side => {
    const counts = {}

    for (const { type } of sides[side]) {
      counts[type] = (counts[type] ?? 0) + 1
    }

    const listed = Object.entries(counts).map(([type, count]) => `${count} ${type}`).join(', ') || 'none'
    const symmetric = symmetricFamilies(sides[side])

    return symmetric.length > 0 ? `${listed}, symmetric ${symmetric.join('+')}` : listed
  }

  return `local: ${render('local')}; remote: ${render('remote')}; ice: ${peerConnection.iceConnectionState}`
}

/**
 * Both sides behind a symmetric NAT is a different failure from a stale invite,
 * and telling a user to hurry up when the network was never going to work is
 * worse than saying nothing.
 */
export function bothSidesSymmetric (peerConnection) {
  const local = symmetricFamilies(readCandidates(peerConnection.localDescription?.sdp))
  const remote = symmetricFamilies(readCandidates(peerConnection.remoteDescription?.sdp))

  return local.length > 0 && remote.length > 0
}

class SessionError extends Error {
  constructor (message, peerConnection) {
    super(peerConnection == null ? message : `${message} (${describeIce(peerConnection)})`)
    this.name = 'SessionError'
    this.ice = peerConnection == null ? null : describeIce(peerConnection)
  }
}

async function waitForIceGathering (peerConnection, timeoutMs) {
  if (peerConnection.iceGatheringState === 'complete') {
    return
  }

  await new Promise(resolve => {
    const timer = setTimeout(done, timeoutMs)

    function done () {
      clearTimeout(timer)
      peerConnection.removeEventListener('icegatheringstatechange', onChange)
      resolve()
    }

    function onChange () {
      if (peerConnection.iceGatheringState === 'complete') {
        done()
      }
    }

    peerConnection.addEventListener('icegatheringstatechange', onChange)
  })
}

async function waitForConnected (peerConnection, timeoutMs) {
  if (peerConnection.connectionState === 'connected') {
    return
  }

  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup()
      reject(new SessionError('WebRTC connection timed out', peerConnection))
    }, timeoutMs)

    function cleanup () {
      clearTimeout(timer)
      peerConnection.removeEventListener('connectionstatechange', onChange)
    }

    function onChange () {
      const state = peerConnection.connectionState

      if (state === 'connected') {
        cleanup()
        resolve()
        return
      }

      if (state === 'failed' || state === 'closed') {
        cleanup()
        reject(new SessionError(`WebRTC connection entered state ${state}`, peerConnection))
      }
    }

    peerConnection.addEventListener('connectionstatechange', onChange)
  })
}

export class QRSession extends EventTarget {
  /**
   * @param node - a started libp2p node using the `webRTCQR` transport
   * @param options.rtcConfiguration - object, or a function returning one, so a
   *   caller that lets the user supply a TURN server per visit can do so.
   *   Defaults to `DEFAULT_RTC_CONFIGURATION`, the list `qr-status` probes
   *   with, so the probe's verdict describes what an invite can reach. Pass
   *   `{ iceServers: [] }` to gather host candidates only: the same network
   *   still works, and no STUN server learns this device's public address.
   */
  constructor (node, options = {}) {
    super()

    this.node = node
    this.options = { ...DEFAULTS, ...options }
    this.offers = new Map()
    this.inbound = new Set()
  }

  #addressFamily () {
    const family = this.options.addressFamily

    return asAddressFamily(typeof family === 'function' ? family() : family)
  }

  /**
   * The SDP this peer hands out, with the family filter applied if one is set.
   *
   * Refuses rather than handing over a payload with no transport address in it.
   * An invite filtered down to nothing still encodes, signs, renders as a QR
   * code and verifies on the far side - and then ICE sits in `checking` until it
   * times out, with nothing anywhere saying why. "This device gathered no IPv6
   * candidate" is a finding, and it is worth far more as a sentence than as a
   * timeout thirty seconds later.
   *
   * Only when the unfiltered description had candidates: a gather that produced
   * nothing at all is a different fault, and it is not this filter's to report.
   *
   * The two ways of having nothing left are different findings and get different
   * sentences. "No IPv6 candidate" is an answer about the network. "Every
   * address was withheld as a `.local` name" is an answer about the *browser* -
   * all three engines obfuscate host addresses by default - and it means the
   * question cannot be asked over host candidates at all. Reflexive candidates
   * carry real addresses, so gathering with a STUN server is what makes a
   * filtered run possible; without one, a same-network invite may have nothing
   * but mDNS names in it.
   */
  #offered (sdp, family) {
    if (family == null) return sdp

    const filtered = filterSdpCandidates(sdp, family)
    const gathered = readCandidates(sdp)

    if (readCandidates(filtered).length === 0 && gathered.length > 0) {
      const withheld = gathered.every(candidate => familyOf(candidate.address) === 'mdns')

      throw new SessionError(withheld
        ? 'Nothing to offer: every candidate this device gathered has its address withheld as an ' +
          `mDNS (.local) name, which says nothing about its family, so an ${familyLabel(family)}-only ` +
          'invite cannot be built from them. Reflexive candidates carry real addresses - gather with ' +
          'a STUN server to ask this question.'
        : `Nothing to offer: this device gathered no ${familyLabel(family)} candidate, so an ` +
          `${familyLabel(family)}-only invite would describe no address to connect to.`)
    }

    return filtered
  }

  #rtcConfiguration () {
    const configuration = this.options.rtcConfiguration ?? DEFAULT_RTC_CONFIGURATION

    return typeof configuration === 'function' ? configuration() : configuration
  }

  #emit (type, detail) {
    this.dispatchEvent(new CustomEvent(type, { detail }))
  }

  #address (peerId) {
    return multiaddr(`/webrtc/p2p/${peerId}`)
  }

  /**
   * The newest session for a peer, not the first.
   *
   * Reconnecting to a peer leaves the dead session in the map beside the new
   * one, and handing the transport a closed peer connection fails the dial with
   * "Remote closed connection during opening" - which says nothing about the
   * real cause.
   */
  getOutboundSession (remotePeerId) {
    let newest = null

    for (const session of this.offers.values()) {
      if (session.remotePeerId === remotePeerId && (newest == null || session.createdAt >= newest.createdAt)) {
        newest = session
      }
    }

    return newest?.upgradeContext ?? null
  }

  /**
   * Create a signed offer, and hold the peer connection until it is answered.
   *
   * `{ compact: false }` produces a v2 payload for this offer only - for a host
   * that knows it is inviting an older peer, and for tests that need the large
   * payload the animated code exists for.
   */
  async createOffer (options = {}) {
    const compact = options.compact ?? this.options.compact
    const peerConnection = new RTCPeerConnection(this.#rtcConfiguration())
    const sessionId = newSessionId(compact)
    // Negotiated, so the remote never sees a `datachannel` event for it.
    const initDataChannel = peerConnection.createDataChannel('init', { negotiated: true, id: 1023 })

    try {
      await setLocalDescription(peerConnection, await peerConnection.createOffer(), compact)
      await waitForIceGathering(peerConnection, this.options.iceGatheringTimeout)

      if (peerConnection.localDescription == null) {
        throw new SessionError('WebRTC did not create an SDP offer')
      }

      const addressFamily = this.#addressFamily()

      this.offers.set(sessionId, {
        sessionId,
        createdAt: Date.now(),
        peerConnection,
        initDataChannel,
        /**
         * Kept with the session rather than read again when the answer arrives.
         * The filter is a control somebody can change between showing an invite
         * and reading the reply to it, and an answer accepted under a different
         * rule than the offer it belongs to would be a measurement of neither.
         */
        addressFamily,
        remotePeerId: null,
        upgradeContext: null
      })

      return await encodeOffer({
        privateKey: this.node.components.privateKey,
        peerId: this.node.peerId.toString(),
        sessionId,
        sdp: this.#offered(peerConnection.localDescription.sdp, addressFamily),
        compact
      })
    } catch (error) {
      peerConnection.close()
      this.offers.delete(sessionId)
      throw error
    }
  }

  /**
   * Verify an offer and answer it.
   *
   * Returns as soon as the answer is signed, because the offering peer cannot
   * finish until it reads that answer. The connection completes afterwards and
   * reports itself through the `connect` event - or `error` if it never does.
   */
  async acceptOffer (text) {
    const offer = await decodeOffer(text)
    // Answer in the format the offer arrived in, not in this peer's preference -
    // an offerer that sent v2 cannot read a v3 answer.
    const compact = replyFormatFor(text)

    if (offer.peerId === this.node.peerId.toString()) {
      throw new SessionError('This offer was created by this peer')
    }

    const addressFamily = this.#addressFamily()
    const peerConnection = new RTCPeerConnection(this.#rtcConfiguration())
    const address = this.#address(offer.peerId)
    // This peer answered, so it is the inbound side of the session.
    const upgradeContext = createWebRTCUpgradeContext(this.node.components, peerConnection, address, {
      direction: 'inbound'
    })

    this.inbound.add(peerConnection)

    try {
      // Filtered on the way in as well as on the way out, and that is what makes
      // one device enough: a candidate this side never learnt about is a pair
      // this side never probes.
      await setRemoteDescription(peerConnection, offer, 'offer', addressFamily)
      await setLocalDescription(peerConnection, await peerConnection.createAnswer(), compact)
      await waitForIceGathering(peerConnection, this.options.iceGatheringTimeout)

      if (peerConnection.localDescription == null) {
        throw new SessionError('WebRTC did not create an SDP answer')
      }

      // Before the wait is armed, not after: a filter with nothing left to offer
      // throws, and throwing after that promise is running reports the same
      // refusal twice - once as itself and once as a connection that failed.
      const sdp = this.#offered(peerConnection.localDescription.sdp, addressFamily)

      waitForConnected(peerConnection, this.options.answerWaitTimeout)
        .then(async () => {
          await this.node.components.upgrader.upgradeInbound(upgradeContext.connection, {
            skipEncryption: true,
            skipProtection: true,
            // No handshake tells libp2p who the remote is, so it has to be told.
            // The peer id comes from the offer whose signature was just verified,
            // which is what makes that safe.
            remotePeer: peerIdFromString(offer.peerId),
            muxerFactory: upgradeContext.muxerFactory,
            signal: AbortSignal.timeout(this.options.connectionTimeout)
          })

          this.#emit('connect', { peerId: offer.peerId, peerConnection, direction: 'inbound' })
        })
        .catch(error => {
          this.inbound.delete(peerConnection)
          peerConnection.close()
          this.#emit('error', { peerId: offer.peerId, peerConnection, error, direction: 'inbound' })
        })

      return await encodeAnswer({
        privateKey: this.node.components.privateKey,
        peerId: this.node.peerId.toString(),
        offerPeerId: offer.peerId,
        sessionId: offer.sessionId,
        sdp,
        compact
      })
    } catch (error) {
      this.inbound.delete(peerConnection)
      peerConnection.close()
      throw error
    }
  }

  /**
   * Verify an answer to an offer this session created and complete the
   * connection - including the dial that turns it into a libp2p connection.
   *
   * Resolves with the connection. Pass `{ dial: false }` to stop before that
   * step, for a caller that wants to open a protocol stream itself and would
   * rather not have a connection dialled twice.
   */
  async acceptAnswer (text, options = {}) {
    const answer = await decodeAnswer(text)

    if (answer.peerId === this.node.peerId.toString()) {
      throw new SessionError('This answer was created by this peer')
    }

    const session = this.offers.get(answer.sessionId)

    if (session == null) {
      throw new SessionError('The answer belongs to a different session')
    }

    if (answer.offerPeerId !== this.node.peerId.toString()) {
      throw new SessionError('The answer was not created for this peer')
    }

    const ageSeconds = Math.round((Date.now() - session.createdAt) / 1000)

    await setRemoteDescription(session.peerConnection, answer, 'answer', session.addressFamily)

    try {
      await waitForConnected(session.peerConnection, this.options.connectionTimeout)
    } catch (error) {
      // Two failures look identical from here and need opposite advice.
      //
      // A NAT keeps a UDP binding open only while packets flow through it, often
      // well under two minutes, so candidates in an invite that sat in a chat can
      // point at bindings that no longer exist - a fresh invite fixes that.
      //
      // But if both sides are behind a symmetric NAT, no invite of any age would
      // have connected, and telling someone to hurry up sends them to try the
      // same thing faster. Mobile carriers are the common case, and the reflexive
      // candidates say so: more than one public port in one family.
      if (bothSidesSymmetric(session.peerConnection)) {
        throw new SessionError(
          'WebRTC could not connect: both networks use a symmetric NAT, which hole punching cannot cross. IPv6 on both sides, the same network, or a relay would work',
          session.peerConnection
        )
      }

      throw ageSeconds > 90
        ? new SessionError(`WebRTC connection failed after the invite sat for ${ageSeconds}s - the network path it described has closed since. Create a fresh invite`, session.peerConnection)
        : error
    }

    session.initDataChannel.close()
    session.remotePeerId = answer.peerId
    session.upgradeContext = createWebRTCUpgradeContext(
      this.node.components,
      session.peerConnection,
      this.#address(answer.peerId),
      { direction: 'outbound' }
    )

    // Dial before reporting a connection, because until something dials there
    // is no libp2p connection - only a WebRTC one with an upgrade context beside
    // it. An app with a protocol of its own never notices, because dialling that
    // protocol does it. An app that just uses whatever connection exists - a
    // replicating database, a pubsub topic - sees `connect` fire and no peer.
    const connection = options.dial === false ? null : await this.dial(answer.peerId)

    this.#emit('connect', {
      peerId: answer.peerId,
      peerConnection: session.peerConnection,
      connection,
      direction: 'outbound'
    })

    return { peerId: answer.peerId, address: this.#address(answer.peerId), connection, ageSeconds }
  }

  /**
   * Retry a dial while the answering peer attaches its muxer.
   *
   * Both peers reach `connected` at the same moment, but anything opened before
   * the remote muxer exists negotiates and is immediately reset - so a single
   * dial fails for a connection that is about to be perfectly good. It also has
   * to be checked *after* a beat, because the reset arrives just late enough for
   * the first look to say `open`.
   */
  async #retryDial (what, open, attempts) {
    let lastError = new SessionError(`The remote peer never accepted a ${what}`)

    for (let attempt = 0; attempt < attempts; attempt++) {
      try {
        const result = await open()

        await new Promise(resolve => setTimeout(resolve, this.options.dialSettleDelay))

        if (result.status === 'open') {
          return result
        }

        lastError = new SessionError(`${what} was ${result.status} right after opening`)
      } catch (error) {
        lastError = error
      }

      await new Promise(resolve => setTimeout(resolve, this.options.dialRetryDelay))
    }

    throw lastError
  }

  /** Open a connection to a peer whose answer was accepted. */
  async dial (peerId, options = {}) {
    const address = this.#address(peerId)

    return this.#retryDial(
      'connection',
      () => this.node.dial(address, { signal: AbortSignal.timeout(this.options.connectionTimeout) }),
      options.attempts ?? this.options.dialAttempts
    )
  }

  /** Open a protocol stream to a peer whose answer was accepted. */
  async dialProtocol (peerId, protocol, options = {}) {
    const address = this.#address(peerId)

    return this.#retryDial(
      'stream',
      () => this.node.dialProtocol(address, protocol, {
        signal: AbortSignal.timeout(this.options.connectionTimeout)
      }),
      options.attempts ?? this.options.dialAttempts
    )
  }

  /**
   * Forget everything held for a peer: the libp2p connection, the offer session
   * and its peer connection. Leaving any of it behind makes the *next* attempt
   * fail, because libp2p matches the new session against the stale one.
   */
  forget (peerId) {
    for (const connection of this.node?.getConnections() ?? []) {
      if (connection.remotePeer.toString() === peerId) {
        connection.close().catch(() => {})
      }
    }

    for (const [sessionId, session] of this.offers) {
      if (session.remotePeerId === peerId) {
        session.peerConnection?.close()
        this.offers.delete(sessionId)
      }
    }
  }

  /** Close every peer connection this session is holding. */
  close () {
    for (const session of this.offers.values()) {
      session.peerConnection.close()
    }

    for (const peerConnection of this.inbound) {
      peerConnection.close()
    }

    this.offers.clear()
    this.inbound.clear()
  }
}
