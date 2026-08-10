import { mergeStrings, resolveText } from './strings.js'
import QRCode from 'qrcode'
import { MAX_FRAGMENT_BYTES, STATIC_QR_MAX_LENGTH, createFrameSource } from './frames.js'

/**
 * `<qr-invite>` - show a payload as a code someone can scan.
 *
 * A custom element rather than a component in somebody's framework, because the
 * three consumers of this package are plain JavaScript twice over and Svelte
 * once, and a fourth will not be any of those. Shadow DOM so a host stylesheet
 * cannot reach in and break a code that has to stay scannable; CSS custom
 * properties so the host can still say what it should look like.
 *
 * ```html
 * <qr-invite value="https://example/#i=…"></qr-invite>
 * ```
 *
 * Above `STATIC_QR_MAX_LENGTH` the payload is split into a BC-UR sequence and
 * cycled, because a code dense enough to hold a long invite is one a second
 * phone cannot read - measured at 2.29 pixels per module on a 320px screen,
 * against 3.95 for six frames.
 */

const STYLE = `
  :host {
    display: block;
    --qr-invite-background: #ffffff;
    --qr-invite-foreground: #000000;
    --qr-invite-radius: 8px;
    --qr-invite-padding: 10px;
    --qr-invite-max-width: 440px;
    --qr-invite-caption-color: inherit;
    --qr-invite-caption-size: 0.84rem;
  }

  :host([hidden]) { display: none; }

  img {
    display: block;
    /* Padding is part of the width, or a code told to fill the screen ends up
       wider than it and pushes the page sideways. */
    box-sizing: border-box;
    width: min(100%, var(--qr-invite-max-width));
    margin: 0 auto;
    background: var(--qr-invite-background);
    border-radius: var(--qr-invite-radius);
    padding: var(--qr-invite-padding);
    /* The code is a grid of squares; smoothing it is how a scan stops catching. */
    image-rendering: pixelated;
  }

  p {
    margin: 10px 0 0;
    text-align: center;
    font-size: var(--qr-invite-caption-size);
    color: var(--qr-invite-caption-color);
    font-variant-numeric: tabular-nums;
  }

  p[hidden] { display: none; }
`

/**
 * Everything this element says, in English. Replace any of it through the
 * `strings` property; what you leave out keeps these.
 *
 * `part` carries numbers, so it is a function rather than a template with
 * placeholders - word order is not universal, and `{n} of {total}` would fix
 * ours onto every translation.
 */
export const QR_INVITE_STRINGS = {
  alt: 'Invite code',
  part: ({ slot, total }) => `Part ${slot} of ${total} — hold the phone still`,
  recovery: 'Recovery frame — hold the phone still'
}

export class QrInviteElement extends HTMLElement {
  static observedAttributes = ['value', 'frame-interval']

  #image
  #caption
  #timer = null
  #renderToken = 0
  #strings = { ...QR_INVITE_STRINGS }

  constructor () {
    super()

    const root = this.attachShadow({ mode: 'open' })
    const style = document.createElement('style')

    style.textContent = STYLE
    this.#image = document.createElement('img')
    this.#image.alt = resolveText(this.#strings.alt)
    this.#caption = document.createElement('p')
    this.#caption.hidden = true
    this.#caption.setAttribute('role', 'status')

    root.append(style, this.#image, this.#caption)
  }

  get value () {
    return this.getAttribute('value') ?? ''
  }

  set value (next) {
    if (next == null || next === '') {
      this.removeAttribute('value')
      return
    }

    this.setAttribute('value', next)
  }

  get frameInterval () {
    return Number(this.getAttribute('frame-interval')) || 200
  }

  connectedCallback () {
    this.#render()
  }

  /**
   * An element removed from the document must stop animating. Without this the
   * timer keeps rendering codes for a page nobody is looking at - and in a
   * framework that swaps views, that is every navigation.
   */
  disconnectedCallback () {
    this.#stop()
  }

  attributeChangedCallback () {
    if (this.isConnected) {
      this.#render()
    }
  }

  #stop () {
    if (this.#timer != null) {
      clearInterval(this.#timer)
      this.#timer = null
    }
  }

  async #render () {
    this.#stop()

    // Renders are async, so a value that changes mid-flight would otherwise let
    // an older render finish last and win.
    const token = ++this.#renderToken
    const value = this.value

    if (value === '') {
      this.#image.removeAttribute('src')
      this.#caption.hidden = true
      return
    }

    if (value.length <= STATIC_QR_MAX_LENGTH) {
      const url = await this.#toDataUrl(value)

      if (token !== this.#renderToken) {
        return
      }

      this.#image.src = url
      this.#caption.hidden = true
      this.dispatchEvent(new CustomEvent('render', { detail: { frames: 1 } }))
      return
    }

    const source = await createFrameSource(value, { maxFragmentBytes: MAX_FRAGMENT_BYTES })
    const rendered = [await this.#toDataUrl(source.next())]

    if (token !== this.#renderToken) {
      return
    }

    const ceiling = source.total * 2
    let index = 0

    this.#image.src = rendered[0]
    this.#caption.hidden = false
    this.#caption.textContent = this.#captionFor(0, source.total)
    this.dispatchEvent(new CustomEvent('render', { detail: { frames: source.total } }))

    const tick = async () => {
      if (token !== this.#renderToken) {
        return
      }

      index++

      // Rendered ahead of the tick rather than inside it: encoding a code takes
      // long enough that doing it per frame makes the sequence stutter, and a
      // stuttering sequence is one a camera misses parts of.
      if (index >= rendered.length && rendered.length < ceiling) {
        rendered.push(await this.#toDataUrl(source.next()))
      }

      if (token !== this.#renderToken) {
        return
      }

      const slot = index % rendered.length

      this.#image.src = rendered[slot]
      this.#caption.textContent = this.#captionFor(slot, source.total)
    }

    this.#timer = setInterval(() => { tick() }, this.frameInterval)
  }

  /** The text this element shows. A partial table keeps the rest. */
  get strings () {
    return { ...this.#strings }
  }

  set strings (value) {
    this.#strings = mergeStrings(QR_INVITE_STRINGS, value)
    this.#image.alt = resolveText(this.#strings.alt)
  }

  #captionFor (slot, total) {
    return slot < total
      ? resolveText(this.#strings.part, { slot: slot + 1, total })
      : resolveText(this.#strings.recovery)
  }

  #toDataUrl (text) {
    return QRCode.toDataURL(text, {
      errorCorrectionLevel: 'M',
      margin: 4,
      width: 1280,
      color: {
        dark: getComputedStyle(this).getPropertyValue('--qr-invite-foreground').trim() || '#000000',
        light: getComputedStyle(this).getPropertyValue('--qr-invite-background').trim() || '#ffffff'
      }
    })
  }
}

if (customElements.get('qr-invite') == null) {
  customElements.define('qr-invite', QrInviteElement)
}
