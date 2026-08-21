import { expect, test } from '@playwright/test'

/**
 * The readiness panel's two new behaviours: it shows it is measuring, and it
 * raises an alarm when the network cannot reach a peer elsewhere.
 *
 * Both are exercised on a standalone `<qr-status>` created in the page rather
 * than the demo's own hidden instance, so the test drives the element's own
 * contract - the one yogasuci reuses - without the demo's show/hide timing.
 */

const makeStatus = page => page.evaluate(() => {
  const el = document.createElement('qr-status')

  el.id = 'probe-under-test'
  el.setAttribute('rows', 'ipv4 ipv6 overall')
  document.body.append(el)
})

test.describe('the readiness panel', () => {
  test('shows a progress bar while measuring, gone once it settles', async ({ page }) => {
    await page.goto('/?ice=host&view=technical&intro=off')
    await page.waitForFunction(() => customElements.get('qr-status') != null)
    await makeStatus(page)

    // Read the bar the instant probing starts, synchronously - `#setProbing(true)`
    // runs before the first await, so this is race-free where polling a locator
    // is not: on a fast engine the probe settled and the bar was gone before the
    // first poll (Firefox in CI). Then wait it out and check it cleared.
    const during = await page.evaluate(() => {
      const el = document.getElementById('probe-under-test')
      const done = el.probe()
      const bar = el.shadowRoot.querySelector('.probe')
      const caption = el.shadowRoot.querySelector('.probe-caption')
      const snapshot = { shown: bar != null && !bar.hidden, caption: caption?.textContent ?? '' }

      return done.catch(() => {}).then(() => snapshot)
    })

    expect(during.shown).toBe(true)
    expect(during.caption).toMatch(/checking/i)

    await expect(page.locator('#probe-under-test').locator('.probe')).toBeHidden()
  })

  test('raises an alarm when no path off this network exists', async ({ page }) => {
    await page.goto('/?ice=host&view=technical&intro=off')
    await page.waitForFunction(() => customElements.get('qr-status') != null)
    await makeStatus(page)

    // No ICE servers at all: only host candidates, so neither family gets a
    // reflexive one and the verdict is blocked - the same shape a mobile
    // network with STUN blocked and no IPv6 produces, made deterministic.
    await page.evaluate(async () => {
      const el = document.getElementById('probe-under-test')

      el.rtcConfiguration = { iceServers: [] }
      await el.probe()
    })

    const el = page.locator('#probe-under-test')

    await expect(el.locator('.alarm')).toBeVisible()
    await expect(el.locator('.alarm-inner')).toHaveAttribute('role', 'alert')
    await expect(el.locator('.alarm-inner')).toContainText(/cannot reach a peer/i)

    // Reflected on the host, so a consumer can gate its own controls with a
    // selector instead of subscribing to the probe event.
    await expect(el).toHaveAttribute('blocked', '')
    await expect(el).toHaveAttribute('off-network-risk', 'blocked')
  })

  test('warns more quietly when a path exists but only reaches this network', async ({ page }) => {
    await page.goto('/?ice=host&view=technical&intro=off')
    await page.waitForFunction(() => customElements.get('qr-status') != null)
    await makeStatus(page)

    // The 5G shape: IPv4 behind a carrier NAT that maps per destination, no
    // IPv6. Rendered from a supplied verdict rather than provoked, because a
    // symmetric NAT is not something CI can be placed behind - and this is the
    // case that was silent before, which is exactly why it needs a test.
    await page.evaluate(() => {
      document.getElementById('probe-under-test').renderResult({
        ipv4: { state: 'symmetric', text: 'carrier NAT, new port per destination' },
        ipv6: { state: 'blocked', text: 'no IPv6 candidate here' },
        overall: { state: 'symmetric', text: 'local only' }
      })
    })

    const el = page.locator('#probe-under-test')

    await expect(el.locator('.alarm')).toBeVisible()
    await expect(el.locator('.alarm')).toHaveClass(/is-unreliable/)
    await expect(el.locator('.alarm-inner')).toContainText(/usually fail to anyone else/i)

    // Amber, not red: the strong hook stays off, the graded one says why.
    await expect(el).not.toHaveAttribute('blocked', '')
    await expect(el).toHaveAttribute('off-network-risk', 'unreliable')
  })

  test('does not disturb the row order the panel is selected by', async ({ page }) => {
    await page.goto('/?ice=host&view=technical&intro=off')
    await page.waitForFunction(() => customElements.get('qr-status') != null)
    await makeStatus(page)

    await page.evaluate(async () => {
      const el = document.getElementById('probe-under-test')

      el.rtcConfiguration = { iceServers: [] }
      await el.probe()
    })

    const el = page.locator('#probe-under-test')

    // The progress and alarm regions are siblings of the row list, not children
    // of it, so `.line:nth-child(N)` still addresses the chips as before.
    await expect(el.locator('.line:nth-child(1) .verdict')).toHaveText(/\w/)
    await expect(el.locator('.line:nth-child(3) .verdict')).toHaveText(/\w/)
  })
})

test.describe('the panel when the language changes under it', () => {
  test('the measuring line follows, instead of staying behind in English', async ({ page }) => {
    await page.goto('/?ice=host&view=technical&intro=off')
    await page.waitForFunction(() => customElements.get('qr-status') != null)
    await makeStatus(page)

    // Everything here is synchronous and inside one evaluate, for the reason
    // the test above gives: on a fast engine the probe can settle before a
    // locator poll ever runs, and then this asserts nothing.
    //
    // A sentinel rather than the real German table: the element's contract is
    // that an assigned `measuring` reaches the caption, and that holds whatever
    // the words are. `test/strings-de.test.js` is what guards the table.
    const seen = await page.evaluate(() => {
      const el = document.getElementById('probe-under-test')
      const caption = () => el.shadowRoot.querySelector('.probe-caption').textContent

      const done = el.probe()
      const before = caption()

      // Mid-probe, which is the whole point: a probe takes STUN round trips,
      // and that is long enough for somebody to reach the language switch.
      el.strings = { measuring: 'Prüfe, was dieses Netz zulässt…' }
      const after = caption()

      return done.then(() => ({ before, after, settled: caption() }))
    })

    expect(seen.before).toContain('Checking')
    expect(seen.after).toBe('Prüfe, was dieses Netz zulässt…')

    // And it still clears when the probe ends - the fix writes the caption, so
    // it could just as easily have left one behind.
    expect(seen.settled).toBe('')
  })
})
