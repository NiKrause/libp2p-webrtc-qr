import jsQR from 'jsqr'
import { createPartAccumulator, looksLikeUrPart } from './frames.js'

/**
 * `<qr-scanner>` - a camera that reads a payload and hands it over.
 *
 * ```js
 * scanner.validate = async text => ({ ok: text.includes('#i='), reason: 'Not an invite' })
 * scanner.addEventListener('scan', event => use(event.detail.text))
 * scanner.open()
 * ```
 *
 * The element owns the camera, the scan loop and the reassembly of multi-frame
 * codes; the host owns what a payload means. That split is deliberate - the
 * element cannot know whether a scanned code is the one this screen was waiting
 * for, and the host should not have to own a camera lifecycle to find out.
 *
 * `validate` returning `{ ok: false, reason }` keeps the camera running and
 * shows the reason, which is what makes "that is a reply, not an invite" a
 * message rather than a dead end.
 *
 * The camera is released on **every** way out - the close button, Escape, the
 * host calling `close()`, a successful scan, and the element being removed from
 * the document. That last one is the one that bites: a detached element holding
 * a track leaves the camera light on, and users report that as spyware rather
 * than as a leak.
 */

/** Scanning faster than this burns battery without catching more codes. */
const SCAN_INTERVAL = 140
/** jsQR slows down quadratically with resolution and gains nothing above this. */
const CANVAS_MAX_WIDTH = 960

const STYLE = `
  :host {
    /* The element renders nothing but a modal, so it should take no space in
       the flow it was placed in. */
    display: contents;
    --qr-scanner-background: #101420;
    --qr-scanner-foreground: #edf1f8;
    --qr-scanner-border: rgba(255, 255, 255, 0.12);
    --qr-scanner-radius: 14px;
    --qr-scanner-width: 460px;
    --qr-scanner-status-color: #a8b3c7;
  }

  dialog {
    width: min(100vw, var(--qr-scanner-width));
    max-width: 100vw;
    max-height: 100dvh;
    padding: 20px;
    border: 1px solid var(--qr-scanner-border);
    border-radius: var(--qr-scanner-radius);
    background: var(--qr-scanner-background);
    color: var(--qr-scanner-foreground);
    overflow-y: auto;
  }

  dialog::backdrop { background: rgb(0 0 0 / 0.72); }

  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    margin-bottom: 16px;
  }

  h3 { margin: 0; font-size: 1.02rem; }

  video {
    display: block;
    box-sizing: border-box;
    width: 100%;
    border: 1px solid var(--qr-scanner-border);
    border-radius: 8px;
    background: #000;
  }

  p {
    margin: 12px 0 0;
    min-height: 2.4em;
    font-size: 0.86rem;
    color: var(--qr-scanner-status-color);
  }

  button {
    font: inherit;
    color: inherit;
    background: transparent;
    border: 1px solid var(--qr-scanner-border);
    border-radius: 8px;
    padding: 6px 12px;
    cursor: pointer;
  }

  .close { width: 34px; height: 34px; padding: 0; border-radius: 50%; }

  @media (max-width: 560px) {
    dialog {
      width: 100vw;
      height: 100dvh;
      margin: 0;
      border: none;
      border-radius: 0;
    }
  }
`

export class QrScannerElement extends HTMLElement {
  static observedAttributes = ['label']

  /** Set by the host: decides whether a scanned payload is the one it wants. */
  validate = null

  #dialog
  #video
  #status
  #title
  #stream = null
  #frame = null
  #session = 0
  #detector = null
  #accumulator = null
  #receiving = false
  #attempts = 0
  #lastScan = 0
  #canvas = document.createElement('canvas')

  constructor () {
    super()

    const root = this.attachShadow({ mode: 'open' })
    const style = document.createElement('style')

    style.textContent = STYLE
    this.#dialog = document.createElement('dialog')
    this.#title = document.createElement('h3')
    this.#video = document.createElement('video')
    this.#status = document.createElement('p')

    this.#video.autoplay = true
    this.#video.muted = true
    this.#video.playsInline = true
    this.#video.setAttribute('playsinline', '')
    this.#status.setAttribute('role', 'status')
    this.#status.setAttribute('aria-live', 'polite')

    const header = document.createElement('header')
    const close = document.createElement('button')

    close.className = 'close'
    close.type = 'button'
    close.textContent = '×'
    close.setAttribute('aria-label', 'Close')
    close.addEventListener('click', () => this.close())

    header.append(this.#title, close)
    this.#dialog.append(header, this.#video, this.#status)
    root.append(style, this.#dialog)

    // Fires for Escape and for `close()` alike, so the camera is released in
    // one place rather than at each of the ways out.
    this.#dialog.addEventListener('close', () => {
      this.#stop()
      this.dispatchEvent(new CustomEvent('close'))
    })
  }

  get label () {
    return this.getAttribute('label') ?? 'Scan a code'
  }

  set label (next) {
    this.setAttribute('label', next)
  }

  attributeChangedCallback () {
    this.#title.textContent = this.label
  }

  connectedCallback () {
    this.#title.textContent = this.label
  }

  /**
   * A framework swapping views detaches the element without closing it. Without
   * this the camera stays on for a page nobody is looking at.
   */
  disconnectedCallback () {
    this.#stop()
  }

  get isOpen () {
    return this.#dialog.open
  }

  async open () {
    if (navigator.mediaDevices?.getUserMedia == null) {
      throw new Error('Camera access is not supported by this browser')
    }

    if (!this.#dialog.open) {
      this.#dialog.showModal()
    }

    const session = ++this.#session

    this.#attempts = 0
    this.#lastScan = 0
    this.#receiving = false
    this.#detector = null
    this.#status.textContent = 'Starting the camera…'

    if ('BarcodeDetector' in window) {
      try {
        this.#detector = new window.BarcodeDetector({ formats: ['qr_code'] })
      } catch {}
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 1280 },
          height: { ideal: 720 },
          frameRate: { ideal: 30, max: 30 }
        },
        audio: false
      })

      // The dialog can have been closed while the permission prompt was up.
      if (session !== this.#session) {
        stream.getTracks().forEach(track => track.stop())
        return
      }

      this.#stream = stream
      this.#video.srcObject = stream
      await this.#video.play()
      this.#status.textContent = 'Looking for a code… hold it steady and fill about half of the frame.'
      this.#schedule(session)
    } catch (error) {
      this.close()
      this.dispatchEvent(new CustomEvent('error', { detail: { error } }))
      throw error
    }
  }

  close () {
    if (this.#dialog.open) {
      this.#dialog.close()
      return
    }

    this.#stop()
  }

  #stop () {
    this.#session++

    if (this.#frame != null) {
      cancelAnimationFrame(this.#frame)
      this.#frame = null
    }

    this.#stream?.getTracks().forEach(track => track.stop())
    this.#stream = null
    this.#video.srcObject = null
    this.#detector = null
    this.#accumulator?.reset()
    this.#receiving = false
  }

  #schedule (session) {
    if (this.#stream != null && session === this.#session) {
      this.#frame = requestAnimationFrame(timestamp => this.#tick(timestamp, session))
    }
  }

  async #tick (timestamp, session) {
    if (session !== this.#session) {
      return
    }

    if (timestamp - this.#lastScan < SCAN_INTERVAL) {
      this.#schedule(session)
      return
    }

    this.#lastScan = timestamp
    this.#attempts++

    // Not while a sequence is coming in: an animated code takes many attempts by
    // design, and "move closer" is the wrong advice for a scan that is going
    // fine - it also stamps over the part counter the user is watching.
    if (this.#attempts % 8 === 0 && !this.#receiving) {
      this.#status.textContent = `Still looking… ${this.#attempts} attempts. Move a little closer, hold steady, and avoid reflections.`
    }

    let text = await this.#read()

    if (session !== this.#session) {
      return
    }

    if (text != null && looksLikeUrPart(text)) {
      text = await this.#accumulate(text, session)

      if (text == null) {
        return
      }
    }

    if (text == null) {
      this.#schedule(session)
      return
    }

    const verdict = (await this.validate?.(text)) ?? { ok: true }

    if (session !== this.#session) {
      return
    }

    if (verdict.ok === false) {
      this.#status.textContent = verdict.reason ?? 'That code is not the one this screen is waiting for.'
      this.#schedule(session)
      return
    }

    this.close()
    this.dispatchEvent(new CustomEvent('scan', { detail: { text } }))
  }

  async #accumulate (part, session) {
    this.#accumulator = this.#accumulator ?? (await createPartAccumulator())

    if (session !== this.#session) {
      return null
    }

    const progress = this.#accumulator.receive(part)

    if (progress.state === 'complete') {
      this.#receiving = false
      return progress.payload
    }

    this.#receiving = true
    this.#status.textContent = progress.total > 0
      ? `Animated code: ${progress.received} of ${progress.total} parts. Keep holding steady.`
      : 'Animated code detected. Keep holding steady.'
    this.#schedule(session)

    return null
  }

  async #read () {
    if (this.#detector != null) {
      try {
        const codes = await this.#detector.detect(this.#video)

        return codes.find(code => code.format === 'qr_code')?.rawValue ?? codes[0]?.rawValue ?? null
      } catch {
        // A detector that throws once throws every time; stop asking it.
        this.#detector = null
      }
    }

    const scale = Math.min(1, CANVAS_MAX_WIDTH / (this.#video.videoWidth || 1))

    this.#canvas.width = Math.max(1, Math.round(this.#video.videoWidth * scale))
    this.#canvas.height = Math.max(1, Math.round(this.#video.videoHeight * scale))

    const context = this.#canvas.getContext('2d', { willReadFrequently: true })

    context.drawImage(this.#video, 0, 0, this.#canvas.width, this.#canvas.height)

    const image = context.getImageData(0, 0, this.#canvas.width, this.#canvas.height)

    return jsQR(image.data, image.width, image.height, { inversionAttempts: 'attemptBoth' })?.data ?? null
  }
}

if (customElements.get('qr-scanner') == null) {
  customElements.define('qr-scanner', QrScannerElement)
}
