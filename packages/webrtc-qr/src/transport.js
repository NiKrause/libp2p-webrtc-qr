import { serviceCapabilities, transportSymbol } from '@libp2p/interface'
import { WebRTCMultiaddrConnection } from './vendor/maconn.js'
import { DataChannelMuxerFactory } from './vendor/muxer.js'

class NoopListener extends EventTarget {
  async listen () {}

  getAddrs () {
    return []
  }

  async close () {}

  updateAnnounceAddrs () {}
}

export function createWebRTCUpgradeContext (components, peerConnection, remoteAddr) {
  return {
    connection: new WebRTCMultiaddrConnection(components, {
      peerConnection,
      remoteAddr,
      timeline: { open: Date.now() }
    }),
    muxerFactory: new DataChannelMuxerFactory(components, {
      peerConnection
    })
  }
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
    const remotePeerId = addr.getPeerId()

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
      muxerFactory: session.muxerFactory,
      onProgress: options.onProgress,
      signal: options.signal
    })
  }
}

export function webRTCQR (init) {
  return components => new WebRTCQRTransport(components, init)
}
