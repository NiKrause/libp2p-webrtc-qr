import { expect, test } from '@playwright/test'

/**
 * Urgency where it is true, silence where it is not.
 *
 * Field result from two Android phones, Chrome and DuckDuckGo: the handover
 * through a messenger works, provided you come back within a couple of seconds.
 * That is not a rule anyone can guess, and it is not a rule that applies to a
 * desktop, where a background tab keeps running and none of this happens.
 *
 * So the sentence goes next to the button that sends someone away - the last
 * moment it can still be acted on - and only on the devices where leaving costs
 * something. False urgency is how people learn to ignore a warning.
 */

const APP = '/?ice=host'

const createInvite = async page => {
  await page.locator('#start-client').click()
  await page.locator('#create-offer').click()
  await expect(page.locator('#invite-box')).toBeVisible({ timeout: 60000 })
  await expect.poll(() => page.locator('#invite-link').inputValue(), { timeout: 60000 }).toMatch(/#i=/)
}

/** What a phone answers. Playwright's mobile presets set exactly this pair. */
const asPhone = page => page.addInitScript(() => {
  const real = window.matchMedia.bind(window)

  window.matchMedia = query => query.includes('hover: none')
    ? { matches: true, media: query, addEventListener () {}, removeEventListener () {} }
    : real(query)
})

test.describe('come straight back', () => {
  test('a phone is told, at the moment it can still act', async ({ context }) => {
    const page = await context.newPage()

    await asPhone(page)
    await page.goto(APP)
    await createInvite(page)

    // Nothing before the tap: the invite is on screen and nobody is leaving.
    await expect(page.locator('#hurry-back')).toBeHidden()

    await page.locator('#copy-payload').click()

    await expect(page.locator('#hurry-back')).toBeVisible()
    await expect(page.locator('#hurry-back')).toContainText(/within seconds/i)

    await page.close()
  })

  test('a desktop is not, and does not even carry the sentence', async ({ page }) => {
    await page.goto(APP)
    await createInvite(page)
    await page.locator('#copy-payload').click()

    await expect(page.locator('#hurry-back')).toBeHidden()

    // Empty, not merely hidden: a screen reader should not find advice that is
    // false here, and `hidden` alone would leave it in the accessibility tree
    // of anything that ignores the attribute.
    expect(await page.locator('#hurry-back').textContent()).toBe('')

    await page.close()
  })

  // The status-line wording is deliberately not asserted: it only differs on
  // the clipboard path, and a headless browser will not write to a clipboard
  // without permissions that vary by engine. The visible hint above is the
  // guarantee, and it needs no such machinery.
})

test.describe('what the warning is based on', () => {
  test('says nothing after an absence the connection survived', async ({ page }) => {
    await page.goto(APP)
    await createInvite(page)

    await page.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true })
      document.dispatchEvent(new Event('visibilitychange'))
      Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true })
      document.dispatchEvent(new Event('visibilitychange'))
    })

    // The old rule fired on elapsed time and would have cried wolf here. This
    // one asks the connection, and the connection is fine.
    await expect(page.locator('#handoff-banner')).toBeHidden()
  })

  test('says so after an absence it did not survive, however short', async ({ page }) => {
    await page.goto(APP)
    await createInvite(page)

    await page.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true })
      document.dispatchEvent(new Event('visibilitychange'))
      // What a phone does within a couple of seconds - far inside any duration
      // rule, which is exactly why the duration rule was the wrong question.
      window.__libp2pQrTest.simulateSuspension()
      Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true })
      document.dispatchEvent(new Event('visibilitychange'))
    })

    await expect(page.locator('#handoff-banner')).toBeVisible()
    await expect(page.locator('#handoff-banner')).toContainText(/did not survive/i)
    await expect(page.locator('#handoff-banner')).toContainText(/make a new invite/i)
  })
})
