import { expect, test } from '@playwright/test'

/**
 * Publishing: the one act in this app that connects to anything.
 *
 * Two claims are worth more than the rest, and both are testable without a
 * relay in sight:
 *
 * 1. **The page has not fetched the code that can connect.** Not "has not
 *    connected" - has not *loaded*. A promise that rests on a flag not being
 *    set is weaker than one where the module is not in the page.
 * 2. **What the preview shows is what would go.** The published log is
 *    append-only, so a field that leaks is a field that cannot be recalled.
 *    These assert the *absence* of things rather than trusting the projection's
 *    own comments.
 *
 * Nothing here presses the button for real. The relay lookup is a request to
 * somebody else's service, and a test suite that reached for it would be both
 * flaky and, in a project whose whole claim is that it connects to nothing,
 * rude. The one test that does press it blocks everything off-origin first,
 * which is also how the failure path gets covered.
 */

/** A row as the logbook would have written it, with every withheld field set. */
const ROW = {
  id: 'row-1',
  at: '2026-11-01T15:47:31.123Z',
  role: 'offering',
  carrier: 'qr',
  scenario: 'mobile-data',
  families: ['v4'],
  familyFilter: null,
  pairId: 'abcd1234',
  engine: 'Chromium',
  version: '144',
  browser: null,
  platform: 'Android',
  mobile: true,
  provider: 'Telekom',
  place: 'at Anna\'s flat',
  peer: 'Anna\'s iPhone',
  country: 'DE',
  city: 'Berlin',
  region: 'BE',
  ip: '203.0.113.9',
  coords: { lat: 48.1, lon: 11.5 },
  candidates: [{ type: 'srflx', address: '203.0.113.9' }],
  network: { overall: 'blocked' },
  reported: { engine: 'Firefox', version: '140', platform: 'Android', region: 'BY', country: 'DE' },
  outcome: 'failed',
  reason: 'entered state failed',
  ms: 31000,
  review: 'sound',
  reviewNote: 'the camera was fine, the carrier was not',
  reviewedAt: '2026-11-01T16:00:00.000Z',
  publishedAt: null
}

const open = async (page, rows = [ROW]) => {
  await page.goto('/?ice=host&view=technical&intro=off')
  await page.evaluate(seeded => {
    localStorage.setItem('webrtc-qr.logbook.v1', JSON.stringify(seeded))
    localStorage.setItem('webrtc-qr.logbook.enabled.v1', 'true')
  }, rows)
  await page.reload()
  await expect(page.locator('#publish')).toBeVisible()
}

const preview = page => page.evaluate(() => window.__libp2pQrTest.publishPreview())

test.describe('publishing the sound rows', () => {
  test('the page has not fetched the code that can connect', async ({ page }) => {
    await open(page)

    // The module is dynamically imported, so until the button is pressed the
    // browser has never asked for it. Measured from the browser's own resource
    // timings rather than from a mock.
    const fetched = await page.evaluate(() => performance.getEntriesByType('resource')
      .map(entry => entry.name)
      .filter(name => /publish-network|orbitdb/i.test(name)))

    expect(fetched).toEqual([])
  })

  test('what would leave is shown, and it is not what was typed', async ({ page }) => {
    await open(page)

    const [row] = await preview(page)

    // The three the person typed. "at Anna's flat" is a venue type and a
    // person's name in one string, and nothing can tell those apart.
    expect(row).not.toHaveProperty('place')
    expect(row).not.toHaveProperty('peer')
    expect(row).not.toHaveProperty('reviewNote')

    // The ones the browser or a lookup produced and #27 refuses.
    expect(row).not.toHaveProperty('ip')
    expect(row).not.toHaveProperty('coords')
    expect(row).not.toHaveProperty('city')
    expect(row).not.toHaveProperty('region')
    // Including inside the nested structure, which has its own list for
    // exactly this reason.
    expect(row.reported).not.toHaveProperty('region')

    // Addresses become shapes.
    expect(row.candidates).toEqual({ 'srflx.v4': 1 })

    // And the time is an hour, not a moment: a carrier, a country and a
    // timestamp to the second is a fingerprint.
    expect(row.at).toBe('2026-11-01T15:00:00Z')

    // What is left is the measurement.
    expect(row).toMatchObject({
      scenario: 'mobile-data',
      pairId: 'abcd1234',
      provider: 'Telekom',
      country: 'DE',
      outcome: 'failed',
      reason: 'entered state failed',
      review: 'sound'
    })
  })

  test('the preview on screen is the same text, not a description of it', async ({ page }) => {
    await open(page)
    await page.locator('.publish-preview summary').click()

    const shown = await page.locator('#publish-rows').textContent()

    expect(JSON.parse(shown)).toEqual(await preview(page))
    // And the list of what stays, beside it rather than in a help page.
    await expect(page.locator('#publish-withheld li')).toHaveCount(4)
    await expect(page.locator('#publish-withheld')).toContainText(/hour is published, not the minute/i)
  })

  test('only sound rows are offered, and only once', async ({ page }) => {
    await open(page, [
      ROW,
      { ...ROW, id: 'row-2', review: 'operator-error' },
      { ...ROW, id: 'row-3', review: 'sound', publishedAt: '2026-11-01T16:30:00.000Z' },
      { ...ROW, id: 'row-4', review: null }
    ])

    expect((await preview(page)).map(row => row.id)).toEqual(['row-1'])
    await expect(page.locator('#publish-count')).toContainText('1 sound row is waiting')
    await expect(page.locator('#publish')).toBeEnabled()

    // A row that has gone says so, because it cannot be taken back and must
    // not be offered a second time.
    await expect(page.locator('.logbook-entry[data-id="row-3"] .logbook-how')).toContainText('published')
  })

  test('nothing waiting, nothing to press', async ({ page }) => {
    await open(page, [{ ...ROW, review: null }])

    await expect(page.locator('#publish')).toBeDisabled()
    await expect(page.locator('#publish-count')).toContainText(/mark it sound/i)
    expect(await preview(page)).toEqual([])
  })

  test('a publish that cannot reach a relay marks nothing as published', async ({ page, baseURL }) => {
    await open(page)

    // Everything off-origin refused, which is both what makes this test
    // deterministic and what keeps a test suite for this project from quietly
    // calling somebody else's API.
    await page.route('**/*', route =>
      route.request().url().startsWith(baseURL ?? 'http://127.0.0.1') ? route.continue() : route.abort())

    await page.locator('#publish').click()

    await expect(page.locator('#publish-state')).toContainText(/Nothing was published/i, { timeout: 60000 })

    // The row is still here, still unpublished, still offered. A half-written
    // set is the one thing an append-only log cannot be left in, so a failure
    // records nothing at all.
    const [entry] = await page.evaluate(() => JSON.parse(localStorage.getItem('webrtc-qr.logbook.v1') ?? '[]'))

    expect(entry.publishedAt).toBeNull()
    expect((await preview(page)).map(row => row.id)).toEqual(['row-1'])
  })
})
