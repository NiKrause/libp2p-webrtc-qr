import { expect, test } from '@playwright/test'

/**
 * The element, exercised in a browser rather than through a stub.
 *
 * Everything here needs a real shadow root, a real `<dialog>`, and a real
 * `RTCPeerConnection` - none of which Node has. The policy that decides *when*
 * to show it is DOM-free and covered by unit tests instead.
 *
 * Mounted on a blank page rather than inside the demo: the demo does not use
 * this element yet, and a test that waited for it to would be testing a plan.
 */

const mount = async (page, { locale = 'en', technical = false } = {}) => {
  await page.goto('/?ice=host&view=technical&intro=off')

  // Through the app's own switch, so `elementStrings()` below returns the
  // tables for that language rather than whatever the default happened to be.
  if (locale !== 'en') await page.locator('#locale').selectOption(locale)

  return page.evaluate(({ locale, technical }) => {
    const intro = document.createElement('qr-intro')
    // Named, because the demo now mounts one of its own: an unqualified
    // `qr-intro` locator matches both, and the assertions below are about this
    // one - the element in isolation, with no story and no first-visit policy.
    intro.id = 'probe-intro'
    const story = document.createElement('p')

    story.textContent = 'The app says this part.'
    intro.append(story)
    if (technical) intro.setAttribute('technical', '')
    // The table the package ships, reached through the app rather than retyped:
    // a literal here would prove only that the literal was correct.
    if (locale === 'de') intro.strings = window.__libp2pQrTest.elementStrings().intro

    // No STUN: the verdict is then deterministic rather than a claim about
    // whatever network CI happens to be on.
    intro.rtcConfiguration = { iceServers: [] }
    document.body.append(intro)
    window.__intro = intro

    return true
  }, { locale, technical })
}

// Playwright locators pierce an open shadow root, and - unlike `textContent` -
// they respect `hidden`. The first version of this file asserted on
// `shadowRoot.textContent` and failed, because a hidden <ul> still has its text
// and the <style> block contributes its own.
const inShadow = (page, selector) => page.locator(`#probe-intro ${selector}`)

test.describe('qr-intro', () => {
  test('shows the app story through the slot', async ({ page }) => {
    await mount(page)
    await page.evaluate(() => window.__intro.open())

    // The story is light DOM, so it is the page's text and not the shadow's -
    // which is the whole point of using a slot for it.
    await expect(page.locator('#probe-intro')).toContainText('The app says this part.')
  })

  test('measures on open and reports a verdict', async ({ page }) => {
    await mount(page)

    const result = await page.evaluate(() => window.__intro.open())

    expect(result).not.toBeNull()
    // With no STUN servers there is no path off this network, and the element
    // must say so rather than staying on "checking" forever.
    await expect(inShadow(page, '.verdict')).not.toHaveAttribute('data-state', 'checking')
  })

  test('the caveats are behind the technical attribute', async ({ page }) => {
    await mount(page)
    await page.evaluate(() => window.__intro.open())
    await expect(inShadow(page, '.tech')).toBeHidden()

    await page.evaluate(() => { window.__intro.technical = true })

    // Nothing is deleted, only moved behind a door - which is what makes this
    // usable as the target of a simple/technical switch.
    await expect(inShadow(page, '.tech')).toBeVisible()
    await expect(inShadow(page, '.tech')).toContainText('DuckDuckGo')
  })

  test('closing reports whether the box was ticked', async ({ page }) => {
    await mount(page)

    const remembered = await page.evaluate(async () => {
      await window.__intro.open()
      const seen = []
      window.__intro.addEventListener('close', e => seen.push(e.detail.remember))

      window.__intro.close()
      window.__intro.shadowRoot.querySelector('input[type=checkbox]').checked = true
      await window.__intro.open()
      window.__intro.close()

      return seen
    })

    // An app cannot honour "do not show again" unless the element says which
    // kind of close this was.
    expect(remembered).toEqual([false, true])
  })

  test('German reaches the element', async ({ page }) => {
    await mount(page, { locale: 'de', technical: true })
    await page.evaluate(() => window.__intro.open())

    await expect(inShadow(page, 'h2')).toHaveText('Bevor Sie anfangen')
    await expect(inShadow(page, '.tech')).toContainText('Telefon')
  })
})
