import base from "./playwright.param-panel-stage1.config";

const config = {
  ...base,
  testMatch: [...base.testMatch, "canvas-param-panel-stage2.spec.ts", "canvas-panel-after-supplier.spec.ts", "dialog-interactions.spec.ts", "image-parameter-contract.spec.ts", "canvas-*-parameters.spec.ts", "canvas-music.spec.ts", "image-output-mode.spec.ts"],
};
export default config;
