/**
 * The answer, carried back as sound.
 *
 * The handshake is symmetric today and the hardware is not. Two phones are fine:
 * each has a camera and a screen, so each can show a code and read one. A laptop
 * and a phone are not. The laptop shows the offer, the phone scans it - and then
 * the phone has to hold its answer up to a webcam that is badly angled, poor, or
 * absent. In practice people fall back to copy and paste, which is exactly the
 * case this project exists to make effortless.
 *
 * So: QR in one direction, sound in the other. The idea is not ours -
 * `vbocan/webrtc-oob-pairing` pairs a workstation with a phone that answers over
 * an audible chirp, and #3 is where we decided to take it seriously.
 *
 * **Carrier, not format.** These are the same signed bytes that go into a code
 * or a link. Nothing here authenticates anything; the signature travelling
 * inside the payload still does, exactly as it does for the other two carriers.
 * A microphone is not a trusted channel and is not treated as one.
 *
 * ## What this costs, measured rather than assumed
 *
 * ggwave carries **at most 140 bytes per transmission** and - the part that
 * decides the shape of this module - **silently truncates anything longer**. It
 * returns a valid waveform that decodes cleanly to the first 140 bytes, with the
 * loss reported only as a line on stdout. A half-answer that verifies as a
 * half-answer is the worst failure available here, so the payload is framed and
 * chunked by us, and a chunk that would reach that limit throws instead.
 *
 * At 48 kHz, one full 140-byte chunk takes:
 *
 * | protocol  | seconds | bytes/s |
 * | --------- | ------: | ------: |
 * | `normal`  |    13.5 |    10.3 |
 * | `fast`    |     9.3 |    15.1 |
 * | `fastest` |     5.0 |    28.0 |
 *
 * A compact (v3) answer is around **207 bytes**, so two chunks: about **8
 * seconds** on `fastest` and **14** on `fast`. A full (v2) answer is around 758
 * bytes - six chunks, thirty seconds at best - which is why this carrier sets
 * the compact format rather than following the invite's. That coupling is real
 * and is written down beside the export that does it.
 *
 * ## Why ggwave and not our own modulation
 *
 * Frequency-shift keying is the easy half. What makes a data-over-sound channel
 * work in a room is the rest: a preamble the receiver can lock onto, framing,
 * and error correction strong enough for a laptop speaker into a phone
 * microphone at conversational distance. ggwave has all of it, is MIT, and is
 * one dependency rather than a subsystem.
 *
 * It is an **optional peer dependency**, and loaded with `await import()` at the
 * moment somebody opens the channel. Nobody who only wants the transport should
 * pay 150 KB of WebAssembly for a feature they never open, and nobody should
 * have their build fail because a package they do not use is missing.
 */

/**
 * 140 bytes is the transmission limit, three of them are ours.
 *
 * The header is `<index><total>:` - one digit each, so at most nine chunks, and
 * the colon makes a malformed frame obvious rather than plausible. Nine chunks
 * is 1233 bytes, comfortably past the largest payload this project produces, and
 * a bound is better than a format that grows a second header byte in the field.
 */
export const AUDIO_TRANSMISSION_LIMIT = 140
export const AUDIO_HEADER_LENGTH = 3
export const AUDIO_CHUNK_LIMIT = AUDIO_TRANSMISSION_LIMIT - AUDIO_HEADER_LENGTH

/** The three audible protocols, named as this project talks about them. */
export const AUDIO_PROTOCOLS = ['normal', 'fast', 'fastest']

/**
 * `fast` rather than `fastest`, and the difference is five seconds against a
 * room. The fastest protocol packs the symbols closest together, which is also
 * what makes it the first to fail against an echo or a fan. Somebody holding a
 * phone up to a laptop will accept nine seconds; nobody accepts doing it twice.
 */
export const AUDIO_DEFAULT_PROTOCOL = 'fast'

const PROTOCOL_IDS = {
  normal: 'GGWAVE_PROTOCOL_AUDIBLE_NORMAL',
  fast: 'GGWAVE_PROTOCOL_AUDIBLE_FAST',
  fastest: 'GGWAVE_PROTOCOL_AUDIBLE_FASTEST'
}

let modulePromise = null

/**
 * The library, loaded once and only when somebody asks for sound.
 *
 * The error is worth more than the failure: a consumer who never touches this
 * should not have installed ggwave, and one who reaches it and has not should be
 * told which package and why rather than meeting a bare module-not-found from
 * inside a dependency.
 */
export async function loadAudioCodec () {
  if (modulePromise == null) {
    modulePromise = import('ggwave')
      .then(module => (module.default ?? module)())
      .catch(cause => {
        modulePromise = null
        throw new Error(
          'The acoustic channel needs the optional peer dependency "ggwave" - install it to send or ' +
          'listen for a handshake over sound. Every other carrier works without it.',
          { cause }
        )
      })
  }

  return modulePromise
}

/** For tests and for a consumer that swaps the codec: forget the loaded one. */
export function resetAudioCodec () {
  modulePromise = null
}

function protocolId (codec, name) {
  const key = PROTOCOL_IDS[name]
  if (key == null) throw new Error(`Unknown audio protocol "${name}" - one of ${AUDIO_PROTOCOLS.join(', ')}`)

  return codec.ProtocolId[key]
}

/**
 * Cut a payload into transmissions.
 *
 * Exported because the chunking is the part that has to be right, and a test
 * that has to run an audio round trip to check an off-by-one is a test nobody
 * writes.
 *
 * @param {string} text
 * @returns {string[]}
 */
export function frameForAudio (text) {
  if (typeof text !== 'string' || text.length === 0) throw new Error('Nothing to send over audio')

  const total = Math.ceil(text.length / AUDIO_CHUNK_LIMIT)
  if (total > 9) {
    throw new Error(
      `${text.length} bytes needs ${total} transmissions and the frame header carries one digit. ` +
      'Send the compact format over sound.'
    )
  }

  return Array.from({ length: total }, (_, index) => {
    const body = text.slice(index * AUDIO_CHUNK_LIMIT, (index + 1) * AUDIO_CHUNK_LIMIT)
    const frame = `${index + 1}${total}:${body}`

    // Belt and braces against the silent truncation this whole module is shaped
    // around. If the arithmetic above is ever wrong, it fails here rather than
    // on the other side of the room.
    if (frame.length > AUDIO_TRANSMISSION_LIMIT) {
      throw new Error(`Frame of ${frame.length} bytes exceeds the ${AUDIO_TRANSMISSION_LIMIT}-byte transmission limit`)
    }

    return frame
  })
}

/**
 * Read a frame back, and refuse anything that is not one.
 *
 * @param {string} frame
 * @returns {{ index: number, total: number, body: string } | null}
 */
export function parseAudioFrame (frame) {
  if (typeof frame !== 'string' || frame.length < AUDIO_HEADER_LENGTH + 1) return null
  if (frame[2] !== ':') return null

  const index = Number(frame[0])
  const total = Number(frame[1])
  if (!Number.isInteger(index) || !Number.isInteger(total)) return null
  if (index < 1 || total < 1 || index > total) return null

  return { index, total, body: frame.slice(AUDIO_HEADER_LENGTH) }
}

/**
 * Turn a payload into waveforms, one per transmission.
 *
 * Separate buffers rather than one: the gap between them is where a receiver
 * that missed a chunk gets to hear the next preamble cleanly, and where a person
 * gets to move the phone closer without losing what has already arrived.
 *
 * @param {string} text the payload, compact format
 * @param {object} [options]
 * @param {'normal'|'fast'|'fastest'} [options.protocol]
 * @param {number} [options.sampleRate] must match the AudioContext that plays it
 * @param {number} [options.volume] ggwave's own 0-100 scale
 * @returns {Promise<{ frames: Float32Array[], seconds: number }>}
 */
export async function encodeToAudio (text, { protocol = AUDIO_DEFAULT_PROTOCOL, sampleRate = 48000, volume = 15 } = {}) {
  const codec = await loadAudioCodec()
  const parameters = codec.getDefaultParameters()
  parameters.sampleRateInp = sampleRate
  parameters.sampleRateOut = sampleRate
  parameters.sampleFormatInp = codec.SampleFormat.GGWAVE_SAMPLE_FORMAT_F32
  parameters.sampleFormatOut = codec.SampleFormat.GGWAVE_SAMPLE_FORMAT_F32

  const instance = codec.init(parameters)

  try {
    const frames = frameForAudio(text).map(frame => {
      const encoded = codec.encode(instance, frame, protocolId(codec, protocol), volume)
      if (encoded == null || encoded.length === 0) throw new Error('The audio codec produced no waveform')

      // Copied, not viewed. What comes back is a window onto the WebAssembly
      // heap, and the next call writes over it.
      return new Float32Array(new Float32Array(encoded.buffer, encoded.byteOffset, encoded.length / 4))
    })

    const samples = frames.reduce((total, frame) => total + frame.length, 0)

    return { frames, seconds: samples / sampleRate }
  } finally {
    codec.free(instance)
  }
}

/**
 * Listen, and say when the whole payload has arrived.
 *
 * Fed blocks of microphone samples; returns `null` until a payload is complete.
 * Chunks may arrive in any order and more than once - somebody replaying the
 * sound because the first attempt was drowned out is the ordinary case, not an
 * error - so a repeat is ignored rather than restarting anything.
 *
 * @param {object} [options]
 * @param {number} [options.sampleRate] the AudioContext's rate, not the codec's
 * @returns {Promise<{ push: (samples: Float32Array) => string | null, missing: () => number[], reset: () => void, close: () => void }>}
 */
export async function createAudioReceiver ({ sampleRate = 48000 } = {}) {
  const codec = await loadAudioCodec()
  const parameters = codec.getDefaultParameters()
  parameters.sampleRateInp = sampleRate
  parameters.sampleRateOut = sampleRate
  parameters.sampleFormatInp = codec.SampleFormat.GGWAVE_SAMPLE_FORMAT_F32
  parameters.sampleFormatOut = codec.SampleFormat.GGWAVE_SAMPLE_FORMAT_F32

  const instance = codec.init(parameters)
  const received = new Map()
  let expected = null

  const assemble = () => {
    if (expected == null || received.size !== expected) return null

    let text = ''
    for (let index = 1; index <= expected; index++) text += received.get(index)

    return text
  }

  return {
    push (samples) {
      // The codec takes the bytes of the samples, not the samples: its binding
      // is a `std::string` and a `Float32Array` is not one. A view rather than a
      // copy, so a block straight off an AudioWorklet costs nothing here.
      const bytes = samples instanceof Float32Array
        ? new Uint8Array(samples.buffer, samples.byteOffset, samples.byteLength)
        : samples

      const decoded = codec.decode(instance, bytes)
      if (decoded == null || decoded.length === 0) return null

      const frame = parseAudioFrame(new TextDecoder().decode(decoded))
      // Not ours, or damaged past its own error correction. Silence is the right
      // answer: a room contains other sounds and none of them are a failure.
      if (frame == null) return null

      // A different transmission entirely - somebody started over with a fresh
      // payload. Keeping the old chunks would splice two answers into one.
      if (expected != null && frame.total !== expected) received.clear()

      expected = frame.total
      received.set(frame.index, frame.body)

      return assemble()
    },

    /** Which chunks are still outstanding, so a UI can say "2 of 3". */
    missing () {
      if (expected == null) return []

      return Array.from({ length: expected }, (_, i) => i + 1).filter(index => !received.has(index))
    },

    reset () {
      received.clear()
      expected = null
    },

    close () {
      received.clear()
      expected = null
      codec.free(instance)
    }
  }
}
