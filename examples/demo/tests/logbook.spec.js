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
  //
  // Asserted rather than assumed: a switch that silently did not take would
  // surface later as an empty log and read as a flake, which is exactly what it
  // did once on WebKit under three parallel engines.
  if (record) {
    await page.locator('#logbook-enabled').check()
    await expect(page.locator('#logbook-enabled')).toBeChecked()
  }

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

      // Bob's own network, typed on Bob's phone. Neither end can see the
      // other's side of a connection without being told, and two peers on the
      // same two browsers behave differently on cable and on carrier-grade NAT.
      await bob.locator('#logbook-provider').fill('Vodafone')
      await bob.locator('#logbook-place').fill('a place that must not travel')

      // The three fields no browser can know, typed before the attempt.
      await alice.locator('#logbook-provider').fill('Telekom')
      await alice.locator('#logbook-place').fill('hotel lobby')
      await alice.locator('#logbook-peer').fill('Vanadium on GrapheneOS')

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
      // The far end, typed. It stays the person's answer even here, where the
      // attempt connected and the far end could be asked.
      expect(entry.peer).toBe('Vanadium on GrapheneOS')

      // And what the far end says about itself, which arrives after the entry
      // was closed and so has to find its way back to the right row.
      await expect.poll(() => entries(alice).then(([e]) => e.reported), { timeout: 30000 })
        .toEqual(expect.objectContaining({ platform: expect.any(String) }))

      const [amended] = await entries(alice)

      expect(amended.reported.engine).toBeTruthy()
      // The far end's network, which is half of every useful row.
      expect(amended.reported.provider).toBe('Vodafone')
      // And not the far end's place. That one is a note somebody wrote for
      // themselves, and it stays on the phone it was typed on.
      expect(JSON.stringify(amended)).not.toContain('a place that must not travel')
      // Never instead of the typed one: the two are different claims about the
      // same device, and the disagreement is the finding.
      expect(amended.peer).toBe('Vanadium on GrapheneOS')
      // And the measured part, which decides whether a code was readable.
      expect(entry.format).toMatch(/^v[23]$/)
      expect(entry.frames).toBeGreaterThan(0)
      expect(entry.engine).toBeTruthy()
      expect(entry.platform).toBeTruthy()
      expect(entry.ms).toBeGreaterThan(0)

      // Visible at a glance, which is what the panel is for.
      await expect(alice.locator('.logbook-entry.is-connected')).toHaveCount(1)
      // And on its own line, so the two ends never read as one device.
      await expect(alice.locator('.logbook-entry .logbook-peer')).toContainText('Vanadium on GrapheneOS')
      await expect(alice.locator('.logbook-entry .logbook-peer')).toContainText(/reports itself as/)
    } finally {
      await alice.close()
      await bob.close()
    }
  })

  test('a peer that keeps no logbook describes itself to nobody', async ({ browser, browserName, baseURL }) => {
    test.skip(
      browserName === 'webkit' && process.platform === 'linux',
      'Playwright WebKit on Linux cannot establish a WebRTC connection'
    )

    const alice = await (await browser.newContext({ baseURL })).newPage()
    const bob = await (await browser.newContext({ baseURL })).newPage()

    try {
      await open(alice)
      // Bob is not taking part in the measurement, so Bob sends nothing about
      // himself. The switch that decides is the sender's own: Alice ticking a
      // box on her phone must not make Bob's device describe itself.
      await open(bob, { record: false })

      await alice.locator('#create-offer').click()
      await expect(alice.locator('#invite-box')).toBeVisible({ timeout: 60000 })

      const invite = await alice.locator('#invite-link').inputValue()
      await bob.goto(invite.replace(/^https?:\/\/[^/]+/, ''))
      await expect(bob.locator('#invite-link')).toHaveValue(/#r=/, { timeout: 60000 })

      const reply = await bob.locator('#invite-link').inputValue()
      await alice.locator('#paste-reply').click()
      await alice.locator('#payload-display').fill(reply)
      await alice.locator('#process-payload').click()

      await expect.poll(() => entries(alice).then(list => list.length), { timeout: 60000 }).toBe(1)

      // The connection is up and the chat stream is live, so a greeting had
      // every chance to arrive. Asserted after a message crosses, rather than
      // after a bare wait, so this fails when a greeting is sent rather than
      // when the test machine is slow.
      await alice.locator('#message').fill('a message that had to cross first')
      await alice.locator('#message').press('Enter')
      await expect.poll(
        () => bob.evaluate(() => window.__libp2pQrTest.getLastReceivedMessage()),
        { timeout: 30000 }
      ).toBe('a message that had to cross first')

      const [entry] = await entries(alice)

      expect(entry.outcome).toBe('connected')
      expect(entry.reported).toBeNull()

      // And Bob, who is not recording, has no entry to amend either way.
      expect(await entries(bob)).toEqual([])
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

  /**
   * A real captured string, because the point is that it lies convincingly:
   * it carries "Chrome" and "Safari" like every other Chromium fork, and asking
   * `userAgentData.brands` returns "Google Chrome" too. DuckDuckGo is one of the
   * two browsers this project has field results about, so recording it as Chrome
   * lost the very row the log exists for.
   */
  const DDG_ANDROID = 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/130.0.6723.106 Mobile DuckDuckGo/5 Safari/537.36'

  test('names the browser somebody chose, not the engine it is built on', async ({ browser, baseURL }) => {
    const context = await browser.newContext({ baseURL, userAgent: DDG_ANDROID })
    const page = await context.newPage()

    try {
      await open(page)

      await page.locator('.paste-fallback summary').click()
      await page.locator('#payload-display').fill('https://example.org/#r=q3:not-a-real-payload')
      await page.locator('#process-payload').click()

      await expect.poll(() => entries(page).then(list => list.length), { timeout: 30000 }).toBe(1)

      const [entry] = await entries(page)

      expect(entry.browser).toBe('DuckDuckGo')
      // The engine underneath is kept, not replaced: the shell is what a person
      // installs, and the engine number is what predicts whether WebRTC behaves.
      expect(entry.engine).toMatch(/Chrom/i)
      await expect(page.locator('.logbook-what')).toContainText('DuckDuckGo')
    } finally {
      await context.close()
    }
  })

  test('the typed context survives a reload, because a location does', async ({ page }) => {
    await open(page)
    await page.locator('#logbook-provider').fill('Vodafone')
    await page.locator('#logbook-place').fill('office')
    await page.locator('#logbook-peer').fill('iPhone 12, Safari')

    await page.reload()

    // Somebody testing all evening in one place types this once.
    await expect(page.locator('#logbook-provider')).toHaveValue('Vodafone')
    // The peer is stickiest of the three in practice: a testing session is two
    // devices for an evening, not a new pair every attempt.
    await expect(page.locator('#logbook-peer')).toHaveValue('iPhone 12, Safari')
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

  /**
   * The lookup, with the service replaced.
   *
   * Nothing here reaches the internet: the suite runs offline by design, and a
   * test that depended on a free third party would fail for reasons that have
   * nothing to do with this code - that service answered `RateLimited` while
   * this was being written, which is the ordinary case rather than the
   * exception.
   */
  const answerWith = async (page, body, { status = 200 } = {}) => {
    const hits = { count: 0 }

    // A predicate rather than a glob. `**/api.ipquery.io/**` matched here and
    // not in the E2E container on Firefox, where the request went to the real
    // network instead, failed DNS, and surfaced as an empty field three tests
    // later. A URL match should not depend on how a trailing slash and a query
    // string normalise.
    await page.route(url => url.hostname === 'api.ipquery.io', route => {
      hits.count++

      return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })
    })

    return hits
  }

  /** The stub was used, rather than the field being empty for some other reason. */
  const usedStub = async (page, hits) => {
    await expect
      .poll(() => hits.count, { message: 'the lookup never reached the stubbed service' })
      .toBeGreaterThan(0)
  }

  test('works out the provider and fills the fields somebody would have typed', async ({ page }) => {
    await open(page)
    const hits = await answerWith(page, {
      ip: '203.0.113.7',
      isp: { asn: 'AS64500', isp: 'Example Telecom', org: 'Example Telecom GmbH' },
      location: { country_code: 'DE', state: 'Bavaria', city: 'Munich' }
    })

    await page.locator('#logbook-lookup-consent').check()
    await page.locator('#logbook-locate').click()
    await usedStub(page, hits)

    await expect(page.locator('#logbook-provider')).toHaveValue('Example Telecom')

    // The place is *not* filled from the city, though it is right there in the
    // answer. `place` travels with an export and `city` is dropped by it, so
    // prefilling one from the other would launder a measured value past the
    // projection - and "hotel lobby" is what a pattern is made of anyway, which
    // no service knows.
    await expect(page.locator('#logbook-place')).toHaveValue('')

    // The city is still shown, so somebody can see the lookup worked.
    await expect(page.locator('#logbook-locate-state')).toContainText('Munich')
  })

  test('a typed place survives a lookup untouched', async ({ page }) => {
    await open(page)
    await page.locator('#logbook-place').fill('hotel lobby')
    const hits = await answerWith(page, {
      ip: '203.0.113.7',
      isp: { isp: 'Example Telecom' },
      location: { country_code: 'DE', state: 'Bavaria', city: 'Munich' }
    })

    await page.locator('#logbook-lookup-consent').check()
    await page.locator('#logbook-locate').click()
    await usedStub(page, hits)
    await expect(page.locator('#logbook-provider')).toHaveValue('Example Telecom')

    // "hotel lobby" is what a pattern is made of; "Munich" is not, and no
    // service knows the difference.
    await expect(page.locator('#logbook-place')).toHaveValue('hotel lobby')
  })

  test('a service that says no leaves the typed fields alone', async ({ page }) => {
    await open(page)
    await page.locator('#logbook-provider').fill('typed by hand')
    const hits = await answerWith(page, { error: true, reason: 'RateLimited' })

    await page.locator('#logbook-lookup-consent').check()
    await page.locator('#logbook-locate').click()
    await usedStub(page, hits)

    await expect(page.locator('#logbook-locate-state')).toContainText('RateLimited')
    await expect(page.locator('#logbook-provider')).toHaveValue('typed by hand')
  })

  test('the export keeps the country and drops everything finer', async ({ page }) => {
    await open(page)
    const hits = await answerWith(page, {
      ip: '203.0.113.7',
      isp: { isp: 'Example Telecom' },
      location: { country_code: 'DE', state: 'Bavaria', city: 'Munich' }
    })
    await page.locator('#logbook-lookup-consent').check()
    await page.locator('#logbook-locate').click()
    await usedStub(page, hits)
    await expect(page.locator('#logbook-provider')).toHaveValue('Example Telecom')

    await page.locator('.paste-fallback summary').click()
    await page.locator('#payload-display').fill('https://example.org/#r=q3:nonsense')
    await page.locator('#process-payload').click()
    await expect.poll(() => entries(page).then(list => list.length), { timeout: 30000 }).toBe(1)

    const exported = await page.evaluate(() => window.__libp2pQrTest.logbookExport())

    // The country survives, because it is the one thing an IP answers reliably.
    expect(exported).toContain('DE')
    expect(exported, 'the export leaked the public IP').not.toContain('203.0.113.7')
    expect(exported, 'the export leaked the city').not.toContain('Munich')
    // The region is dropped for a different reason than fineness: it is wrong.
    // IP geolocation places a customer at their provider's egress, measured on a
    // cable connection reported as Berlin from Bavaria. A dataset about where
    // WebRTC works is worse than useless with a confidently wrong location in
    // it, and a wrong value is not improved by being coarse.
    expect(exported, 'the export carried an IP-derived region').not.toContain('Bavaria')

    const parsed = JSON.parse(exported)
    expect(parsed.redacted).toContain('public IP')
  })

  /**
   * The one location that is correct, free, and asks nobody.
   *
   * An IP lookup on this connection answered Frankfurt over IPv4 and Berlin over
   * IPv6 - 423 km apart, neither of them right. The browser knew the time zone
   * the whole time, without a request, a permission or a third party.
   */
  test('records the time zone the browser already knew', async ({ browser, baseURL }) => {
    // Set on the context rather than read from the machine, so this asserts the
    // value is carried rather than that CI happens to sit in one place.
    const context = await browser.newContext({ baseURL, timezoneId: 'Europe/Berlin' })
    const page = await context.newPage()

    try {
      await open(page)
      await page.locator('.paste-fallback summary').click()
      await page.locator('#payload-display').fill('https://example.org/#r=q3:nonsense')
      await page.locator('#process-payload').click()
      await expect.poll(() => entries(page).then(list => list.length), { timeout: 30000 }).toBe(1)

      const [entry] = await entries(page)

      expect(entry.timeZone).toBe('Europe/Berlin')
      await expect(page.locator('.logbook-what')).toContainText('Europe/Berlin')
    } finally {
      await context.close()
    }
  })

  /**
   * Asking costs something, and the button never said what.
   *
   * Determining a provider means asking a service, and asking tells that service
   * this device's address by the act of asking - there is no version without it.
   * A button labelled "work out where I am" says what it will find and not what
   * it costs, so the consent is its own box and the box names the disclosure.
   */
  test('asks nobody anything until the disclosure is accepted', async ({ page }) => {
    await open(page)

    const hits = await answerWith(page, {
      ip: '203.0.113.7',
      isp: { isp: 'Example Telecom' },
      location: { country_code: 'DE', state: 'Berlin', city: 'Tempelhof' }
    })

    // Unticked by default, and the button cannot be pressed.
    await expect(page.locator('#logbook-lookup-consent')).not.toBeChecked()
    await expect(page.locator('#logbook-locate')).toBeDisabled()

    // Forced past the disabled attribute, which is a convenience for a person
    // and not the thing that decides. What decides is checked in the handler,
    // and this is the assertion that would catch a future caller bypassing it.
    await page.locator('#logbook-locate').evaluate(el => { el.disabled = false; el.click() })
    await page.waitForTimeout(500)

    expect(hits.count, 'a request went out before anyone agreed to it').toBe(0)
    await expect(page.locator('#logbook-provider')).toHaveValue('')

    // And with consent, the same press works.
    await page.locator('#logbook-lookup-consent').check()
    await expect(page.locator('#logbook-locate')).toBeEnabled()
    await page.locator('#logbook-locate').click()
    await usedStub(page, hits)
    await expect(page.locator('#logbook-provider')).toHaveValue('Example Telecom')
  })

  test('the consent survives a reload, and withdrawing it disables the button again', async ({ page }) => {
    await open(page)

    await page.locator('#logbook-lookup-consent').check()
    await page.reload()

    // Somebody testing all evening in one place should not re-tick a box whose
    // answer has not changed.
    await expect(page.locator('#logbook-lookup-consent')).toBeChecked()
    await expect(page.locator('#logbook-locate')).toBeEnabled()

    await page.locator('#logbook-lookup-consent').uncheck()
    await expect(page.locator('#logbook-locate')).toBeDisabled()
  })

  /**
   * "Position added" says a measurement happened, not what it found.
   *
   * That is the one line in this panel a person cannot check, and checking it is
   * the reason to press the button at all - a coordinate that is quietly the
   * middle of the country is worth knowing about.
   */
  test('shows the coordinates it found, and a map that shows them', async ({ browser, baseURL }) => {
    const context = await browser.newContext({
      baseURL,
      permissions: ['geolocation'],
      geolocation: { latitude: 52.4751234, longitude: 13.3587654, accuracy: 12 }
    })
    const page = await context.newPage()

    try {
      await open(page)
      const hits = await answerWith(page, {
        ip: '203.0.113.7',
        isp: { isp: 'Example Telecom' },
        location: { country_code: 'DE', state: 'Berlin', city: 'Tempelhof' }
      })

      await page.locator('#logbook-lookup-consent').check()
    await page.locator('#logbook-locate').click()
      await usedStub(page, hits)

      const link = page.locator('#logbook-locate-state a.logbook-coords')

      await expect(link).toBeVisible()
      // Five decimals is about a metre, which is finer than the accuracy beside
      // it - more digits would be arithmetic rather than information.
      await expect(link).toContainText('52.47512, 13.35877')
      await expect(link).toContainText('±12 m')

      const href = await link.getAttribute('href')

      expect(href).toContain('openstreetmap.org')
      expect(href).toContain('mlat=52.47512')
      // Following it tells OSM the position by definition; it need not also
      // tell them which page it came from.
      expect(await link.getAttribute('rel')).toContain('noreferrer')

      // Written when the button is pressed, and gone after a reload. Coordinates
      // must not sit on screen because a tab was left open.
      await page.reload()
      await expect(page.locator('#logbook-locate-state a.logbook-coords')).toHaveCount(0)
    } finally {
      await context.close()
    }
  })

  /**
   * A greeting may carry exactly what an export may carry.
   *
   * Two questions that look different - what a file may hold, what a peer may
   * be told - are the same question: what may leave this device. Answering it
   * twice is how the answers drift, so this asserts the greeting against the
   * projection's own rule rather than against a list written here.
   */
  test('tells a peer what an export would carry, and nothing finer', async ({ browser, browserName, baseURL }) => {
    test.skip(
      browserName === 'webkit' && process.platform === 'linux',
      'Playwright WebKit on Linux cannot establish a WebRTC connection'
    )

    const alice = await (await browser.newContext({ baseURL })).newPage()
    const bob = await (await browser.newContext({ baseURL })).newPage()

    try {
      await open(alice)
      await open(bob)

      // Bob looks himself up, so he has all of it to send: provider, country,
      // region, city and a public IP.
      const hits = await answerWith(bob, {
        ip: '203.0.113.7',
        isp: { isp: 'Example Telecom' },
        location: { country_code: 'DE', state: 'Bavaria', city: 'Munich' }
      })

      await bob.locator('#logbook-lookup-consent').check()
      await bob.locator('#logbook-locate').click()
      await usedStub(bob, hits)
      await expect(bob.locator('#logbook-provider')).toHaveValue('Example Telecom')

      await alice.locator('#create-offer').click()
      await expect(alice.locator('#invite-box')).toBeVisible({ timeout: 60000 })

      const invite = await alice.locator('#invite-link').inputValue()
      await bob.goto(invite.replace(/^https?:\/\/[^/]+/, ''))
      await expect(bob.locator('#invite-link')).toHaveValue(/#r=/, { timeout: 60000 })

      const reply = await bob.locator('#invite-link').inputValue()
      await alice.locator('#paste-reply').click()
      await alice.locator('#payload-display').fill(reply)
      await alice.locator('#process-payload').click()

      await expect.poll(() => entries(alice).then(([e]) => e?.reported?.provider), { timeout: 60000 })
        .toBe('Example Telecom')

      const [entry] = await entries(alice)

      expect(entry.reported.country).toBe('DE')
      // Correct, free, and from the far end's own browser rather than from a
      // guess about its provider's routing.
      expect(entry.reported.timeZone).toBeTruthy()

      // The two the projection withholds. Asserted against the whole entry
      // rather than the named fields, so a payload that grows a city under some
      // other name fails here too.
      const written = JSON.stringify(entry)

      expect(written, 'the greeting leaked the far end\'s city').not.toContain('Munich')
      expect(written, 'the greeting carried an IP-derived region').not.toContain('Bavaria')
      expect(written, 'the greeting leaked the far end\'s public IP').not.toContain('203.0.113.7')
    } finally {
      await alice.close()
      await bob.close()
    }
  })
})

