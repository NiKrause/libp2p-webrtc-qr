import { offNetworkRisk, probeNetwork, summariseNetwork } from './network.js'
import { mergeStrings, resolveText } from './strings.js'

/**
 * Explain this before asking anyone to use it - and measure, do not assert.
 *
 * Two halves. The **story** is the app's and arrives through the default slot:
 * what this particular app is for, who the other person is, what a passkey or a
 * list means here. None of that belongs in a transport.
 *
 * The **caveats** are ours, and they are the reason this element exists rather
 * than a paragraph in each app. Whether a phone holds a waiting invite, whether
 * Chrome on Android reports IPv6, what a VPN does to a direct connection - those
 * are the top facts in this project's own AGENTS.md, every consumer needs them,
 * and today each one writes them again from memory.
 *
 * Between the two sits a live verdict, because advice is only worth giving when
 * it applies. Telling two phones already on the same Wi-Fi to find another
 * network would be wrong, so `sameNetwork` sits *next to* the verdict rather
 * than being folded into it.
 *
 * **It reuses `probeNetwork`.** An earlier consumer wrote a second, smaller
 * probe for its own intro - candidate found yes or no, with no address family
 * and no notion of a symmetric NAT - because its readiness panel was hidden in
 * the simple view. That is a layout problem being solved twice at the wrong
 * layer: the verdict a first-time reader needs is the *fuller* one, since they
 * are the least equipped to interpret a thin one.
 *
 * ## Custom properties
 *
 * `--qr-intro-background`, `--qr-intro-color`, `--qr-intro-border`,
 * `--qr-intro-accent`, `--qr-intro-muted`, `--qr-intro-radius`,
 * `--qr-intro-backdrop`.
 */

export const QR_INTRO_STRINGS = {
  title: 'Before you start',
  close: 'Close',
  checkHeading: 'This browser, on this network',
  checking: 'Checking what this network allows…',
  ok: 'A direct connection off this network looks possible.',
  unreliable: 'This network maps a new port per destination and offers no IPv6, so a direct connection usually works only to someone on this same network.',
  none: 'No path off this network was found. You can still connect to someone on this same network.',
  sameNetwork: 'Two devices on the same Wi-Fi connect regardless of any of this.',
  technicalHeading: 'Worth knowing',
  technical: [
    'A phone closes a waiting invite within seconds of you leaving the app. Only DuckDuckGo and Safari have been seen to hold one for about ten.',
    'Chrome on Android reports no IPv6 where Firefox and DuckDuckGo on the same phone and the same Wi-Fi report one. A verdict describes this browser, not the network.',
    'On mobile data, carrier NAT usually blocks a direct connection to anyone outside that network.',
    'A VPN moves both ends somewhere else, which can fix a blocked network or break a working one.'
  ],
  dontShow: 'Do not show this again'
}

const STYLE = `
  :host { --qr-intro-radius: 14px; }
  dialog {
    max-width: 34rem;
    width: calc(100vw - 2rem);
    border: 1px solid var(--qr-intro-border, rgba(255,255,255,0.14));
    border-radius: var(--qr-intro-radius);
    background: var(--qr-intro-background, #12161f);
    color: var(--qr-intro-color, #e8ecf3);
    padding: 1.25rem;
    font: inherit;
  }
  dialog::backdrop { background: var(--qr-intro-backdrop, rgba(0,0,0,0.55)); }
  .head { display: flex; align-items: start; justify-content: space-between; gap: 1rem; }
  h2 { margin: 0; font-size: 1.05rem; }
  .close {
    background: none; border: 0; color: inherit; cursor: pointer;
    font-size: 1.3rem; line-height: 1; padding: 0 0.25rem;
  }
  .story { margin: 0.75rem 0; }
  .check {
    margin: 0.9rem 0; padding: 0.7rem 0.85rem;
    border: 1px solid var(--qr-intro-border, rgba(255,255,255,0.14));
    border-radius: 10px;
  }
  .check h3 { margin: 0 0 0.35rem; font-size: 0.78rem; text-transform: uppercase; letter-spacing: 0.04em; }
  .verdict { margin: 0; }
  /* The three states differ in weight, not only in colour: a verdict that is
     only a colour is no verdict to anyone who cannot see the difference. */
  .verdict[data-state="ok"] { color: var(--qr-intro-accent, #3edc97); }
  .verdict[data-state="unreliable"] { color: #ffc24b; font-weight: 600; }
  .verdict[data-state="none"] { color: #ff6b5b; font-weight: 600; }
  .same { margin: 0.35rem 0 0; font-size: 0.85rem; color: var(--qr-intro-muted, #97a1b3); }
  .tech h3 { margin: 0 0 0.35rem; font-size: 0.78rem; text-transform: uppercase; letter-spacing: 0.04em; }
  .tech ul { margin: 0; padding-left: 1.1rem; font-size: 0.88rem; color: var(--qr-intro-muted, #97a1b3); }
  .tech li + li { margin-top: 0.35rem; }
  .foot { display: flex; align-items: center; gap: 0.5rem; margin-top: 1rem; font-size: 0.88rem; }
`

export class QrIntroElement extends HTMLElement {
  static observedAttributes = ['technical']

  #strings = { ...QR_INTRO_STRINGS }
  #probed = false
  #result = null
  // Our own record of whether this is showing. `dialog.open` cannot be it: the
  // guard has to survive the moment between `dialog.close()` and the event it
  // may or may not fire.
  #open = false

  constructor () {
    super()

    const root = this.attachShadow({ mode: 'open' })
    const style = document.createElement('style')
    const dialog = document.createElement('dialog')

    style.textContent = STYLE

    const head = document.createElement('div')
    const heading = document.createElement('h2')
    const close = document.createElement('button')

    head.className = 'head'
    close.className = 'close'
    close.type = 'button'
    close.addEventListener('click', () => this.close())
    head.append(heading, close)

    // The app's own story. A slot rather than a string, because it is prose with
    // structure - paragraphs, a link, sometimes a list - and a table of strings
    // is the wrong shape for that.
    const story = document.createElement('div')
    const slot = document.createElement('slot')
    story.className = 'story'
    story.append(slot)

    const check = document.createElement('div')
    const checkHeading = document.createElement('h3')
    const verdict = document.createElement('p')
    const same = document.createElement('p')

    check.className = 'check'
    verdict.className = 'verdict'
    verdict.setAttribute('aria-live', 'polite')
    same.className = 'same'
    check.append(checkHeading, verdict, same)

    const tech = document.createElement('div')
    const techHeading = document.createElement('h3')
    const techList = document.createElement('ul')

    tech.className = 'tech'
    tech.append(techHeading, techList)

    const foot = document.createElement('div')
    const label = document.createElement('label')
    const box = document.createElement('input')
    const boxText = document.createElement('span')

    foot.className = 'foot'
    box.type = 'checkbox'
    box.part = 'dont-show'
    label.append(box, boxText)
    foot.append(label)

    dialog.append(head, story, check, tech, foot)
    root.append(style, dialog)

    Object.assign(this, {
      __dialog: dialog,
      __heading: heading,
      __close: close,
      __checkHeading: checkHeading,
      __verdict: verdict,
      __same: same,
      __tech: tech,
      __techHeading: techHeading,
      __techList: techList,
      __box: box,
      __boxText: boxText
    })

    // Escape and the backdrop close a <dialog> without going through `close()`,
    // so that path has to report itself too - guarded by `#open` because
    // `dialog.close()` fires this in some browsers and, as a Chromium build in
    // this project's own CI demonstrated, silently does not in others. Relying
    // on it alone loses the event; relying on both without a guard sends it
    // twice.
    dialog.addEventListener('close', () => {
      if (!this.#open) return
      this.#open = false
      this.#emitClose()
    })

    this.#paint()
  }

  get strings () {
    return { ...this.#strings }
  }

  set strings (value) {
    this.#strings = mergeStrings(QR_INTRO_STRINGS, value)
    this.#paint()
  }

  /** Whether the technical caveats are shown. Off by default. */
  get technical () {
    return this.hasAttribute('technical')
  }

  set technical (on) {
    if (on) this.setAttribute('technical', '')
    else this.removeAttribute('technical')
  }

  attributeChangedCallback () {
    this.#paint()
  }

  get isOpen () {
    return this.__dialog.open
  }

  /** The result of the last check, or `null` if it has not run. */
  get result () {
    return this.#result
  }

  #paint () {
    const s = this.#strings

    this.__heading.textContent = resolveText(s.title)
    this.__close.setAttribute('aria-label', resolveText(s.close))
    this.__close.textContent = '×'
    this.__checkHeading.textContent = resolveText(s.checkHeading)
    this.__techHeading.textContent = resolveText(s.technicalHeading)
    this.__boxText.textContent = resolveText(s.dontShow)
    this.__same.textContent = resolveText(s.sameNetwork)
    this.__tech.hidden = !this.technical

    this.__techList.replaceChildren(...(s.technical ?? []).map(line => {
      const li = document.createElement('li')
      li.textContent = resolveText(line)
      return li
    }))

    this.#paintVerdict()
  }

  #paintVerdict () {
    const s = this.#strings

    if (this.#result == null) {
      this.__verdict.dataset.state = 'checking'
      this.__verdict.textContent = resolveText(s.checking)
      return
    }

    const risk = offNetworkRisk(this.#result)
    const state = risk === 'blocked' ? 'none' : risk === 'unreliable' ? 'unreliable' : 'ok'

    this.__verdict.dataset.state = state
    this.__verdict.textContent = resolveText(s[state === 'none' ? 'none' : state])
  }

  /**
   * Show it, and measure once.
   *
   * The check runs on the first open rather than on connection: an element that
   * probed the network on every page load would spend STUN round trips on
   * everyone who never sees it.
   */
  async open () {
    if (!this.__dialog.open) this.__dialog.showModal()
    this.#open = true

    if (this.#probed) return this.#result

    this.#probed = true
    this.#paintVerdict()

    try {
      this.#result = await probeNetwork(this.rtcConfiguration)
    } catch {
      // A probe that cannot run tells us nothing better than "no path found",
      // and the advice below the verdict is the same either way.
      this.#result = { overall: summariseNetwork({ state: 'blocked' }, { state: 'blocked' }) }
    }

    this.#paintVerdict()
    this.dispatchEvent(new CustomEvent('check', { detail: this.#result }))

    return this.#result
  }

  close () {
    if (!this.#open) return

    this.#open = false
    if (this.__dialog.open) this.__dialog.close()
    this.#emitClose()
  }

  #emitClose () {
    this.dispatchEvent(new CustomEvent('close', {
      detail: { remember: this.__box.checked }
    }))
  }
}

if (globalThis.customElements != null && globalThis.customElements.get('qr-intro') == null) {
  globalThis.customElements.define('qr-intro', QrIntroElement)
}
