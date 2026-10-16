import { defineConfig } from "@playwright/test";
import { assertPreparationLoopback } from "./e2e/helpers/p0-memory-preparation";

const baseURL = process.env.P0_MEMORY_PREPARE_BASE_URL;
if (process.env.P0_MEMORY_PREPARE_ACTIVE !== "1" || !baseURL || !process.env.P0_MEMORY_PREPARE_OUTPUT_DIR)
  throw new Error("P0 preparation configuration is callable only by its owned parent");
assertPreparationLoopback(baseURL);

// API-only: deliberately no globalSetup, webServer, browser/page fixtures or
// ordinary suite configuration. The parent already owns the ephemeral server.
export default defineConfig({
  testDir: "./e2e", testMatch: "p0-memory-prepare.spec.ts", timeout: 120_000,
  fullyParallel: false, workers: 1, retries: 0, reporter: [["list"]],
  outputDir: `${process.env.P0_MEMORY_PREPARE_OUTPUT_DIR}/preparation-playwright`,
  use: { baseURL, extraHTTPHeaders: { "x-supercanvas-desktop-token": "supercanvas-isolated-e2e-session" },
    trace: "off", video: "off", screenshot: "off" },
});
