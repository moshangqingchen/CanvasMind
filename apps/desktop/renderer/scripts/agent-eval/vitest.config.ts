import { defineConfig } from "vitest/config";
import { realpathSync } from "node:fs";
import { join } from "node:path";
import { RENDERER_ROOT, REPOSITORY_ROOT } from "./paths";
export const aliases = [
  { find: "server-only", replacement: join(RENDERER_ROOT, "node_modules", "next", "dist", "compiled", "server-only", "empty.js") },
  ...["core", "db", "director", "providers", "runtime", "storage"].map(name => ({
    find: new RegExp(`^@super-canvas/${name}$`, "u"),
    replacement: realpathSync(join(RENDERER_ROOT, "node_modules", "@super-canvas", name, "dist", "index.js")),
  })),
  { find: /^@super-canvas\/providers\/(.+)$/u,
    replacement: `${realpathSync(join(RENDERER_ROOT, "node_modules", "@super-canvas", "providers", "dist"))}/$1.js` },
];
export default defineConfig({
  root: RENDERER_ROOT, cacheDir: join(REPOSITORY_ROOT, ".codex-temp", "agent-eval", "vite-cache"),
  resolve: { alias: aliases },
  test: { include: ["scripts/agent-eval/*.test.ts"], exclude: ["scripts/agent-eval/*.live.test.ts"],
    fileParallelism: false, testTimeout: 60_000, env: { USE_MEMORY_STORE: "ephemeral", SUPPLIER_AUTO_VERIFY: "off" } },
});
