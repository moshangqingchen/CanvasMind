import base from "./playwright.canvas-v3.config";

/** The existing isolated server and loopback guard, with this phase's regressions. */
const config = {
  ...base,
  testMatch: [
    "canvas-param-panel-stage1.spec.ts",
    "canvas-parameter-dock.spec.ts",
    "canvas-failed-generation-parameters.spec.ts",
    "canvas-layout-regression.spec.ts",
    "canvas-model-picker-layout.spec.ts",
    "user-image-size-presets.spec.ts",
    "media-contract-ui.spec.ts",
    "supplier-billing.spec.ts",
    "image-mask-model-state.spec.ts",
    "video-duration-controls.spec.ts",
    "weai-current-group-pricing.spec.ts",
  ],
};
export default config;
