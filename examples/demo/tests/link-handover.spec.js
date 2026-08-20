import { expect, test } from '@playwright/test'

/**
 * The link, folded under the code and copyable in one press.
 *
 * The QR code stays the headline; this is the path for when a camera is not an
 * option. What is asserted here is the part that is easy to get wrong: the
 * field stays reachable beside the button rather than being replaced by it,
 * because clipboard access is refused often enough - insecure origins,
 * permission policies, some mobile browsers - that a button alone would strand
 * exactly the people on phones this exists for.
 */

const invite = async page => {
  await page.goto('/?ice=host&view=technical&intro=off')
  await page.locator('#start-client').click()
  await page.waitForFunction(() => document.getElementById('peer-id').textContent !== 'not started')
  await page.locator('#create-offer').click()
  await expect(page.locator('#invite-box')).toBeVisible({ timeout: 60000 })
}

test.describe('the link beside the code', () => {
  test('the field and the button are both there, and the field holds the link', async ({ page }) => {
    await invite(page)
    await page.locator('.invite-link-fallback summary').click()

    await expect(page.locator('#copy-link')).toBeVisible()
    await expect(page.locator('#invite-link')).toHaveValue(/^https?:\/\/.+#i=/)
  })

  test('touching the field selects the whole link', async ({ page }) => {
    await invite(page)
    await page.locator('.invite-link-fallback summary').click()
    await page.locator('#invite-link').focus()

    // Dragging across a thousand characters on a phone is not something anybody
    // manages, so the manual path has to hand the whole thing over at once.
    const selected = await page.evaluate(() => {
      const el = document.getElementById('invite-link')
      return el.value.slice(el.selectionStart, el.selectionEnd)
    })

    expect(selected).toBe(await page.locator('#invite-link').inputValue())
  })

  test('copying says so on the button that was pressed', async ({ page, context, browserName }) => {
    test.skip(browserName !== 'chromium', 'clipboard permissions are Chromium-only in Playwright')
    await context.grantPermissions(['clipboard-read', 'clipboard-write'])

    await invite(page)
    await page.locator('.invite-link-fallback summary').click()
    await page.locator('#copy-link').click()

    // The eye is already on the button that was just pressed, so the
    // confirmation belongs there rather than in a status line elsewhere.
    await expect(page.locator('#copy-link')).toHaveText('Copied')
    expect(await page.evaluate(() => navigator.clipboard.readText()))
      .toBe(await page.locator('#invite-link').inputValue())
  })

  test('a new link clears a stale confirmation', async ({ page, context, browserName }) => {
    test.skip(browserName !== 'chromium', 'clipboard permissions are Chromium-only in Playwright')
    await context.grantPermissions(['clipboard-read', 'clipboard-write'])

    await invite(page)
    await page.locator('.invite-link-fallback summary').click()
    await page.locator('#copy-link').click()
    await expect(page.locator('#copy-link')).toHaveText('Copied')

    await page.locator('#create-offer-again').click()

    // The offer and the answer are two different links. "Copied" left standing
    // after the link changed says something that is no longer true.
    await expect(page.locator('#copy-link')).toHaveText('Copy')
  })

  test('the button speaks the chosen language', async ({ page }) => {
    await page.goto('/?ice=host&view=technical&intro=off')
    await page.locator('#locale').selectOption('de')
    await page.locator('#start-client').click()
    await page.waitForFunction(() => document.getElementById('peer-id').textContent !== 'not started')
    await page.locator('#create-offer').click()
    await expect(page.locator('#invite-box')).toBeVisible({ timeout: 60000 })
    await page.locator('.invite-link-fallback summary').click()

    await expect(page.locator('#copy-link')).toHaveText('Kopieren')
  })
})
