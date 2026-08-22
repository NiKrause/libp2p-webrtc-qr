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
      // `part`, not `input[type=checkbox]`. With a relay configured there are
      // two checkboxes in this shadow root, and the untargeted query takes
      // whichever comes first in the DOM — which is how a hidden second box
      // once made an element silently stop remembering dismissals.
      window.__intro.shadowRoot.querySelector('input[part=dont-show]').checked = true
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

  test('the host can put its own chrome in the dialog', async ({ page }) => {
    await mount(page)

    const placed = await page.evaluate(async () => {
      const put = (name, tag, text) => {
        const node = document.createElement(tag)
        node.slot = name
        node.textContent = text
        node.dataset.probe = name
        window.__intro.append(node)
      }

      put('header', 'button', 'Deutsch')
      put('advice', 'a', 'What to do about it')
      put('footer', 'button', 'Close')
      await window.__intro.open()

      // Where each one landed, by the shadow container it is assigned into.
      // Placement is the whole point: advice under a verdict it does not
      // follow is advice for a different situation.
      return [...window.__intro.querySelectorAll('[data-probe]')].map(node => ({
        slot: node.dataset.probe,
        into: node.assignedSlot?.parentElement?.className
      }))
    })

    expect(placed).toEqual([
      { slot: 'header', into: 'head' },
      { slot: 'advice', into: 'check' },
      { slot: 'footer', into: 'foot' }
    ])
  })

  test('an app that fills none of them gets the dialog it had', async ({ page }) => {
    await mount(page)

    const empty = await page.evaluate(async () => {
      await window.__intro.open()
      const root = window.__intro.shadowRoot

      return [...root.querySelectorAll('slot[name]')].every(
        slot => slot.assignedNodes().length === 0
      )
    })

    // A seam nobody uses has to cost nothing — no stray gap, no empty node
    // that a stylesheet then has to know about.
    expect(empty).toBe(true)
  })

  test('without a relay there is no relay half at all, not even a hidden one', async ({ page }) => {
    await mount(page)

    const shape = await page.evaluate(() => ({
      checkboxes: window.__intro.shadowRoot.querySelectorAll('input[type=checkbox]').length,
      first: window.__intro.shadowRoot.querySelector('input[type=checkbox]')?.part.value,
      ways: window.__intro.shadowRoot.querySelector('.ways') != null,
      optIn: window.__intro.relayOptIn
    }))

    // Hiding it was not enough and the difference cost a CI run: a hidden
    // checkbox is still the first match for
    // `querySelector('input[type=checkbox]')`, which is how both this file and
    // the demo reached "do not show again". An element nobody configured a
    // relay on has to be what it was before the relay half existed.
    expect(shape).toEqual({ checkboxes: 1, first: 'dont-show', ways: false, optIn: false })
  })

  test('the relay half appears when configured, and asks nothing until ticked', async ({ page }) => {
    await mount(page)

    const before = await page.evaluate(async () => {
      window.__checked = 0
      window.__intro.relay = {
        check: async () => { window.__checked++; return { source: 'baked', addresses: ['/relay'] } }
      }
      await window.__intro.open()

      return {
        checked: window.__checked,
        optIn: window.__intro.relayOptIn,
        resultShown: window.__intro.shadowRoot.querySelector('.relay-result').hidden === false
      }
    })

    // Off is the promise, not a starting value: opening the dialog must not
    // reach for a relay, and a verdict line before anything ran would read as
    // a failed check rather than as a check that never happened.
    expect(before).toEqual({ checked: 0, optIn: false, resultShown: false })

    const after = await page.evaluate(async () => {
      const box = window.__intro.shadowRoot.querySelector('input[part=relay-opt-in]')
      box.checked = true
      box.dispatchEvent(new Event('change'))
      await new Promise(resolve => setTimeout(resolve, 50))

      return {
        checked: window.__checked,
        state: window.__intro.shadowRoot.querySelector('.relay-result').dataset.state,
        text: window.__intro.shadowRoot.querySelector('.relay-result').textContent
      }
    })

    // Ticking it checks at once. An opt-in whose effect only shows at the next
    // connection attempt leaves the person guessing.
    expect(after.checked).toBe(1)
    expect(after.state).toBe('baked')
    expect(after.text).toContain('1 known relay')
  })

  test('a remembered yes is checked on open, not when the property is set', async ({ page }) => {
    await mount(page)

    const timeline = await page.evaluate(async () => {
      localStorage.setItem('demo.relayOptIn', 'true')
      window.__checked = 0
      window.__intro.relay = {
        check: async () => { window.__checked++; return { source: 'none', addresses: [] } },
        storageKey: 'demo.relayOptIn'
      }

      const onAssign = window.__checked
      await window.__intro.open()
      await new Promise(resolve => setTimeout(resolve, 50))

      return { onAssign, afterOpen: window.__checked, ticked: window.__intro.relayOptIn }
    })

    // Assignment can happen long before anybody sees the dialog. Probing then
    // would spend the session's first outbound call on a page nobody looked at.
    expect(timeline).toEqual({ onAssign: 0, afterOpen: 1, ticked: true })
  })
})
