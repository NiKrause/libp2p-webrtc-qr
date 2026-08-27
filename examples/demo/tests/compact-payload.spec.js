import { expect, test } from '@playwright/test'

/**
 * A compact (v3) connection has to carry bytes, not merely report success.
 *
 * #83 is the reason the compact format is off by default: a connection built
 * from a **reconstructed** SDP was measured going silent under load - four runs
 * in eight, against zero in eight on v2. Silent means both peers hold an open
 * stream that carries nothing. No error, no event, no ICE state change; the
 * handshake completes and reports success.
 *
 * That is the worst shape a defect can have, and until now the evidence for it
 * was eight runs in a worktree. **Nothing in CI would have noticed it getting
 * better or worse**, which the issue itself names as the first thing to fix.
 *
 * So this asserts the thing that was missing rather than the thing that was
 * present: a connection is not interesting here, a *message arriving over it*
 * is. A silent connection passes every other test in this suite.
 */

const ROUNDS = 3

const openPeer = async page => {
  await page.goto('/?ice=host&view=technical&intro=off')
  await page.waitForFunction(() => typeof window.__libp2pQrTest?.createOfferPayload === 'function')
  await page.locator('#start-client').click()
  await expect(page.locator('#status')).toContainText('Peer started')
}

const useLink = async (page, link) => {
  if (await page.locator('#invite-box[open]').count() > 0) {
    await page.locator('#paste-reply').click()
  } else {
    await page.locator('.paste-fallback').evaluate(details => { details.open = true })
  }

  await page.locator('#payload-display').fill(link)
  await page.locator('#process-payload').click()
}

test.describe('the compact payload', () => {
  test('carries bytes over a reconstructed SDP, not just a connection', async ({ browser, baseURL, browserName }) => {
    test.skip(
      browserName === 'webkit' && process.platform === 'linux',
      'Playwright WebKit on Linux cannot establish a WebRTC connection'
    )
    test.setTimeout(300000)

    for (let round = 1; round <= ROUNDS; round++) {
      const alice = await (await browser.newContext({ baseURL })).newPage()
      const bob = await (await browser.newContext({ baseURL })).newPage()

      try {
        await openPeer(alice)
        await openPeer(bob)

        // The box is off by default - because of #83 - so the test has to ask
        // for the format it is about.
        await alice.locator('#compact-payload').check()

        await alice.locator('#create-offer').click()
        await expect(alice.locator('#invite-box')).toBeVisible({ timeout: 60000 })
        await expect.poll(() => alice.locator('#invite-link').inputValue()).toMatch(/#i=/)

        const invite = await alice.locator('#invite-link').inputValue()

        // The format, asserted rather than assumed: a round that quietly fell
        // back to v2 would pass this test while testing nothing. The colon is
        // percent-encoded in a link, which this assertion caught on its first
        // run - which is the argument for having it.
        expect(decodeURIComponent(invite), `round ${round} did not use the compact format`).toContain('#i=q3:')

        await useLink(bob, invite)
        await expect.poll(() => bob.locator('#invite-link').inputValue(), { timeout: 60000 }).toMatch(/#r=/)

        await useLink(alice, await bob.locator('#invite-link').inputValue())

        // Not `getConnections`: a libp2p connection exists before the chat
        // stream is attached, and the peer count follows the streams.
        for (const page of [alice, bob]) {
          await expect(page.locator('#peer-count')).toHaveText(/[1-9]\d* connected/, { timeout: 60000 })
        }

        // The assertion this file exists for. Everything above is what a silent
        // connection also does.
        const message = `round ${round} carried bytes`
        await alice.evaluate(async text => { await window.__libp2pQrTest.sendMessage(text) }, message)

        await expect
          .poll(() => bob.evaluate(() => window.__libp2pQrTest.getLastReceivedMessage()), { timeout: 30000 })
          .toBe(message)

        // Both ways: the measured failure had both peers holding a stream that
        // carried nothing, and one direction working would be a different bug.
        const back = `round ${round} carried bytes back`
        await bob.evaluate(async text => { await window.__libp2pQrTest.sendMessage(text) }, back)

        await expect
          .poll(() => alice.evaluate(() => window.__libp2pQrTest.getLastReceivedMessage()), { timeout: 30000 })
          .toBe(back)
      } finally {
        await alice.close()
        await bob.close()
      }
    }
  })
})
