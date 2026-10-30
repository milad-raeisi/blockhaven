import 'dotenv/config';
import { defineConfig, devices } from '@playwright/test';

const PORT = 3100;
const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL ?? 'postgresql://blockhaven:blockhaven@localhost:5434/blockhaven_test?schema=public';

/**
 * Browser tests run against a production build (`pnpm build` first) served on
 * port 3100 with the separate test database, so they never touch real worlds
 * or a running development server.
 */
export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 90_000,
  expect: { timeout: 30_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list']],
  globalSetup: './tests/integration/globalSetup.ts',
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'retain-on-failure',
    viewport: { width: 1280, height: 800 },
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        launchOptions: { args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] },
      },
    },
  ],
  webServer: {
    command: 'pnpm exec tsx server/index.ts',
    url: `http://localhost:${PORT}/api/health`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      NODE_ENV: 'production',
      PORT: String(PORT),
      HOST: '127.0.0.1',
      DATABASE_URL: TEST_DATABASE_URL,
      SESSION_SECRET: 'playwright-test-secret-value',
      LOG_LEVEL: 'warn',
    },
  },
});
