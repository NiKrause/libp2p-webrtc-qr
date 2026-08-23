/**
 * Keep the page playing audio, so the browser does not suspend it and take the
 * peer connection with it.
 *
 * This exists because of the first fact in `AGENTS.md`: a browser closes an
 * `RTCPeerConnection` when it suspends the page, and on Android it does so
 * within a couple of seconds and without firing an event. Sending an invite
 * through a messenger means leaving the app, which is exactly that suspension —
 * so the carrier that is easiest to use is the one the platform breaks.
 *
 * A page that is playing audio is not a page Chromium freezes. That is the
 * whole mechanism. It is a workaround for a platform behaviour rather than a
 * guarantee, and it is deliberately small: start it when a payload is waiting
 * for an answer, stop it when the connection is up or the attempt is abandoned.
 *
 * **Audible by default, and that is not laziness.** Silence is the failure mode:
 * a stream the browser decides is inaudible stops counting as playback, and the
 * page is frozen anyway with nothing to show for the battery. Audio the user can
 * hear also tells them the app is still holding the line through a wait that is
 * otherwise a minute of nothing, and it gives Android a media notification —
 * which, with `mediaSession` metadata set, is a labelled one-tap way back into
 * the app. That last part addresses the actual complaint: people take a while to
 * come back.
 *
 * `silent: true` is offered for anyone who needs it, with the caveat above.
 *
 * Not a wake lock. `AGENTS.md` says it outright: a wake lock holds the screen,
 * not the page, and the browser drops it the moment the page is hidden. The two
 * solve different halves and neither substitutes for the other.
 */

/**
 * A buffer of *almost* silence.
 *
 * Not zeros. A buffer of pure zeros is exactly what a browser is entitled to
 * treat as "nothing is playing", which would defeat the point while still
 * costing a running audio graph. One least-significant bit at 16-bit depth is
 * inaudible on any speaker and is not silence to a level meter.
 *
 * @param {AudioContext} context
 * @returns {AudioBuffer}
 */
function nearSilentBuffer (context) {
  const frames = Math.max(1, Math.floor(context.sampleRate * 0.5))
  const buffer = context.createBuffer(1, frames, context.sampleRate)
  const channel = buffer.getChannelData(0)
  const lsb = 1 / 32768

  for (let i = 0; i < frames; i++) {
    channel[i] = i % 2 === 0 ? lsb : -lsb
  }

  return buffer
}

/**
 * @param {string} url
 * @param {AudioContext} context
 * @returns {Promise<AudioBuffer>}
 */
async function loadBuffer (url, context) {
  const response = await fetch(url)

  if (!response.ok) {
    throw new Error(`keep-alive track ${url} responded ${response.status}`)
  }

  return context.decodeAudioData(await response.arrayBuffer())
}

/**
 * @typedef {object} KeepAliveOptions
 * @property {string} [track] URL of an audio file to loop. Without one the
 *   keep-alive runs near-silent, whatever `silent` says — there is nothing to
 *   play.
 * @property {boolean} [silent] Run inaudibly even when a `track` is given.
 * @property {number} [volume] 0..1, applied to `track` only. Defaults to 0.35:
 *   audible in a pocket, not startling in a meeting.
 * @property {{ title?: string, artist?: string }} [metadata] Shown in the
 *   platform's media notification, which doubles as the way back to the app.
 */

/**
 * @param {KeepAliveOptions} [options]
 */
export function createKeepAlive (options = {}) {
  const { track, silent = false, volume = 0.35, metadata } = options

  /** @type {AudioContext | null} */
  let context = null
  /** @type {AudioBufferSourceNode | null} */
  let source = null
  let starting = false
  /**
   * Bumped by every `stop()`. `start()` awaits a resume and a fetch, and a stop
   * arriving in that window used to leave it dereferencing a context that had
   * been closed underneath it - a TypeError its own catch swallowed, reported to
   * the caller as "audio could not start" at the exact moment the connection
   * succeeded and the caller asked it to stop.
   */
  let generation = 0

  const supported = typeof globalThis.AudioContext === 'function' ||
    typeof (/** @type {any} */ (globalThis).webkitAudioContext) === 'function'

  /**
   * The platform's media notification, when there is something to label. Set
   * before playback rather than after, so the notification never appears blank.
   */
  function describe () {
    const session = /** @type {any} */ (globalThis.navigator)?.mediaSession

    if (session == null || metadata == null) {
      return
    }

    try {
      const MetadataCtor = /** @type {any} */ (globalThis).MediaMetadata
      if (typeof MetadataCtor === 'function') {
        session.metadata = new MetadataCtor(metadata)
      }
    } catch {
      // A platform that refuses metadata still plays audio, which is the part
      // that matters. The notification is then unlabelled rather than absent.
    }
  }

  return {
    get running () {
      return source != null
    },

    /** True once running, false when this browser cannot help. */
    get supported () {
      return supported
    },

    /**
     * Must be called from a user gesture.
     *
     * `AudioContext` starts `suspended` under the autoplay policy, and
     * `resume()` outside a gesture is refused - so not a `visibilitychange`
     * handler reacting to somebody already leaving, by which time there is no
     * gesture left to spend.
     *
     * **The gesture that hands the page away**, not the one that makes the
     * invite. Starting when the invite is created means playing music at
     * somebody who is only holding a code up to a camera and never leaves at
     * all; the share or copy control is the first moment the page is actually
     * about to lose the foreground. The demo moved for that reason and this
     * paragraph did not follow it until now.
     *
     * @returns {Promise<boolean>} whether audio is now playing
     */
    async start () {
      if (source != null || starting || !supported) {
        return source != null
      }

      starting = true

      const mine = generation

      try {
        const Ctor = globalThis.AudioContext ?? /** @type {any} */ (globalThis).webkitAudioContext
        context = new Ctor()

        if (context.state === 'suspended') {
          await context.resume()
        }

        if (mine !== generation) return false

        let buffer = null

        if (track != null && !silent) {
          try {
            buffer = await loadBuffer(track, context)
          } catch {
            // A missing or undecodable track must not cost the keep-alive: the
            // near-silent buffer does the same job, just without the audible
            // reassurance.
          }
        }

        // Stopped while the track was still downloading. Nothing to undo -
        // `stop()` closed the context - and nothing went wrong either.
        if (mine !== generation) return false

        const audible = buffer != null
        source = context.createBufferSource()
        source.buffer = buffer ?? nearSilentBuffer(context)
        source.loop = true

        if (audible) {
          const gain = context.createGain()
          gain.gain.value = Math.min(Math.max(volume, 0), 1)
          source.connect(gain)
          gain.connect(context.destination)
          describe()
        } else {
          source.connect(context.destination)
        }

        source.start()
        return true
      } catch {
        await this.stop()
        return false
      } finally {
        starting = false
      }
    },

    /**
     * Stop as soon as the connection is up or the attempt is abandoned.
     *
     * Not optional housekeeping: a keep-alive still running afterwards holds the
     * CPU awake for nothing, and — with an audible track — tells the user the
     * app is still working on something it finished minutes ago.
     */
    async stop () {
      generation++

      try {
        source?.stop()
      } catch {
        // Already stopped, or never started.
      }

      source?.disconnect()
      source = null

      const closing = context
      context = null

      const session = /** @type {any} */ (globalThis.navigator)?.mediaSession
      if (session != null && metadata != null) {
        try {
          session.metadata = null
        } catch {
          // Leaving stale metadata behind is untidy, never fatal.
        }
      }

      try {
        await closing?.close()
      } catch {
        // Closing an already-closed context throws on some engines.
      }
    }
  }
}
