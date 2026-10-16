import { defineConfig } from "@playwright/test";

// Separate opt-in diagnostic. It never joins or changes the running soak matrix.
export default defineConfig({
  testDir: "./e2e",
  testMatch: "p0-settings-retention.spec.ts",
  globalSetup: "./e2e/helpers/p0-settings-retention-global-setup.ts",
  timeout: 5 * 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  outputDir: process.env.P0_MEMORY_OUTPUT_DIR
    ? `${process.env.P0_MEMORY_OUTPUT_DIR}/playwright`
    : "test-results-p0-settings-retention",
  use: {
    baseURL: `http://127.0.0.1:${process.env.PLAYWRIGHT_PORT ?? "3238"}`,
    extraHTTPHeaders: { "x-supercanvas-desktop-token": "supercanvas-isolated-e2e-session" },
    trace: "off", video: "off", screenshot: "off",
  },
});
