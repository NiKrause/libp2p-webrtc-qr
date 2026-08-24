import { AUDIO_SAMPLE_RATE } from '../audio-rate.js'
import { mergeStrings, resolveText } from './strings.js'

/**
 * `<qr-listen>` - a microphone that hears a payload and hands it over.
 *
 * ```js
 * import { createAudioReceiver } from '@le-space/libp2p-webrtc-qr'
 *
 * listen.createReceiver = createAudioReceiver
 * listen.validate = async text => ({ ok: text.startsWith('q3:'), reason: 'Not a reply' })
 * listen.addEventListener('payload', event => use(event.detail.text))
 * listen.open()
 * ```
 *
 * **The codec is handed in, not imported here.** It would otherwise be imported
 * by every consumer of the elements bundle, including the ones who never open
 * this - and ggwave's WebAssembly glue names Node's `path` and `fs`, which no
 * browser bundle resolves. Passing `createReceiver` keeps the optional
 * dependency genuinely optional: an application that wants sound imports the
 * codec from the package root and hands it over, and one that does not carries
 * nothing. It is the same seam `strings` and `validate` are.
 *
 * The other half of `<qr-scanner>`, and deliberately the same shape: the element
 * owns the device, the decoding and the reassembly; the host owns what a payload
 * means. `validate` returning `{ ok: false, reason }` keeps listening and shows
 * the reason, so "that is an invite, not a reply" is a message rather than a
 * dead end.
 *
 * The microphone is released on every way out - the close button, Escape, the
 * host calling `close()`, a payload arriving, and the element being removed from
 * the document. A detached element holding a track leaves the recording
 * indicator on, and people report that as spyware rather than as a leak.
 *
 * ## The three switches that had to be off
 *
 * A browser's default microphone constraints are tuned for speech and every one
 * of them is hostile here. **Noise suppression** is built to remove exactly the
 * kind of steady tone this carries. **Echo cancellation** subtracts what the
 * speakers are playing, which on one device doing both halves is the signal
 * itself. **Automatic gain control** rides the level up and down mid-transmission
 * and smears the symbol boundaries. All three are asked for as `false`, and a
 * browser that ignores the request is a browser where this will be unreliable.
 */

/**
 * Blocks of this many samples, assembled in the worklet rather than on the main
 * thread. A worklet is handed 128 frames at a time - eight hundred messages a
 * second, each one a decode call, for a decoder that wants a window it can lock
 * a preamble onto.
 */
const BLOCK_SIZE = 1024

/**
 * Silence for this long, and say so. Long enough that somebody walking back to
 * the other device is not accused of anything; short enough to catch a phone on
 * mute before the whole transmission has been played to nobody.
 */
const QUIET_AFTER_MS = 6000

/** Below this RMS there is nothing on the microphone worth calling sound. */
const QUIET_LEVEL = 0.005

const WORKLET_SOURCE = `
  class QrListenProcessor extends AudioWorkletProcessor {
    constructor () {
      super()
      this.buffer = new Float32Array(${BLOCK_SIZE})
      this.filled = 0
    }

    process (inputs) {
      const channel = inputs[0]?.[0]
      // No input yet, or a track that ended. Not an error: keep the node alive
      // so a device that comes back is heard without rebuilding the graph.
      if (channel == null) return true

      for (let i = 0; i < channel.length; i++) {
        this.buffer[this.filled++] = channel[i]

        if (this.filled === this.buffer.length) {
          // A copy, because the port transfers nothing and the next block
          // overwrites this one while the main thread is still decoding it.
          this.port.postMessage(this.buffer.slice())
          this.filled = 0
        }
      }

      return true
    }
  }

  registerProcessor('qr-listen-processor', QrListenProcessor)
`

const STYLE = `
  /* The shadow root gets its own reset, because it does not inherit the page's.
     Without it, a width of 100vw plus 20px of padding is 100vw *plus the
     padding*: the dialog hangs 40px off the right of a phone, and the close
     button sits at the right end of the header. Reported from a Galaxy A57
     where the close button could not be reached. A Fold never showed it,
     because above 560px the full-width branch below does not apply at all. */
  *, *::before, *::after { box-sizing: border-box; }

  :host {
    /* The element renders nothing but a modal, so it should take no space in
       the flow it was placed in. */
    display: contents;
    --qr-listen-background: #101420;
    --qr-listen-foreground: #edf1f8;
    --qr-listen-border: rgba(255, 255, 255, 0.12);
    --qr-listen-radius: 14px;
    --qr-listen-width: 460px;
    --qr-listen-status-color: #a8b3c7;
    --qr-listen-level: #58c7f3;
  }

  dialog {
    width: min(100vw, var(--qr-listen-width));
    max-width: 100vw;
    max-height: 100dvh;
    padding: 20px;
    border: 1px solid var(--qr-listen-border);
    border-radius: var(--qr-listen-radius);
    background: var(--qr-listen-background);
    color: var(--qr-listen-foreground);
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

  /* Not decoration. Somebody holding two devices together has no other way to
     tell a microphone that is refused apart from a room that is quiet. */
  .meter {
    height: 8px;
    border: 1px solid var(--qr-listen-border);
    border-radius: 999px;
    overflow: hidden;
    background: rgb(255 255 255 / 0.04);
  }

  .level {
    height: 100%;
    width: 0;
    background: var(--qr-listen-level);
    transition: width 0.08s linear;
  }

  p {
    margin: 12px 0 0;
    min-height: 2.4em;
    font-size: 0.86rem;
    color: var(--qr-listen-status-color);
  }

  button {
    font: inherit;
    color: inherit;
    background: transparent;
    border: 1px solid var(--qr-listen-border);
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

/**
 * Everything this element says, in English. Replace any of it through the
 * `strings` property; what you leave out keeps these.
 *
 * The entry that carries numbers is a function, for the reason given in
 * ./strings.js.
 */
export const QR_LISTEN_STRINGS = {
  label: 'Listen for their reply',
  close: 'Close',
  unsupported: 'This browser cannot open a microphone',
  noAudio: 'The audio system did not start. This device may have no sound output the browser can use.',
  starting: 'Opening the microphone…',
  listening: 'Listening. Hold the two devices close, and play the sound on the other one.',
  quiet: 'Nothing heard yet. Is the other device playing, and is its volume up?',
  progress: ({ received, total }) => `Heard ${received} of ${total} parts. Keep it playing.`,
  rejected: 'That is not the reply this screen is waiting for.',
  denied: 'The microphone was refused. The code and the link both still work.'
}

export class QrListenElement extends HTMLElement {
  static observedAttributes = ['label']

  /** Set by the host: decides whether a heard payload is the one it wants. */
  validate = null

  /**
   * Set by the host: `createAudioReceiver` from the package root, or anything
   * with its shape. See the note above for why this is not imported here.
   */
  createReceiver = null

  #dialog
  #status
  #title
  #level
  #stream = null
  #context = null
  #node = null
  #source = null
  #receiver = null
  #session = 0
  #quietTimer = null
  /** Whether a payload has already been handed over in this session. */
  #delivered = false
  #strings = { ...QR_LISTEN_STRINGS }

  constructor () {
    super()

    const root = this.attachShadow({ mode: 'open' })
    const style = document.createElement('style')

    style.textContent = STYLE
    this.#dialog = document.createElement('dialog')
    this.#title = document.createElement('h3')
    this.#status = document.createElement('p')

    const meter = document.createElement('div')
    meter.className = 'meter'
    this.#level = document.createElement('div')
    this.#level.className = 'level'
    meter.append(this.#level)

    this.#status.setAttribute('role', 'status')
    this.#status.setAttribute('aria-live', 'polite')

    const header = document.createElement('header')
    const close = document.createElement('button')

    close.className = 'close'
    close.type = 'button'
    close.textContent = '×'
    close.setAttribute('aria-label', resolveText(this.#strings.close))
    close.addEventListener('click', () => this.close())

    header.append(this.#title, close)
    this.#dialog.append(header, meter, this.#status)
    root.append(style, this.#dialog)

    // Fires for Escape and for `close()` alike, so the microphone is released
    // in one place rather than at each of the ways out.
    this.#dialog.addEventListener('close', () => {
      this.#stop()
      this.dispatchEvent(new CustomEvent('close'))
    })
  }

  /**
   * The text this element shows. A partial table keeps the rest.
   *
   * The `label` attribute still wins where it is set: an attribute is the more
   * specific instruction, and a consumer that set both meant the attribute.
   */
  get strings () {
    return { ...this.#strings }
  }

  set strings (value) {
    this.#strings = mergeStrings(QR_LISTEN_STRINGS, value)
    this.#title.textContent = this.label
  }

  get label () {
    return this.getAttribute('label') ?? resolveText(this.#strings.label)
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
   * this the microphone stays open for a page nobody is looking at.
   */
  disconnectedCallback () {
    this.#stop()
  }

  get isOpen () {
    return this.#dialog.open
  }

  async open () {
    if (navigator.mediaDevices?.getUserMedia == null || typeof AudioContext === 'undefined') {
      throw new Error(resolveText(this.#strings.unsupported))
    }

    if (typeof this.createReceiver !== 'function') {
      throw new Error(
        'Set `createReceiver` on <qr-listen> before opening it - `createAudioReceiver` from ' +
        '@le-space/libp2p-webrtc-qr, or anything with its shape.'
      )
    }

    if (!this.#dialog.open) {
      this.#dialog.showModal()
    }

    const session = ++this.#session

    this.#delivered = false
    this.#status.textContent = resolveText(this.#strings.starting)
    this.#level.style.width = '0'

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        // All three off, and the comment at the top of this file is why. These
        // are requests: a browser is entitled to ignore them.
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false
        },
        video: false
      })

      // The dialog can have been closed while the permission prompt was up.
      if (session !== this.#session) {
        stream.getTracks().forEach(track => track.stop())
        return
      }

      this.#stream = stream
      await this.#listen(session)
    } catch (error) {
      // `NotAllowedError` is the one a person can act on; anything else already
      // carries its own sentence and saying "you refused this" over the top of
      // it would be wrong.
      this.#status.textContent = error?.name === 'NotAllowedError'
        ? resolveText(this.#strings.denied)
        : (error?.message ?? resolveText(this.#strings.denied))
      this.close()
      this.dispatchEvent(new CustomEvent('error', { detail: { error } }))
      throw error
    }
  }

  async #listen (session) {
    // Asked for, not accepted. A browser's default rate follows the output
    // device and 44.1 kHz is what a great many of them report - a rate this
    // codec encodes at and decodes nothing from, without failing either way.
    // The browser resamples between this and the hardware, which it is good at.
    let context

    try {
      context = new AudioContext({ sampleRate: AUDIO_SAMPLE_RATE })
    } catch {
      // An engine too old for the option. The receiver below refuses a rate it
      // cannot carry, so this fails with a sentence rather than with silence.
      context = new AudioContext()
    }

    // The codec is told the context's own rate rather than assuming 48 kHz: a
    // context that came up at 44.1 and a decoder expecting 48 hear different
    // frequencies for the same sound, and nothing decodes.
    const receiver = await this.createReceiver({ sampleRate: context.sampleRate })
    const url = URL.createObjectURL(new Blob([WORKLET_SOURCE], { type: 'text/javascript' }))

    try {
      await context.audioWorklet.addModule(url)
    } finally {
      // The module is compiled by now; the URL is only the delivery.
      URL.revokeObjectURL(url)
    }

    if (session !== this.#session) {
      receiver.close()
      await context.close()
      return
    }

    // A context built after `getUserMedia` resolved is one task removed from the
    // gesture that opened this, and the autoplay policy is entitled to hold it
    // suspended - in which case the graph never runs and the microphone is open
    // for nothing.
    //
    // Bounded, because "suspended" is not the only way this ends. On a machine
    // with no usable audio output - a container, a stripped-down VM - Firefox
    // never settles this promise at all, and a dialog that waits forever is
    // worse than one that says what went wrong.
    if (context.state === 'suspended') {
      const started = await Promise.race([
        context.resume().then(() => true, () => false),
        new Promise(resolve => setTimeout(() => resolve(false), 5000))
      ])

      if (!started) {
        receiver.close()
        await context.close().catch(() => {})
        throw new Error(resolveText(this.#strings.noAudio))
      }
    }

    const node = new AudioWorkletNode(context, 'qr-listen-processor')
    const source = context.createMediaStreamSource(this.#stream)

    source.connect(node)
    // Not to the destination: routing a live microphone to the speakers is
    // feedback, and this element is open precisely when a sound is playing
    // nearby. The worklet runs because it is pulled by the graph, not because
    // anything is listening to its output.

    node.port.onmessage = event => this.#hear(session, event.data)

    this.#context = context
    this.#node = node
    this.#source = source
    this.#receiver = receiver

    this.#status.textContent = resolveText(this.#strings.listening)
    this.#armQuiet()
  }

  #armQuiet () {
    clearTimeout(this.#quietTimer)
    this.#quietTimer = setTimeout(() => {
      // Only where nothing has arrived yet. A half-received payload is a room
      // that is working, and telling that person to check their volume is
      // noise on top of a transfer in progress.
      if (this.#receiver != null && this.#receiver.total() === 0) {
        this.#status.textContent = resolveText(this.#strings.quiet)
      }
    }, QUIET_AFTER_MS)
  }

  async #hear (session, samples) {
    if (session !== this.#session || this.#receiver == null) return

    let sum = 0
    for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i]
    const level = Math.sqrt(sum / samples.length)

    // Square-rooted again for the display: the ear is not linear and neither is
    // a meter that reads as "there is something there" at conversational level.
    this.#level.style.width = `${Math.min(100, Math.sqrt(level) * 140).toFixed(1)}%`
    if (level > QUIET_LEVEL) this.#armQuiet()

    const text = this.#receiver.push(samples)
    const missing = this.#receiver.missing()

    if (text == null) {
      // Say how far along it is, but only once something has arrived - before
      // that there is no total to count against.
      const total = this.#receiver.total()
      if (total > 0) {
        this.#status.textContent = resolveText(this.#strings.progress, { received: total - missing.length, total })
      }

      return
    }

    // Claimed before the await below, not after it. `close()` bumps the
    // generation, but it only runs once the event has been dispatched - so a
    // second complete decode arriving while `validate` was in flight passed the
    // same guards and dispatched the payload twice. Once every chunk is in hand
    // any further frame re-completes the payload, so a replayed sound was
    // enough, and the host then applied one answer to a session that had
    // already accepted it.
    if (this.#delivered) return
    this.#delivered = true

    if (typeof this.validate === 'function') {
      let verdict

      try {
        verdict = await this.validate(text)
      } catch (error) {
        verdict = { ok: false, reason: error?.message }
      }

      if (session !== this.#session) return

      if (verdict != null && verdict.ok === false) {
        // Keep listening. Somebody who played the wrong sound can play the
        // right one without reopening anything.
        this.#delivered = false
        this.#receiver.reset()
        // `||`, not `??`: `resolveText` returns an empty string for a missing
        // value rather than null, so `??` never reached the default and a
        // verdict without a reason blanked the status line instead of
        // explaining itself.
        this.#status.textContent = resolveText(verdict.reason) || resolveText(this.#strings.rejected)
        this.#armQuiet()
        return
      }
    }

    if (session !== this.#session) return

    this.dispatchEvent(new CustomEvent('payload', { detail: { text } }))
    this.close()
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

    clearTimeout(this.#quietTimer)
    this.#quietTimer = null

    if (this.#node != null) {
      this.#node.port.onmessage = null
      this.#node.disconnect()
      this.#node = null
    }

    if (this.#source != null) {
      this.#source.disconnect()
      this.#source = null
    }

    if (this.#receiver != null) {
      this.#receiver.close()
      this.#receiver = null
    }

    if (this.#stream != null) {
      this.#stream.getTracks().forEach(track => track.stop())
      this.#stream = null
    }

    if (this.#context != null) {
      // Not awaited: every caller of this is a way out, and none of them should
      // wait on an audio graph to finish tearing down before the dialog closes.
      this.#context.close().catch(() => {})
      this.#context = null
    }

    this.#level.style.width = '0'
  }
}

if (typeof customElements !== 'undefined' && customElements.get('qr-listen') == null) {
  customElements.define('qr-listen', QrListenElement)
}
