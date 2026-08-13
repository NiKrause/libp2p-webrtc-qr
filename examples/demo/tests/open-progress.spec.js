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
 * Drive the page's own notion of visibility.
 *
 * Stated plainly: this is not a phone going to the background. It cannot be -
 * a headless browser has no home button, and the CDP override is not in every
 * build. What it does exercise is the code that runs on the transition, which
 * is the part that was written. Whether a real NAT mapping lapses in the
 * meantime is the question the two-phone test answers, not this one.
 */
const setVisibility = async (page, value) => {
  await page.evaluate(state => {
    Object.defineProperty(document, 'visibilityState', { value: state, configurable: true })
    Object.defineProperty(document, 'hidden', { value: state === 'hidden', configurable: true })
    document.dispatchEvent(new Event('visibilitychange'))
  }, value)
}

const hide = page => setVisibility(page, 'hidden')
const show = page => setVisibility(page, 'visible')

/**
 * A clock the test can move.
 *
 * The threshold being tested is twenty seconds, and three tests waiting that
 * long in real time cost a minute of the suite - and, measured, pushed two
 * unrelated tests in other engines over their own timeouts. Nothing here
 * depends on time actually passing, only on what the page computes from it.
 */
const withClock = page => page.addInitScript(() => {
  window.__skew = 0
  const real = Date.now

  Date.now = () => real() + window.__skew
})

const advance = (page, ms) => page.evaluate(amount => { window.__skew += amount }, ms)

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

    await offerer.goto('/')
    const invite = await createInvite(offerer)

    await recordSteps(answerer)
    // Straight to the link, as a person arrives from a chat - no visit first.
    await answerer.goto(invite)
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
    await page.goto('/')
    await page.locator('#start-client').click()

    // The panel belongs to the arrive-from-a-chat flow. Someone who pressed
    // Start themselves is not waiting on anything and should not be told to.
    await expect(page.locator('#open-progress')).toBeHidden()
  })
})

test.describe('leaving while an invite waits', () => {
  test('says so on the way back, before anything has failed', async ({ browser }) => {
    const page = await browser.newPage()

    await withClock(page)
    await page.goto('/')
    await createInvite(page)

    // Twenty seconds is the threshold; this is the messenger round trip.
    await hide(page)
    await advance(page, 21000)
    await show(page)

    // Said while there is still something to do about it - the reply has not
    // even arrived yet. Warning only at failure time is a post-mortem.
    await expect(page.locator('#handoff-banner')).toContainText(/You were away for 2\d s|You were away for \d+s/)
    await expect(page.locator('#handoff-banner')).toContainText(/make a new invite/i)

    await page.close()
  })

  test('a short handover says nothing', async ({ browser }) => {
    const page = await browser.newPage()

    await withClock(page)
    await page.goto('/')
    await createInvite(page)

    // Copying a link and coming straight back is the flow that works. Warning
    // here would train people to ignore the warning that matters.
    await hide(page)
    await advance(page, 1500)
    await show(page)

    await expect(page.locator('#handoff-banner')).toBeHidden()

    await page.close()
  })

  test('a fresh invite clears what the old one lived through', async ({ browser }) => {
    const page = await browser.newPage()

    await withClock(page)
    await page.goto('/')
    await createInvite(page)

    await hide(page)
    await advance(page, 21000)
    await show(page)
    await expect(page.locator('#handoff-banner')).toBeVisible()

    // The new invite carries new candidates, so the tally has to start over -
    // otherwise every later invite inherits a warning it did not earn.
    await page.locator('#paste-reply').click().catch(() => {})
    await page.locator('#create-offer, #invite-another').first().click()
    await expect(page.locator('#invite-box')).toBeVisible({ timeout: GATHER_TIMEOUT })
    // Not the five-second default: the field is emptied while the next invite
    // gathers, and gathering against real STUN on a loaded runner outruns five
    // seconds - which is exactly how this passed here and failed in CI.
    await expect
      .poll(() => page.locator('#invite-link').inputValue(), { timeout: GATHER_TIMEOUT })
      .toMatch(/#i=/)

    // Hidden by the test, so what follows is about the *new* invite only. The
    // banner left over from the old one would otherwise satisfy any assertion
    // made after it, which is what made the first version of this test mush.
    await page.evaluate(() => { document.getElementById('handoff-banner').hidden = true })

    await hide(page)
    await advance(page, 1500)
    await show(page)

    await expect(page.locator('#handoff-banner')).toBeHidden()

    await page.close()
  })
})
