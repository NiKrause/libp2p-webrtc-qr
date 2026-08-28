import { mergeStrings, resolveText } from './strings.js'
import { DEFAULT_RTC_CONFIGURATION, offNetworkRisk, probeBrowser, probeCamera, probeNetwork } from './network.js'

/**
 * `<qr-status>` - what this network will let you do, before anyone tries.
 *
 * ```html
 * <qr-status auto></qr-status>
 * ```
 *
 * Three indicators: IPv4, IPv6, and a summary that is green when either family
 * is usable. Either being usable is enough - the peers negotiate over whichever
 * one works, and IPv6 does not care that IPv4 sits behind a carrier NAT.
 *
 * A coloured dot is not a verdict anyone can read out loud, and on a touch
 * screen there is no hover to reveal an explanation. So each indicator is a chip
 * carrying the verdict as a word, and the explanation opens on tap.
 *
 * Nothing here disables anything, deliberately. A symmetric NAT still connects
 * peers on the same network, which is the case this is mostly used for, and
 * hiding the controls would block something that works.
 */

/**
 * Everything this element says, in English.
 *
 * A consumer replaces any of it through the `strings` property; what it does
 * not mention keeps these. See ./strings.js for why that is a merge.
 */
export const QR_STATUS_STRINGS = {
  browser: 'Browser',
  ipv4: 'IPv4',
  ipv6: 'IPv6',
  camera: 'Camera',
  overall: 'Result',
  open: 'usable',
  relay: 'via TURN',
  symmetric: 'local only',
  blocked: 'none',
  // Shown while the probe runs. The network check waits on STUN round trips, so
  // a still panel reads as a frozen one without this.
  measuring: 'Checking what this network allows…',
  // Shown when neither family can reach off this network - see offNetworkRisk.
  // An invite made here cannot connect to anyone elsewhere, so this is loud.
  alarm: 'This network cannot reach a peer on another network. An invite made here will not connect until you move to Wi-Fi, enable IPv6, or use a relay.',
  // The 5G case: carrier NAT on IPv4, no IPv6. A path exists but maps per
  // destination, so it works only if the other side is open - worth saying,
  // and worth saying more quietly than the outright block above.
  alarmUnreliable: 'This network maps a new port per destination and has no IPv6, so an invite made here reaches peers on this network but will usually fail to anyone else. Wi-Fi, IPv6, or a relay makes it reliable.',
  // The candidate list. Closed by default, and that is not only tidiness: a
  // reflexive candidate carries the public IP of whoever is looking at the
  // screen, and a panel that is safe to screenshot stays safe.
  details: 'Show the addresses this check found',
  detailsHint: 'What a peer would be offered as a route to this device. Turn a VPN on or off and check again - if anything changed, it changed here.',
  recheck: 'Check again',
  detailsEmpty: 'No candidates were gathered.',
  // Named rather than abbreviated: "srflx" is the word in the specification and
  // nowhere else, and this panel is read by people who are not reading the
  // specification.
  candidateHost: 'this device',
  candidateSrflx: 'seen from outside',
  candidateRelay: 'via a relay',
  candidatePrflx: 'discovered mid-connection',
  // Shown only when an mDNS name is actually in the list, because until then it
  // is an explanation of something nobody has seen.
  candidateMdns: 'Addresses ending in .local are stand-ins the browser substitutes for this device\'s own address, so a web page cannot read it. They are not a fault and they are not the VPN.',
  candidateNew: 'new',
  candidateGone: 'gone'
}

/** ICE's own words for where a candidate came from, in this panel's words. */
const KIND_KEYS = {
  host: 'candidateHost',
  srflx: 'candidateSrflx',
  relay: 'candidateRelay',
  prflx: 'candidatePrflx'
}

/** Which keys are rows rather than verdicts. Also the `rows` vocabulary. */
const ROW_KEYS = ['browser', 'ipv4', 'ipv6', 'camera', 'overall']

/**
 * The network rows only, unless a consumer asks for more. Adding rows by
 * default would shift what every existing caller renders, and a readiness panel
 * that silently grows is one nobody can write a test against.
 */
const DEFAULT_ROWS = ['ipv4', 'ipv6', 'overall']

const STYLE = `
  :host {
    display: block;
    --qr-status-open: #3edc97;
    --qr-status-degraded: #ffc24b;
    --qr-status-blocked: #ff6b5b;
    --qr-status-unknown: #5c677a;
    --qr-status-chip-background: #141926;
    --qr-status-chip-border: rgba(255, 255, 255, 0.09);
    --qr-status-chip-color: #a8b3c7;
    --qr-status-verdict-color: #5c677a;
    --qr-status-tip-background: #232b3d;
    --qr-status-tip-color: #edf1f8;
    --qr-status-focus: #58c7f3;
    --qr-status-radius: 8px;
  }

  :host([hidden]) { display: none; }

  .rows {
    position: relative;
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }

  /* Progress while measuring. Kept out of .rows so it cannot shift the chips'
     nth-child order, which the demo's tests select on. */
  .probe { margin-bottom: 8px; }
  .probe[hidden] { display: none; }

  .probe-bar {
    position: relative;
    height: 4px;
    border-radius: 2px;
    background: var(--qr-status-chip-border);
    overflow: hidden;
  }

  .probe-fill {
    position: absolute;
    top: 0;
    bottom: 0;
    width: 40%;
    border-radius: 2px;
    background: var(--qr-status-focus);
    animation: qr-status-probe 1.1s ease-in-out infinite;
  }

  @keyframes qr-status-probe {
    from { left: -40%; }
    to { left: 100%; }
  }

  .probe-caption {
    margin-top: 5px;
    font-size: 0.78rem;
    color: var(--qr-status-chip-color);
  }

  /* Motion is decoration here; the caption carries the meaning. */
  @media (prefers-reduced-motion: reduce) {
    .probe-fill { animation: none; left: 0; width: 100%; opacity: 0.5; }
  }

  /* Alarm: no path off this network. Louder than a chip, because an invite made
     here cannot connect to anyone elsewhere. */
  .alarm { margin-bottom: 8px; }
  .alarm[hidden] { display: none; }

  .alarm-inner {
    --alarm-colour: var(--qr-status-blocked);
    display: flex;
    gap: 8px;
    padding: 9px 12px;
    font-size: 0.8rem;
    line-height: 1.45;
    color: var(--qr-status-tip-color);
    background: color-mix(in srgb, var(--alarm-colour) 14%, var(--qr-status-chip-background));
    border: 1px solid var(--alarm-colour);
    border-radius: var(--qr-status-radius);
  }

  .alarm-inner::before {
    content: '';
    width: 9px;
    height: 9px;
    margin-top: 5px;
    flex-shrink: 0;
    border-radius: 50%;
    background: var(--alarm-colour);
    box-shadow: 0 0 10px var(--alarm-colour);
  }

  /* Amber, not red: a path exists, it is just unreliable to anyone elsewhere. */
  .alarm.is-unreliable .alarm-inner { --alarm-colour: var(--qr-status-degraded); }

  .line {
    --dot: var(--qr-status-unknown);
    position: static;
  }

  .line.open, .line.relay { --dot: var(--qr-status-open); }
  .line.symmetric { --dot: var(--qr-status-degraded); }
  .line.blocked { --dot: var(--qr-status-blocked); }

  button {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    padding: 5px 10px;
    font: inherit;
    font-size: 0.8rem;
    color: var(--qr-status-chip-color);
    background: var(--qr-status-chip-background);
    border: 1px solid var(--qr-status-chip-border);
    border-radius: 999px;
    cursor: pointer;
  }

  button::before {
    content: '';
    width: 9px;
    height: 9px;
    flex-shrink: 0;
    border-radius: 50%;
    background: var(--dot);
    box-shadow: 0 0 10px var(--dot);
  }

  button:focus-visible {
    outline: 2px solid var(--qr-status-focus);
    outline-offset: 3px;
  }

  /* Colour alone would carry the verdict, so each chip also spells it out. */
  .verdict { color: var(--qr-status-verdict-color); }

  .tip {
    position: absolute;
    top: calc(100% + 7px);
    left: 0;
    right: 0;
    z-index: 5;
    padding: 9px 12px;
    font-size: 0.8rem;
    line-height: 1.45;
    color: var(--qr-status-tip-color);
    background: var(--qr-status-tip-background);
    border: 1px solid var(--qr-status-chip-border);
    border-radius: var(--qr-status-radius);
    box-shadow: 0 10px 26px rgb(0 0 0 / 45%);
    opacity: 0;
    visibility: hidden;
    transition: opacity 120ms ease;
  }

  /*
   * Tapping toggles aria-expanded, which doubles as the styling hook - the
   * tooltip cannot then be visible while screen readers are told it is not.
   * Hover is added only where a real pointer exists, so a tap on a touch screen
   * does not leave a chip stuck in a hover state.
   */
  button[aria-expanded='true'] + .tip {
    opacity: 1;
    visibility: visible;
  }

  @media (hover: hover) {
    .line:hover .tip {
      opacity: 1;
      visibility: visible;
    }
  }

  /* ---------- the addresses behind the verdict ---------- */

  .details { margin-top: 8px; }
  .details[hidden] { display: none; }

  summary {
    font-size: 0.78rem;
    color: var(--qr-status-chip-color);
    cursor: pointer;
  }

  summary:focus-visible {
    outline: 2px solid var(--qr-status-focus);
    outline-offset: 3px;
  }

  .details-body {
    margin-top: 7px;
    padding: 9px 12px;
    background: var(--qr-status-chip-background);
    border: 1px solid var(--qr-status-chip-border);
    border-radius: var(--qr-status-radius);
  }

  .details-hint,
  .details-note {
    margin: 0 0 8px;
    font-size: 0.76rem;
    line-height: 1.45;
    color: var(--qr-status-chip-color);
  }

  .details-note { margin: 8px 0 0; }

  .candidates {
    margin: 0;
    padding: 0;
    list-style: none;
    font-size: 0.76rem;
    line-height: 1.6;
    color: var(--qr-status-tip-color);
  }

  /* The address is the thing being compared between two probes, so it is the
     thing set in a font where a digit cannot be mistaken for another. */
  .candidate-address {
    font-family: ui-monospace, monospace;
    overflow-wrap: anywhere;
  }

  .candidate-kind { color: var(--qr-status-chip-color); }

  .candidate-flag {
    margin-left: 6px;
    padding: 0 6px;
    font-size: 0.68rem;
    border-radius: 999px;
    border: 1px solid currentColor;
  }

  .is-new .candidate-flag { color: var(--qr-status-open); }

  .is-gone { color: var(--qr-status-verdict-color); }
  .is-gone .candidate-address { text-decoration: line-through; }
  .is-gone .candidate-flag { color: var(--qr-status-blocked); }

  .recheck { margin-top: 9px; }
`

export class QrStatusElement extends HTMLElement {
  static observedAttributes = ['rows']

  #rows = {}
  #keys = DEFAULT_ROWS
  #result = null
  #strings = { ...QR_STATUS_STRINGS }
  #dismiss = null
  /** What the display is being compared against. Null before a second probe. */
  #baseline = null
  /** What is on screen now, so a repaint is not mistaken for a new probe. */
  #renderedCandidates = null

  /** Override to probe through a different set of STUN servers. */
  rtcConfiguration = DEFAULT_RTC_CONFIGURATION

  constructor () {
    super()

    const root = this.attachShadow({ mode: 'open' })
    const style = document.createElement('style')
    const list = document.createElement('div')

    style.textContent = STYLE
    list.className = 'rows'
    list.setAttribute('role', 'status')
    this.__list = list

    // A progress region and an alarm region, both siblings of the row list so
    // they never disturb its nth-child order. Above the chips, because both are
    // about the chips as a whole rather than any one of them.
    const probe = document.createElement('div')
    const bar = document.createElement('div')
    const fill = document.createElement('div')
    const caption = document.createElement('div')

    probe.className = 'probe'
    probe.hidden = true
    bar.className = 'probe-bar'
    fill.className = 'probe-fill'
    caption.className = 'probe-caption'
    caption.setAttribute('aria-live', 'polite')
    bar.append(fill)
    probe.append(bar, caption)
    this.__probe = probe
    this.__probeCaption = caption

    const alarm = document.createElement('div')
    const alarmInner = document.createElement('div')

    alarm.className = 'alarm'
    alarm.hidden = true
    alarmInner.className = 'alarm-inner'
    // Assertive: the user is about to make an invite that cannot connect, and
    // needs to hear it now rather than after it fails.
    alarmInner.setAttribute('role', 'alert')
    alarm.append(alarmInner)
    this.__alarm = alarm
    this.__alarmText = alarmInner

    // The addresses behind the verdict, below the chips because they explain
    // them. A `<details>` rather than a button of our own: it is closed by
    // default in every engine, it is keyboard-operable without any code here,
    // and a reflexive candidate holds the public IP of whoever is looking at
    // the screen - so closed-by-default is the safety property as much as the
    // tidiness one.
    const details = document.createElement('details')
    const summary = document.createElement('summary')
    const body = document.createElement('div')
    const hint = document.createElement('p')
    const items = document.createElement('ul')
    const note = document.createElement('p')
    const recheck = document.createElement('button')

    details.className = 'details'
    details.hidden = true
    body.className = 'details-body'
    hint.className = 'details-hint'
    items.className = 'candidates'
    note.className = 'details-note'
    note.hidden = true
    recheck.type = 'button'
    recheck.className = 'recheck'
    recheck.addEventListener('click', () => this.probe().catch(() => {}))

    body.append(hint, items, note, recheck)
    details.append(summary, body)

    this.__details = details
    this.__summary = summary
    this.__detailsHint = hint
    this.__candidates = items
    this.__mdnsNote = note
    this.__recheck = recheck

    root.append(style, probe, alarm, list, details)
    this.#build()
  }

  #build () {
    this.__list.replaceChildren()
    this.#rows = {}

    for (const key of this.#keys) {
      const line = document.createElement('div')
      const chip = document.createElement('button')
      const name = document.createElement('span')
      const verdict = document.createElement('span')
      const tip = document.createElement('span')

      line.className = 'line'
      chip.type = 'button'
      chip.setAttribute('aria-expanded', 'false')
      name.textContent = resolveText(this.#strings[key]) || key
      verdict.className = 'verdict'
      tip.className = 'tip'
      tip.setAttribute('role', 'tooltip')

      chip.append(name, verdict)
      line.append(chip, tip)
      this.__list.append(line)
      chip.addEventListener('click', () => this.#toggle(chip))

      this.#rows[key] = { line, chip, verdict, tip }
    }
  }

  /**
   * The text this element shows. Assigning a partial table keeps the rest, so
   * translating one row never blanks the others.
   */
  get strings () {
    return { ...this.#strings }
  }

  set strings (value) {
    this.#strings = mergeStrings(QR_STATUS_STRINGS, value)
    // Rebuilt rather than patched: the row labels were written into the DOM
    // when the element was built, and a setter that only takes effect on the
    // next probe is the kind of half-applied that costs an afternoon.
    this.#build()
    if (this.#result != null) this.#paint(this.#result)

    // The caption is written once, when the probe starts, and not touched
    // again until it ends - so a table assigned mid-probe left that one line in
    // the old language while everything around it changed. A probe takes STUN
    // round trips, which is long enough for somebody to reach the language
    // switch, and the line sits in the middle of the panel.
    //
    // `#build()` above only replaces the row list, so these nodes and their
    // hidden state survive it.
    if (this.__probe?.hidden === false) this.#setProbing(true)
  }

  /**
   * Write a result into the rows.
   *
   * Split out of `probe` so a table assigned after a probe repaints at once.
   *
   * @param {Record<string, { state: string, text: string }>} result
   */
  #paint (result) {
    for (const key of this.#keys) {
      const row = this.#rows[key]

      if (row == null || result[key] == null) {
        continue
      }

      row.line.className = `line ${result[key].state}`
      row.verdict.textContent = resolveText(this.#strings[result[key].state])
      row.tip.textContent = result[key].text
      row.chip.setAttribute('aria-label', `${key}: ${result[key].text}`)
    }

    this.#renderAlarm(result)
    this.#renderCandidates(result.candidates ?? null)
  }

  /**
   * The addresses, and what is different about them since last time.
   *
   * The diff is the point. A list of eight candidates asks somebody to compare
   * two screens from memory; "new" and "gone" answer the question they actually
   * had - did switching the VPN on change anything - and answer it wrong only
   * if it genuinely changed nothing.
   *
   * Gone candidates are kept on screen, struck through. A row that vanishes
   * between two probes is the most interesting thing the panel can show, and
   * removing it hides exactly that.
   */
  #renderCandidates (candidates) {
    if (candidates == null) {
      this.__details.hidden = true
      return
    }

    const key = c => `${c.type}|${c.protocol}|${c.address}|${c.port}`

    // A repaint is not a new measurement. `#paint` runs again whenever a
    // consumer assigns a string table, and advancing the baseline there would
    // wipe the new/gone marks off the screen because somebody changed language.
    // So the baseline only moves when the list actually did.
    if (candidates !== this.#renderedCandidates) {
      this.#baseline = this.#renderedCandidates
    }

    const before = this.#baseline
    const now = new Set(candidates.map(key))
    const gone = before == null ? [] : before.filter(c => !now.has(key(c)))

    this.__summary.textContent = resolveText(this.#strings.details)
    this.__detailsHint.textContent = resolveText(this.#strings.detailsHint)
    this.__recheck.textContent = resolveText(this.#strings.recheck)

    const row = (candidate, state) => {
      const item = document.createElement('li')
      const kind = document.createElement('span')
      const address = document.createElement('span')

      item.className = state == null ? '' : `is-${state}`
      kind.className = 'candidate-kind'
      kind.textContent = `${resolveText(this.#strings[KIND_KEYS[candidate.type] ?? 'candidateHost'])} · `
      address.className = 'candidate-address'
      address.textContent = candidate.port == null
        ? candidate.address
        : `${candidate.address}:${candidate.port}`

      item.append(kind, address)

      if (state != null) {
        const flag = document.createElement('span')

        flag.className = 'candidate-flag'
        flag.textContent = resolveText(this.#strings[state === 'new' ? 'candidateNew' : 'candidateGone'])
        item.append(flag)
      }

      return item
    }

    const fresh = before == null ? null : new Set(before.map(key))

    this.__candidates.replaceChildren(
      ...candidates.map(c => row(c, fresh != null && !fresh.has(key(c)) ? 'new' : null)),
      ...gone.map(c => row(c, 'gone'))
    )

    if (candidates.length === 0 && gone.length === 0) {
      const empty = document.createElement('li')

      empty.textContent = resolveText(this.#strings.detailsEmpty)
      this.__candidates.replaceChildren(empty)
    }

    // Only once an mDNS name is actually on screen. Before that it explains
    // something nobody has seen, which is how a panel becomes unreadable.
    const hasMdns = candidates.some(c => c.family === 'mdns')

    this.__mdnsNote.textContent = hasMdns ? resolveText(this.#strings.candidateMdns) : ''
    this.__mdnsNote.hidden = !hasMdns

    this.__details.hidden = false
    this.#renderedCandidates = candidates
  }

  /** The measuring bar and caption, on or off. */
  #setProbing (on) {
    this.__probeCaption.textContent = on ? resolveText(this.#strings.measuring) : ''
    this.__probe.hidden = !on
  }

  /**
   * The alarm, when there is no path off this network. Reflected as a `blocked`
   * attribute too, so a consumer can gate its own controls with a CSS selector
   * or a mutation observer instead of listening for the probe event.
   */
  #renderAlarm (result) {
    const risk = offNetworkRisk(result)

    this.__alarmText.textContent = risk == null
      ? ''
      : resolveText(risk === 'blocked' ? this.#strings.alarm : this.#strings.alarmUnreliable)
    this.__alarm.hidden = risk == null
    this.__alarm.className = risk == null ? 'alarm' : `alarm is-${risk}`

    // Two hooks, because they answer different questions: `blocked` is "nothing
    // at all works off this network", `off-network-risk` is "how bad is it".
    // Consumers gating a connect button want the second.
    this.toggleAttribute('blocked', risk === 'blocked')

    if (risk == null) {
      this.removeAttribute('off-network-risk')
    } else {
      this.setAttribute('off-network-risk', risk)
    }
  }

  attributeChangedCallback () {
    const requested = (this.getAttribute('rows') ?? '').trim()

    this.#keys = requested.length > 0
      ? requested.split(/\s+/).filter(key => ROW_KEYS.includes(key))
      : DEFAULT_ROWS
    this.#build()
  }

  get result () {
    return this.#result
  }

  /**
   * Render a verdict this element did not measure itself.
   *
   * Until now the panel could only show the result of its own `probe()`, which
   * leaves two real cases out: an application that already ran a check and does
   * not want to pay for a second one, and restoring a remembered verdict on
   * load so the panel is not blank while it re-measures.
   *
   * @param {{ ipv4?: object, ipv6?: object, overall?: object, browser?: object, camera?: object }} result
   */
  renderResult (result) {
    this.#result = result
    this.#paint(result)

    return result
  }

  connectedCallback () {
    // Listened for on the document, because a tap outside this element never
    // reaches inside its shadow root. `pointerdown` rather than `click`: Safari
    // does not dispatch a click for a tap on an element that is not itself
    // interactive, so a click listener never hears the tap that should dismiss
    // the tooltip. It fires before the chip's own click handler, which is why a
    // tap on a chip is excluded here rather than closed and reopened.
    this.#dismiss = event => {
      if (event.composedPath().some(node => node instanceof HTMLButtonElement && this.shadowRoot?.contains(node))) {
        return
      }

      this.#closeTips()
    }

    document.addEventListener('pointerdown', this.#dismiss)
    document.addEventListener('keydown', this.#onKeydown)

    if (this.hasAttribute('auto')) {
      this.probe().catch(() => {})
    }
  }

  disconnectedCallback () {
    document.removeEventListener('pointerdown', this.#dismiss)
    document.removeEventListener('keydown', this.#onKeydown)
    this.#dismiss = null
  }

  #onKeydown = event => {
    if (event.key === 'Escape') {
      this.#closeTips()
    }
  }

  #toggle (chip) {
    const open = chip.getAttribute('aria-expanded') === 'true'

    this.#closeTips(chip)
    chip.setAttribute('aria-expanded', open ? 'false' : 'true')
  }

  #closeTips (except) {
    for (const { chip } of Object.values(this.#rows)) {
      if (chip !== except) {
        chip.setAttribute('aria-expanded', 'false')
      }
    }
  }

  /**
   * Run the check and render it. Resolves with the result so a caller can also
   * log it, or decide something on the strength of it.
   */
  async probe () {
    // Shown before the first await, so the bar is up the instant probing starts
    // rather than after the network round trips it is meant to cover.
    this.#setProbing(true)

    try {
      const network = await probeNetwork(this.rtcConfiguration)
      const result = {
        ...network,
        // Asked for only when displayed. The camera query is passive but still a
        // question, and the browser check builds a peer connection.
        ...(this.#keys.includes('browser') ? { browser: probeBrowser() } : {}),
        ...(this.#keys.includes('camera') ? { camera: await probeCamera() } : {})
      }

      this.#result = result
      this.#paint(result)

      this.dispatchEvent(new CustomEvent('probe', { detail: result }))

      return result
    } finally {
      this.#setProbing(false)
    }
  }
}

if (customElements.get('qr-status') == null) {
  customElements.define('qr-status', QrStatusElement)
}
