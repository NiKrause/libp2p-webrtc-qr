import { expect, test } from '@playwright/test'

/**
 * The half of the backgrounding problem a wake lock cannot reach.
 *
 * A wake lock holds the screen, and only while the page is visible, so it does
 * nothing for the case that actually kills invites: leaving for a messenger,
 * where the browser suspends the page and closes the peer connection without
 * firing anything. A page that is playing audio is not a page Chromium freezes.
 *
 * What is asserted here is the *wiring* - that a start is attempted inside the
 * gesture and that it stops when the code leaves the screen. Whether audio
 * genuinely survives an app switch on Android is a claim about Android, and no
 * headless browser can make it; that experiment lives in AGENTS.md and needs
 * two phones.
 *
 * `audible` is deliberately not asserted. Playwright's Chromium ships without
 * proprietary codecs, so the MP3 does not decode and the near-silent buffer is
 * used instead - which is the keep-alive working, not failing.
 */

const keepAlive = page => page.evaluate(() => window.__libp2pQrTest.keepAliveState())

const startPeer = async page => {
  await page.goto('/?ice=host')
  await page.locator('#start-client').click()
  await page.waitForFunction(() => document.getElementById('peer-id').textContent !== 'not started')
}

test.describe('keep-alive audio', () => {
  test('is not running on an idle started peer', async ({ page }) => {
    await startPeer(page)

    // Nothing is waiting for an answer, so nothing needs protecting from a
    // suspension that is not going to cost anything.
    expect((await keepAlive(page)).running).toBe(false)
  })

  test('runs while an invite waits, and stops when the invite closes', async ({ page }) => {
    await startPeer(page)
    await page.locator('#create-offer').click()
    await expect(page.locator('#invite-box')).toBeVisible({ timeout: 60000 })

    // Polled, not read once, and the reason is worth knowing: `start()` resumes
    // the AudioContext inside the gesture but only reports `running` once the
    // track has been fetched and decoded. With `?ice=host` the invite appears
    // almost immediately, so it beats the audio to the screen every time.
    await expect.poll(async () => (await keepAlive(page)).running, { timeout: 15000 }).toBe(true)

    await page.locator('#invite-box [data-close-modal]').first().click()
    await expect(page.locator('#invite-box')).toBeHidden()

    // Audio still playing afterwards holds the CPU awake for nothing and tells
    // the user the app is working on something it finished.
    await expect.poll(async () => (await keepAlive(page)).running).toBe(false)
  })

  test('starts from the gesture, not from the invite appearing', async ({ page }) => {
    await startPeer(page)

    // The distinction is the whole reason this is wired where it is: an
    // AudioContext resumed outside a user gesture is refused, and by the time
    // ICE has gathered and the box is visible there is no gesture left. So it
    // has to be running before the invite shows, not after.
    await page.locator('#create-offer').click()
    await expect.poll(async () => (await keepAlive(page)).running, { timeout: 15000 }).toBe(true)
    await expect(page.locator('#invite-box')).toBeVisible({ timeout: 60000 })
  })
})
