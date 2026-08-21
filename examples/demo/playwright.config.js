import { defineConfig, devices } from '@playwright/test'

const port = Number(process.env.E2E_PORT ?? 4174)

export default defineConfig({
  testDir: './tests',
  // One worker on CI. These specs each drive two or three real browser peers
  // through a WebRTC handshake and a bitswap transfer; running several in
  // parallel on a two-core runner starves them and shows up as timeouts that
  // do not reproduce anywhere else.
  workers: process.env.CI ? 1 : undefined,
  /**
   * Retries everywhere, and this is not sweeping anything under a rug.
   *
   * Playwright reports a test that needed one as **flaky**, not as passed, so
   * the instability stays on the summary where it can be seen accumulating.
   * What changes is that one starved handshake stops failing a whole run.
   *
   * It was CI-only until the same thing was measured on a 16-core laptop: five
   * large runs produced five *different* failing WebKit tests - keep-alive,
   * installable, link-handover, hurry-back - and every one of them passed on
   * its own, one of them eighteen times in a row. The distribution is the
   * finding. A run that reds a different random test each time is not reporting
   * four bugs, and treating it as though it were trains everybody to re-run
   * without reading.
   *
   * Fewer workers is not the lever - that was measured too. Capping local runs
   * to four made the suite *slower* (7.7 min against 6.9) and still failed two.
   * These specs each drive two or three real browser peers through a WebRTC
   * handshake, and it is the browsers competing for the machine that starves
   * them, not the count of test files in flight.
   *
   * One retry locally rather than two: enough to absorb a starved handshake,
   * few enough that something genuinely broken still goes red rather than
   * grinding through three attempts.
   *
   * A test that starts needing its retries regularly is a bug report, not a
   * reason to raise this number.
   */
  retries: process.env.CI ? 2 : 1,
  timeout: 120000,
  expect: {
    timeout: 15000
  },
  webServer: {
    // The elements ship as a bundle, so it has to exist before the demo builds.
    command: `pnpm --filter @le-space/libp2p-webrtc-qr build && pnpm exec vite build && pnpm exec vite preview --host 127.0.0.1 --port ${port}`,
    url: `http://127.0.0.1:${port}`,
    reuseExistingServer: false,
    timeout: 120000
  },
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    actionTimeout: 15000,
    navigationTimeout: 30000
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        // A synthetic camera, so the scan modal can be driven end to end -
        // opened, closed, and checked for having released the track. Without it
        // `getUserMedia` rejects and there is nothing to release.
        launchOptions: {
          args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream']
        }
      }
    },
    {
      name: 'firefox',
      use: {
        ...devices['Desktop Firefox'],
        launchOptions: {
          firefoxUserPrefs: {
            'media.navigator.streams.fake': true,
            'media.navigator.permission.disabled': true
          }
        }
      }
    },
    {
      name: 'webkit',
      use: {
        ...devices['Desktop Safari']
      }
    }
  ]
})
