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

  test('is not wanted merely because a code is on screen', async ({ page }) => {
    await startPeer(page)
    await page.locator('#create-offer').click()
    await expect(page.locator('#invite-box')).toBeVisible({ timeout: 60000 })

    // Holding a code up to somebody's camera never leaves the app, and that is
    // the flow this page is named after. It used to start on this click, which
    // meant a minute of opera to show a QR code.
    expect((await keepAlive(page)).wanted).toBe(false)
  })

  test('is wanted from the gesture that takes the link away', async ({ page }) => {
    // The share sheet is what a phone offers; forced on here rather than waited
    // for, because whether the engine has one is not the subject.
    await page.addInitScript(() => { navigator.share = async () => {} })
    await startPeer(page)
    await page.locator('#create-offer').click()
    await expect(page.locator('#invite-box')).toBeVisible({ timeout: 60000 })

    await page.locator('#copy-payload').click()

    // Inside that click, and nowhere later: an AudioContext resumed outside a
    // gesture is refused, so there is no second chance after the await.
    expect((await keepAlive(page)).wanted).toBe(true)
  })

  test('and from the Copy button, which is the other way out', async ({ page, context, browserName }) => {
    test.skip(browserName !== 'chromium', 'clipboard permissions are Chromium-only in Playwright')
    await context.grantPermissions(['clipboard-read', 'clipboard-write'])

    await startPeer(page)
    await page.locator('#create-offer').click()
    await expect(page.locator('#invite-box')).toBeVisible({ timeout: 60000 })

    // On a phone whose browser has no share sheet this is the only way out, so
    // it has to arm the same protection the share button does.
    await page.locator('.invite-link-fallback summary').click()
    await page.locator('#copy-link').click()

    expect((await keepAlive(page)).wanted).toBe(true)
  })

  test('is given up when the code leaves the screen', async ({ page }) => {
    await page.addInitScript(() => { navigator.share = async () => {} })
    await startPeer(page)
    await page.locator('#create-offer').click()
    await expect(page.locator('#invite-box')).toBeVisible({ timeout: 60000 })
    await page.locator('#copy-payload').click()
    expect((await keepAlive(page)).wanted).toBe(true)

    await page.locator('#invite-box [data-close-modal]').first().click()
    await expect(page.locator('#invite-box')).toBeHidden()

    // Audio still playing afterwards holds the CPU awake for nothing and tells
    // the user the app is working on something it finished.
    expect((await keepAlive(page)).wanted).toBe(false)
  })
})
