import { fileURLToPath } from "node:url";
import base from "./playwright.canvas-v3.config";

// Next's development-only version lookup is answered locally; all other
// non-loopback connections remain subject to the inherited strict TCP guard.
process.env.NEURAL_DISABLE_VERSION_CHECK = "1";
process.env.PARAM_PANEL_SCREENSHOT_DIR ??= fileURLToPath(new URL(
  "../../../.codex-logs/2026-10-19-route-hierarchy/regression/screenshots/", import.meta.url,
));

const config = {
  ...base,
  testMatch: [
    "canvas-route-picker-hierarchy.spec.ts",
    "canvas-failed-generation-parameters.spec.ts",
    "canvas-model-picker-layout.spec.ts",
    "canvas-panel-after-supplier.spec.ts",
    "canvas-panel-interaction.spec.ts",
    "canvas-param-panel-stage1.spec.ts",
    "canvas-param-panel-stage2.spec.ts",
    "canvas-param-panel-stage3.spec.ts",
    "canvas-pdog-parameters.spec.ts",
    "canvas-supplier-picker.spec.ts",
    "canvas-tk1688-connections.spec.ts",
    "canvas-weai-image25-default.spec.ts",
    "canvas.spec.ts",
    "image-output-mode.spec.ts",
    "image-transparency-reference.spec.ts",
    "supplier-billing.spec.ts",
    "supplier-jijiu-persistence.spec.ts",
    "supplier-jijiu.spec.ts",
    "weai-current-group-pricing.spec.ts",
  ],
};
export default config;
