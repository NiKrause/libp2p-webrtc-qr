import { expect, test } from '@playwright/test'

/**
 * Opening someone's link, and leaving while one is waiting.
 *
 * Both come from the same report: two phones passing links through Telegram.
 * Opening a link starts a peer and gathers ICE before anything appears, which
 * on a phone is several seconds of a page that looks broken. And sharing a link
 * *means* leaving - the messenger comes up, this page goes to the background,
 * and the invite's candidates describe NAT mappings that close while it is gone.
 *
 * The second half is not a fix, because a one-shot link cannot re-gather. It is
 * the difference between a failure a person can act on and one they cannot.
 */

/**
 * Sixty seconds, not thirty.
 *
 * Making an invite means gathering ICE against real STUN servers, and the
 * config already runs CI single-worker because a two-core runner starves them.
 * Thirty seconds is a bet on that machine being unloaded: it held here and lost
 * in Firefox on CI, where the dialog was still closed after 62 polls. The poll
 * that follows needs the same allowance - the field is emptied while gathering.
 */
const GATHER_TIMEOUT = 60000

/**
 * Host candidates only, as the rest of the suite does.
 *
 * These tests are about the connection's lifecycle, not about which addresses
 * it found - and gathering against real STUN servers costs seconds each time.
 * Paying that here is what pushed the Firefox run past sixty seconds on a
 * two-core runner: not one slow test, a suite full of them.
 *
 * The invite link drops the query on purpose (`url.search = ''`), so it has to
 * be put back for the side that arrives by opening one.
 */
const APP = '/?ice=host&view=technical&intro=off'
const asHostIce = link => link.replace('#', '?ice=host&view=technical&intro=off#')

const createInvite = async page => {
  await page.locator('#start-client').click()
  await page.locator('#create-offer').click()
  await expect(page.locator('#invite-box')).toBeVisible({ timeout: GATHER_TIMEOUT })
  await expect
    .poll(() => page.locator('#invite-link').inputValue(), { timeout: GATHER_TIMEOUT })
    .toMatch(/#i=/)

  return page.locator('#invite-link').inputValue()
}

/**
 * Record the steps from inside the page.
 *
 * Polling them from the test does not work: a locator call every 120ms races
 * the navigation it is meant to be observing, and the page loses. An observer
 * installed before the document runs sees every value with no such contention,
 * and sessionStorage carries the record across the navigation.
 */
const recordSteps = page => page.addInitScript(() => {
  sessionStorage.setItem('steps', '[]')

  const push = () => {
    const el = document.getElementById('open-progress-step')

    if (el == null || el.textContent.length === 0) {
      return
    }

    const seen = JSON.parse(sessionStorage.getItem('steps') ?? '[]')
    const value = `${el.textContent}|${document.getElementById('open-progress-bar')?.value ?? ''}`

    if (seen.at(-1) !== value) {
      sessionStorage.setItem('steps', JSON.stringify([...seen, value]))
    }
  }

  // Two mechanisms, because either alone misses a step. Hanging the observer
  // off DOMContentLoaded is too late - the page's module script is deferred, so
  // it runs and announces step 1 before that fires. And sampling on a timer is
  // a race: step 1 lasted under 20ms in a measured run, and 20ms ticks skipped
  // straight over it. A document-level observer fires synchronously on the
  // change itself, whatever the main thread is doing around it.
  const attach = () => {
    if (document.documentElement == null) {
      return false
    }

    new MutationObserver(push).observe(document.documentElement, {
      childList: true,
      characterData: true,
      subtree: true
    })

    return true
  }

  if (!attach()) {
    const waiting = setInterval(() => attach() && clearInterval(waiting), 1)
  }
})

const stepsOf = page => page.evaluate(() => JSON.parse(sessionStorage.getItem('steps') ?? '[]'))

test.describe('opening a link', () => {
  test('reports each step, in order, before the reply appears', async ({ browser }) => {
    const offerer = await browser.newPage()
    const answerer = await browser.newPage()

    await offerer.goto(APP)
    const invite = await createInvite(offerer)

    await recordSteps(answerer)
    // Straight to the link, as a person arrives from a chat - no visit first.
    await answerer.goto(asHostIce(invite))
    // The answering side gathers too, so it gets the same allowance.
    await expect(answerer.locator('#invite-link')).toHaveValue(/#r=/, { timeout: GATHER_TIMEOUT })

    const steps = await stepsOf(answerer)
    const text = steps.join(' ~ ')

    // Named in the order they happen. Which step is slow is the useful part:
    // step 3 is where the seconds go, and where it fails.
    expect(text).toMatch(/Step 1 of 3 — starting your peer/)
    expect(text).toMatch(/Step 2 of 3 — checking their invite/)
    expect(text).toMatch(/Step 3 of 3 — building your reply/)
    expect(text.indexOf('Step 1')).toBeLessThan(text.indexOf('Step 3'))

    // A bar that only ever shows its final value is a label, not progress.
    expect(steps.map(entry => Number(entry.split('|').at(-1)))).toContain(1)
    expect(steps.map(entry => Number(entry.split('|').at(-1)))).toContain(3)

    // And it goes away once there is something to look at.
    await expect(answerer.locator('#open-progress')).toBeHidden()

    await offerer.close()
    await answerer.close()
  })

  test('says nothing when no link was opened', async ({ page }) => {
    await page.goto(APP)
    await page.locator('#start-client').click()

    // The panel belongs to the arrive-from-a-chat flow. Someone who pressed
    // Start themselves is not waiting on anything and should not be told to.
    await expect(page.locator('#open-progress')).toBeHidden()
  })
})

// The behaviour around *leaving* - the urgency hint, and the warning on the
// way back - lives in hurry-back.spec.js. It stopped being about elapsed time
// when two Android phones showed the connection gone after a couple of seconds,
// so it is now asserted against the connection's own state, next to the rest of
// that story rather than split across two files.
