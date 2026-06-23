import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 30_000,
  use: {
    baseURL: "http://127.0.0.1:13000",
    trace: "on-first-retry",
  },
  webServer: {
    command: "pnpm --dir apps/web exec next dev -p 13000 -H 127.0.0.1",
    url: "http://127.0.0.1:13000",
    reuseExistingServer: true,
    timeout: 60_000,
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], channel: "chrome" },
    },
  ],
});
