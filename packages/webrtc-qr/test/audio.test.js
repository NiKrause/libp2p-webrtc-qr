import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  AUDIO_CHUNK_LIMIT,
  AUDIO_HEADER_LENGTH,
  AUDIO_ID_LENGTH,
  byteLength,
  AUDIO_SAMPLE_RATE,
  AUDIO_TRANSMISSION_LIMIT,
  createAudioReceiver,
  encodeToAudio,
  frameForAudio,
  parseAudioFrame
} from '../src/audio.js'

/**
 * The acoustic return channel, and the one thing that can go quietly wrong.
 *
 * ggwave carries 140 bytes per transmission and **truncates anything longer
 * without failing** - a valid waveform that decodes cleanly to the first 140
 * bytes, with the loss reported on stdout. A payload cut in half that verifies
 * as a payload cut in half is the worst outcome this carrier has available, so
 * most of what is asserted here is the framing that keeps us away from it.
 *
 * The round trip is a loopback: the waveform this module produces is fed
 * straight back into its own receiver. That proves the framing, the chunking and
 * the reassembly. It does not prove a room - a laptop speaker into a phone
 * microphone at conversational distance is a measurement, not a test, and it is
 * hand work.
 */

// A stand-in for a compact (v3) answer: the prefix this project uses and 204
// characters of base64url alphabet, which is the size measured on a live invite.
const COMPACT_SIZED = 'q3:' + Array.from({ length: 204 }, (_, i) => 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'[i % 64]).join('')

const feed = (receiver, frames, blockSize = 1024) => {
  let payload = null

  for (const frame of frames) {
    for (let offset = 0; offset < frame.length; offset += blockSize) {
      payload = receiver.push(frame.subarray(offset, offset + blockSize)) ?? payload
    }
  }

  return payload
}

describe('framing for the acoustic channel', () => {
  it('leaves room for its own header inside the transmission limit', () => {
    assert.equal(AUDIO_CHUNK_LIMIT + AUDIO_HEADER_LENGTH, AUDIO_TRANSMISSION_LIMIT)
  })

  it('cuts a compact-sized answer into two transmissions, neither of them truncatable', () => {
    const frames = frameForAudio(COMPACT_SIZED)

    assert.equal(frames.length, 2)
    assert.match(frames[0], new RegExp(`^12[0-9a-z]{${AUDIO_ID_LENGTH}}:`))
    assert.match(frames[1], new RegExp(`^22[0-9a-z]{${AUDIO_ID_LENGTH}}:`))
    // Both halves of one payload carry the same id, or the receiver would treat
    // the second as a different transmission and throw the first away.
    assert.equal(parseAudioFrame(frames[0]).id, parseAudioFrame(frames[1]).id)
    for (const frame of frames) assert.ok(byteLength(frame) <= AUDIO_TRANSMISSION_LIMIT, `${byteLength(frame)} bytes`)
  })

  it('sends a short payload as one transmission rather than padding it', () => {
    const frames = frameForAudio('q3:short')

    assert.equal(frames.length, 1)
    assert.equal(parseAudioFrame(frames[0]).body, 'q3:short')
    assert.equal(parseAudioFrame(frames[0]).index, 1)
    assert.equal(parseAudioFrame(frames[0]).total, 1)
  })

  it('measures the limit in bytes, which is what truncates', () => {
    // The limit ggwave enforces is a byte count. `text.slice` counts UTF-16
    // code units, so this payload used to be cut into pieces that looked right
    // and arrived short - a payload cut in half that verifies as one.
    const frames = frameForAudio('ä'.repeat(200))

    for (const frame of frames) {
      assert.ok(byteLength(frame) <= AUDIO_TRANSMISSION_LIMIT, `${byteLength(frame)} bytes`)
    }

    // And no piece ends halfway through a character, so the parts still join
    // back into what went in.
    assert.equal(frames.map(frame => parseAudioFrame(frame).body).join(''), 'ä'.repeat(200))
  })

  it('gives two different payloads two different ids', () => {
    // The same chunk count is the ordinary case - two answers are usually the
    // same length - so the count cannot be what tells them apart.
    const one = frameForAudio(COMPACT_SIZED)
    const other = frameForAudio(COMPACT_SIZED.replace('q3:A', 'q3:B'))

    assert.equal(one.length, other.length)
    assert.notEqual(parseAudioFrame(one[0]).id, parseAudioFrame(other[0]).id)
  })

  it('refuses a payload that would need more chunks than the header can number', () => {
    // The full (v2) format is around 1011 characters, which fits. This does not,
    // and the point is that it says so rather than sending eight tenths of it.
    assert.throws(() => frameForAudio('x'.repeat(AUDIO_CHUNK_LIMIT * 9 + 1)), /compact format over sound/)
  })

  it('refuses nothing at all', () => {
    assert.throws(() => frameForAudio(''), /Nothing to send/)
  })

  it('reads back what it wrote', () => {
    const frames = frameForAudio(COMPACT_SIZED)
    const parsed = frames.map(parseAudioFrame)

    assert.equal(parsed.map(part => part.body).join(''), COMPACT_SIZED)
    assert.deepEqual(parsed.map(part => part.index), [1, 2])
  })

  it('rejects what is not one of its frames', () => {
    // A room contains other sounds, and some of them decode.
    for (const junk of ['', 'hi', '1x:body', '00:body', '31:body', 'q3:not-a-frame']) {
      assert.equal(parseAudioFrame(junk), null, junk)
    }
  })
})

describe('a payload carried over sound', () => {
  it('arrives whole, through the codec and back', async () => {
    const { frames, seconds } = await encodeToAudio(COMPACT_SIZED, { protocol: 'fastest' })
    assert.equal(frames.length, 2)

    // Sanity on the measurement this carrier's design rests on: two chunks of a
    // compact answer are seconds, not minutes.
    assert.ok(seconds > 1 && seconds < 30, `${seconds.toFixed(1)}s`)

    const receiver = await createAudioReceiver()

    try {
      assert.equal(feed(receiver, frames), COMPACT_SIZED)
    } finally {
      receiver.close()
    }
  })

  it('does not mind which chunk arrives first', async () => {
    const { frames } = await encodeToAudio(COMPACT_SIZED, { protocol: 'fastest' })
    const receiver = await createAudioReceiver()

    try {
      assert.equal(feed(receiver, [...frames].reverse()), COMPACT_SIZED)
    } finally {
      receiver.close()
    }
  })

  it('takes a repeat for what it is - somebody playing it again', async () => {
    const { frames } = await encodeToAudio(COMPACT_SIZED, { protocol: 'fastest' })
    const receiver = await createAudioReceiver()

    try {
      assert.equal(feed(receiver, [frames[0], frames[0]]), null, 'one chunk twice is still one chunk')
      assert.deepEqual(receiver.missing(), [2])
      assert.equal(feed(receiver, [frames[1]]), COMPACT_SIZED)
    } finally {
      receiver.close()
    }
  })
})

describe('the sample rate it can be carried at', () => {
  /**
   * Found by CI and worth the whole story.
   *
   * The e2e passed on a laptop and decoded nothing in the container three runs
   * running, which read as a container problem: no sound card, no audio. It was
   * not. The container's `AudioContext` comes up at **44.1 kHz**, and at 44.1 kHz
   * this codec encodes a waveform that decodes to nothing - no error on either
   * side, just silence that verifies as silence.
   *
   * That is a browser bug waiting to happen, not a CI one. A browser's default
   * rate follows the output device, and 44.1 kHz is what a great many of them
   * report. Every transfer on those machines would have failed the same way,
   * and the first report would have been "it doesn't work" with nothing else in
   * it.
   */
  const MEASURED = {
    8000: false,
    11025: false,
    16000: true,
    22050: false,
    24000: true,
    32000: true,
    44100: false,
    48000: true,
    96000: true
  }

  it('asks for a rate it was measured to survive', () => {
    assert.equal(MEASURED[AUDIO_SAMPLE_RATE], true)
  })

  it('refuses a rate that would encode to silence, rather than encoding to silence', async () => {
    // The failure this replaces is the worst kind available: a payload that
    // travels, arrives, and decodes to nothing at either end.
    await assert.rejects(
      () => encodeToAudio(COMPACT_SIZED, { sampleRate: 44100 }),
      /cannot use 44100 Hz/
    )

    await assert.rejects(
      () => createAudioReceiver({ sampleRate: 44100 }),
      /cannot use 44100 Hz/
    )
  })

  it('agrees with the measurement in both directions', async () => {
    for (const [rate, carries] of Object.entries(MEASURED)) {
      const attempt = encodeToAudio('q3:short', { sampleRate: Number(rate) })

      if (carries) {
        await attempt
      } else {
        await assert.rejects(() => attempt, new RegExp(`cannot use ${rate} Hz`), `${rate} Hz`)
      }
    }
  })

  it('carries a payload at every rate it accepts', async () => {
    // Not only that the guard agrees with a table: that the rates the guard
    // lets through actually work, which is the claim the table is making.
    for (const rate of Object.keys(MEASURED).filter(rate => MEASURED[rate]).map(Number)) {
      const { frames } = await encodeToAudio('q3:short', { protocol: 'fastest', sampleRate: rate })
      const receiver = await createAudioReceiver({ sampleRate: rate })

      try {
        assert.equal(feed(receiver, frames), 'q3:short', `${rate} Hz`)
      } finally {
        receiver.close()
      }
    }
  })
})

describe('two payloads in one room', () => {
  it('does not splice chunks from different payloads into one', async () => {
    // The failure this prevents: Alice plays an answer, Bob hears chunk 1;
    // Alice abandons that invite and plays a new answer of the same length, Bob
    // hears chunk 2. Before the payload id, the receiver assembled the two
    // halves into a payload that never existed and handed it over as intact.
    const one = await encodeToAudio(COMPACT_SIZED, { protocol: 'fastest' })
    const other = await encodeToAudio(COMPACT_SIZED.replace('q3:A', 'q3:B'), { protocol: 'fastest' })

    assert.equal(one.frames.length, 2)
    assert.equal(other.frames.length, 2)

    const receiver = await createAudioReceiver()

    try {
      // The first half of one payload, then the second half of the other.
      const spliced = feed(receiver, [one.frames[0], other.frames[1]])

      assert.equal(spliced, null, 'assembled a payload out of two different ones')
      // And the second payload is now the one being collected, so its own first
      // half completes it rather than being discarded as a duplicate.
      assert.equal(feed(receiver, [other.frames[0]]), COMPACT_SIZED.replace('q3:A', 'q3:B'))
    } finally {
      receiver.close()
    }
  })
})

