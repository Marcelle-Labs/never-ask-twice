import { defineConfig, devices } from "@playwright/test";

// neverasktwice.dev (Railway) is the browser-renderable deployment, so it is the
// default for browser specs. Alibaba FC is also live, but its free *.fcapp.run
// subdomain forces `Content-Disposition: attachment`, so a browser downloads the
// response instead of rendering it — pointing Playwright there makes every UI
// assertion fail for a reason that has nothing to do with the app.
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
