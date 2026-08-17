import assert from 'node:assert/strict'
import test from 'node:test'

import { createKeepAlive } from '../src/keep-alive.js'

/**
 * These cover the mechanics — that the graph is built, that the buffer is not
 * silence, that stopping releases everything. They cannot cover the claim the
 * module exists for: that playing audio stops Android suspending the page and
 * closing the peer connection. That needs two phones and a messenger, the same
 * way the finding in `AGENTS.md` was arrived at.
 */

/** A minimal AudioContext, recording what was asked of it. */
function stubAudio () {
  const log = []
  let closed = false

  class FakeAudioContext {
    constructor () {
      this.sampleRate = 48000
      this.state = 'suspended'
      this.destination = { id: 'destination' }
      log.push('construct')
    }

    async resume () {
      this.state = 'running'
      log.push('resume')
    }

    createBuffer (channels, frames) {
      const data = new Float32Array(frames)
      return { getChannelData: () => data, length: frames, channels }
    }

    createBufferSource () {
      return {
        buffer: null,
        loop: false,
        start: () => log.push('start'),
        stop: () => log.push('stop'),
        connect: (node) => log.push(`connect:${node.id ?? 'gain'}`),
        disconnect: () => log.push('disconnect')
      }
    }

    createGain () {
      return { id: 'gain', gain: { value: 1 }, connect: (node) => log.push(`gain->${node.id}`) }
    }

    async close () {
      closed = true
      log.push('close')
    }
  }

  const previous = globalThis.AudioContext
  globalThis.AudioContext = /** @type {any} */ (FakeAudioContext)

  return {
    log,
    get closed () { return closed },
    restore () {
      if (previous === undefined) {
        delete (/** @type {any} */ (globalThis).AudioContext)
      } else {
        globalThis.AudioContext = previous
      }
    }
  }
}

test('starting resumes the context and loops a source', async () => {
  const audio = stubAudio()

  try {
    const keepAlive = createKeepAlive()
    assert.equal(keepAlive.running, false)

    const started = await keepAlive.start()

    assert.equal(started, true)
    assert.equal(keepAlive.running, true)
    // `resume()` matters: the context starts suspended under the autoplay
    // policy, so a keep-alive that never resumes is a keep-alive that never runs.
    assert.ok(audio.log.includes('resume'), 'must resume the suspended context')
    assert.ok(audio.log.includes('start'), 'must start the source')

    await keepAlive.stop()
    assert.equal(keepAlive.running, false)
    assert.equal(audio.closed, true, 'stopping must close the context')
  } finally {
    audio.restore()
  }
})

test('the silent buffer is not actually silence', async () => {
  const audio = stubAudio()

  try {
    // Capture whatever the module assigns as its buffer. The assertion is the
    // whole reason the module does not simply use zeros: a buffer of silence is
    // what a browser is entitled to treat as "nothing is playing", which defeats
    // the keep-alive while still costing a running audio graph.
    let captured = null
    const Base = /** @type {any} */ (globalThis.AudioContext)
    globalThis.AudioContext = /** @type {any} */ (class extends Base {
      createBufferSource () {
        const source = super.createBufferSource()
        Object.defineProperty(source, 'buffer', {
          set (value) { captured = value },
          get () { return captured }
        })
        return source
      }
    })

    const keepAlive = createKeepAlive()
    await keepAlive.start()
    await keepAlive.stop()

    assert.ok(captured != null, 'a buffer must have been assigned')
    assert.ok(
      captured.getChannelData(0).some((v) => v !== 0),
      'the keep-alive buffer must not be pure silence'
    )
  } finally {
    audio.restore()
  }
})

test('a browser without AudioContext degrades instead of throwing', async () => {
  const previous = globalThis.AudioContext
  delete (/** @type {any} */ (globalThis).AudioContext)

  try {
    const keepAlive = createKeepAlive()
    assert.equal(keepAlive.supported, false)
    assert.equal(await keepAlive.start(), false)
    await keepAlive.stop()
    assert.equal(keepAlive.running, false)
  } finally {
    if (previous !== undefined) globalThis.AudioContext = previous
  }
})

test('stopping twice is harmless', async () => {
  const audio = stubAudio()

  try {
    const keepAlive = createKeepAlive()
    await keepAlive.start()
    await keepAlive.stop()
    await keepAlive.stop()
    assert.equal(keepAlive.running, false)
  } finally {
    audio.restore()
  }
})
