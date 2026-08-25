import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Playwright specs live in tests/ and demo/. Vitest must not collect them:
    // they import @playwright/test and read deployment env vars at module scope,
    // so collecting one fails the unit run before a single test executes.
    exclude: [
      "**/node_modules/**",
      "**/dist/**",
      "tests/**/*.spec.ts",
      "demo/**/*.spec.ts",
    ],
  },
});
