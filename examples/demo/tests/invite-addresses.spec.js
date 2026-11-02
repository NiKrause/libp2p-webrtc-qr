import { expect, test } from '@playwright/test'

/**
 * What the invite on screen says about this device (#192).
 *
 * The panel exists because a measurement changed what it could honestly be:
 * leaving a candidate out of the payload decides what the invite offers as a
 * route, and does **not** keep the address off the network, because the local
 * ICE agent keeps pairing it against everything the other side sent. So these
 * assertions are about disclosure and about the invite staying usable - not
 * about an address being hidden, which the page must not claim and this suite
 * must not appear to verify.
 *
 * No connection is made here on purpose. Re-signing an invite is signing, not
 * handshaking, and a spec that needed two peers to agree would be unable to
 * run exactly where this most needs checking - a machine whose VPN stops two
 * local peers reaching each other at all.
 */

const rows = page => page.locator('#invite-address-list li')
const boxes = page => page.locator('#invite-address-list input[type="checkbox"]')

const openPeer = async page => {
  // Host candidates only: a run that depends on a STUN server round trip puts
  // the shape of somebody's network into the assertions.
  await page.goto('/?ice=host&view=technical&intro=off')
  await page.locator('#start-client').click()
  await expect(page.locator('#status')).toContainText('Peer started')
}

const invite = async page => {
  await page.locator('#create-offer').click()
  await expect(page.locator('#invite-box')).toBeVisible({ timeout: 60000 })
  await expect.poll(() => page.locator('#invite-link').inputValue(), { timeout: 60000 }).toMatch(/#i=/)
  await page.locator('#invite-addresses').evaluate(details => { details.open = true })
}

/** The session id, which must survive a re-signing - see the first test. */
const sessionPrefix = link => decodeURIComponent(link.split('#i=')[1] ?? '').slice(0, 16)

test.describe('what an invite discloses', () => {
  test('lists the addresses the invite carries, and says which reveal nothing', async ({ page }) => {
    await openPeer(page)
    await invite(page)

    await expect(rows(page)).not.toHaveCount(0)

    // Every host candidate a browser gathers is an mDNS stand-in, and those are
    // the rows that disclose nothing *and* carry the same-network path. Saying
    // so on the row is the whole reason the panel is not just a list.
    await expect(rows(page).first()).toContainText(/withheld by the browser/i)
    await expect(page.locator('#invite-addresses')).toContainText(/does keep an address off the network/i)
  })

  test('leaving one out shortens the invite and keeps the session id', async ({ page }) => {
    await openPeer(page)
    await invite(page)

    const count = await boxes(page).count()

    test.skip(count < 2, 'needs two candidates to drop one and still have an invite')

    const before = await page.locator('#invite-link').inputValue()

    await boxes(page).first().uncheck()
    await expect(page.locator('#invite-addresses-count')).toHaveText(/1 left out/)

    const after = await page.locator('#invite-link').inputValue()

    expect(after.length).toBeLessThan(before.length)
    // The code somebody has already photographed has to keep working: the
    // reply carries this session id and arrives at the same pending offer.
    expect(sessionPrefix(after)).toBe(sessionPrefix(before))

    // The row stays listed, unticked. Dropping it from the list would leave no
    // way to put it back.
    await expect(rows(page)).toHaveCount(count)
    await expect(boxes(page).first()).not.toBeChecked()
  })

  test('the last address cannot be left out', async ({ page }) => {
    await openPeer(page)
    await invite(page)

    const count = await boxes(page).count()

    for (let index = 0; index < count - 1; index++) {
      await boxes(page).nth(index).uncheck()
      await expect(boxes(page).nth(index)).not.toBeChecked()
    }

    const last = boxes(page).nth(count - 1)
    const before = await page.locator('#invite-link').inputValue()

    // `click`, not `uncheck`: Playwright's `uncheck` fails when the state does
    // not change, and not changing is the whole assertion here.
    await last.click()

    await expect(page.locator('#invite-address-note')).toContainText(/last route/i)
    // The tick comes back. A message beside a cleared box would describe
    // something that did not happen.
    await expect(last).toBeChecked()
    await expect(page.locator('#invite-address-note')).toBeVisible()
    await expect(page.locator('#invite-link')).toHaveValue(before)
  })

  test('the answering side gets the same panel', async ({ browser, baseURL }) => {
    // The side with most to disclose: in scenario B this is the phone on
    // mobile data, answering an invite that arrived by messenger. It was also
    // the side that could not change its mind until `Session#answers` existed.
    test.setTimeout(180000)

    const alice = await (await browser.newContext({ baseURL })).newPage()
    const bob = await (await browser.newContext({ baseURL })).newPage()

    try {
      await openPeer(alice)
      await openPeer(bob)
      await invite(alice)

      const link = await alice.locator('#invite-link').inputValue()

      await bob.locator('.paste-fallback').evaluate(details => { details.open = true })
      await bob.locator('#payload-display').fill(link)
      await bob.locator('#process-payload').click()

      // The reply, not a second invite. No connection is awaited: signing the
      // answer is what this is about, and the handshake behind it may well not
      // complete on the machine running the suite.
      await expect.poll(() => bob.locator('#invite-link').inputValue(), { timeout: 60000 }).toMatch(/#r=/)
      await bob.locator('#invite-addresses').evaluate(details => { details.open = true })

      await expect(rows(bob)).not.toHaveCount(0)

      const count = await boxes(bob).count()

      test.skip(count < 2, 'needs two candidates to drop one and still have an answer')

      const before = await bob.locator('#invite-link').inputValue()

      await boxes(bob).first().uncheck()
      await expect(bob.locator('#invite-addresses-count')).toHaveText(/1 left out/)

      const after = await bob.locator('#invite-link').inputValue()

      expect(after.length).toBeLessThan(before.length)
      expect(after).toContain('#r=')
    } finally {
      await alice.context().close()
      await bob.context().close()
    }
  })

  test('the rows follow the language', async ({ page }) => {
    await openPeer(page)
    await invite(page)

    await expect(rows(page).first()).toContainText(/this device/i)

    // Before the next invite, not during this one: the dialog covers the
    // language switch, so switching with an invite on screen is not something
    // anyone can do. The rows are built in JavaScript rather than from the
    // markup, so nothing else would have translated them.
    await page.keyboard.press('Escape')
    await page.locator('#locale-de').click()
    await invite(page)

    await expect(rows(page).first()).toContainText(/dieses Gerät/)
    await expect(rows(page).first()).toContainText(/vom Browser zurückgehalten/)
  })
})
