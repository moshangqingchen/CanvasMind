import { defineConfig } from "@playwright/test";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import base from "./playwright.config";

const root = fileURLToPath(new URL("../../..", import.meta.url));
const logs = resolve(root, ".codex-logs/2026-10-18-ui-readability");
Object.assign(process.env, { TEMP: resolve(logs, "tmp"), TMP: resolve(logs, "tmp"), NEXT_TELEMETRY_DISABLED: "1" });

export default defineConfig({
  ...base, globalSetup: "./e2e/helpers/ui-readability-app-global-setup.ts", metadata: { offlineCanvasInventories: true },
  testMatch: ["supplier-jijiu.spec.ts", "supplier-tk1688-model-groups.spec.ts", "supplier-settings-usability.spec.ts", "canvas-public-directory-diff.spec.ts", "canvas-model-picker-layout.spec.ts", "canvas-panel-after-supplier.spec.ts", "media-contract-ui.spec.ts", "weai-current-group-pricing.spec.ts", "suppliers.spec.ts", "miaowu-canvas-upgrade.spec.ts", "video-duration-controls.spec.ts", "canvas-phase4-polish.spec.ts", "canvas-performance.spec.ts"],
  outputDir: resolve(logs, "app-test-results"), reporter: [["list"]], retries: 0,
  use: { ...base.use, launchOptions: { args: ["--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost, EXCLUDE 127.0.0.1"] } },
});
