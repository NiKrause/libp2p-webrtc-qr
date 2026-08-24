import { expect, test } from '@playwright/test'

/**
 * What happens when there is no camera - which is most of what happens.
 *
 * `camera.spec.js` covers the working path thoroughly: it renders the invite to
 * a video file, hands it to Chromium as a capture device, and asserts the whole
 * chain through to an answer. What it cannot cover is *getting* a camera, because
 * it is given one by a launch flag and permission is granted by another. Every
 * way that step fails - refused, no device, another app holding it, a page served
 * over plain http - was therefore invisible to the suite.
 *
 * That is the gap this fills, and it needs no device at all: `getUserMedia` is
 * replaced, so it runs on all three engines and asserts the thing a person
 * actually meets.
 *
 * The report behind it: "Bob presses Scan their code and nothing happens." The
 * dialog opened and closed within half a second, and the only explanation went
 * to a status line in a different card further down the page.
 */

/**
 * Replaced after the page has loaded, not in an init script.
 *
 * The element reads `navigator.mediaDevices` when the button is pressed, so
 * stubbing it here is early enough - and it removes a race that showed up as a
 * flake on WebKit under load: an init script that lands late leaves the *real*
 * `getUserMedia` in place, and on a machine with a camera that opens a
 * permission prompt nobody answers, so the dialog sits on "Starting the
 * camera…" until the assertion times out.
 */
const refuse = async (page, name) => {
  await page.evaluate(reason => {
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: {
        getUserMedia: async () => {
          const error = new Error('denied by the test')
          error.name = reason
          throw error
        }
      }
    })
  }, name)

  // Asserted rather than assumed: a stub that silently did not take would fail
  // some other assertion later and look like a flake, which is exactly what it
  // did before this line existed.
  expect(await page.evaluate(() => navigator.mediaDevices.getUserMedia.toString().includes('denied by the test')))
    .toBe(true)
}

const load = async page => {
  await page.goto('/?ice=host&view=technical&intro=off')
  await page.locator('#start-client').click()
  await page.waitForFunction(() => document.getElementById('peer-id').textContent !== 'not started')
}

const scan = page => page.locator('#scan-offer').click()

test.describe('a camera that will not open', () => {
  test('leaves the dialog up and says the camera was refused', async ({ page }) => {
    await load(page)
    await refuse(page, 'NotAllowedError')
    await scan(page)

    // The dialog stays. Closing it took away the one surface that could
    // explain, half a second after it appeared.
    await expect(page.locator('qr-scanner dialog')).toBeVisible()
    await expect(page.locator('qr-scanner p')).toContainText('refused')
    // And says what to do instead, because the other way in needs no camera.
    await expect(page.locator('qr-scanner p')).toContainText('link')
  })

  test('says which failure it was when no device answers', async ({ page }) => {
    await load(page)
    await refuse(page, 'NotFoundError')
    await scan(page)

    await expect(page.locator('qr-scanner dialog')).toBeVisible()
    await expect(page.locator('qr-scanner p')).toContainText('No camera answered')
  })

  test('blames the address, not the browser, on an insecure page', async ({ page }) => {
    // `mediaDevices` is simply absent on an insecure origin - which is how
    // anybody testing two devices over a LAN address meets it. Saying "this
    // browser cannot open a camera" sends them to change browsers over a page
    // that works at the same address under https.
    await load(page)

    // Refused as well as insecure, though only the first should be reached.
    // Without it, an override that failed to take would fall through to the
    // real camera and sit on a permission prompt until the assertion times out
    // - a hang that reads as a flake instead of naming itself. With it, the
    // worst case is a wrong message, which is a failure that says what it is.
    await refuse(page, 'NotAllowedError')
    await page.evaluate(() => {
      Object.defineProperty(window, 'isSecureContext', { configurable: true, value: false })
    })
    expect(await page.evaluate(() => window.isSecureContext), 'the override did not take').toBe(false)

    await scan(page)

    await expect(page.locator('qr-scanner dialog')).toBeVisible()
    await expect(page.locator('qr-scanner p')).toContainText('secure page')
    await expect(page.locator('qr-scanner p')).toContainText('https')
  })

  test('the way out is still the close button', async ({ page }) => {
    await load(page)
    await refuse(page, 'NotAllowedError')
    await scan(page)

    await expect(page.locator('qr-scanner dialog')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.locator('qr-scanner dialog')).toBeHidden()
  })
})
