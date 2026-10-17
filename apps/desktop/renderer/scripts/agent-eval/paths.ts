import { fileURLToPath } from "node:url";
import { join, resolve, relative, isAbsolute } from "node:path";
export const REPOSITORY_ROOT = fileURLToPath(new URL("../../../../../", import.meta.url));
export const RENDERER_ROOT = fileURLToPath(new URL("../../", import.meta.url));
export const EVALUATION_TEMP = join(REPOSITORY_ROOT, ".codex-temp", "agent-eval");
export const EVALUATION_LOG = join(REPOSITORY_ROOT, ".codex-logs", "2026-10-16-redesign-v2", "agent-eval");
// Preserve the task-wide counter across all stages; never reset for a new report.
export const GLOBAL_HTTP_LEDGER = join(REPOSITORY_ROOT, ".codex-logs", "2026-10-16-redesign", "agent-eval", "http-attempts");
export const SNAPSHOT_PATH = join(EVALUATION_TEMP, "selection.secret.json");
export const BASELINE_SOURCE = join(REPOSITORY_ROOT, ".codex-temp", "agent-eval-v3-baseline-source", "apps", "desktop", "renderer", "lib");

export function assertInside(parent: string, path: string): string {
  const absolute = resolve(path);
  const rel = relative(resolve(parent), absolute);
  if (!rel || rel.startsWith("..") || isAbsolute(rel)) throw new Error("评测路径超出项目隔离目录");
  return absolute;
}
