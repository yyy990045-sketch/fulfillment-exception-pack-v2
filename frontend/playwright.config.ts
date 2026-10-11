import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  testMatch: ['manufacturing.spec.ts', 'analytics.spec.ts'],
  retries: 0,
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:3510",
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium-desktop",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } },
    },
  ],
  webServer: {
    command: "STORE=.playwright/f1-$$; PACK_STORE_DIR=$STORE npm run demo:packs:prepare && PACK_STORE_DIR=$STORE npm run demo:operations:prepare && npm run frontend:build && PORT=3510 HOST=127.0.0.1 DEMO_MODE=true PACK_STORE_DIR=$STORE npm run demo",
    url: "http://127.0.0.1:3510/api/health",
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
