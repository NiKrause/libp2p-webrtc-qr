import { expect, test } from '@playwright/test'

/**
 * The public page: the dataset, and the gaps in it (#179, step 7).
 *
 * Nothing here opens a database. The page's own job is to read one over a
 * relay, and a suite for a project whose claim is that it connects to nothing
 * has no business reaching for somebody else's service - so the fold and the
 * rendering are driven through `window.__libp2pQrResultsTest.load`, with
 * entries written here.
 *
 * What is worth asserting is not that a table appears. It is that the page
 * keeps the two promises the issue makes for it:
 *
 * 1. **The gaps are stated, and they are stated first.** A dataset that
 *    overstates its coverage is worth less than one that says what is missing,
 *    so "no mobile-data run" has to be on screen *above* the numbers it
 *    qualifies - and has to disappear the moment a mobile-data row exists.
 * 2. **The demo page still connects to nothing.** This page loads a libp2p
 *    stack; `index.html` must not, and the two now share a bundle.
 */

/** A published row, exactly as the mirror would receive it from the log. */
const entry = (over = {}) => ({
  hash: `zdpu${Math.random().toString(36).slice(2, 10)}`,
  identity: 'did:key:zauthor',
  value: {
    v: 1,
    id: `${Math.random().toString(36).slice(2, 8)}-abcd`,
    at: '2026-11-02T05:00:00Z',
    role: 'offering',
    outcome: 'connected',
    engine: 'Chromium',
    version: '149',
    platform: 'macOS',
    ...over
  }
})

const open = async (page, entries) => {
  await page.goto('/results.html')
  await page.waitForFunction(() => window.__libp2pQrResultsTest != null)
  await page.evaluate(seeded => window.__libp2pQrResultsTest.load(seeded), entries)
}

const gapKeys = page => page.evaluate(() => window.__libp2pQrResultsTest.gaps())

test.describe('the results page', () => {
  test('says what it cannot tell you, before it says anything else', async ({ page }) => {
    await open(page, [entry({ scenario: 'same-lan', country: 'DE', provider: 'Telekom' })])

    const gaps = page.locator('#results-gaps li')

    await expect(gaps.first()).toBeVisible()

    // The two scenarios nobody has run are the first thing on the list,
    // because an unasked question is worth more to a reader than a thin
    // answer to one that was asked.
    const keys = await gapKeys(page)

    expect(keys.slice(0, 2)).toEqual([
      'results.gaps.scenario.across-networks',
      'results.gaps.scenario.mobile-data'
    ])

    // And it is above the numbers, not under them in a footnote.
    const gapsBox = await page.locator('#results-gaps-card').boundingBox()
    const numbersBox = await page.locator('#results-headline-card').boundingBox()

    expect(gapsBox.y).toBeLessThan(numbersBox.y)
  })

  test('a gap closes when the run that answers it arrives', async ({ page }) => {
    await open(page, [entry({ scenario: 'same-lan' })])
    expect(await gapKeys(page)).toContain('results.gaps.scenario.mobile-data')

    await page.evaluate(() => window.__libp2pQrResultsTest.load([]))
    await page.evaluate(seeded => window.__libp2pQrResultsTest.load(seeded), [
      entry({ scenario: 'same-lan' }),
      entry({ scenario: 'mobile-data', country: 'DE', provider: 'Vodafone DE' })
    ])

    expect(await gapKeys(page)).not.toContain('results.gaps.scenario.mobile-data')
  })

  test('the IPv6 question carries its denominator', async ({ page }) => {
    // Offered and refused is a finding; never offered is a gap, and the page
    // must not let one read as the other.
    await open(page, [entry({ candidates: { 'srflx.v4': 1 } })])
    expect(await gapKeys(page)).toContain('results.gaps.noV6Offered')

    await page.evaluate(seeded => window.__libp2pQrResultsTest.load(seeded), [
      entry({ familyFilter: 'v6', candidates: { 'srflx.v4': 1 } })
    ])

    const keys = await gapKeys(page)

    expect(keys).not.toContain('results.gaps.noV6Offered')
    expect(keys).toContain('results.gaps.thinV6')
  })

  test('an empty dataset says so rather than looking broken', async ({ page }) => {
    await open(page, [])

    expect(await gapKeys(page)).toEqual(['results.gaps.nothing'])
    await expect(page.locator('#results-count')).toContainText('0')
  })

  test('a malformed entry is listed rather than disappearing', async ({ page }) => {
    await open(page, [entry(), { hash: 'zdpubad', identity: 'did:key:zother', value: { v: 1, at: 'whenever' } }])

    // Anyone may write to this log. A filter whose removals cannot be
    // inspected is an opinion with a URL.
    await expect(page.locator('#results-rejected li')).toHaveCount(1)
    await expect(page.locator('#results-rejected')).toContainText('at:')
    await expect(page.locator('#results-headline')).toContainText('1')
  })

  test('free text a publisher invented never reaches the table', async ({ page }) => {
    await open(page, [entry({ place: "at Anna's flat", peer: 'Anna', ip: '203.0.113.9' })])

    const body = await page.locator('main').textContent()

    for (const secret of ['Anna', '203.0.113.9']) {
      expect(body).not.toContain(secret)
    }
  })

  test('filtering offers only what is in the data', async ({ page }) => {
    await open(page, [
      entry({ country: 'DE', outcome: 'connected' }),
      entry({ country: 'AT', outcome: 'failed' })
    ])

    const countries = page.locator('.results-filter select').first()

    await expect(page.locator('#results-rows tbody tr')).toHaveCount(2)

    // A filter offering `mobile-data` on a dataset without one sends the
    // reader to an empty table and teaches them nothing.
    const options = await page.locator('.results-filter select').allInnerTexts()

    expect(options.join(' ')).not.toContain('mobile-data')

    await countries.selectOption('AT')
    await expect(page.locator('#results-rows tbody tr')).toHaveCount(1)
    await expect(page.locator('#results-count')).toContainText('1')
  })

  test('the page is readable in German, gaps included', async ({ page }) => {
    await open(page, [entry({ scenario: 'same-lan' })])
    await page.locator('#locale-de').click()

    await expect(page.locator('#results-gaps-card h2')).toHaveText(/noch nicht sagen kann/i)
    // The gap sentences are catalogue entries, not strings built in JavaScript,
    // so a translated page is translated all the way down.
    await expect(page.locator('#results-gaps')).toContainText(/Mobilfunknetz/i)
  })

  test('the demo page still has not fetched the code that can connect', async ({ page }) => {
    // The two pages share a bundle now. This is the promise that sharing could
    // break silently: index.html must reference no chunk built from the
    // publishing or the reading module.
    await page.goto('/?intro=off')

    const fetched = await page.evaluate(() => performance.getEntriesByType('resource')
      .map(entry => entry.name)
      .filter(name => /publish-network|results-network|orbitdb/i.test(name)))

    expect(fetched).toEqual([])
  })
})
