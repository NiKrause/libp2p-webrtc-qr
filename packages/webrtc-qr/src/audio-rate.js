/**
 * What sample rate the acoustic channel can work at, and nothing else.
 *
 * A module of its own for one number and one guard, because both ends need them
 * and one of those ends is a custom element. `audio.js` reaches for ggwave
 * behind an `await import()`, and a bundler follows that import whether or not
 * anybody ever opens the channel - so an element that imported the rate from
 * there would drag 150 KB of WebAssembly into every consumer's elements bundle,
 * which is exactly what handing `createReceiver` in was meant to avoid. It is
 * cheaper to keep the number where nothing else lives than to duplicate it and
 * watch the two drift.
 */

/**
 * The rate to ask an `AudioContext` for, and the reason to ask at all.
 *
 * **The codec is silent at 44.1 kHz.** Measured across the rates a browser
 * actually comes up at: 16000, 24000, 32000, 48000 and 96000 carry a payload
 * and back; 8000, 11025, 22050, 44100 and 88200 encode a waveform that decodes
 * to nothing. The multiples of 8000 work and the 44.1 family does not, in both
 * directions, with no error from the codec either way.
 *
 * That is not a container quirk or a laptop quirk. A browser's default rate
 * follows the output device - 44.1 kHz is what a great many of them report, and
 * on those machines every one of these transfers would have failed silently. So
 * both ends ask for this rate rather than taking what they are given:
 *
 * ```js
 * const context = new AudioContext({ sampleRate: AUDIO_SAMPLE_RATE })
 * ```
 *
 * The browser resamples between this and the hardware, which is a thing browsers
 * are good at and this module is not.
 */
export const AUDIO_SAMPLE_RATE = 48000

/**
 * Is this a rate the codec can carry?
 *
 * A guess dressed as a rule would be worse than no rule, so this is exactly the
 * measurement above: a multiple of 8000, and high enough to hold the tones.
 */
function carriesAudio (rate) {
  return Number.isInteger(rate) && rate >= 16000 && rate % 8000 === 0
}

export function assertRate (rate) {
  if (carriesAudio(rate)) return

  throw new Error(
    `The acoustic channel cannot use ${rate} Hz - the codec encodes at that rate and decodes nothing, ` +
    `without failing. Ask for a rate it can carry: new AudioContext({ sampleRate: ${AUDIO_SAMPLE_RATE} }).`
  )
}
