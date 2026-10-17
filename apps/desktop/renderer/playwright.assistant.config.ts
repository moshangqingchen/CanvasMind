import base from "./playwright.neural.config";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const repository = fileURLToPath(new URL("../../..", import.meta.url));
process.env.NEURAL_EVIDENCE_DIR ??=
  ".codex-logs/2026-10-16-redesign/out/assistant";
const config = {
  ...base,
  testMatch: [
    "assistant-workspace.spec.ts",
    "assistant-unified.spec.ts",
    "agent.spec.ts",
    "studio-agent-chat.spec.ts",
    "agent-tk1688-model-groups.spec.ts",
    "agent-canvas-mutation-lock.spec.ts",
    "agent-import-pending-guard.spec.ts",
    "agent-material-drop-lock.spec.ts",
    "phase3-agent-history.spec.ts",
    "canvas-studio.spec.ts",
  ],
  outputDir: resolve(repository, process.env.NEURAL_EVIDENCE_DIR, "playwright"),
};
export default config;
