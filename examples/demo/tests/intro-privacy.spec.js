import { expect, test } from '@playwright/test'

/**
 * The statement that follows the choices, and the gate in front of it.
 *
 * A generic privacy notice describes an app nobody is running, and a tick
 * against it confirms nothing. This panel is assembled from what was actually
 * chosen, and the tick accepts that - which is the only version of the gesture
 * that means anything.
 *
 * The clauses are set from the test rather than from the demo on purpose: they
 * are the consumer's half, and what is under test is the mechanism that calls
 * them and repaints when an answer changes.
 */

const open = async (page, url = '/?ice=host') => {
  await page.goto(url)
  await page.waitForFunction(() => document.getElementById('intro') != null)
}

const panel = page => page.locator('qr-intro').locator('css=.privacy')
const clauses = page => panel(page).locator('li')

const configure = (page, { accept = false } = {}) =>
  page.evaluate(everything => {
    const intro = document.getElementById('intro')
    intro.privacy = {
      accept: everything.accept,
      // Deliberately answers differently depending on the state, so a stale
      // panel is visible as a wrong sentence rather than as a missing repaint.
      clauses: state => [
        state.relayOptIn ? 'A relay may hold this briefly.' : 'Nothing leaves this network.',
        `Identity: ${state.identity ?? 'none'}`
      ]
    }
  }, { accept })

test.describe('the statement that follows the choices', () => {
  test('there is no panel until an app passes clauses', async ({ page }) => {
    await open(page)
    // An empty panel is a promise the app did not make.
    await expect(panel(page)).toBeHidden()
  })

  test('the clauses an app passes are what it shows', async ({ page }) => {
    await open(page)
    await configure(page)

    await expect(clauses(page)).toHaveCount(2)
    await expect(clauses(page).first()).toContainText('Nothing leaves this network')
  })

  test('an answer that changes changes the statement', async ({ page }) => {
    await open(page)
    await configure(page)
    await expect(clauses(page).nth(1)).toContainText('none')

    await page.evaluate(() => {
      document.getElementById('intro').choices = { identity: 'passkey' }
    })

    await expect(clauses(page).nth(1)).toContainText('passkey')
  })

  test('choices are merged, so one switch does not erase the rest', async ({ page }) => {
    await open(page)
    await configure(page)
    await page.evaluate(() => {
      const intro = document.getElementById('intro')
      intro.choices = { identity: 'passkey' }
      intro.choices = { storage: 'indexeddb' }
    })

    await expect(clauses(page).nth(1)).toContainText('passkey')
    expect(await page.evaluate(() => document.getElementById('intro').choices.storage))
      .toBe('indexeddb')
  })

  test('without a gate the way out is open from the start', async ({ page }) => {
    await open(page)
    await configure(page, { accept: false })

    expect(await page.evaluate(() => document.getElementById('intro').accepted)).toBe(true)
  })

  test('with a gate there is no way out until the statement is accepted', async ({ page }) => {
    await open(page)
    await configure(page, { accept: true })

    const closeButton = page.locator('qr-intro').locator('css=.close')
    await expect(closeButton).toBeDisabled()

    // Disabled rather than hidden: somebody looking for the way out should see
    // where it is, not hunt for a button that appears once they guess right.
    await page.evaluate(() => document.getElementById('intro').close())
    expect(await page.evaluate(() => document.getElementById('intro').isOpen)).toBe(true)

    await page.evaluate(() => {
      const intro = document.getElementById('intro')
      const box = intro.shadowRoot.querySelector('input[part=accept]')
      box.checked = true
      box.dispatchEvent(new Event('change'))
    })

    await expect(closeButton).toBeEnabled()
    await page.evaluate(() => document.getElementById('intro').close())
    expect(await page.evaluate(() => document.getElementById('intro').isOpen)).toBe(false)
  })

  test('the panel folds away, because a statement is long and a dialog is not', async ({ page }) => {
    await open(page)
    await configure(page)

    const details = panel(page)
    await expect(details).toHaveJSProperty('open', true)
    await details.locator('css=summary').click()
    await expect(details).toHaveJSProperty('open', false)
  })
})
