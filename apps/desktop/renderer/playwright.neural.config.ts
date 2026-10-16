import { defineConfig, devices } from "@playwright/test";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const repository = fileURLToPath(new URL("../../..", import.meta.url));
const temporary = resolve(repository, ".codex-temp");
const evidence = resolve(
  repository,
  process.env.NEURAL_EVIDENCE_DIR ?? ".codex-logs/2026-10-16-redesign/out",
);
// Browser profiles, ffmpeg and Next caches must stay inside the repository.
Object.assign(process.env, {
  TEMP: temporary,
  TMP: temporary,
  PLAYWRIGHT_BROWSERS_PATH: resolve(temporary, "playwright-browsers"),
  npm_config_cache: resolve(temporary, "npm-cache"),
  ELECTRON_CACHE: resolve(temporary, "electron-cache"),
  ELECTRON_BUILDER_CACHE: resolve(temporary, "electron-builder-cache"),
});

export default defineConfig({
  testDir: "./e2e",
  testMatch: "neural-workspace.spec.ts",
  globalSetup: "./e2e/helpers/neural-global-setup.ts",
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  outputDir: resolve(evidence, "playwright"),
  use: {
    ...devices["Desktop Chrome"],
    viewport: { width: 1440, height: 900 },
    baseURL: `http://127.0.0.1:${process.env.PLAYWRIGHT_PORT ?? "3217"}`,
    extraHTTPHeaders: {
      "x-supercanvas-desktop-token": "supercanvas-isolated-e2e-session",
    },
    channel: process.env.PLAYWRIGHT_CHANNEL ?? "chrome",
    launchOptions: { args: ["--enable-precise-memory-info"] },
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off",
  },
});
