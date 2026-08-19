import { expect, test } from '@playwright/test'

import { VIEW_MODE_STORAGE_KEY } from '../view-mode.js'

/**
 * A switch, not a deletion.
 *
 * The page serves two readers: somebody who wants to show a code to the person
 * next to them, and somebody checking that libp2p came up. Both are worth
 * keeping and only one of them should be met at the door - so nothing is
 * removed, it is moved behind one labelled door, and the default is the gentler
 * side.
 *
 * The load-bearing case is the last one here: hiding step 1 hides the button
 * that starts the peer, so the simple view has to start it from the button that
 * is actually on screen. Without that, the only control a first-time visitor
 * can see is disabled forever.
 */

const open = async (page, mode) => {
  if (mode != null) {
    await page.addInitScript(([key, value]) => {
      localStorage.setItem(key, value)
    }, [VIEW_MODE_STORAGE_KEY, String(mode === 'simple')])
  }

  await page.goto('/?ice=host')
}

test.describe('simple and technical', () => {
  test('starts simple, with the technical panels away', async ({ page }) => {
    await open(page)

    await expect(page.locator('#view-mode')).toHaveValue('simple')
    await expect(page.locator('#step-start')).toBeHidden()
    // The thing somebody came to do is still there.
    await expect(page.locator('#create-offer')).toBeVisible()
  })

  test('the technical view brings them back rather than adding something new', async ({ page }) => {
    await open(page)
    await page.locator('#view-mode').selectOption('technical')

    await expect(page.locator('#step-start')).toBeVisible()
    await expect(page.locator('#peer-id')).toBeVisible()
  })

  test('the choice survives a reload', async ({ page }) => {
    await open(page)
    await page.locator('#view-mode').selectOption('technical')
    await page.reload()

    await expect(page.locator('#view-mode')).toHaveValue('technical')
    await expect(page.locator('#step-start')).toBeVisible()
  })

  test('the switch speaks the chosen language', async ({ page }) => {
    await open(page)
    await page.locator('#locale').selectOption('de')

    await expect(page.locator('#view-mode option').first()).toHaveText('Einfach')
  })

  test('the simple view starts the peer from the button it does show', async ({ page }) => {
    await open(page, 'simple')

    // Step 1 is hidden, so nothing has been "started" in the sense the
    // technical view means. The button still has to work.
    await expect(page.locator('#step-start')).toBeHidden()
    await page.locator('#create-offer').click()

    await expect(page.locator('#invite-box')).toBeVisible({ timeout: 60000 })
    await expect(page.locator('qr-invite')).toBeVisible()
  })

  test('chat stays and the protocol trace goes', async ({ page }) => {
    await open(page, 'technical')
    // The technical view keeps the two steps apart on purpose, so this is the
    // path it actually offers: start, then invite. Only the simple view folds
    // the first into the second.
    await page.locator('#start-client').click()
    await page.waitForFunction(() => document.getElementById('peer-id').textContent !== 'not started')
    await page.locator('#create-offer').click()
    await expect(page.locator('#invite-box')).toBeVisible({ timeout: 60000 })

    // Both live in one box, so this cannot be done by hiding the box: that
    // would take the conversation with it, which is what the simple view is for.
    const trace = page.locator('#chat-log div[data-view="technical"]')
    await expect(trace.first()).toBeVisible()

    await page.locator('#view-mode').selectOption('simple')
    await expect(trace.first()).toBeHidden()
  })
})
