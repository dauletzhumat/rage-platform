import { defineConfig, devices } from '@playwright/test';

/**
 * Smoke E2E against the production build (`pnpm build` first).
 * By default the web server is pointed at an API URL where nothing listens
 * (E2E_API_URL), so the suite deterministically exercises the
 * "API unavailable" states. Set E2E_API_URL to a running API to smoke real data.
 */
const PORT = Number(process.env.E2E_PORT ?? 3100);
const baseURL = process.env.E2E_BASE_URL ?? `http://127.0.0.1:${PORT}`;
const E2E_API_URL = process.env.E2E_API_URL ?? 'http://127.0.0.1:4599/api/v1';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  timeout: 30_000,
  use: {
    baseURL,
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: `pnpm exec next start -p ${PORT}`,
        url: baseURL,
        reuseExistingServer: false,
        timeout: 120_000,
        env: {
          API_INTERNAL_URL: E2E_API_URL,
          NEXT_PUBLIC_API_BASE_URL: E2E_API_URL,
        },
      },
});
