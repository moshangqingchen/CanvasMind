import { defineConfig } from "@playwright/test";

// Deliberately separate from the ordinary E2E suite: no implicit browser, build,
// retries, user profile, external server or production data are reused.
export default defineConfig({
  testDir: "./e2e",
  testMatch: ["p0-memory-soak.spec.ts", "p0-retention.spec.ts", "p0-polling-retention.spec.ts", "p0-connection-retention.spec.ts"],
  globalSetup: "./e2e/helpers/p0-memory-global-setup.ts",
  timeout: 45 * 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  outputDir: process.env.P0_MEMORY_OUTPUT_DIR ? `${process.env.P0_MEMORY_OUTPUT_DIR}/playwright` : "test-results-p0-memory",
  use: {
    baseURL: `http://127.0.0.1:${process.env.PLAYWRIGHT_PORT ?? "3211"}`,
    extraHTTPHeaders: { "x-supercanvas-desktop-token": "supercanvas-isolated-e2e-session" },
    trace: "off", video: "off", screenshot: "off",
  },
});
