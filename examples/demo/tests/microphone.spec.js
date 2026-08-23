import { expect, test } from '@playwright/test'

/**
 * The microphone path, in a browser.
 *
 * The unit tests feed the codec's own waveform straight back into its own
 * receiver, which proves framing, chunking and reassembly and nothing about a
 * browser. Everything between those two - the constraints the element asks for,
 * an `AudioWorklet` buffering 128-frame blocks into 1024-sample ones, and the
 * release of the track afterwards - was covered by nothing.
 *
 * **This used to hand Chromium a WAV as its capture device**, the way
 * `camera.spec.js` hands it a video file, and it passed here and produced
 * silence on CI three times over. The E2E runs inside the Playwright container,
 * which has no audio device at all - so `--use-file-for-fake-audio-capture` had
 * nothing to play through. A test that needs a sound card is a test that only
 * runs on a laptop.
 *
 * So the sound is made *in the page*: the payload is encoded, played into a
 * `MediaStreamAudioDestinationNode`, and handed to the element as the stream
 * `getUserMedia` would have returned. Everything the element does with it is
 * unchanged, it runs on all three engines, and it needs no hardware.
 *
 * **CI found a real bug here, twice over.** The first version handed Chromium a
 * WAV as its capture device and the container had no device to play it through.
 * The second made the sound in the page and still decoded nothing - which read
 * as the container having no audio at all, and was not: its `AudioContext` comes
 * up at 44.1 kHz, and at 44.1 kHz the codec encodes a waveform that decodes to
 * silence. Both ends now ask for a rate the codec survives. See
 * `audio-rate.js` for the measurement.
 *
 * What none of this proves is a room - a laptop speaker into a phone microphone
 * at conversational distance, with an echo and a fan. That is a measurement and
 * it is hand work. See #110.
 */

const PAYLOAD = 'q3:heard-through-a-microphone'

test.describe('a payload heard through a microphone', () => {
  test('reaches the element from a media stream, whole', async ({ page }) => {
    test.setTimeout(120000)

    const errors = []

    page.on('pageerror', error => errors.push(error.message))
    await page.goto('/?ice=host&intro=off')
    await page.waitForFunction(() => typeof window.__libp2pQrTest?.encodeToAudio === 'function')

    const heard = await page.evaluate(async payload => {
      const { createAudioReceiver, encodeToAudio } = window.__libp2pQrTest

      // The stream the element will be given, playing the payload on a loop:
      // the element starts listening a moment after this starts, and a loop
      // means the transmission it half-missed comes round again.
      // The same rate the element asks for, and for the same reason: a default
      // context follows the output device, and at 44.1 kHz this encodes to
      // something that decodes to nothing.
      const context = new AudioContext({ sampleRate: window.__libp2pQrTest.AUDIO_SAMPLE_RATE })
      if (context.state === 'suspended') await context.resume()

      const { frames } = await encodeToAudio(payload, { protocol: 'fastest', sampleRate: context.sampleRate })
      const length = frames.reduce((total, frame) => total + frame.length, 0)
      const buffer = context.createBuffer(1, length, context.sampleRate)
      const channel = buffer.getChannelData(0)

      let offset = 0
      for (const frame of frames) {
        channel.set(frame, offset)
        offset += frame.length
      }

      const source = context.createBufferSource()
      const destination = context.createMediaStreamDestination()

      source.buffer = buffer
      source.loop = true
      source.connect(destination)
      source.start()

      // Not connected to `context.destination`: a test that plays a minute of
      // tones out of the machine running it is a test people learn to mute.

      let asked = null
      navigator.mediaDevices.getUserMedia = async constraints => {
        asked = constraints
        return destination.stream
      }

      const listen = document.createElement('qr-listen')

      listen.createReceiver = createAudioReceiver
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
      // track. `close()` is the way out a person has.
      listen.close()
      listen.remove()

      const tracks = destination.stream.getTracks()
      const result = {
        text,
        asked,
        live: tracks.filter(track => track.readyState === 'live').length,
        tracks: tracks.length
      }

      source.stop()
      await context.close()

      return result
    }, PAYLOAD)

    expect(heard.text, 'nothing was decoded from the stream').toBe(PAYLOAD)

    // The recording indicator is what people read as spyware, so a track left
    // running is the failure worth asserting rather than assuming.
    expect(heard.tracks, 'the element was never handed a track').toBeGreaterThan(0)
    expect(heard.live, 'a track was left running').toBe(0)

    // The three switches that had to be off. A browser may ignore the request;
    // asking is the part that is ours to get right, and a default that silently
    // came back would be the bug nobody notices until a room full of noise
    // suppression eats the signal.
    expect(heard.asked.audio).toMatchObject({
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false
    })

    expect(errors).toEqual([])
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
