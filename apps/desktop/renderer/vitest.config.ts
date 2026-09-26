import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Production standalone copies must never be collected as a second test suite.
    include: ["app/api/**/*.test.ts", "lib/**/*.test.ts", "proxy.test.ts"],
  },
});
