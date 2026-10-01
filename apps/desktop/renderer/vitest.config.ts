import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    // Tests run on the server; keep Next's client-boundary marker inert here.
    alias: { "server-only": fileURLToPath(new URL("./node_modules/next/dist/compiled/server-only/empty.js", import.meta.url)) },
  },
  test: {
    // Production standalone copies must never be collected as a second test suite.
    include: ["app/api/**/*.test.ts", "lib/**/*.test.ts", "proxy.test.ts"],
  },
});
