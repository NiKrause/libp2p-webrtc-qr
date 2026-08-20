import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { test, expect } from '@playwright/test'

/**
 * The footer says which build this is.
 *
 * Written because working out whether a deploy had landed meant grepping the
 * served HTML for a button label that happened to have changed in the same
 * release - a method that works exactly once. The stamp is a build-time
 * substitution, so the way it breaks is silent: the tokens ship unreplaced, or
 * the version quietly goes stale against the package it claims to be.
 */

const { version } = JSON.parse(readFileSync(
  fileURLToPath(new URL('../../../packages/webrtc-qr/package.json', import.meta.url)),
  'utf8'
))

const stamp = page => page.locator('.build-stamp')

test.describe('build stamp', () => {
  test('names the library version that was built', async ({ page }) => {
    await page.goto('/?view=technical&intro=off')

    // Not the demo's own private 0.1.0: someone reading this is comparing the
    // page against their npm install of the library.
    await expect(stamp(page)).toContainText(`v${version}`)
  })

  test('carries a build time and a commit', async ({ page }) => {
    await page.goto('/?view=technical&intro=off')

    await expect(stamp(page).locator('time')).toHaveText(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2} UTC$/)
    await expect(stamp(page).locator('code')).toHaveText(/^[0-9a-f]{7}$|^unknown$/)
  })

  test('the machine-readable time actually parses', async ({ page }) => {
    await page.goto('/?view=technical&intro=off')

    // The point of the attribute is that something other than a person can read
    // it. "2026-08-13 09:37 UTC" looks fine and parses as nothing.
    const datetime = await stamp(page).locator('time').getAttribute('datetime')

    expect(Number.isNaN(Date.parse(datetime)), `${datetime} is not a datetime`).toBe(false)
  })

  test('every token is substituted', async ({ page }) => {
    await page.goto('/?view=technical&intro=off')

    // The plugin failing open would leave `v__QR_VERSION__` on the page, which
    // reads as a build stamp until you look at it. Assert against the whole
    // document, so a token added to the footer later is covered without anyone
    // remembering to extend this.
    expect(await page.content()).not.toContain('__QR_')
  })

  test('the commit links to the commit it names', async ({ page }) => {
    await page.goto('/?view=technical&intro=off')

    const link = stamp(page).locator('a').last()
    const sha = (await link.textContent()).trim()

    test.skip(sha === 'unknown', 'built outside a checkout')

    // A stamp that names one commit and links to another is worse than none.
    await expect(link).toHaveAttribute('href', `https://github.com/NiKrause/libp2p-webrtc-qr/commit/${sha}`)
  })
})
