import { mergeStrings, text } from './strings.js'
/**
 * `<qr-peers>` - who is connected, and how that connection is doing.
 *
 * ```js
 * peers.peers = [{ peerId, state: 'connected' }, …]
 * peers.addEventListener('disconnect', event => drop(event.detail.peerId))
 * ```
 *
 * Display only: it is told who is connected rather than asking, because the
 * answer lives in the application's own bookkeeping - which streams are open,
 * which peer connections it is still watching - and an element that went looking
 * for it would have to know more about the app than it should.
 *
 * `disconnect` is a request, not an announcement. The host closes the stream and
 * the peer connection, and the list changes when the host says it has.
 */

/**
 * `disconnected` is not `failed`. WebRTC reports it for a connection that has
 * lost its path and may well get it back - a phone whose radio slept usually
 * does, once the screen is on again - so it is amber and worded as a wait, not
 * red and worded as an end.
 */
/**
 * Everything this element says, in English. Replace any of it through the
 * `strings` property; what you leave out keeps these.
 */
export const QR_PEERS_STRINGS = {
  connected: 'connected',
  connecting: 'connecting…',
  disconnected: 'reconnecting…',
  failed: 'failed',
  closed: 'closed',
  new: 'connecting…',
  disconnect: 'Disconnect',
  disconnectFrom: ({ peerId }) => `Disconnect from ${peerId}`
}

const STYLE = `
  :host {
    display: block;
    --qr-peers-background: #10141f;
    --qr-peers-border: #232b3d;
    --qr-peers-accent: #3edc97;
    --qr-peers-degraded: #ffc24b;
    --qr-peers-lost: #ff6b5b;
    --qr-peers-muted: #5c677a;
    --qr-peers-radius: 8px;
    --qr-peers-mono: ui-monospace, monospace;
  }

  :host([hidden]) { display: none; }

  .row {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 9px 14px;
    margin-bottom: 8px;
    border: 1px solid var(--qr-peers-border);
    border-left: 2px solid var(--qr-peers-accent);
    border-radius: 0 var(--qr-peers-radius) var(--qr-peers-radius) 0;
    background: var(--qr-peers-background);
  }

  .name {
    flex: 1;
    font-family: var(--qr-peers-mono);
    font-size: 0.8rem;
    color: var(--qr-peers-accent);
    overflow-wrap: anywhere;
  }

  .health {
    font-size: 0.72rem;
    font-family: var(--qr-peers-mono);
    color: var(--qr-peers-muted);
    white-space: nowrap;
  }

  .health.connected { color: var(--qr-peers-accent); }
  .health.disconnected { color: var(--qr-peers-degraded); }
  .health.failed, .health.closed { color: var(--qr-peers-lost); }

  button {
    font: inherit;
    font-size: 0.78rem;
    padding: 4px 12px;
    color: inherit;
    background: transparent;
    border: 1px solid var(--qr-peers-border);
    border-radius: var(--qr-peers-radius);
    cursor: pointer;
  }
`

/** Long enough to recognise, short enough to sit in a row on a phone. */
function shortPeer (peerId) {
  return `${peerId.slice(0, 8)}…${peerId.slice(-6)}`
}

export class QrPeersElement extends HTMLElement {
  #list
  #peers = []
  #strings = { ...QR_PEERS_STRINGS }

  constructor () {
    super()

    const root = this.attachShadow({ mode: 'open' })
    const style = document.createElement('style')

    style.textContent = STYLE
    this.#list = document.createElement('div')
    this.#list.setAttribute('role', 'list')

    root.append(style, this.#list)
  }

  /**
   * @param next - `[{ peerId, state }]`, where state is an
   *   `RTCPeerConnection.connectionState` or omitted for a peer whose connection
   *   the host is not tracking
   */
  set peers (next) {
    this.#peers = Array.isArray(next) ? next : []
    this.#render()
  }

  get peers () {
    return this.#peers
  }

  get count () {
    return this.#peers.length
  }

  /** The text this element shows. A partial table keeps the rest. */
  get strings () {
    return { ...this.#strings }
  }

  set strings (value) {
    this.#strings = mergeStrings(QR_PEERS_STRINGS, value)
    this.#render()
  }

  #render () {
    this.#list.replaceChildren()

    for (const { peerId, state = 'connected' } of this.#peers) {
      const row = document.createElement('div')
      const name = document.createElement('span')
      const health = document.createElement('span')
      const drop = document.createElement('button')

      row.className = 'row'
      row.setAttribute('role', 'listitem')
      row.dataset.peer = peerId

      name.className = 'name'
      name.textContent = shortPeer(peerId)
      // The full id, for anyone who needs to compare it against another screen.
      name.title = peerId

      health.className = `health ${state}`
      health.textContent = text(this.#strings[state]) || state

      drop.type = 'button'
      drop.textContent = text(this.#strings.disconnect)
      drop.setAttribute('aria-label', text(this.#strings.disconnectFrom, { peerId }))
      drop.addEventListener('click', () => {
        this.dispatchEvent(new CustomEvent('disconnect', { detail: { peerId } }))
      })

      row.append(name, health, drop)
      this.#list.append(row)
    }
  }
}

if (customElements.get('qr-peers') == null) {
  customElements.define('qr-peers', QrPeersElement)
}
