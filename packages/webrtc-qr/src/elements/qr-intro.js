import { offNetworkRisk, probeNetwork, summariseNetwork } from './network.js'
import { readRelayOptIn, writeRelayOptIn } from './relay-choice.js'
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
 * ## Room for the host's own chrome
 *
 * The first app to adopt this could not: its dialog carries a language switch
 * and a view switch beside the title, an explicit Close button, and — in its
 * technical view — a verdict with a link in it and a row of `qr-status` chips
 * under it. None of that is the transport's business, and none of it had
 * anywhere to go, so adopting the element would have meant deleting all four.
 *
 * Three named slots fix that without the element learning anything about any
 * app: `header` beside the title, `advice` directly under the verdict, and
 * `footer` beside "do not show again". They stay empty for everyone else.
 *
 * `advice` is the one that mattered most. A string table cannot hold a link —
 * the tables are read with `resolveText` and written to `textContent`, which is
 * deliberate, because an interpolation habit here is the one that later gets
 * pointed at a user-supplied string. So advice that needs markup is markup the
 * host writes, placed where advice belongs: after the verdict it follows from.
 *
 * ## The second way in
 *
 * A scanned code needs the other person to be here. When they are not - the
 * list is going to somebody two towns away over a messenger - the way in is a
 * relay, and this element offers it as a choice rather than as a fact: set
 * `relay` and a checkbox appears, **off**, with the consequence of ticking it
 * written next to it. Nothing here dials anything; `relay.check` is the
 * consumer's function, because only the app knows its addresses and its ping.
 *
 * Ticking it checks at once. An opt-in whose effect only shows at the next
 * connection attempt leaves the person guessing, which is the state this
 * replaces. A consumer that passes no `relay` gets the element it had before,
 * unchanged - which is how an app with no relay at all adopts this dialog.
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
  dontShow: 'Do not show this again',
  // The second way in. Shown only when a consumer passes `relay`.
  waysHeading: 'How the other device gets in',
  wayQr: 'By camera: you hold up a code, they scan it. Nothing leaves this network.',
  relayLabel: 'Connect through a relay',
  relayHint: 'For when the other device cannot scan your code - over a messenger, for instance. Off unless you ask for it.',
  relayChecking: 'Looking for a relay that answers…',
  // Functions, because these carry a number and word order is not universal.
  relayReachable: ({ count }) => `${count} known relay${count === 1 ? '' : 's'} answered. No directory was queried.`,
  relayDiscovered: ({ count }) => `${count} relay${count === 1 ? '' : 's'} found in the directory - the ones shipped with this app stayed silent.`,
  relayNone: 'No relay answered. Scanning a code still works.'
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
  .foot {
    display: flex; align-items: center; gap: 0.5rem; margin-top: 1rem; font-size: 0.88rem;
    /* Wraps rather than overflowing: a translated label and a button do not
       fit on one line on a phone, and space-between keeps the button on the
       right, where a dialog's action belongs. */
    flex-wrap: wrap; justify-content: space-between;
  }
  .foot label { display: flex; align-items: center; gap: 0.5rem; }
  .ways h3 { margin: 0 0 0.35rem; font-size: 0.78rem; text-transform: uppercase; letter-spacing: 0.04em; }
  .ways { margin: 0.9rem 0; }
  .way-qr { margin: 0 0 0.5rem; font-size: 0.88rem; color: var(--qr-intro-muted, #97a1b3); }
  .relay { display: flex; align-items: start; gap: 0.5rem; font-size: 0.88rem; }
  .relay-hint { display: block; margin-top: 0.15rem; color: var(--qr-intro-muted, #97a1b3); }
  .relay-result { margin: 0.5rem 0 0; font-size: 0.88rem; }
  .relay-result[data-state="checking"] { color: var(--qr-intro-muted, #97a1b3); }
  .relay-result[data-state="baked"], .relay-result[data-state="aleph"] { color: var(--qr-intro-accent, #3edc97); }
  .relay-result[data-state="none"] { color: #ffc24b; font-weight: 600; }
`

export class QrIntroElement extends HTMLElement {
  static observedAttributes = ['technical']

  #strings = { ...QR_INTRO_STRINGS }
  #probed = false
  #result = null
  /** @type {{ check: (() => Promise<any>), storageKey?: string, storage?: Storage } | null} */
  #relay = null
  /** @type {'idle' | 'checking' | 'baked' | 'aleph' | 'none'} */
  #relayState = 'idle'
  #relayCount = 0
  #relayChecking = false
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
    // Between the title and the close button: an app's language switch belongs
    // in the first thing it shows somebody, not two screens away in a header
    // they cannot read yet.
    const headerSlot = document.createElement('slot')
    headerSlot.name = 'header'
    head.append(heading, headerSlot, close)

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
    // Under the verdict, above `sameNetwork`: advice is only worth giving when
    // it applies, and it applies to the verdict directly above it.
    const adviceSlot = document.createElement('slot')
    adviceSlot.name = 'advice'
    check.append(checkHeading, verdict, adviceSlot, same)

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
    // Beside "do not show again", where a dialog's own actions live. The × in
    // the corner is a close, not a confirmation, and an app whose introduction
    // ends in a decision needs somewhere to put the button for it.
    const footerSlot = document.createElement('slot')
    footerSlot.name = 'footer'
    foot.append(label, footerSlot)

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
      __boxText: boxText,
      __foot: foot,
      // The relay half is built on demand — see `#buildRelay`.
      __ways: null
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

  /**
   * The relay half, or `null` for the element as it was before it existed.
   *
   * `check` is the consumer's: only the app knows which addresses it shipped
   * with, how to ping one, and whether it has a directory to fall back on.
   * `relay-choice.js` carries the *rule* those functions are fed into, so the
   * ordering is not re-decided per app.
   *
   * @type {{ check: () => Promise<{ source: string, addresses?: string[] }>, storageKey?: string, storage?: Storage } | null}
   */
  get relay () {
    return this.#relay
  }

  set relay (value) {
    this.#relay = value ?? null

    if (this.#relay == null) {
      // Removed rather than hidden. An element with no relay half has to be
      // structurally what it was before one existed — see `#buildRelay`.
      this.__ways?.remove()
      this.__ways = null
      this.#relayState = 'idle'
      return
    }

    this.#buildRelay()
    const stored = readRelayOptIn(this.#storage, this.#relay.storageKey)
    this.__relayBox.checked = stored
    // A remembered yes checks on the next open rather than now: this may be
    // assigned before the dialog is ever shown, and a probe wave from a page
    // load nobody has seen is exactly what the default-off promise is about.
    if (!stored) this.#relayState = 'idle'

    this.#paint()
  }

  /**
   * Build the relay half, once, on first use.
   *
   * Built here rather than in the constructor for a reason that cost a CI run:
   * it adds a second `<input type=checkbox>` to the shadow root, and both the
   * demo's tests and the README's own advice reached the "do not show again"
   * box with `shadowRoot.querySelector('input[type=checkbox]')`. A hidden
   * second checkbox is still the first match, so an element nobody had
   * configured a relay on silently stopped remembering dismissals.
   *
   * An element without `relay` therefore has no relay DOM at all, which is the
   * only version of "unchanged for existing consumers" that is actually true.
   * Where both do exist, `part` tells them apart: `dont-show`, `relay-opt-in`.
   */
  #buildRelay () {
    if (this.__ways != null) return

    const ways = document.createElement('div')
    const waysHeading = document.createElement('h3')
    const wayQr = document.createElement('p')
    const relayLabel = document.createElement('label')
    const relayBox = document.createElement('input')
    const relayText = document.createElement('span')
    const relayName = document.createElement('span')
    const relayHint = document.createElement('span')
    const relayResult = document.createElement('p')
    const relaySlot = document.createElement('slot')

    ways.className = 'ways'
    wayQr.className = 'way-qr'
    relayLabel.className = 'relay'
    relayBox.type = 'checkbox'
    relayBox.part = 'relay-opt-in'
    relayHint.className = 'relay-hint'
    relayResult.className = 'relay-result'
    relayResult.setAttribute('aria-live', 'polite')
    relayResult.hidden = true
    // A named slot rather than a second string table: what an app wants to add
    // here — what starting a relay costs, who runs theirs — is its own prose,
    // the same argument as the story slot above.
    relaySlot.name = 'relay'
    relayText.append(relayName, relayHint)
    relayLabel.append(relayBox, relayText)
    ways.append(waysHeading, wayQr, relayLabel, relayResult, relaySlot)

    relayBox.addEventListener('change', () => { void this.#onRelayToggle(relayBox.checked) })

    // Before the footer, so the choice reads as part of the explanation rather
    // than as an afterthought next to "do not show again".
    this.__dialog.insertBefore(ways, this.__foot)

    Object.assign(this, {
      __ways: ways,
      __waysHeading: waysHeading,
      __wayQr: wayQr,
      __relayBox: relayBox,
      __relayName: relayName,
      __relayHint: relayHint,
      __relayResult: relayResult
    })
  }

  /** Whether the relay box is ticked. `false` when there is no relay half. */
  get relayOptIn () {
    return this.__ways != null && this.__relayBox.checked === true
  }

  get #storage () {
    if (this.#relay?.storage != null) return this.#relay.storage
    try {
      return globalThis.localStorage
    } catch {
      // Reading `localStorage` throws outright in a sandboxed frame.
      return null
    }
  }

  async #onRelayToggle (on) {
    writeRelayOptIn(this.#storage, this.#relay?.storageKey, on)
    this.dispatchEvent(new CustomEvent('relay-opt-in', { detail: { optIn: on } }))

    if (!on) {
      this.#relayState = 'idle'
      this.#relayCount = 0
      this.#paintRelay()
      return
    }

    await this.#runRelayCheck()
  }

  async #runRelayCheck () {
    if (this.#relay == null || this.#relayChecking) return

    this.#relayChecking = true
    this.#relayState = 'checking'
    this.#paintRelay()

    try {
      const result = await this.#relay.check()
      this.#relayState = /** @type {any} */ (result?.source ?? 'none')
      this.#relayCount = result?.addresses?.length ?? 0
      this.dispatchEvent(new CustomEvent('relay-check', { detail: result }))
    } catch (error) {
      // Nothing answered and nothing could be asked. For the person reading the
      // line those are the same fact, so they get the same line - the
      // distinction goes to the event, where a consumer can log it.
      this.#relayState = 'none'
      this.#relayCount = 0
      this.dispatchEvent(new CustomEvent('relay-check', { detail: { source: 'none', error } }))
    } finally {
      this.#relayChecking = false
      this.#paintRelay()
    }
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

    if (this.__ways == null) return

    this.__waysHeading.textContent = resolveText(s.waysHeading)
    this.__wayQr.textContent = resolveText(s.wayQr)
    this.__relayName.textContent = resolveText(s.relayLabel)
    this.__relayHint.textContent = resolveText(s.relayHint)
    this.#paintRelay()
  }

  #paintRelay () {
    if (this.__ways == null) return

    const s = this.#strings
    const state = this.#relayState

    this.__relayResult.hidden = state === 'idle'
    if (state === 'idle') return

    this.__relayResult.dataset.state = state
    this.__relayResult.textContent =
      state === 'checking'
        ? resolveText(s.relayChecking)
        : state === 'baked'
          ? resolveText(s.relayReachable, { count: this.#relayCount })
          : state === 'aleph'
            ? resolveText(s.relayDiscovered, { count: this.#relayCount })
            : resolveText(s.relayNone)
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

    // A remembered yes is checked here rather than on assignment, so the first
    // outbound call of the session happens when somebody is looking at the
    // answer.
    if (this.relayOptIn && this.#relayState === 'idle') void this.#runRelayCheck()

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
