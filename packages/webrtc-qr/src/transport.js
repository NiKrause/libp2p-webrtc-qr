import { serviceCapabilities, transportSymbol } from '@libp2p/interface'
import { peerIdFromString } from '@libp2p/peer-id'
import { toMultiaddrConnection } from './maconn.js'
import { DataChannelMuxerFactory } from './vendor/muxer.js'

class NoopListener extends EventTarget {
  async listen () {}

  getAddrs () {
    return []
  }

  async close () {}

  updateAnnounceAddrs () {}
}

/**
 * Wrap a connected RTCPeerConnection so libp2p can upgrade it.
 *
 * @param components - the libp2p components object (`node.components`)
 * @param peerConnection - an RTCPeerConnection that has already reached
 *   `connected` via QR-exchanged signaling
 * @param remoteAddr - `/webrtc/p2p/<peer-id>` for the verified remote peer
 * @param options.direction - `'outbound'` on the peer that created the offer
 *   and dials, `'inbound'` on the peer that answered. Getting this wrong leaves
 *   the answering side unable to see incoming streams at all.
 */
export function createWebRTCUpgradeContext (components, peerConnection, remoteAddr, options = {}) {
  const direction = options.direction ?? 'outbound'
  const log = components.logger.forComponent('libp2p:webrtc-qr:connection')

  return {
    connection: toMultiaddrConnection({
      peerConnection,
      remoteAddr,
      direction,
      log
    }),
    muxerFactory: new DataChannelMuxerFactory({
      peerConnection,
      log
    })
  }
}

/**
 * Multiaddr dropped `getPeerId()` in v13, so read the `/p2p/` component.
 */
function remotePeerIdFrom (addr) {
  for (const component of addr.getComponents()) {
    if (component.name === 'p2p' && component.value != null) {
      return component.value
    }
  }

  return null
}

class WebRTCQRTransport {
  constructor (components, init) {
    this.components = components
    this.getOutboundSession = init.getOutboundSession
    this.started = false
  }

  [transportSymbol] = true;
  [Symbol.toStringTag] = '@libp2p/webrtc-qr';
  [serviceCapabilities] = ['@libp2p/transport']

  isStarted () {
    return this.started
  }

  async start () {
    this.started = true
  }

  async stop () {
    this.started = false
  }

  createListener () {
    return new NoopListener()
  }

  listenFilter (multiaddrs) {
    return multiaddrs.filter(addr => addr.toString().startsWith('/webrtc/p2p/'))
  }

  dialFilter (multiaddrs) {
    return this.listenFilter(multiaddrs)
  }

  async dial (addr, options) {
    const remotePeerId = remotePeerIdFrom(addr)

    if (remotePeerId == null) {
      throw new Error('A QR WebRTC address must include a /p2p/ peer id')
    }

    const session = this.getOutboundSession(remotePeerId)

    if (session == null) {
      throw new Error(`No completed QR offer session exists for peer ${remotePeerId}`)
    }

    return options.upgrader.upgradeOutbound(session.connection, {
      skipProtection: true,
      skipEncryption: true,
      // Since libp2p 3 the upgrader wants the remote peer up front. Skipping
      // encryption means there is no handshake to learn it from - it comes from
      // the signed QR payload, which is the only reason skipping is safe here.
      remotePeer: peerIdFromString(remotePeerId),
      muxerFactory: session.muxerFactory,
      onProgress: options.onProgress,
      signal: options.signal
    })
  }
}

export function webRTCQR (init) {
  return components => new WebRTCQRTransport(components, init)
}
