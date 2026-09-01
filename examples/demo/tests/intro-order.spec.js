import { expect, test } from '@playwright/test'

/**
 * The one decision, above the background reading.
 *
 * Appending the relay half put it last, behind four paragraphs of caveats - and
 * in the technical view that pushed the checkbox off the bottom of the dialog,
 * where somebody looking for it reported not finding it. Background reading can
 * be scrolled to; a control cannot be scrolled to by somebody who does not know
 * it is there.
 */

const mount = async page => {
  await page.goto('/?ice=host')
  await page.waitForFunction(() => document.getElementById('intro') != null)
  await page.evaluate(() => {
    const intro = document.getElementById('intro')
    intro.relay = { check: async () => ({ source: 'none', addresses: [], askedAleph: false }) }
    intro.technical = true
  })
}

test('the relay choice comes before the technical section', async ({ page }) => {
  await mount(page)

  const order = await page.evaluate(() => {
    const root = document.getElementById('intro').shadowRoot
    const main = root.querySelector('.body > div')
    return [...main.children].map(node => node.className)
  })

  const ways = order.indexOf('ways')
  const tech = order.indexOf('tech')

  expect(ways).toBeGreaterThan(-1)
  expect(tech).toBeGreaterThan(-1)
  expect(ways).toBeLessThan(tech)
})
