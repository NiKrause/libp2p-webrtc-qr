import { AbstractMultiaddrConnection } from '@libp2p/utils'

/**
 * Presents an already-connected RTCPeerConnection to libp2p as a
 * MultiaddrConnection.
 *
 * `@libp2p/webrtc` has an equivalent internally, but does not export it. Since
 * libp2p 3 the base class it builds on - `AbstractMultiaddrConnection` - is a
 * public export of `@libp2p/utils`, so this is our own ~40 lines rather than
 * another vendored copy. See src/vendor/README.md for what still has to be
 * copied.
 *
 * There is no send path here: the DataChannel muxer writes to its own channels,
 * so this connection only models the lifecycle of the peer connection itself.
 */
class QRWebRTCMultiaddrConnection extends AbstractMultiaddrConnection {
  constructor (init) {
    super(init)

    this.peerConnection = init.peerConnection

    this.peerConnection.addEventListener('connectionstatechange', () => {
      const state = this.peerConnection.connectionState

      if (state === 'failed' || state === 'closed') {
        this.onTransportClosed()
        this.peerConnection.close()
      }
    })
  }

  sendData (data) {
    return {
      sentBytes: data.byteLength,
      canSendMore: true
    }
  }

  async sendClose (options) {
    this.peerConnection.close()
    options?.signal?.throwIfAborted()
  }

  sendReset () {
    this.peerConnection.close()
  }

  sendPause () {}

  sendResume () {}
}

export function toMultiaddrConnection (init) {
  return new QRWebRTCMultiaddrConnection(init)
}
