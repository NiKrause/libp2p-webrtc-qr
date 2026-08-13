import { expect, test } from '@playwright/test'

/**
 * Is the half-finished connection still alive?
 *
 * Asked because nobody can answer it by looking: browsers close an
 * RTCPeerConnection when they suspend the page, and have shipped versions that
 * did it without firing any event (w3c/webrtc-pc#2489). There is nothing to
 * listen for - only something to read afterwards. So the readout records the
 * state on the way out and on the way back, and survives on screen.
 *
 * It covers both roles deliberately. The inviting side leaves an offer waiting
 * while it walks to a messenger; the answering side leaves the connection it
 * built from that offer and then walks to the same messenger to send the reply.
 * Either device can be the one that dies, and until this readout existed there
 * was no way to tell which.
 */

const GATHER_TIMEOUT = 60000

const health = page => page.locator('#invite-box .pc-health')

const setVisibility = (page, value) => page.evaluate(state => {
  Object.defineProperty(document, 'visibilityState', { value: state, configurable: true })
  Object.defineProperty(document, 'hidden', { value: state === 'hidden', configurable: true })
  document.dispatchEvent(new Event('visibilitychange'))
}, value)

const createInvite = async page => {
  await page.locator('#start-client').click()
  await page.locator('#create-offer').click()
  await expect(page.locator('#invite-box')).toBeVisible({ timeout: GATHER_TIMEOUT })
  await expect
    .poll(() => page.locator('#invite-link').inputValue(), { timeout: GATHER_TIMEOUT })
    .toMatch(/#i=/)

  return page.locator('#invite-link').inputValue()
}

test.describe('the connection readout', () => {
  test('shows the inviting side holding an offer open', async ({ page }) => {
    await page.goto('/')
    await createInvite(page)

    await expect(health(page)).toContainText(/invite \w+: (new|connecting|checking)/)
    await expect(health(page)).toHaveClass(/is-alive/)
  })

  test('shows the answering side holding its own connection', async ({ browser }) => {
    const offerer = await browser.newPage()
    const answerer = await browser.newPage()

    await offerer.goto('/')
    const invite = await createInvite(offerer)

    // The answering side is the one the report was missing: it builds a
    // connection from the invite and then leaves to send the reply back.
    await answerer.goto(invite)
    await expect(answerer.locator('#invite-link')).toHaveValue(/#r=/, { timeout: GATHER_TIMEOUT })

    await expect(health(answerer)).toContainText(/reply #1:/)

    await offerer.close()
    await answerer.close()
  })

  test('records what happened while the page was away', async ({ page }) => {
    await page.goto('/')
    await createInvite(page)

    await setVisibility(page, 'hidden')
    await setVisibility(page, 'visible')

    // The whole point: a line that is there to be read *afterwards*, naming the
    // state before and after, because during is invisible by definition.
    await expect(health(page)).toContainText(/after \d+s away:/)
    await expect(health(page)).toContainText(/invite \w+ (survived|\w+ → \w+)/)
  })

  test('turns red and says so when the browser closed it', async ({ page }) => {
    await page.goto('/')
    await createInvite(page)

    await setVisibility(page, 'hidden')
    // Exactly what a suspending browser does, and the reason this readout
    // exists: closed from underneath the page, with no event to hear.
    await page.evaluate(() => window.__libp2pQrTest.simulateSuspension())
    await setVisibility(page, 'visible')

    await expect(health(page)).toContainText(/→ (closed|gone)/)
    await expect(health(page)).toHaveClass(/is-dead/)
  })
})
