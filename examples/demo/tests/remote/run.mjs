import { mkdir, writeFile } from 'node:fs/promises'

// `@playwright/test`, not `playwright`: that is what this package depends on.
// The bare `playwright` import resolved locally off a hoisted transitive copy
// and vanished on a clean install, which is a failure that only ever happens in
// CI - the least useful place to find it.
import { connectAlephChromium, PLAYWRIGHT_RUNNER_VERSION } from '@le-space/playwright'
import { chromium } from '@playwright/test'

import { runBothFormats } from './link-handover.mjs'

/**
 * Drive the handover with the answering browser on another machine.
 *
 * This is the configuration the local suite cannot be: two peers whose
 * reflexive candidates come from two different NATs. Everything the suite
 * asserts about signing, formats and the state machine is already covered
 * locally - what only this run can show is whether the path they describe to
 * each other is one they can actually take.
 *
 *   REMOTE_APP_URL   deployment to test, default the published demo
 *   REMOTE_PROVIDER  `aleph` (default) or `local`
 *
 * `local` runs both browsers here. It is there so the script itself can be
 * exercised without an Aleph VM, and it proves nothing about NAT - the summary
 * says so rather than letting a green run imply otherwise.
 */
const appUrl = process.env.REMOTE_APP_URL ?? 'https://webrtc-qr.le-space.de'
const provider = process.env.REMOTE_PROVIDER ?? 'aleph'
const outputDir = process.env.REMOTE_OUTPUT_DIR ?? 'test-results/remote-link-handover'

const browserA = await chromium.launch({ headless: true })
let browserB

try {
  browserB = provider === 'aleph'
    ? await connectAlephChromium({
      chromium: { connect: (endpoint, options) => chromium.connect(endpoint, options) },
      wsEndpoint: process.env.ALEPH_PLAYWRIGHT_WS_ENDPOINT,
      versionUrl: process.env.ALEPH_PLAYWRIGHT_VERSION_URL,
      secret: process.env.ALEPH_PLAYWRIGHT_SECRET,
      expectedVersion: PLAYWRIGHT_RUNNER_VERSION
    })
    : await chromium.launch({ headless: true })
} catch (error) {
  await browserA.close()
  throw error
}

let results
let failure = null

try {
  results = await runBothFormats({ browserA, browserB, appUrl })
} catch (error) {
  failure = error
} finally {
  await browserB.close().catch(() => {})
  await browserA.close().catch(() => {})
}

await mkdir(outputDir, { recursive: true })
await writeFile(`${outputDir}/summary.json`, `${JSON.stringify({
  appUrl,
  provider,
  // Stated in the artefact, not only in the log: someone reading a green result
  // months from now needs to know whether two networks were involved.
  crossesTwoNetworks: provider === 'aleph',
  results: results ?? null,
  error: failure == null ? null : failure.message
}, null, 2)}\n`)

if (failure != null) {
  console.error(`Link handover failed against ${appUrl} (${provider}): ${failure.message}`)
  process.exit(1)
}

for (const { compact, timings, inviteLength } of results) {
  console.log(
    `${compact ? 'short code' : 'full payload'}: invite ${timings.inviteMs}ms (${inviteLength} chars), ` +
    `reply ${timings.replyMs}ms, connected ${timings.connectMs}ms`
  )
}
