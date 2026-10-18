import { defineConfig, devices } from "@playwright/test";

// This fixture bundles browser components only. There is no Next server, API,
// user profile, database or supplier adapter process in this test configuration.
export default defineConfig({
  testDir: "./e2e", testMatch: "ui-readability.spec.ts", workers: 1, fullyParallel: false,
  timeout: 30_000, expect: { timeout: 5_000 }, reporter: [["list"]],
  outputDir: "../../../.codex-logs/2026-10-18-ui-readability/fixture-test-results",
  use: { ...devices["Desktop Chrome"], channel: "chrome", screenshot: "only-on-failure", trace: "retain-on-failure" },
});
