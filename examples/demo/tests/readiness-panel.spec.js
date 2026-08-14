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
    await page.goto('/?ice=host')
    await page.waitForFunction(() => customElements.get('qr-status') != null)
    await makeStatus(page)

    const el = page.locator('#probe-under-test')

    // Start the probe but keep hold of the promise - the bar has to be up
    // *during* it, and asserting after it resolves would only see it gone.
    await page.evaluate(() => {
      window.__probe = document.getElementById('probe-under-test').probe()
    })

    await expect(el.locator('.probe')).toBeVisible()
    await expect(el.locator('.probe-caption')).toContainText(/checking/i)

    await page.evaluate(() => window.__probe)

    await expect(el.locator('.probe')).toBeHidden()
  })

  test('raises an alarm when no path off this network exists', async ({ page }) => {
    await page.goto('/?ice=host')
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
  })

  test('does not disturb the row order the panel is selected by', async ({ page }) => {
    await page.goto('/?ice=host')
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
