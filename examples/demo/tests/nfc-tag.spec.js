import { expect, test } from '@playwright/test'

/**
 * Reading an invite off an NFC tag - the read half of #152.
 *
 * The issue guessed this could not be covered, "no fake NFC radio the way there
 * is a fake camera". Half right: the radio cannot be faked, but `NDEFReader` is
 * an ordinary global constructor, and the wiring - feature detection, the
 * permission path, and above all that a tag feeds the same verification as a
 * scanned code - is exactly what these drive. What stays untested is physics.
 */

const APP = '/?ice=host&view=technical&intro=off'

/** A stand-in NDEFReader the test can tap tags against. */
const withFakeNfc = page => page.addInitScript(() => {
  const instances = []

  window.NDEFReader = class extends EventTarget {
    async scan () { instances.push(this) }
  }

  window.__nfcTap = text => {
    const reader = instances.at(-1)

    if (reader == null) throw new Error('nothing is listening')

    const event = new Event('reading')

    event.message = { records: [{ recordType: 'url', data: new TextEncoder().encode(text) }] }
    reader.dispatchEvent(event)
  }
})

test.describe('reading a tag', () => {
  test('the button is not there in a browser without Web NFC', async ({ page }) => {
    // Desktop Chromium has no NDEFReader, which makes it the honest fixture for
    // most of the world: iOS, Firefox, desktop Chrome.
    await page.goto(APP)
    await page.locator('#start-client').click()

    await expect(page.locator('#read-tag')).toBeHidden()
  })

  test('a tapped invite goes down the same path as a scanned one', async ({ browser, baseURL }) => {
    const alice = await (await browser.newContext({ baseURL })).newPage()
    const bobContext = await browser.newContext({ baseURL })
    const bob = await bobContext.newPage()

    await withFakeNfc(bob)

    await alice.goto(APP)
    await alice.locator('#start-client').click()
    await alice.waitForFunction(() => document.getElementById('peer-id').textContent !== 'not started')

    await bob.goto(APP)
    await bob.locator('#logbook-enabled').check()
    await bob.locator('#start-client').click()
    await bob.waitForFunction(() => document.getElementById('peer-id').textContent !== 'not started')

    await alice.locator('#create-offer').click()
    await expect(alice.locator('#invite-box')).toBeVisible({ timeout: 60000 })
    const invite = await alice.locator('#invite-link').inputValue()

    // The tag at the door: the invite link, delivered by touch.
    await bob.locator('#read-tag').click()
    await expect(bob.locator('#read-tag')).toContainText(/listening/i)
    await bob.evaluate(text => window.__nfcTap(text), invite)

    // The reply appears exactly as it would after a camera scan - same seam,
    // same verification, and the listener has stopped itself.
    await expect(bob.locator('#invite-link')).toHaveValue(/#r=/, { timeout: 60000 })
    await expect(bob.locator('#read-tag')).not.toContainText(/listening/i)

    // Close the loop, so the logbook entry ends as connected rather than open.
    const reply = await bob.locator('#invite-link').inputValue()
    await alice.locator('#paste-reply').click()
    await alice.locator('#payload-display').fill(reply)
    await alice.locator('#process-payload').click()
    await expect(alice.locator('#send')).toBeEnabled({ timeout: 60000 })

    // The carrier says how the offer arrived, which is the row of the matrix
    // this feature adds.
    await expect.poll(async () => {
      const entries = await bob.evaluate(() => JSON.parse(localStorage.getItem('webrtc-qr.logbook.v1') ?? '[]'))
      return entries[0]?.carrier
    }, { timeout: 30000 }).toBe('tag')

    await alice.close()
    await bobContext.close()
  })

  test('a tag that fails verification fails like a bad code, not silently', async ({ page }) => {
    await withFakeNfc(page)
    await page.goto(APP)
    await page.locator('#start-client').click()
    await page.waitForFunction(() => document.getElementById('peer-id').textContent !== 'not started')

    await page.locator('#read-tag').click()
    await page.evaluate(() => window.__nfcTap('https://example.org/#i=q3:not-a-real-payload'))

    // The same failure surface as every other carrier: a status with a reason.
    await expect(page.locator('#status')).toContainText(/could not|failed|cannot/i, { timeout: 30000 })
  })
})
