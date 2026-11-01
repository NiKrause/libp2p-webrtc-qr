import { expect, test } from '@playwright/test'

/**
 * The address-family filter where the addresses are real.
 *
 * `WebRtcHideLocalIpsWithMdns` is the Chromium feature that turns host
 * addresses into `.local` names. With it off, a host-only gather produces
 * ordinary IPv4 and IPv6 addresses and the filter has something to choose
 * between - which is what a field run has too, by way of the reflexive
 * candidates a STUN server hands back.
 *
 * Its own file, not a describe block in `address-family.spec.js`: Playwright
 * refuses `launchOptions` anywhere but the top level, because changing them
 * forces a new worker. Chromium only - it is the one engine with a switch for
 * this that does not need a reachable STUN server.
 */

test.use({
  launchOptions: {
    args: ['--disable-features=WebRtcHideLocalIpsWithMdns']
  }
})

const LOG_KEY = 'webrtc-qr.logbook.v1'

const entries = page => page.evaluate(key => JSON.parse(localStorage.getItem(key) ?? '[]'), LOG_KEY)

const open = async page => {
  await page.goto('/?ice=host&view=technical&intro=off')

  await page.locator('#logbook-enabled').check()
  await expect(page.locator('#logbook-enabled')).toBeChecked()

  await page.locator('#start-client').click()
  await page.waitForFunction(() => document.getElementById('peer-id').textContent !== 'not started')
}

const choose = (page, value) => page.locator('#address-family').selectOption(value)

/** Both honest endings, as in the companion file - see the note there. */
async function createInvite (page, { timeout = 90_000 } = {}) {
  await page.locator('#create-offer').click()

  const deadline = Date.now() + timeout

  while (Date.now() < deadline) {
    if (await page.evaluate(() => document.getElementById('invite-box')?.open === true)) {
      return 'shown'
    }

    if ((await entries(page)).some(entry => entry.outcome === 'failed')) {
      return 'refused'
    }

    await page.waitForTimeout(250)
  }

  throw new Error('the invite was neither shown nor refused')
}

test.describe('offering one family, with addresses the browser will admit to', () => {
  test.skip(({ browserName }) => browserName !== 'chromium', 'only Chromium has a switch for mDNS obfuscation')

  test('the restriction is recorded as a restriction, not as a network with nothing else', async ({ page }) => {
    await open(page)
    await choose(page, 'v4')

    expect(await createInvite(page)).toBe('shown')

    // The two fields say different things, which is why both exist. `families:
    // ['v4']` on its own would be indistinguishable from a network with no IPv6
    // at all - and #179 proposed exactly that one field.
    expect(await page.evaluate(() => window.__libp2pQrTest.logbookPending()?.familyFilter)).toBe('v4')

    // Written after the code is on screen, so it is polled rather than read.
    // Nothing but the chosen family survives, mDNS included.
    await expect
      .poll(() => page.evaluate(() => window.__libp2pQrTest.logbookPending()?.families), { timeout: 30000 })
      .toEqual(['v4'])
  })

  test('nothing about the filter travels with the invite', async ({ page, context }) => {
    // The opposite of the scenario label, which has to travel because the far
    // end writes its own row. A restriction that travelled would be a link that
    // quietly cripples the recipient's connection to answer somebody else's
    // question - and one device filtering both directions already holds both
    // sides to one family.
    await open(page)
    await choose(page, 'v4')

    expect(await createInvite(page)).toBe('shown')

    const link = await page.locator('#invite-link').inputValue()

    // Only the parameter: the payload is base64 and may contain any two
    // characters by chance.
    expect(link).not.toContain('family=')

    const far = await context.newPage()

    await far.goto(link)
    await far.waitForFunction(() => window.__libp2pQrTest != null)

    expect(await far.evaluate(() => window.__libp2pQrTest.addressFamily())).toBeNull()
  })
})
