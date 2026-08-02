import { defineConfig, devices } from '@playwright/test'

const port = Number(process.env.E2E_PORT ?? 4174)

export default defineConfig({
  testDir: './tests',
  // One worker on CI. These specs each drive two or three real browser peers
  // through a WebRTC handshake and a bitswap transfer; running several in
  // parallel on a two-core runner starves them and shows up as timeouts that
  // do not reproduce anywhere else.
  workers: process.env.CI ? 1 : undefined,
  timeout: 120000,
  expect: {
    timeout: 15000
  },
  webServer: {
    command: `pnpm exec vite build && pnpm exec vite preview --host 127.0.0.1 --port ${port}`,
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
