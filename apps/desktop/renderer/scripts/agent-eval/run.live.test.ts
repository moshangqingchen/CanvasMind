import { readFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { it } from "vitest";
import { runEvaluation, validateSnapshot } from "./runner";
import { originalProviderSender } from "./runtime";
import type { SelectionSnapshot } from "./fixture";
import { BASELINE_SOURCE, EVALUATION_LOG, EVALUATION_TEMP, GLOBAL_HTTP_LEDGER, RENDERER_ROOT, SNAPSHOT_PATH } from "./paths";
import { V3_EVALUATION_CASES } from "./cases-v3";

it.skipIf(process.env.AGENT_EVAL_REAL_CALLS !== "confirmed-text-only-global-40")("explicit real text-only evaluation", async () => {
  const phase = process.env.AGENT_EVAL_PHASE;
  if (phase !== "baseline" && phase !== "after" && phase !== "retest") throw new Error("必须显式指定 baseline/after/retest");
  mkdirSync(EVALUATION_TEMP, { recursive: true });
  if (existsSync(join(EVALUATION_LOG, "REAL_EVAL_STOP.json"))) throw new Error("本轮真实评测已停止；禁止再次发请求");
  const cases = V3_EVALUATION_CASES.filter(item => item.id === process.env.AGENT_EVAL_CASE);
  if (cases.length !== 1) throw new Error("第三阶段按单题运行并人工检查原始输出后继续");
  // Read only the previously isolated snapshot. Never reads source profile/DB.
  const snapshot = JSON.parse(readFileSync(SNAPSHOT_PATH, "utf8")) as SelectionSnapshot;
  validateSnapshot(snapshot);
  const summary = await runEvaluation({ phase, mode: "real", snapshot,
    runtimeDirectory: phase === "baseline" ? BASELINE_SOURCE : join(RENDERER_ROOT, "lib"),
    ledgerDirectory: GLOBAL_HTTP_LEDGER, outputDirectory: EVALUATION_LOG,
    send: await originalProviderSender(snapshot.providerProxy), cases, phaseLimit: phase === "retest" ? 4 : 6 });
  // No credentials, headers, connection URL or raw provider object on stdout.
  console.log(JSON.stringify({ runId: summary.runId, calls: summary.calls, globalReserved: summary.globalReserved,
    results: summary.results, stopped: summary.stopped }, null, 2));
});
