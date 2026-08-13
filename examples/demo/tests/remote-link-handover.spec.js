import { chromium, test } from '@playwright/test'

import { runLinkHandover } from './remote/link-handover.mjs'

/**
 * The handover across two independent browsers, in both payload formats.
 *
 * This is the local half of the remote scenario: a second browser process
 * rather than a second machine. It is honest about what that buys - the two
 * peers still share a NAT, so it cannot reproduce the two-phone failure - but
 * it does keep the scenario itself working, which is what makes the remote run
 * worth starting. A scenario that only ever runs in a nightly against a live
 * deployment rots between runs.
 *
 * Chromium only, and one at a time: two full browsers plus two libp2p nodes and
 * real STUN round trips is not something to run three ways in parallel.
 */

test.describe.configure({ mode: 'serial' })

test.describe('link handover between separate browsers', () => {
  test.skip(({ browserName }) => browserName !== 'chromium', 'one engine is enough for the transport')

  for (const compact of [false, true]) {
    test(`connects and talks both ways with the ${compact ? 'short code' : 'full'} payload`, async ({ browser, baseURL }, testInfo) => {
      testInfo.setTimeout(180_000)

      const browserB = await chromium.launch({ headless: true })

      try {
        const result = await runLinkHandover({
          browserA: browser,
          browserB,
          appUrl: baseURL ?? 'http://127.0.0.1:5173/',
          compact
        })

        // Attached rather than asserted: locally these numbers say nothing
        // about a network, and pinning them would be pinning this machine.
        // Across two machines they are the reason to run it.
        await testInfo.attach(`handover-${compact ? 'compact' : 'full'}.json`, {
          body: JSON.stringify(result, null, 2),
          contentType: 'application/json'
        })
      } finally {
        await browserB.close()
      }
    })
  }
})
