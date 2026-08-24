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
  test('the share button is absent where it would only duplicate Copy', async ({ page }) => {
    // Taken away rather than assumed away. This used to assert that the engine
    // had no `navigator.share` and then check the button - which passed for as
    // long as no automation engine shipped the Web Share API, and stopped the
    // day WebKit did. The subject is the branch, not the engine, so the branch
    // is what the test arranges. Its sibling below forces the other direction
    // the same way.
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'share', { value: undefined, configurable: true })
    })
    await invite(page)

    // Without `navigator.share`, `shareOrCopy` falls back to the clipboard -
    // which is exactly what the Copy button in the fold does. Two controls
    // doing the same thing side by side is the duplication this removes.
    expect(await page.evaluate(() => typeof navigator.share)).toBe('undefined')
    await expect(page.locator('#copy-payload')).toBeHidden()
  })

  test('and present where it goes somewhere else', async ({ page }) => {
    // On a phone the sheet goes straight into a messenger, and that handover is
    // the case this project is built around - so it is hidden for absence, not
    // on principle.
    await page.addInitScript(() => { navigator.share = async () => {} })
    await invite(page)

    await expect(page.locator('#copy-payload')).toBeVisible()
  })

  test('a reply on screen offers no way to reply to it', async ({ page }) => {
    await invite(page)

    // Showing an offer means waiting for a reply. Showing an *answer* means the
    // other side is about to connect, and both ways of taking that next step
    // belong to the first case - `paste-reply` used to stay visible either way.
    await expect(page.locator('#scan-reply')).toBeVisible()
    await expect(page.locator('#paste-reply')).toBeVisible()
  })

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
    await page.locator('#locale-de').click()
    await page.locator('#start-client').click()
    await page.waitForFunction(() => document.getElementById('peer-id').textContent !== 'not started')
    await page.locator('#create-offer').click()
    await expect(page.locator('#invite-box')).toBeVisible({ timeout: 60000 })
    await page.locator('.invite-link-fallback summary').click()

    await expect(page.locator('#copy-link')).toHaveText('Kopieren')
  })

  test('a pasted reply works with no peer started, in the view that hides the start button', async ({ browser, baseURL }) => {
    // Reported from two phones over Telegram, and it is the main path rather
    // than an edge of it: Alice left for the messenger, the phone discarded the
    // tab, and coming back reloaded the page. No node, no invite on screen -
    // and in the simple view no visible control that starts one, because step 1
    // is exactly what that view hides.
    //
    // The suite missed it twice over. `useLink()` above uses `fill()`, which
    // dispatches `input` and re-enables the button; and every other spec drives
    // `view=technical` and presses Start first. So this one does neither.
    const alice = await (await browser.newContext({ baseURL })).newPage()
    const bob = await (await browser.newContext({ baseURL })).newPage()

    try {
      await alice.goto('/?ice=host&view=technical&intro=off')
      await alice.locator('#start-client').click()
      await alice.waitForFunction(() => document.getElementById('peer-id').textContent !== 'not started')
      await alice.locator('#create-offer').click()
      await expect(alice.locator('#invite-box')).toBeVisible({ timeout: 60000 })

      const invite = await alice.locator('#invite-link').inputValue()

      // Bob answers by opening the link, which is the ordinary way round.
      await bob.goto(invite.replace(/^https?:\/\/[^/]+/, ''))
      await expect(bob.locator('#invite-box')).toBeVisible({ timeout: 60000 })
      await expect.poll(() => bob.locator('#invite-link').inputValue()).toMatch(/#r=/)
      const reply = await bob.locator('#invite-link').inputValue()

      // Alice comes back to a page that was discarded and reloaded, in the
      // default view, with nothing started.
      await alice.goto('/?ice=host&intro=off')
      await expect(alice.locator('#step-start')).toBeHidden()
      await expect(alice.locator('#peer-id')).toHaveText('not started')

      await alice.locator('.paste-fallback summary').click()
      await alice.locator('#payload-display').fill(reply)

      // The whole report in one assertion: this button could not be pressed.
      await expect(alice.locator('#process-payload')).toBeEnabled()
      await alice.locator('#process-payload').click()

      // And pressing it has to start a peer on the way, or it is a button that
      // reports its own failure instead of doing the work.
      await expect.poll(
        () => alice.locator('#peer-id').textContent(),
        { timeout: 60000 }
      ).not.toBe('not started')
    } finally {
      await alice.close()
      await bob.close()
    }
  })

  test('scanning is offered to somebody who has not started a peer', async ({ page }) => {
    // The sibling of the test above, and reported the same way: on a phone,
    // "Scan their code" was sometimes dead and it was not obvious when. The
    // answer was whether anything else had happened to start a peer first -
    // creating an invite starts one, arriving by link starts one, and a person
    // whose first move is to scan has done neither.
    //
    // In the simple view the control that would have started one is exactly the
    // control that view hides, so the only enabled button on screen was the
    // wrong one.
    await page.goto('/?ice=host&intro=off')

    await expect(page.locator('#step-start')).toBeHidden()
    await expect(page.locator('#peer-id')).toHaveText('not started')

    await expect(page.locator('#scan-offer')).toBeEnabled()
    await page.locator('#scan-offer').click()

    // Opening the scanner starts a peer beside the camera rather than before
    // it, so that the camera prompt still belongs to this click.
    await expect(page.locator('qr-scanner dialog')).toBeVisible()
    await expect.poll(
      () => page.locator('#peer-id').textContent(),
      { timeout: 60000 }
    ).not.toBe('not started')
  })
})

