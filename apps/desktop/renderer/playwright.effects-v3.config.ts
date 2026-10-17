import base from "./playwright.neural.config";

const config = {
  ...base,
  testMatch: ["canvas-performance.spec.ts", "canvas-ui-performance.spec.ts", "canvas-ambient-effects.spec.ts"],
};
export default config;
