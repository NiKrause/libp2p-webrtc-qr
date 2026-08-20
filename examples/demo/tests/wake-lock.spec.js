import { chromium, expect, test } from '@playwright/test'

/**
 * The screen stays lit through the whole connect-critical window, not only once
 * a connection exists.
 *
 * The moment it matters most is the one with no connection yet: two phones held
 * up to scan, and the phone showing the code sitting untouched while the other
 * lines up the shot. A screen that sleeps there drops the code mid-scan. So the
 * lock now follows scanning and a displayed invite as well as a live connection.
 *
 * `wanted` is asserted, never `held`: a headless browser exposes the wake-lock
 * API and then refuses every request, having no screen to keep awake, so `held`
 * would be a claim about the platform rather than about this code.
 */

const wanted = page => page.evaluate(() => window.__libp2pQrTest.wakeLockState().wanted)

const startPeer = async page => {
  await page.goto('/?ice=host&view=technical&intro=off')
  await page.locator('#start-client').click()
  await page.waitForFunction(() => document.getElementById('peer-id').textContent !== 'not started')
}

test.describe('wake lock', () => {
  test('is not wanted on an idle started peer', async ({ page }) => {
    await startPeer(page)

    // Nothing to protect: no code shown, no camera, no connection. A lock held
    // here is a phone kept awake for no reason.
    expect(await wanted(page)).toBe(false)
  })

  test('is wanted while an invite is on screen, and dropped when it closes', async ({ page }) => {
    await startPeer(page)
    await page.locator('#create-offer').click()
    await expect(page.locator('#invite-box')).toBeVisible({ timeout: 60000 })

    // The QR code is showing and the other person has not scanned yet — exactly
    // the window a sleeping screen used to break.
    await expect.poll(() => wanted(page), { timeout: 5000 }).toBe(true)

    await page.locator('#invite-box [data-close-modal]').click()
    await expect(page.locator('#invite-box')).toBeHidden()

    // Closed with no connection behind it, so the screen may sleep again.
    await expect.poll(() => wanted(page), { timeout: 5000 }).toBe(false)
  })
})

test.describe('wake lock while scanning', () => {
  test('is wanted while the scanner runs, and dropped when it closes', async ({ browserName, baseURL }) => {
    test.skip(browserName !== 'chromium', 'only Chromium can be given a fake camera device')

    // A generated pattern is enough here: the test is about the scanner being
    // open, not about decoding anything from it.
    const browser = await chromium.launch({
      args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream']
    })

    try {
      const page = await (await browser.newContext({ baseURL })).newPage()

      await page.goto('/?ice=host&view=technical&intro=off')
      await page.locator('#start-client').click()
      await page.waitForFunction(() => document.getElementById('peer-id').textContent !== 'not started')

      expect(await wanted(page)).toBe(false)

      await page.locator('#scan-offer').click()
      await expect.poll(() => wanted(page), { timeout: 10000 }).toBe(true)

      // Escape closes the scanner dialog, which releases the camera and, with
      // nothing else needing it lit, the lock.
      await page.keyboard.press('Escape')
      await expect.poll(() => wanted(page), { timeout: 5000 }).toBe(false)
    } finally {
      await browser.close()
    }
  })
})
