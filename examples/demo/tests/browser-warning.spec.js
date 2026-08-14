import { expect, test } from '@playwright/test'

/**
 * What this browser does to a waiting invite, said at the press of *Create
 * invite link*.
 *
 * That is the last moment where switching browsers is still a cheap decision.
 * Afterwards the invite exists and its life is measured in seconds, so saying it
 * then is saying it too late.
 *
 * The list of browsers that hold is a record of hand testing on phones, not
 * something the platform promises - which is why the wording says "have been
 * seen to" rather than stating it as a rule.
 */

const APP = '/?ice=host'

const PHONE_UA = {
  chrome: 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
  firefox: 'Mozilla/5.0 (Android 13; Mobile; rv:120.0) Gecko/120.0 Firefox/120.0',
  ddg: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 DuckDuckGo/7 Safari/605.1.15',
  // The Android string carries "Chrome", so if detection ever regressed to
  // matching that first, a DuckDuckGo user would be told their browser drops
  // invites when it is one of the two that does not. Hence a real string here.
  ddgAndroid: 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/130.0.6723.106 Mobile DuckDuckGo/5 Safari/537.36',
  safari: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'
}

/** A phone answers this pair; a desktop does not, whatever its user agent says. */
const asPhone = page => page.addInitScript(() => {
  const real = window.matchMedia.bind(window)

  window.matchMedia = query => query.includes('hover: none')
    ? { matches: true, media: query, addEventListener () {}, removeEventListener () {} }
    : real(query)
})

const createInvite = async page => {
  await page.locator('#start-client').click()
  await page.locator('#create-offer').click()
}

const openOn = async (browser, { userAgent, phone = true }) => {
  const context = await browser.newContext(userAgent == null ? {} : { userAgent })
  const page = await context.newPage()

  if (phone) {
    await asPhone(page)
  }

  await page.goto(APP)
  await expect.poll(() => page.evaluate(() => document.documentElement.dataset.browser)).not.toBe(undefined)

  return { context, page }
}

test.describe('the browser warning at invite time', () => {
  test('warns in a phone browser that does not hold the invite', async ({ browser }) => {
    const { context, page } = await openOn(browser, { userAgent: PHONE_UA.chrome })

    // Nothing before the press - no invite is waiting, so there is nothing to
    // lose yet and nothing to say.
    await expect(page.locator('#browser-warning')).toBeHidden()

    await createInvite(page)

    await expect(page.locator('#browser-warning')).toBeVisible()
    await expect(page.locator('#browser-warning')).toContainText(/DuckDuckGo and Safari/i)
    // The part that is easy to leave out and matters most: the other person
    // leaves twice, and both trips have to be quick.
    await expect(page.locator('#browser-warning')).toContainText(/leave twice/i)
    await expect(page.locator('#browser-warning')).toContainText(/no way around this yet/i)

    await context.close()
  })

  test('warns in mobile Firefox too', async ({ browser }) => {
    const { context, page } = await openOn(browser, { userAgent: PHONE_UA.firefox })

    await createInvite(page)
    await expect(page.locator('#browser-warning')).toBeVisible()

    await context.close()
  })

  for (const name of ['ddg', 'ddgAndroid', 'safari']) {
    test(`stays quiet in ${name}, where the flow is workable`, async ({ browser }) => {
      const { context, page } = await openOn(browser, { userAgent: PHONE_UA[name] })

      await createInvite(page)

      // Warning everywhere would make the warning worth ignoring.
      await expect(page.locator('#browser-warning')).toBeHidden()
      expect(await page.locator('#browser-warning').textContent()).toBe('')

      await context.close()
    })
  }

  test('repeats the browser-specific part in the dialog, where the leaving happens', async ({ browser }) => {
    const { context, page } = await openOn(browser, { userAgent: PHONE_UA.chrome })

    await createInvite(page)
    await expect(page.locator('#invite-box')).toBeVisible({ timeout: 60000 })
    await page.locator('#copy-payload').click()

    // The dialog covers step 2 the moment it opens, so the heads-up there has
    // left the screen by the time anyone taps Send. The sentence that must be
    // true at the instant of leaving is repeated here rather than assumed read.
    await expect(page.locator('#hurry-back')).toBeVisible()
    await expect(page.locator('#hurry-back')).toContainText(/does not hold a waiting invite/i)

    await context.close()
  })

  test('stays quiet on a desktop, whatever the browser', async ({ browser }) => {
    const { context, page } = await openOn(browser, { userAgent: PHONE_UA.chrome, phone: false })

    await createInvite(page)

    // A desktop keeps a background tab running; none of this applies there.
    await expect(page.locator('#browser-warning')).toBeHidden()
    expect(await page.locator('#browser-warning').textContent()).toBe('')

    await context.close()
  })
})
