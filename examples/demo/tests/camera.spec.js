import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { chromium, expect, test } from '@playwright/test'

/**
 * The camera path, scanned for real.
 *
 * Every field failure in this project has been here - a scanner that fed links
 * to a raw-payload parser, a code too dense to read between two phones, a status
 * line stamping over the part counter - and every one was found by a person
 * holding two phones while the suite stayed green. The suite exchanges payloads
 * by copy/paste and programmatic calls, so `getUserMedia`, the scan loop and
 * `jsQR` against a rendered code were never exercised.
 *
 * This renders the app's own animated invite into a video file and hands it to
 * Chromium as the capture device, so the scan runs end to end: camera, frames,
 * decode, BC-UR reassembly, signature check, answer.
 *
 * Chromium only. Firefox's fake stream is a generated pattern with no way to
 * supply a file, and WebKit has no fake device at all.
 */

// Big enough for jsQR to resolve the modules, small enough that a few seconds
// of video is not a hundred megabytes of base64 crossing the bridge.
const FRAME_WIDTH = 640
const FRAME_HEIGHT = 480

// The code is deliberately *not* given the whole frame. The failure being
// reproduced is a code too small to resolve, so a test that paints it edge to
// edge would prove something easier than the real thing.
const CODE_HEIGHT_FRACTION = 0.62

// 30fps against the animation's 5fps: six identical frames per code, which is
// also roughly what a camera samples while one code is on screen.
const FPS = 30
const FRAMES_PER_CODE = 6

/**
 * Convert rendered QR images into I420 frames.
 *
 * Done inside the page rather than in Node so that no image decoder is needed
 * here: the browser already has one, and a canvas gives the pixels directly.
 */
async function renderFramesToI420 (page, dataUrls, width, height, fraction) {
  return page.evaluate(async ({ dataUrls, width, height, fraction }) => {
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const context = canvas.getContext('2d', { willReadFrequently: true })
    const frames = []

    for (const dataUrl of dataUrls) {
      const image = new Image()
      image.src = dataUrl
      await image.decode()

      // A grey surround, because a phone camera never sees a code on nothing.
      context.fillStyle = '#6b7280'
      context.fillRect(0, 0, width, height)

      const size = Math.round(height * fraction)
      context.imageSmoothingEnabled = false
      context.drawImage(image, Math.round((width - size) / 2), Math.round((height - size) / 2), size, size)

      const { data } = context.getImageData(0, 0, width, height)
      const ySize = width * height
      const chromaSize = (width / 2) * (height / 2)
      const out = new Uint8Array(ySize + chromaSize * 2)

      for (let i = 0, p = 0; i < data.length; i += 4, p++) {
        // BT.601 luma. A black and white code carries all of its information
        // here, which is also all jsQR looks at.
        out[p] = Math.max(0, Math.min(255,
          Math.round(0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2])))
      }

      // Neutral chroma: the source is greyscale, so there is nothing to encode.
      out.fill(128, ySize)

      let binary = ''
      for (let i = 0; i < out.length; i += 0x8000) {
        binary += String.fromCharCode(...out.subarray(i, i + 0x8000))
      }

      frames.push(btoa(binary))
    }

    return frames
  }, { dataUrls, width, height, fraction })
}

function writeY4m (path, base64Frames, width, height, fps) {
  const parts = [Buffer.from(`YUV4MPEG2 W${width} H${height} F${fps}:1 Ip A1:1 C420\n`, 'ascii')]

  for (const frame of base64Frames) {
    parts.push(Buffer.from('FRAME\n', 'ascii'), Buffer.from(frame, 'base64'))
  }

  writeFileSync(path, Buffer.concat(parts))
}

test.describe('the camera path', () => {
  test.skip(({ browserName }) => browserName !== 'chromium', 'only Chromium can be given a video file as its camera')
  test.describe.configure({ mode: 'serial' })

  test('scans an animated invite off a video feed and answers it', async ({ browser, baseURL }) => {
    test.setTimeout(180000)

    const shown = await browser.newPage()
    const workDir = mkdtempSync(join(tmpdir(), 'webrtc-qr-camera-'))
    const videoPath = join(workDir, 'invite.y4m')
    let cameraBrowser = null

    try {
      await shown.goto('/?ice=host')
      await shown.waitForFunction(() => typeof window.__libp2pQrTest?.createOfferPayload === 'function')
      await shown.locator('#start-client').click()
      await expect(shown.locator('#status')).toContainText('Browser client started')
      await shown.locator('#create-offer').click()
      await shown.locator('#invite-box[open]').waitFor({ timeout: 40000 })

      const invite = await shown.locator('#invite-link').inputValue()

      // Only worth running against the shape that failed in the field.
      expect(invite.length).toBeGreaterThan(600)
      await expect(shown.locator('#qr-frame')).toContainText(/Part \d+ of \d+/)

      // Sample what is actually on screen, so the video carries the app's own
      // frames rather than something a test re-encoded from the payload.
      const codes = await shown.evaluate(async () => {
        // The code is inside the element's shadow root now.
        const image = document.getElementById('qr-image').shadowRoot.querySelector('img')
        const seen = []

        for (let i = 0; i < 24; i++) {
          if (!seen.includes(image.src)) {
            seen.push(image.src)
          }

          await new Promise(resolve => setTimeout(resolve, 110))
        }

        return seen
      })

      expect(codes.length).toBeGreaterThan(1)

      const frames = await renderFramesToI420(shown, codes, FRAME_WIDTH, FRAME_HEIGHT, CODE_HEIGHT_FRACTION)
      const repeated = frames.flatMap(frame => Array.from({ length: FRAMES_PER_CODE }, () => frame))

      writeY4m(videoPath, repeated, FRAME_WIDTH, FRAME_HEIGHT, FPS)

      // A browser whose camera is that video. Chromium loops the file, so the
      // sequence repeats for as long as the scanner needs it.
      cameraBrowser = await chromium.launch({
        args: [
          '--use-fake-ui-for-media-stream',
          '--use-fake-device-for-media-stream',
          `--use-file-for-fake-video-capture=${videoPath}`
        ]
      })

      const scanner = await (await cameraBrowser.newContext({ baseURL })).newPage()
      const scannerErrors = []

      scanner.on('pageerror', error => scannerErrors.push(error.message))
      await scanner.goto('/?ice=host')
      await scanner.waitForFunction(() => typeof window.__libp2pQrTest?.createOfferPayload === 'function')
      await scanner.locator('#start-client').click()
      await expect(scanner.locator('#status')).toContainText('Browser client started')

      await scanner.locator('#scan-offer').click()
      await expect(scanner.locator('#scan-modal')).toBeVisible()

      // Parts arriving from a camera, not from a helper handing them over.
      await expect(scanner.locator('#scan-status')).toContainText(/Animated code: \d+ of \d+ parts/, {
        timeout: 60000
      })

      // The whole path: frames decoded, parts reassembled, signature verified,
      // and an answer produced - with the modal closing itself on the way.
      await expect(scanner.locator('#invite-box')).toBeVisible({ timeout: 90000 })
      await expect(scanner.locator('#scan-modal')).toBeHidden()

      const reply = await scanner.locator('#invite-link').inputValue()

      expect(reply).toMatch(/#r=/)

      // ...and it answers the peer whose code was on the video, rather than
      // being any well-formed reply at all.
      const answer = await scanner.evaluate(async link => {
        const payload = decodeURIComponent(new URL(link).hash.split('#r=')[1])

        return window.__libp2pQrTest.decodePayload(payload)
      }, reply)
      const shownPeerId = (await shown.locator('#peer-id').textContent()).trim()

      expect(answer.offerPeerId).toBe(shownPeerId)
      expect(answer.peerId).not.toBe(shownPeerId)
      expect(scannerErrors).toEqual([])
    } finally {
      await cameraBrowser?.close()
      await shown.close()
      rmSync(workDir, { recursive: true, force: true })
    }
  })

  test('a camera showing nothing scannable produces no answer', async ({ browser, baseURL }) => {
    test.setTimeout(120000)

    // Without this the test above would pass just as well if `#invite-box`
    // appeared for some reason that has nothing to do with the camera.
    const blank = await browser.newPage()
    const workDir = mkdtempSync(join(tmpdir(), 'webrtc-qr-camera-blank-'))
    const videoPath = join(workDir, 'blank.y4m')
    let cameraBrowser = null

    try {
      await blank.goto('/?ice=host')
      await blank.waitForFunction(() => typeof window.__libp2pQrTest?.createOfferPayload === 'function')

      // The same surround as the real feed, with no code on it.
      const empty = 'data:image/gif;base64,R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw=='
      const frames = await renderFramesToI420(blank, [empty], FRAME_WIDTH, FRAME_HEIGHT, 0)

      writeY4m(videoPath, frames, FRAME_WIDTH, FRAME_HEIGHT, FPS)

      cameraBrowser = await chromium.launch({
        args: [
          '--use-fake-ui-for-media-stream',
          '--use-fake-device-for-media-stream',
          `--use-file-for-fake-video-capture=${videoPath}`
        ]
      })

      const scanner = await (await cameraBrowser.newContext({ baseURL })).newPage()

      await scanner.goto('/?ice=host')
      await scanner.waitForFunction(() => typeof window.__libp2pQrTest?.createOfferPayload === 'function')
      await scanner.locator('#start-client').click()
      await expect(scanner.locator('#status')).toContainText('Browser client started')

      await scanner.locator('#scan-offer').click()
      await expect(scanner.locator('#scan-modal')).toBeVisible()

      // It keeps looking, and says so, rather than inventing something.
      await expect(scanner.locator('#scan-status')).toContainText(/Still looking/, { timeout: 30000 })
      await expect(scanner.locator('#invite-box')).toBeHidden()
    } finally {
      await cameraBrowser?.close()
      await blank.close()
      rmSync(workDir, { recursive: true, force: true })
    }
  })
})
