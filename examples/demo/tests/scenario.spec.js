import { expect, test } from '@playwright/test'

/**
 * Running a scenario on purpose, rather than connecting and hoping.
 *
 * The field this drives already existed; what did not was any way to set it
 * without editing a URL by hand, and any way for the *other* device to know a
 * run was a test. A solo scenario is two devices writing a row each, so a label
 * that stops at the device that set it produces half a measurement - which is
 * the one case these specs care most about.
 *
 * They drive the demo rather than the module because the whole feature is
 * wiring: a control, a link, and the four places an attempt can start.
 */

const entries = page => page.evaluate(() => JSON.parse(localStorage.getItem('webrtc-qr.logbook.v1') ?? '[]'))

const open = async (page, { record = true, query = '' } = {}) => {
  await page.goto(`/?ice=host&view=technical&intro=off${query}`)

  if (record) {
    await page.locator('#logbook-enabled').check()
    await expect(page.locator('#logbook-enabled')).toBeChecked()
  }

  await page.locator('#start-client').click()
  await page.waitForFunction(() => document.getElementById('peer-id').textContent !== 'not started')
}

const pick = async (page, value) => {
  await page.locator(`input[name="scenario"][value="${value}"]`).check()
}

test.describe('running a scenario', () => {
  test('starts as no test at all, which is what it should be almost always', async ({ page }) => {
    await open(page)

    // The default matters more than it looks: a picker that remembered its last
    // choice would quietly label ordinary attempts as measurements for as long
    // as somebody left it alone.
    await expect(page.locator('input[name="scenario"][value=""]')).toBeChecked()
    await expect(page.locator('#scenario-brief')).toBeHidden()
  })

  test('picking one labels the attempts that follow', async ({ page }) => {
    await open(page)
    await pick(page, 'same-lan')

    await page.locator('#create-offer').click()
    await expect(page.locator('#invite-box')).toBeVisible({ timeout: 60000 })

    expect(await page.evaluate(() => window.__libp2pQrTest.logbookPending()?.scenario)).toBe('same-lan')
  })

  test('the brief says what must be true, not just what to press', async ({ page }) => {
    await open(page)
    await pick(page, 'mobile-data')

    const brief = page.locator('#scenario-brief')

    await expect(brief).toBeVisible()
    // The hotspot warning is the one that earns this panel its place: one phone
    // tethering the other is scenario A over a carrier, it usually succeeds, and
    // it would enter the record as a mobile-data success.
    await expect(brief).toContainText(/hotspot/i)
    expect(await brief.locator('ol li').count()).toBeGreaterThan(2)
  })

  test('says so when a labelled run would record nothing', async ({ page }) => {
    // Recording off and a scenario picked is the one combination that is
    // silently pointless, so it is the one the panel has to speak up about.
    await open(page, { record: false })
    await pick(page, 'same-lan')

    await expect(page.locator('.scenario-off')).toBeVisible()

    await page.locator('#logbook-enabled').check()

    // And it goes away by itself: the brief follows the log rather than only
    // repainting when somebody picks a scenario again.
    await expect(page.locator('.scenario-off')).toBeHidden()
  })

  test('clearing it back makes the next attempt an ordinary one again', async ({ page }) => {
    await open(page)
    await pick(page, 'same-lan')
    await pick(page, '')

    await page.locator('#create-offer').click()
    await expect(page.locator('#invite-box')).toBeVisible({ timeout: 60000 })

    expect(await page.evaluate(() => window.__libp2pQrTest.logbookPending()?.scenario)).toBeNull()
  })

  test('the label travels with the invite, so the other device labels its own row', async ({ page, context }) => {
    await open(page)
    await pick(page, 'same-lan')

    await page.locator('#create-offer').click()
    await expect(page.locator('#invite-box')).toBeVisible({ timeout: 60000 })

    const link = await page.locator('#invite-link').inputValue()

    // In the fragment, beside the payload - not in the query string, which
    // `linkFor` clears so this device's debug flags stay here.
    expect(link).toContain('s=same-lan')
    expect(new URL(link).search).toBe('')

    // The receiving side is what the claim is actually about: opening the link
    // has to leave that page labelled without anybody setting it twice.
    const far = await context.newPage()

    await far.goto(link)
    await far.waitForFunction(() => window.__libp2pQrTest != null)

    expect(await far.evaluate(() => window.__libp2pQrTest.scenario())).toBe('same-lan')
  })

  test('an unlabelled invite leaves the far side unlabelled', async ({ page, context }) => {
    // The other half of the claim above, and the one that would break quietly:
    // a link that always carried a scenario would label every ordinary
    // connection anybody ever made with it.
    await open(page)

    await page.locator('#create-offer').click()
    await expect(page.locator('#invite-box')).toBeVisible({ timeout: 60000 })

    const link = await page.locator('#invite-link').inputValue()

    expect(link).not.toContain('s=')

    const far = await context.newPage()

    await far.goto(link)
    // Not polled with a fallback: `?? 'not ready'` would swallow the very null
    // this test exists to prove, and pass for the wrong reason forever.
    await far.waitForFunction(() => window.__libp2pQrTest != null)

    expect(await far.evaluate(() => window.__libp2pQrTest.scenario())).toBeNull()
  })

  test('counts only the runs of the scenario in front of you', async ({ page }) => {
    await open(page)

    // Two recorded attempts under different labels, made the cheap way: a
    // payload that cannot be decoded fails fast and is recorded as faithfully
    // as a real failure.
    await page.locator('.paste-fallback summary').click()

    for (const scenario of ['same-lan', 'mobile-data']) {
      await pick(page, scenario)
      await page.locator('#payload-display').fill('https://example.org/#r=q3:nonsense')
      await page.locator('#process-payload').click()
      await expect.poll(() => entries(page).then(list => list.length), { timeout: 30000 })
        .toBe(scenario === 'same-lan' ? 1 : 2)
    }

    await pick(page, 'same-lan')

    // One each, so a tally that counted every labelled run would read 2 here.
    await expect(page.locator('.scenario-tally')).toContainText('1')
  })

  test('the brief follows the language, rather than keeping the one it was drawn in', async ({ page }) => {
    await open(page)
    await pick(page, 'same-lan')

    const brief = page.locator('#scenario-brief')

    await expect(brief).toContainText(/Wi-Fi/i)

    // Built in JavaScript, so `translateDocument` never reaches it - the switch
    // has to repaint it, and before this it kept whichever language it was first
    // drawn in.
    await page.locator('#locale-de').click()

    await expect(brief).toContainText(/WLAN/i)
  })
})
