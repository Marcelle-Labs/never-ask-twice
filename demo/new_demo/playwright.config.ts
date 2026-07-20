import { defineConfig, devices } from "@playwright/test";

// Config for the demo driver. The root playwright.config.ts scopes testDir to
// ./tests, so demo.spec.ts is not discoverable from it. Video is always on
// here (the root config only retains on failure) because the capture IS the
// deliverable.
export default defineConfig({
  testDir: ".",
  testMatch: /demo\.spec\.ts$/,
  outputDir: "./video",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 300_000,
  expect: { timeout: 30_000 },
  use: {
    baseURL: process.env.DEMO_BASE_URL,
    viewport: { width: 1920, height: 1080 },
    trace: "on",
    screenshot: "only-on-failure",
    video: { mode: "on", size: { width: 1920, height: 1080 } },
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
