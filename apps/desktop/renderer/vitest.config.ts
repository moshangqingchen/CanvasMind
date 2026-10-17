import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    // Tests run on the server; keep Next's client-boundary marker inert here.
    alias: { "server-only": fileURLToPath(new URL("./node_modules/next/dist/compiled/server-only/empty.js", import.meta.url)) },
  },
  test: {
    // Finish parallel units before measuring disk latency; keep every assertion
    // and collect the complete scale suite in the normal pnpm test command.
    projects: [
      { extends: true, test: { name: "unit", sequence: { groupOrder: 0 },
        include: ["app/api/**/*.test.ts", "lib/**/*.test.ts", "proxy.test.ts"],
        exclude: ["lib/catalog-pipeline-scale.test.ts"] } },
      { extends: true, test: { name: "catalog-save-serial", sequence: { groupOrder: 1 },
        include: ["lib/catalog-pipeline-scale.test.ts"], fileParallelism: false, maxWorkers: 1 } },
    ],
  },
});
