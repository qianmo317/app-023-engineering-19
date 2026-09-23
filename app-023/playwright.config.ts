import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:4174',
    launchOptions: {
      args: ['--autoplay-policy=no-user-gesture-required', '--use-fake-device-for-media-stream'],
    },
  },
  ...(process.env.E2E_BASE_URL
    ? {}
    : {
        webServer: {
          command: 'npm run preview -- --port 4174',
          port: 4174,
          reuseExistingServer: false,
          timeout: 30_000,
        },
      }),
  reporter: [['list']],
});
