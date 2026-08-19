import { expect, test } from '@playwright/test'

/**
 * Each browser gets its own tint, so a tray full of the same page open six ways
 * is not a guessing game. These check the detection end to end: a real user
 * agent goes in through the context, and the tint that comes out is read off the
 * root element - the same path the app runs on load.
 *
 * Detection is best-effort by nature (user agents lie, every Chromium fork says
 * "Chrome"), so this pins the cases that must not regress rather than claiming
 * to identify every browser that exists.
 */

const CASES = [
  ['Chrome on Android', 'chrome', 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36'],
  ['Chrome on iOS (CriOS)', 'chrome', 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/120.0 Mobile/15E148 Safari/604.1'],
  ['Firefox on Android', 'firefox', 'Mozilla/5.0 (Android 13; Mobile; rv:120.0) Gecko/120.0 Firefox/120.0'],
  ['Safari on iOS', 'safari', 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'],
  ['Opera', 'opera', 'Mozilla/5.0 (Linux; Android 10) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36 OPR/106.0.0.0'],
  ['Edge', 'edge', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0'],
  // DuckDuckGo names itself on both platforms. Real strings, because the
  // Android one carries "Chrome" and the iOS one carries "Safari" - so this is
  // also the check that the ordering above them is right.
  ['DuckDuckGo on iOS', 'ddg', 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 DuckDuckGo/7 Safari/605.1.15'],
  ['DuckDuckGo on Android', 'ddg', 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/130.0.6723.106 Mobile DuckDuckGo/5 Safari/537.36'],
  ['DuckDuckGo on Android with Lilo', 'ddg', 'Mozilla/5.0 (Linux; Android 10) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/117.0.0.0 Mobile DuckDuckGo/1 Lilo/1.2.3 Safari/537.36']
]

const tintOf = page => page.evaluate(() =>
  getComputedStyle(document.documentElement).getPropertyValue('--tint-h').trim())

test.describe('per-browser tint', () => {
  for (const [label, expected, userAgent] of CASES) {
    test(`reads ${expected} from ${label}`, async ({ browser, baseURL }) => {
      const context = await browser.newContext({ userAgent, baseURL })
      const page = await context.newPage()

      await page.goto('/?ice=host&view=technical')
      await expect.poll(() => page.evaluate(() => document.documentElement.dataset.browser)).toBe(expected)

      await context.close()
    })
  }

  test('Brave is taken from its API, not its Chrome user agent', async ({ browser, baseURL }) => {
    const context = await browser.newContext({ baseURL })

    // Brave ships a plain Chrome UA and exposes itself only here.
    await context.addInitScript(() => {
      Object.defineProperty(navigator, 'brave', { value: { isBrave: () => Promise.resolve(true) }, configurable: true })
    })

    const page = await context.newPage()

    await page.goto('/?ice=host&view=technical')
    await expect.poll(() => page.evaluate(() => document.documentElement.dataset.browser)).toBe('brave')

    await context.close()
  })

  test('the tint actually changes with the browser', async ({ browser, baseURL }) => {
    const read = async userAgent => {
      const context = await browser.newContext({ userAgent, baseURL })
      const page = await context.newPage()

      await page.goto('/?ice=host&view=technical')
      await expect.poll(() => page.evaluate(() => document.documentElement.dataset.browser)).not.toBe('')
      const tint = await tintOf(page)

      await context.close()

      return tint
    }

    // Two browsers, two hues - the mapping is real, not just an attribute nobody
    // styled. Firefox is amber (28), Safari is sky (205).
    const firefox = await read(CASES[2][2])
    const safari = await read(CASES[3][2])

    expect(firefox).not.toBe(safari)
    expect(Number(firefox)).toBeGreaterThan(0)
    expect(Number(safari)).toBeGreaterThan(0)
  })
})
