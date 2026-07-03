import { defineConfig, devices } from "@playwright/test";

const BASE_URL = process.env.DEMO_BASE_URL ?? "https://neverasktwice.dev";

export default defineConfig({
  testDir: "./tests",
  testMatch: /.*\.spec\.ts$/,
  outputDir: "./test-results",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 120_000,
  expect: { timeout: 30_000 },
  use: {
    baseURL: BASE_URL,
    viewport: { width: 1920, height: 1080 },
    trace: "on",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
