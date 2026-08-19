import { expect, test } from '@playwright/test'

/**
 * The library's translation seam, exercised by the library's own example.
 *
 * The seam was the headline of 0.7.0 and `AGENTS.md` has said since that
 * anything visible must be translatable - and the demo, the reference consumer,
 * set `strings` exactly zero times. So all four elements showed English
 * defaults to everyone, and nothing here proved the seam worked end to end.
 *
 * These assert on **rendered text**, not on which table was assigned. A test
 * that checked the assignment would pass while the element ignored it.
 */

const open = async (page, query = '') => {
  await page.goto(`/?ice=host${query}`)
  await page.locator('#start-client').click()
  await page.waitForFunction(() => document.getElementById('peer-id').textContent !== 'not started')
}

test.describe('language', () => {
  test('starts in English and says so in the document', async ({ page }) => {
    await open(page)

    await expect(page.locator('#locale')).toHaveValue('en')
    await expect(page.locator('html')).toHaveAttribute('lang', 'en')
  })

  test('German reaches inside the elements, not just the page around them', async ({ page }) => {
    await open(page)
    await page.locator('#locale').selectOption('de')

    // The readiness panel is a custom element with a shadow root, so this is the
    // library's own text rather than anything this page wrote.
    const panel = page.locator('#network-state')
    await expect(panel).toContainText('Ergebnis')
    await expect(panel).not.toContainText('Result')

    await expect(page.locator('html')).toHaveAttribute('lang', 'de')
  })

  test('the choice survives a reload', async ({ page }) => {
    await open(page)
    await page.locator('#locale').selectOption('de')

    await page.reload()
    await page.waitForSelector('#locale')

    // Reaching for the switch is a decision, and making somebody repeat it on
    // every visit is how a language switch becomes a thing nobody uses.
    await expect(page.locator('#locale')).toHaveValue('de')
    await expect(page.locator('html')).toHaveAttribute('lang', 'de')
  })

  test('switching back to English restores the English text', async ({ page }) => {
    await open(page)
    await page.locator('#locale').selectOption('de')
    await expect(page.locator('#network-state')).toContainText('Ergebnis')

    await page.locator('#locale').selectOption('en')

    // `mergeStrings` folds over defaults rather than replacing them, so a switch
    // back has to put every entry back - not merely stop overriding.
    await expect(page.locator('#network-state')).toContainText('Result')
    await expect(page.locator('#network-state')).not.toContainText('Ergebnis')
  })
})
