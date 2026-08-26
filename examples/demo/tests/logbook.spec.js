import { expect, test } from '@playwright/test'

/**
 * The logbook: what worked here, what did not, and why.
 *
 * The point of the feature is the second half. A log that only records successes
 * says nothing about what is broken, and every finding this project has made in
 * the field came from a failure somebody could describe afterwards.
 *
 * These drive the demo rather than the module, because the interesting part is
 * the wiring: an entry has to be opened by whichever control started the
 * attempt and closed by whichever thing ended it, and those are six different
 * places in `index.js`.
 */

const entries = page => page.evaluate(() => JSON.parse(localStorage.getItem('webrtc-qr.logbook.v1') ?? '[]'))

const open = async (page, { record = true } = {}) => {
  await page.goto('/?ice=host&view=technical&intro=off')

  // Off by default, so every test that expects an entry has to say so - which
  // is the assertion in miniature.
  if (record) await page.locator('#logbook-enabled').check()

  await page.locator('#start-client').click()
  await page.waitForFunction(() => document.getElementById('peer-id').textContent !== 'not started')
}

test.describe('the logbook', () => {
  test('records a connection, with the combination that achieved it', async ({ browser, baseURL, browserName }) => {
    // The only test here that needs a connection to actually happen, so the
    // only one that needs the guard the connection specs already use. Playwright
    // WebKit on Linux cannot establish a WebRTC connection at all - and the
    // logbook recorded that faithfully, which is how this was noticed: CI read
    // `failed` where the assertion wanted `connected`, and the entry was right.
    test.skip(
      browserName === 'webkit' && process.platform === 'linux',
      'Playwright WebKit on Linux cannot establish a WebRTC connection'
    )

    const alice = await (await browser.newContext({ baseURL })).newPage()
    const bob = await (await browser.newContext({ baseURL })).newPage()

    try {
      await open(alice)
      await open(bob)

      // The two fields no browser can know, typed before the attempt.
      await alice.locator('#logbook-provider').fill('Telekom')
      await alice.locator('#logbook-place').fill('hotel lobby')

      await alice.locator('#create-offer').click()
      await expect(alice.locator('#invite-box')).toBeVisible({ timeout: 60000 })

      const invite = await alice.locator('#invite-link').inputValue()
      await bob.goto(invite.replace(/^https?:\/\/[^/]+/, ''))
      await expect(bob.locator('#invite-link')).toHaveValue(/#r=/, { timeout: 60000 })

      const reply = await bob.locator('#invite-link').inputValue()
      await alice.locator('#paste-reply').click()
      await alice.locator('#payload-display').fill(reply)
      await alice.locator('#process-payload').click()

      await expect.poll(() => entries(alice).then(list => list.length), { timeout: 60000 }).toBeGreaterThan(0)

      const [entry] = await entries(alice)

      expect(entry.outcome).toBe('connected')
      expect(entry.role).toBe('offering')
      // The typed context rides along, which is the whole reason it is typed.
      expect(entry.provider).toBe('Telekom')
      expect(entry.place).toBe('hotel lobby')
      // And the measured part, which decides whether a code was readable.
      expect(entry.format).toMatch(/^v[23]$/)
      expect(entry.frames).toBeGreaterThan(0)
      expect(entry.engine).toBeTruthy()
      expect(entry.platform).toBeTruthy()
      expect(entry.ms).toBeGreaterThan(0)

      // Visible at a glance, which is what the panel is for.
      await expect(alice.locator('.logbook-entry.is-connected')).toHaveCount(1)
    } finally {
      await alice.close()
      await bob.close()
    }
  })

  test('records a failure with the reason, which is the point of keeping it', async ({ page }) => {
    await open(page)

    // A reply that cannot verify. The specific error matters less than that the
    // entry is closed rather than left dangling.
    await page.locator('.paste-fallback summary').click()
    await page.locator('#payload-display').fill('https://example.org/#r=q3:not-a-real-payload')
    await page.locator('#process-payload').click()

    await expect.poll(() => entries(page).then(list => list.length), { timeout: 30000 }).toBe(1)

    const [entry] = await entries(page)

    expect(entry.outcome).toBe('failed')
    expect(entry.reason, 'a failure without a reason is not a finding').toBeTruthy()

    await expect(page.locator('.logbook-entry.is-failed')).toHaveCount(1)
    await expect(page.locator('.logbook-why')).toContainText(/./)
  })

  test('the typed context survives a reload, because a location does', async ({ page }) => {
    await open(page)
    await page.locator('#logbook-provider').fill('Vodafone')
    await page.locator('#logbook-place').fill('office')

    await page.reload()

    // Somebody testing all evening in one place types this once.
    await expect(page.locator('#logbook-provider')).toHaveValue('Vodafone')
    await expect(page.locator('#logbook-place')).toHaveValue('office')
  })

  test('exports what could be sent by hand, long before any relay exists', async ({ page }) => {
    await open(page)
    await page.locator('.paste-fallback summary').click()
    await page.locator('#payload-display').fill('https://example.org/#r=q3:nonsense')
    await page.locator('#process-payload').click()
    await expect.poll(() => entries(page).then(list => list.length), { timeout: 30000 }).toBe(1)

    // What the file will contain, read from the source rather than out of the
    // browser's download machinery. That machinery is worth one assertion of
    // its own below, but it should not be what decides whether the *content*
    // is right - it is timing-dependent under load and the content is not.
    const parsed = JSON.parse(await page.evaluate(() => window.__libp2pQrTest.logbookExport()))

    expect(parsed.v).toBe(1)
    expect(parsed.entries).toHaveLength(1)
    expect(parsed.entries[0].outcome).toBe('failed')

    // And the button really does hand a file over. Generously timed on purpose:
    // three engines in parallel on one machine make a download take much longer
    // than it takes alone, and a timeout is not a defect worth failing for.
    const download = page.waitForEvent('download', { timeout: 60000 })
    await page.locator('#logbook-export').click()

    expect((await download).suggestedFilename()).toMatch(/^webrtc-qr-logbook-\d{4}-\d{2}-\d{2}\.json$/)
  })

  test('is a technical instrument, not part of the simple view', async ({ page }) => {
    await page.goto('/?ice=host&intro=off')

    // The simple view tells a story; a developer's logbook is not part of it.
    await expect(page.locator('#logbook-card')).toBeHidden()
  })

  test('records nothing at all until somebody asks it to', async ({ page }) => {
    // The default, and the reason for it: an entry holds the addresses a
    // connection used. That was defensible as a count in localStorage and stops
    // being defensible the moment it is an address.
    await open(page, { record: false })

    await expect(page.locator('#logbook-enabled')).not.toBeChecked()

    await page.locator('.paste-fallback summary').click()
    await page.locator('#payload-display').fill('https://example.org/#r=q3:nonsense')
    await page.locator('#process-payload').click()

    // A failure that would certainly have been recorded, had anything been
    // recording. Not an empty entry, not a redacted one - none.
    await page.waitForTimeout(2000)
    expect(await entries(page)).toEqual([])
  })

  test('turning it off keeps what is already there', async ({ page }) => {
    await open(page)
    await page.locator('.paste-fallback summary').click()
    await page.locator('#payload-display').fill('https://example.org/#r=q3:nonsense')
    await page.locator('#process-payload').click()
    await expect.poll(() => entries(page).then(list => list.length), { timeout: 30000 }).toBe(1)

    await page.locator('#logbook-enabled').uncheck()

    // Deleting somebody's own measurements because they closed the tap would be
    // its own surprise. Clear is right beside it for anyone who means that.
    expect(await entries(page)).toHaveLength(1)
    await expect(page.locator('.logbook-entry')).toHaveCount(1)
  })

  test('the export leaves addresses behind', async ({ browser, baseURL, browserName }) => {
    test.skip(
      browserName === 'webkit' && process.platform === 'linux',
      'Playwright WebKit on Linux cannot establish a WebRTC connection'
    )

    // The projection is the point of the local/public split: a local entry may
    // hold the addresses a connection used, and none of it may leave.
    const alice = await (await browser.newContext({ baseURL })).newPage()
    const bob = await (await browser.newContext({ baseURL })).newPage()

    try {
      await open(alice)
      await open(bob)

      await alice.locator('#create-offer').click()
      await expect(alice.locator('#invite-box')).toBeVisible({ timeout: 60000 })

      const invite = await alice.locator('#invite-link').inputValue()
      await bob.goto(invite.replace(/^https?:\/\/[^/]+/, ''))
      await expect(bob.locator('#invite-link')).toHaveValue(/#r=/, { timeout: 60000 })

      const reply = await bob.locator('#invite-link').inputValue()
      await alice.locator('#paste-reply').click()
      await alice.locator('#payload-display').fill(reply)
      await alice.locator('#process-payload').click()

      await expect.poll(() => entries(alice).then(list => list.length), { timeout: 60000 }).toBeGreaterThan(0)

      const [stored] = await entries(alice)

      // Locally the addresses are there - that is what makes a failure
      // diagnosable a week later.
      expect(stored.candidates, 'the local entry kept no candidates').toBeTruthy()
      const addresses = stored.candidates.map(candidate => candidate.address).filter(Boolean)
      expect(addresses.length).toBeGreaterThan(0)

      const exported = await alice.evaluate(() => window.__libp2pQrTest.logbookExport())

      // And in the export, none of them appear - not the strings, not a port,
      // and the file says so rather than leaving a recipient to assume.
      for (const address of addresses) {
        expect(exported, `the export contains ${address}`).not.toContain(address)
      }

      const parsed = JSON.parse(exported)
      expect(parsed.redacted).toContain('candidate addresses and ports')
      // The shape survives: counts by type and family answer "what kind of
      // network" without answering "whose".
      expect(Object.keys(parsed.entries[0].candidates ?? {}).length).toBeGreaterThan(0)
    } finally {
      await alice.close()
      await bob.close()
    }
  })
})

