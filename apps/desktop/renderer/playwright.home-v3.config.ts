import base from "./playwright.neural.config";

/** Full home acceptance uses an owned runtime and the unchanged strict network guard. */
const config = {
  ...base,
  testMatch: ["neural-workspace.spec.ts", "workspace-home.spec.ts"],
};
export default config;
