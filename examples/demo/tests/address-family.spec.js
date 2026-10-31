import { expect, test } from '@playwright/test'

/**
 * Asking about one address family on purpose (#179, step 3).
 *
 * The arithmetic of the filter is asserted in the package's own tests, where an
 * SDP is a string and a dropped newline is visible. What is left here is the
 * part only a page can answer: that the control reaches the session, that a
 * restriction is recorded *as* a restriction, that it does not ride along with
 * the invite, and that an invite with nothing of the chosen family to offer is
 * refused out loud rather than shown and left to time out.
 *
 * ## Why no code is shown here
 *
 * `?ice=host` - what every spec in this suite uses, so that no test depends on
 * a STUN server being reachable - gathers host candidates only, and all three
 * engines withhold host addresses behind an mDNS `.local` name by default. That
 * name says nothing about which family it stands for, so the filter drops it,
 * and with nothing else gathered there is nothing left to offer. In a default
 * test browser *every* filtered invite is refused, and that is a property of
 * the feature rather than of the test.
 *
 * The claims that need a real address - which families were recorded, what the
 * link carries - are in `address-family-real-addresses.spec.js`, which has to
 * be a file of its own because Playwright will not take `launchOptions` from a
 * describe block.
 */

const LOG_KEY = 'webrtc-qr.logbook.v1'

const entries = page => page.evaluate(key => JSON.parse(localStorage.getItem(key) ?? '[]'), LOG_KEY)

const open = async (page, { query = '' } = {}) => {
  await page.goto(`/?ice=host&view=technical&intro=off${query}`)

  await page.locator('#logbook-enabled').check()
  await expect(page.locator('#logbook-enabled')).toBeChecked()

  await page.locator('#start-client').click()
  await page.waitForFunction(() => document.getElementById('peer-id').textContent !== 'not started')
}

const choose = (page, value) => page.locator('#address-family').selectOption(value)

/**
 * Press the invite button and wait for whichever of the two endings arrives.
 *
 * A filtered invite has two honest endings - a code, or a refusal that is
 * itself the finding - and which one happens depends on what the machine
 * gathered. A helper that waited only for the code would hang for its whole
 * timeout on the other one and report nothing about why.
 */
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

test.describe('offering one address family', () => {
  test('offers everything by default, and says nothing while it does', async ({ page }) => {
    await open(page)

    await expect(page.locator('#address-family')).toHaveValue('')
    // The note explains a restriction. With none in force it would be three
    // sentences about something that is not happening.
    await expect(page.locator('#family-brief')).toBeHidden()
  })

  test('stays behind the technical view, because it can break a working connection', async ({ page }) => {
    // Unlike the short-code box beside it, this control can make an invite that
    // would have worked fail. That is the point when the question is whether a
    // family works at all, and a trap in front of somebody who only wants to
    // talk to their friend.
    await page.goto('/?ice=host&view=simple&intro=off')

    await expect(page.locator('.family-filter')).toBeHidden()
  })

  test('a link can open a restricted tab, and the restriction stays in the query string', async ({ page }) => {
    await open(page, { query: '&family=v6' })

    await expect(page.locator('#address-family')).toHaveValue('v6')

    const brief = page.locator('#family-brief')

    await expect(brief).toBeVisible()
    // Three facts the control itself cannot show: that it governs what this
    // device accepts, that an empty offer is refused, and that a withheld
    // address counts as neither family.
    await expect(brief).toContainText(/accepts only IPv6/i)
    await expect(brief).toContainText(/refused/i)
    await expect(brief).toContainText(/\.local/i)
  })

  test('a nonsense family is no filter at all', async ({ page }) => {
    // A typo in a hand-written link should connect normally, not half-cripple
    // the page in a way nothing on screen explains.
    await open(page, { query: '&family=ipv6' })

    await expect(page.locator('#address-family')).toHaveValue('')
    await expect(page.locator('#family-brief')).toBeHidden()
  })

  test('the note follows the language, rather than keeping the one it was drawn in', async ({ page }) => {
    await open(page)
    await choose(page, 'v6')

    const brief = page.locator('#family-brief')

    await expect(brief).toContainText(/accepts only IPv6/i)

    // Built in JavaScript, so `translateDocument` never reaches it.
    await page.locator('#locale-de').click()

    await expect(brief).toContainText(/nimmt nur IPv6 an/i)
  })

  test('withheld addresses are a refusal that names the browser, not the network', async ({ page }) => {
    // The default state of every engine, and so the state most people will meet
    // first: host candidates arrive as `.local` names, the filter drops them
    // all, and there is nothing to offer. The two ways of having nothing left
    // are different findings - this network has no IPv6, or this browser will
    // not say - and a run cannot be read later unless the record says which.
    await open(page)
    await choose(page, 'v4')

    expect(await createInvite(page)).toBe('refused')

    const failed = (await entries(page)).filter(entry => entry.outcome === 'failed')

    expect(failed.length).toBe(1)
    expect(failed[0].reason).toMatch(/withheld as an mDNS/i)
    expect(failed[0].reason).toMatch(/STUN/i)
    // Recorded, not merely shown. Before this the open entry was left dangling
    // and closed as `abandoned` by whatever started next, which threw the
    // finding away.
    expect(failed[0].familyFilter).toBe('v4')
  })
})
