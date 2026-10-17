import { defineConfig } from "vitest/config";
import { join } from "node:path";
import { aliases } from "./vitest.config";
import { RENDERER_ROOT, REPOSITORY_ROOT } from "./paths";
export default defineConfig({
  root: RENDERER_ROOT, cacheDir: join(REPOSITORY_ROOT, ".codex-temp", "agent-eval", "vite-cache"), resolve: { alias: aliases },
  test: { include: ["scripts/agent-eval/cleanup.live.test.ts"], fileParallelism: false },
});
