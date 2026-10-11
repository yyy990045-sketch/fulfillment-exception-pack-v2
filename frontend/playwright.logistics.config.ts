import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  testMatch: 'logistics.spec.ts',
  fullyParallel: false,
  timeout: 90_000,
  workers: 1,
  reporter: 'list',
  use: { baseURL: 'http://127.0.0.1:3512', trace: 'retain-on-failure' },
  projects: [
    { name: 'logistics-desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } },
    { name: 'logistics-mobile', use: { ...devices['iPhone 13'], viewport: { width: 390, height: 844 } } },
  ],
  webServer: {
    command: 'VITE_LOGISTICS_DIRECT=true npm run frontend:dev -- --host 127.0.0.1 --port 3512 --strictPort',
    url: 'http://127.0.0.1:3512/frontend/order',
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
