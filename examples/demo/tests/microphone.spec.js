import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { encodeToAudio } from '@le-space/libp2p-webrtc-qr'
import { chromium, expect, test } from '@playwright/test'

/**
 * The microphone path, heard for real.
 *
 * The unit tests feed the codec's own waveform straight back into its own
 * receiver, which proves framing, chunking and reassembly and nothing about a
 * browser. Everything between those two - `getUserMedia` with the three speech
 * switches off, an `AudioWorklet` buffering 128-frame blocks into 1024-sample
 * ones, and the element that owns the device - was covered by nothing.
 *
 * So this does what `camera.spec.js` does one sense over: render the payload to
 * a file, hand the file to Chromium as the capture device, and let the element
 * hear it. Chromium loops the file, so the transmission repeats for as long as
 * the receiver needs.
 *
 * Chromium only, for the same reason the camera spec is: Firefox's fake stream
 * is a generated tone with no way to supply a file, and WebKit has no fake
 * device at all.
 *
 * What it still does not prove is a room - a laptop speaker into a phone
 * microphone at conversational distance, with an echo and a fan. That is a
 * measurement and it is hand work. See #110.
 */

const SAMPLE_RATE = 48000

// Short on purpose. This asserts that sound gets from a device into the element,
// not that ggwave can carry 207 bytes - the unit tests do that in milliseconds,
// and every byte here is real time a test spends waiting.
const PAYLOAD = 'q3:heard-through-a-microphone'

/** 16-bit PCM, mono, which is what Chromium's fake capture device reads. */
function writeWav (path, samples, sampleRate) {
  const header = Buffer.alloc(44)
  const body = Buffer.alloc(samples.length * 2)

  for (let i = 0; i < samples.length; i++) {
    // Clamped before scaling: a sample slightly past ±1 wraps to the opposite
    // extreme as an Int16 and is heard as a click in the middle of a symbol.
    const clamped = Math.max(-1, Math.min(1, samples[i]))
    body.writeInt16LE(Math.round(clamped * 32767), i * 2)
  }

  header.write('RIFF', 0)
  header.writeUInt32LE(36 + body.length, 4)
  header.write('WAVE', 8)
  header.write('fmt ', 12)
  header.writeUInt32LE(16, 16)
  header.writeUInt16LE(1, 20)          // PCM
  header.writeUInt16LE(1, 22)          // mono
  header.writeUInt32LE(sampleRate, 24)
  header.writeUInt32LE(sampleRate * 2, 28)
  header.writeUInt16LE(2, 32)
  header.writeUInt16LE(16, 34)
  header.write('data', 36)
  header.writeUInt32LE(body.length, 40)

  writeFileSync(path, Buffer.concat([header, body]))
}

test.describe('a payload heard through a microphone', () => {
  test('reaches the element from a capture device, whole', async ({ browserName, baseURL }) => {
    test.skip(browserName !== 'chromium', 'only Chromium can be given a capture file')
    test.setTimeout(120000)

    const directory = mkdtempSync(join(tmpdir(), 'qr-audio-'))
    const wavPath = join(directory, 'answer.wav')
    let browser = null

    try {
      const { frames, seconds } = await encodeToAudio(PAYLOAD, { protocol: 'fastest', sampleRate: SAMPLE_RATE })

      // One transmission, because the payload is short. If that ever changes,
      // the concatenation below still plays them in order.
      const total = frames.reduce((sum, frame) => sum + frame.length, 0)
      const joined = new Float32Array(total)
      let offset = 0
      for (const frame of frames) {
        joined.set(frame, offset)
        offset += frame.length
      }

      writeWav(wavPath, joined, SAMPLE_RATE)
      expect(seconds).toBeLessThan(10)

      browser = await chromium.launch({
        args: [
          '--use-fake-ui-for-media-stream',
          '--use-fake-device-for-media-stream',
          `--use-file-for-fake-audio-capture=${wavPath}`
        ]
      })

      const page = await (await browser.newContext({ baseURL })).newPage()
      const errors = []

      page.on('pageerror', error => errors.push(error.message))
      await page.goto('/?ice=host&intro=off')
      await page.waitForFunction(() => typeof window.__libp2pQrTest?.createAudioReceiver === 'function')

      // Its own element rather than the demo's, which validates what it hears
      // against a real signed answer. What is under test here is the path from
      // the device to the event, and a signature check in the middle would only
      // make the fixture expensive.
      const heard = await page.evaluate(async () => {
        const listen = document.createElement('qr-listen')

        // Every track the element is handed, kept so the state of each can be
        // read after it has been let go of.
        const tracks = []
        const real = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices)
        navigator.mediaDevices.getUserMedia = async constraints => {
          const stream = await real(constraints)
          tracks.push(...stream.getTracks())
          window.__qrListenConstraints = constraints
          return stream
        }

        listen.createReceiver = window.__libp2pQrTest.createAudioReceiver
        document.body.append(listen)

        const arrived = new Promise(resolve => {
          listen.addEventListener('payload', event => resolve(event.detail.text), { once: true })
        })

        await listen.open()

        const text = await Promise.race([
          arrived,
          new Promise(resolve => setTimeout(() => resolve(null), 60000))
        ])

        // Whether it arrived or not: the element must not be left holding the
        // microphone. `close()` is the way out a person has.
        listen.close()
        listen.remove()

        return { text, live: tracks.filter(track => track.readyState === 'live').length, heard: tracks.length }
      })

      expect(heard.text, 'nothing was decoded from the capture device').toBe(PAYLOAD)

      // The recording indicator is what people read as spyware, so a track left
      // running is the failure worth asserting rather than assuming.
      expect(heard.heard, 'the element never opened a microphone').toBeGreaterThan(0)
      expect(heard.live, 'a microphone track was left running').toBe(0)

      // The three switches that had to be off. A browser may ignore the
      // request; asking is the part that is ours to get right, and a default
      // that silently came back would be the bug nobody notices until a room
      // full of noise suppression eats the signal.
      const constraints = await page.evaluate(() => window.__qrListenConstraints)
      expect(constraints.audio).toMatchObject({
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false
      })

      expect(errors).toEqual([])
    } finally {
      await browser?.close()
      rmSync(directory, { recursive: true, force: true })
    }
  })

  test('each side is offered its own half, and never the other one', async ({ page, browser, baseURL }) => {
    // One page shows an offer and one shows an answer, and the pair of controls
    // has to follow that: a side showing an offer has nothing to play, and a
    // side showing an answer has nothing to listen for. Both were visible on
    // both sides before `renderOutbound` learned the difference.
    await page.goto('/?ice=host&view=technical&intro=off')
    await page.locator('#start-client').click()
    await page.waitForFunction(() => document.getElementById('peer-id').textContent !== 'not started')
    await page.locator('#create-offer').click()
    await expect(page.locator('#invite-box')).toBeVisible({ timeout: 60000 })

    await expect(page.locator('#listen-reply')).toBeVisible()
    await expect(page.locator('#play-answer')).toBeHidden()

    const link = await page.locator('#invite-link').inputValue()
    const answerer = await (await browser.newContext({ baseURL })).newPage()

    try {
      await answerer.goto(link.replace(/^https?:\/\/[^/]+/, ''))
      await expect(answerer.locator('#invite-box')).toBeVisible({ timeout: 60000 })
      await expect(answerer.locator('#invite-link')).toHaveValue(/#r=/)

      await expect(answerer.locator('#listen-reply')).toBeHidden()

      // The wait is named on the button rather than discovered by pressing it.
      // Sound is seconds where a code is instant, and a control that does not
      // say so is one people press twice.
      await expect(answerer.locator('#play-answer')).toBeVisible()
      await expect(answerer.locator('#play-answer')).toHaveText(/Play it as sound \(about \d+s\)/)
    } finally {
      await answerer.close()
    }
  })
})
