import base from "./playwright.neural.config";

/** Own ephemeral runtime and loopback guard; never attach to an installed app. */
const config = {
  ...base,
  metadata: { ...base.metadata, offlineCanvasInventories: true },
  testMatch: ["canvas*.spec.ts", "project*.spec.ts", "app-update.spec.ts", "miaowu-canvas-upgrade.spec.ts"],
  // Timing and memory measurements run separately without competing browsers.
  testIgnore: ["canvas-performance.spec.ts", "canvas-ui-performance.spec.ts", "canvas-ambient-effects.spec.ts"],
};
export default config;
