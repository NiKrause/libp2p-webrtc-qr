import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  AUDIO_CHUNK_LIMIT,
  AUDIO_HEADER_LENGTH,
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
    assert.equal(frames[0].slice(0, 3), '12:')
    assert.equal(frames[1].slice(0, 3), '22:')
    for (const frame of frames) assert.ok(frame.length <= AUDIO_TRANSMISSION_LIMIT, `${frame.length} bytes`)
  })

  it('sends a short payload as one transmission rather than padding it', () => {
    assert.deepEqual(frameForAudio('q3:short'), ['11:q3:short'])
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
