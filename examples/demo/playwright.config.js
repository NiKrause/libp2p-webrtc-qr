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
   * Two retries on CI, and this is not sweeping anything under a rug.
   *
   * Playwright reports a test that needed one as **flaky**, not as passed, so
   * the instability stays on the summary where it can be seen accumulating.
   * What changes is that one starved handshake on a shared two-core runner
   * stops failing a whole run - which is what has been happening: the same
   * bitswap test, only in Firefox, only on CI, never twice with the same
   * symptom, passing on its own every time.
   *
   * A test that starts needing its retries regularly is a bug report, not a
   * reason to raise this number.
   */
  retries: process.env.CI ? 2 : 0,
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
