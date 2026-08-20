import { expect, test } from '@playwright/test'

/**
 * The half of the backgrounding problem a wake lock cannot reach.
 *
 * A wake lock holds the screen, and only while the page is visible, so it does
 * nothing for the case that actually kills invites: leaving for a messenger,
 * where the browser suspends the page and closes the peer connection without
 * firing anything. A page that is playing audio is not a page Chromium freezes.
 *
 * `wanted` is asserted, never `running` - the same split `wake-lock.spec.js`
 * makes, and the first version of this file got it wrong. Whether audio truly
 * plays depends on an audio stack rather than on this code: it runs in Firefox
 * on a desktop and not in the CI container, which is a fact about the machine.
 * What is ours to get right is that a start is attempted inside the gesture and
 * given up when the code leaves the screen.
 *
 * Whether audio then survives an app switch on Android is a claim about Android
 * that no headless browser can make. That experiment lives in AGENTS.md and
 * needs two phones.
 */

const keepAlive = page => page.evaluate(() => window.__libp2pQrTest.keepAliveState())

const startPeer = async page => {
  await page.goto('/?ice=host&view=technical&intro=off')
  await page.locator('#start-client').click()
  await page.waitForFunction(() => document.getElementById('peer-id').textContent !== 'not started')
}

test.describe('keep-alive audio', () => {
  test('is not wanted on an idle started peer', async ({ page }) => {
    await startPeer(page)

    // Nothing is waiting for an answer, so nothing needs protecting from a
    // suspension that would not cost anything.
    expect((await keepAlive(page)).wanted).toBe(false)
  })

  test('is wanted while an invite waits, and given up when it closes', async ({ page }) => {
    await startPeer(page)
    await page.locator('#create-offer').click()
    await expect(page.locator('#invite-box')).toBeVisible({ timeout: 60000 })

    // The window the whole feature exists for: a code on screen, nobody has
    // replied, and the next thing this person does is leave for a messenger.
    expect((await keepAlive(page)).wanted).toBe(true)

    await page.locator('#invite-box [data-close-modal]').first().click()
    await expect(page.locator('#invite-box')).toBeHidden()

    // Audio still playing afterwards holds the CPU awake for nothing and tells
    // the user the app is working on something it finished.
    expect((await keepAlive(page)).wanted).toBe(false)
  })

  test('is wanted from the gesture, before the invite appears', async ({ page }) => {
    await startPeer(page)

    // The distinction is the whole reason this is wired where it is: an
    // AudioContext resumed outside a user gesture is refused, and by the time
    // ICE has gathered and the box is visible there is no gesture left. So the
    // attempt has to happen before the invite shows, not after.
    await page.locator('#create-offer').click()
    expect((await keepAlive(page)).wanted).toBe(true)
    await expect(page.locator('#invite-box')).toBeVisible({ timeout: 60000 })
  })
})
