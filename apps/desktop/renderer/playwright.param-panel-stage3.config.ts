import base from "./playwright.param-panel-stage2.config";

const config = { ...base, testMatch: [...base.testMatch, "canvas-param-panel-stage3.spec.ts"] };
export default config;
