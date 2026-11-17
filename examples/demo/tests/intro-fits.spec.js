import { expect, test } from '@playwright/test'

/**
 * The dialog fits the window it is in - all of it, frame included.
 *
 * Its height was capped at the viewport minus 2rem, which looked right and was
 * not: the cap applied to the content box, so the padding and the border came
 * on top. 42px more than the cap, and at a window 800px high the dialog ran 5px
 * past the top and the bottom, its foot - the close control, "do not show
 * again", a consumer's own button - with it. Found by a consumer at 1512x800,
 * an ordinary laptop window (2026-11-17).
 *
 * Measured with everything there is to show: the technical view, the relay
 * half and a statement with an acceptance tick, so the body has to scroll.
 */

const SIZES = [
  { width: 1512, height: 800 },
  { width: 390, height: 844 },
  { width: 360, height: 640 }
]

for (const viewport of SIZES) {
  test(`fits a ${viewport.width}x${viewport.height} window, frame and foot included`, async ({ page }) => {
    await page.setViewportSize(viewport)
    await page.goto('/?ice=host')
    await page.waitForFunction(() => document.getElementById('intro')?.isOpen === true)
    await page.evaluate(() => {
      const intro = document.getElementById('intro')
      intro.relay = { check: async () => ({ source: 'none', addresses: [], askedAleph: false }) }
      intro.privacy = {
        accept: true,
        clauses: () => Array.from({ length: 12 }, (_, i) => `Clause ${i + 1}: long enough to wrap onto a second line in a narrow column.`)
      }
      intro.technical = true
    })

    const box = await page.evaluate(() => {
      const root = document.getElementById('intro').shadowRoot
      const rect = el => {
        const r = el.getBoundingClientRect()
        return { top: r.top, bottom: r.bottom, left: r.left, right: r.right }
      }
      const body = root.querySelector('.body')
      return {
        dialog: rect(root.querySelector('dialog')),
        foot: rect(root.querySelector('.foot')),
        scrolls: body.scrollHeight > body.clientHeight,
        height: window.innerHeight,
        width: document.documentElement.clientWidth
      }
    })

    // The case this is about: too much to show, so the cap is what holds.
    expect(box.scrolls).toBe(true)
    expect(box.dialog.top).toBeGreaterThanOrEqual(0)
    expect(box.dialog.bottom).toBeLessThanOrEqual(box.height)
    expect(box.foot.bottom).toBeLessThanOrEqual(box.height)
    expect(box.dialog.left).toBeGreaterThanOrEqual(0)
    expect(box.dialog.right).toBeLessThanOrEqual(box.width)
  })
}
