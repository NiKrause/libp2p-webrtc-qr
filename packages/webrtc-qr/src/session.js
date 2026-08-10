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
   * **Off by default, and not because the format is unfinished.** A connection
   * built from a reconstructed SDP goes silent under load: measured in isolated
   * worktrees, four of eight runs left both peers holding an open stream that
   * carried no bytes, against zero of eight on v2. The cause is not understood
   * (NiKrause/libp2p-webrtc-qr#6), and a code a quarter the size is not worth a
   * connection that fails half the time under load.
   *
   * *Reading* is unconditional and unaffected: a peer accepts either format
   * whatever this says, so turning it on is safe on the receiving side today.
   * Set `true` to opt in - useful for measuring, and for a controlled setting
   * where load is not a factor.
   */
  compact: false,
  /** A stream can report open and be reset a moment later. Look again. */
  dialSettleDelay: 200
}

/**
 * Summarise what ICE actually had to work with. A failure after clean
 * signalling is almost always about candidate types, and those are invisible in
 * the error otherwise.
 */
export function describeIce (peerConnection) {
  const counts = { local: {}, remote: {} }

  for (const [side, key] of [['local', 'localDescription'], ['remote', 'remoteDescription']]) {
    for (const line of peerConnection[key]?.sdp?.split('\r\n') ?? []) {
      const type = line.match(/^a=candidate:.* typ (host|srflx|prflx|relay)/)?.[1]

      if (type != null) {
        counts[side][type] = (counts[side][type] ?? 0) + 1
      }
    }
  }

  const render = side => Object.entries(counts[side])
    .map(([type, count]) => `${count} ${type}`)
    .join(', ') || 'none'

  return `local: ${render('local')}; remote: ${render('remote')}; ice: ${peerConnection.iceConnectionState}`
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
   *   caller that lets the user supply a TURN server per visit can do so
   */
  constructor (node, options = {}) {
    super()

    this.node = node
    this.options = { ...DEFAULTS, ...options }
    this.offers = new Map()
    this.inbound = new Set()
  }

  #rtcConfiguration () {
    const configuration = this.options.rtcConfiguration ?? {}

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

      this.offers.set(sessionId, {
        sessionId,
        createdAt: Date.now(),
        peerConnection,
        initDataChannel,
        remotePeerId: null,
        upgradeContext: null
      })

      return await encodeOffer({
        privateKey: this.node.components.privateKey,
        peerId: this.node.peerId.toString(),
        sessionId,
        sdp: peerConnection.localDescription.sdp,
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

    const peerConnection = new RTCPeerConnection(this.#rtcConfiguration())
    const address = this.#address(offer.peerId)
    // This peer answered, so it is the inbound side of the session.
    const upgradeContext = createWebRTCUpgradeContext(this.node.components, peerConnection, address, {
      direction: 'inbound'
    })

    this.inbound.add(peerConnection)

    try {
      await setRemoteDescription(peerConnection, offer, 'offer')
      await setLocalDescription(peerConnection, await peerConnection.createAnswer(), compact)
      await waitForIceGathering(peerConnection, this.options.iceGatheringTimeout)

      if (peerConnection.localDescription == null) {
        throw new SessionError('WebRTC did not create an SDP answer')
      }

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
        sdp: peerConnection.localDescription.sdp,
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

    await setRemoteDescription(session.peerConnection, answer, 'answer')

    try {
      await waitForConnected(session.peerConnection, this.options.connectionTimeout)
    } catch (error) {
      // A NAT keeps a UDP binding open only while packets flow through it, often
      // well under two minutes. Candidates in an invite that sat in a chat can
      // point at bindings that no longer exist, and it then fails with
      // signalling that went through perfectly.
      throw ageSeconds > 90
        ? new SessionError(`WebRTC connection failed after the invite sat for ${ageSeconds}s - it was probably too old`, session.peerConnection)
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
