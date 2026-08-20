import { expect, test } from '@playwright/test'

/**
 * The introduction, and the rule about when somebody gets one.
 *
 * The element and its policy are the library's and are covered there. What is
 * asserted here is the wiring: that this demo's own story reaches the slot,
 * that the caveats follow the view switch, and - the case worth having a test
 * for - that somebody arriving by invite is not shown a dialog in front of the
 * only thing they came to do.
 */

const open = async (page, url = '/?ice=host') => {
  await page.goto(url)
  await page.waitForFunction(() => document.getElementById('intro') != null)
}

const isOpen = page => page.evaluate(() => document.getElementById('intro').isOpen)

test.describe('the introduction', () => {
  test('greets a first visit with this demo\'s own words', async ({ page }) => {
    await open(page)

    expect(await isOpen(page)).toBe(true)
    // Light DOM, through the slot: the story is the app's half.
    await expect(page.locator('qr-intro p').first()).toContainText('directly')
  })

  test('does not stand in front of somebody who arrived by invite', async ({ page }) => {
    // That person came to accept something. They get it on their next plain
    // visit instead - so this must not count as having seen it either.
    await open(page, '/?ice=host#i=whatever')
    expect(await isOpen(page)).toBe(false)

    await open(page)
    expect(await isOpen(page)).toBe(true)
  })

  test('remembers being dismissed, and only when asked to', async ({ page }) => {
    await open(page)
    await page.evaluate(() => document.getElementById('intro').close())

    await open(page)
    expect(await isOpen(page)).toBe(true)

    await page.evaluate(() => {
      const intro = document.getElementById('intro')
      intro.shadowRoot.querySelector('input[type=checkbox]').checked = true
      intro.close()
    })

    await open(page)
    expect(await isOpen(page)).toBe(false)
  })

  test('the caveats follow the view switch', async ({ page }) => {
    await open(page)
    await expect(page.locator('qr-intro .tech')).toBeHidden()

    await page.evaluate(() => document.getElementById('intro').close())
    await page.locator('#view-mode').selectOption('technical')
    await page.evaluate(() => document.getElementById('intro').open())

    await expect(page.locator('qr-intro .tech')).toBeVisible()
  })

  test('speaks the chosen language, story and caveats alike', async ({ page }) => {
    await open(page)
    await page.evaluate(() => document.getElementById('intro').close())
    await page.locator('#locale').selectOption('de')
    await page.locator('#view-mode').selectOption('technical')
    await page.evaluate(() => document.getElementById('intro').open())

    // The story is this demo's, the heading is the library's - both have to turn.
    await expect(page.locator('qr-intro p').first()).toContainText('Browser verbinden sich direkt')
    await expect(page.locator('qr-intro h2')).toHaveText('Bevor Sie anfangen')
  })
})
