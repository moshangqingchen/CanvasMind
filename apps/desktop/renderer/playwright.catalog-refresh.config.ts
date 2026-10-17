import { defineConfig } from "@playwright/test";
import neural from "./playwright.neural.config";

/** Production runtime, ephemeral data and the same strict loopback-only guard. */
export default defineConfig(neural, {
  // Legacy canvas fixtures keep saved synthetic connectors between cases.
  // Serve their ordinary model reads offline; explicit refresh/scan stays real
  // or case-mocked, and the server still requires zero external TCP attempts.
  metadata: { ...neural.metadata, offlineCanvasInventories: true },
  testMatch: ["supplier*.spec.ts", "suppliers.spec.ts", "canvas-*supplier*.spec.ts", "miaowu-canvas-upgrade.spec.ts", "weai-current-group-pricing.spec.ts"],
});
