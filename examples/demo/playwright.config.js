import { defineConfig, devices } from '@playwright/test'

const port = Number(process.env.E2E_PORT ?? 4174)

export default defineConfig({
  testDir: './tests',
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
    navigationTimeout: 30000,
    browserName: 'chromium'
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome']
      }
    }
  ]
})
