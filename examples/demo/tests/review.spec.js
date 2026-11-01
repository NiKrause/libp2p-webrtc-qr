import { expect, test } from '@playwright/test'

/**
 * Reviewing what was recorded: the stage between measuring and publishing.
 *
 * The feature is a judgement, so these specs are mostly about what the
 * judgement *gates*. A dataset that cannot tell "this network cannot do it"
 * from "I aimed the camera wrong" is worth nothing, and the only instrument
 * that can tell them apart is the person who was standing there - so the one
 * thing that must not be possible is for an unreviewed row to slip through as
 * though somebody had vouched for it.
 *
 * They drive the demo rather than the module because the gate is wiring: a
 * control per row, a filter that makes the list a work queue, and a projection
 * that has to drop the free text while keeping the verdict.
 */

const entries = page => page.evaluate(() => JSON.parse(localStorage.getItem('webrtc-qr.logbook.v1') ?? '[]'))

const open = async (page, { query = '' } = {}) => {
  await page.goto(`/?ice=host&view=technical&intro=off${query}`)

  await page.locator('#logbook-enabled').check()
  await expect(page.locator('#logbook-enabled')).toBeChecked()

  await page.locator('#start-client').click()
  await page.waitForFunction(() => document.getElementById('peer-id').textContent !== 'not started')
}

/**
 * Rows, the cheap way: a payload that cannot be decoded fails fast and is
 * recorded as faithfully as a real failure. What is under test here is what a
 * person then makes of a row, which does not care how the row was earned.
 */
const record = async (page, times = 1) => {
  await page.locator('.paste-fallback summary').click()

  for (let i = 0; i < times; i++) {
    await page.locator('#payload-display').fill(`https://example.org/#r=q3:nonsense-${i}`)
    await page.locator('#process-payload').click()
    await expect.poll(() => entries(page).then(list => list.length), { timeout: 30000 }).toBe(i + 1)
  }
}

const rows = page => page.locator('.logbook-entry')
const publishable = page => page.evaluate(() => window.__libp2pQrTest.logbookPublishable())

test.describe('reviewing what was recorded', () => {
  test('a row arrives unreviewed, and unreviewed is not sound', async ({ page }) => {
    await open(page)
    await record(page)

    // The default is the whole claim: if an unreviewed row were publishable,
    // the stage would be decoration.
    expect((await entries(page))[0].review).toBeNull()
    expect(await publishable(page)).toEqual([])

    await expect(rows(page).first().locator('.review-verdict')).toHaveValue('')
  })

  test('only the rows marked sound become publishable', async ({ page }) => {
    await open(page)
    await record(page, 3)

    // Newest first, so this is the third row recorded, then the second.
    await rows(page).nth(0).locator('.review-verdict').selectOption('sound')
    await rows(page).nth(1).locator('.review-verdict').selectOption('operator-error')

    await expect.poll(() => publishable(page).then(list => list.length)).toBe(1)

    const [sound] = await publishable(page)

    expect(sound.review).toBe('sound')
    // The third row is still untouched, and that is the one that matters: a
    // gate that let through everything nobody had excluded would pass this
    // test's first half and defeat its purpose.
    expect((await entries(page)).filter(entry => entry.review == null)).toHaveLength(1)
  })

  test('the verdict travels and the note does not', async ({ page }) => {
    await open(page)
    await record(page)

    await rows(page).first().locator('.review-verdict').selectOption('operator-error')

    const note = rows(page).first().locator('.review-note')

    await note.fill('scanned the invite instead of the reply, in a hotel lobby with Anna')
    // On blur, not on every keystroke: the list is rebuilt whenever the log
    // changes, so recording as somebody types would take the field away from
    // them mid-word.
    await note.blur()

    await expect.poll(() => entries(page).then(([entry]) => entry.reviewNote)).toContain('hotel lobby')

    const exported = JSON.parse(await page.evaluate(() => window.__libp2pQrTest.logbookExport()))

    // The verdict is what a dataset needs. The note is the one field here whose
    // content nobody can predict, because it is written while diagnosing a
    // failure - which is exactly when somebody writes down the room and who
    // was holding the other phone.
    expect(exported.entries[0].review).toBe('operator-error')
    expect(exported.entries[0]).not.toHaveProperty('reviewNote')
    expect(JSON.stringify(exported)).not.toContain('Anna')
    // And it says so, rather than leaving a recipient to notice the absence.
    expect(exported.redacted.join(' ')).toMatch(/review note/i)
  })

  test('clearing a verdict takes its note with it', async ({ page }) => {
    await open(page)
    await record(page)

    await rows(page).first().locator('.review-verdict').selectOption('retest')
    await rows(page).first().locator('.review-note').fill('the code expired on the way to the other room')
    await rows(page).first().locator('.review-note').blur()

    await expect.poll(() => entries(page).then(([entry]) => entry.reviewNote)).not.toBeNull()

    await rows(page).first().locator('.review-verdict').selectOption('')

    // A note describes a verdict. Left behind on a row with none, it would read
    // to the next person - most likely the same person, later - as if somebody
    // had already looked at the row.
    await expect.poll(() => entries(page).then(([entry]) => entry.reviewNote)).toBeNull()
    await expect(rows(page).first().locator('.review-note')).toHaveCount(0)
  })

  test('the filter is a work queue, and an empty queue is not an empty log', async ({ page }) => {
    await open(page)
    await record(page, 2)

    await page.locator('#review-filter').selectOption('unreviewed')
    await expect(rows(page)).toHaveCount(2)

    await rows(page).nth(0).locator('.review-verdict').selectOption('sound')
    await expect(rows(page)).toHaveCount(1)

    await rows(page).nth(0).locator('.review-verdict').selectOption('operator-error')
    await expect(rows(page)).toHaveCount(0)

    // The two statements are different and only one of them is true: the log
    // has two rows in it.
    await expect(page.locator('.review-none')).toBeVisible()
    await expect(page.locator('.logbook-empty')).toBeHidden()
  })

  test('the tally counts the whole log, not the part being shown', async ({ page }) => {
    await open(page)
    await record(page, 2)

    await rows(page).nth(0).locator('.review-verdict').selectOption('sound')
    await page.locator('#review-filter').selectOption('sound')

    await expect(rows(page)).toHaveCount(1)
    // "is the review finished" is the question this answers, and a count that
    // shrank to match the filter would answer yes every time the queue emptied.
    await expect(page.locator('#review-tally')).toContainText('1 of 2')
  })

  test('says when a sound row has no scenario to attribute it to', async ({ page }) => {
    await open(page)
    await record(page)

    await rows(page).first().locator('.review-verdict').selectOption('sound')

    // True observation, no question. It is not excluded for that - it simply
    // cannot appear in the breakdown by scenario the exercise is for, and
    // learning that while reviewing beats learning it while querying.
    await expect(page.locator('#review-tally')).toContainText(/no scenario/i)
  })

  test('a labelled sound row is not flagged', async ({ page }) => {
    await open(page, { query: '&scenario=same-lan' })
    await record(page)

    await rows(page).first().locator('.review-verdict').selectOption('sound')

    await expect(page.locator('#review-tally')).toContainText('1 of 1')
    await expect(page.locator('#review-tally')).not.toContainText(/no scenario/i)
  })

  test('reviewing works with recording off, because that is when it happens', async ({ page }) => {
    await open(page)
    await record(page)

    // Somebody who has finished testing and closed the tap is exactly the
    // person about to sit down and go through the rows. One switch meaning two
    // things would stop them.
    await page.locator('#logbook-enabled').uncheck()
    await rows(page).first().locator('.review-verdict').selectOption('sound')

    await expect.poll(() => publishable(page).then(list => list.length)).toBe(1)
  })

  test('the focus stays in the row a verdict was given on', async ({ page }) => {
    await open(page)
    await record(page, 2)

    const second = rows(page).nth(1)
    const id = await second.getAttribute('data-id')

    // Driven by hand rather than with `selectOption`, which leaves the focus on
    // the body - measured, not assumed. This is what a person's keyboard
    // produces: the control keeps the focus and the page gets a change event.
    await second.locator('.review-verdict').evaluate(el => {
      el.focus()
      el.value = 'retest'
      el.dispatchEvent(new Event('change', { bubbles: true }))
    })

    // The list is rebuilt wholesale on every change, so without putting the
    // focus back, giving a verdict on row forty would send somebody to the top
    // of the page - which is the difference between a review and a chore.
    expect(await page.evaluate(() => ({
      control: document.activeElement.className,
      row: document.activeElement.closest('.logbook-entry')?.dataset.id
    }))).toEqual({ control: 'review-verdict', row: id })
  })

  test('the verdicts follow the language', async ({ page }) => {
    await open(page)
    await record(page)

    const verdict = rows(page).first().locator('.review-verdict')

    await expect(verdict).toContainText(/Operator error/i)

    // Built in JavaScript, so `translateDocument` never reaches these - the
    // switch has to repaint the rows and the tally with them.
    await page.locator('#locale-de').click()

    await expect(verdict).toContainText(/Bedienfehler/i)
    await expect(page.locator('#review-tally')).toContainText(/geprüft/i)
  })
})
