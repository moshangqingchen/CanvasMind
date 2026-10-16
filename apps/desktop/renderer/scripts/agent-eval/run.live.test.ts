import { readFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { it } from "vitest";
import { runEvaluation, validateSnapshot } from "./runner";
import { originalProviderSender } from "./runtime";
import type { SelectionSnapshot } from "./fixture";
import { BASELINE_SOURCE, EVALUATION_LOG, EVALUATION_TEMP, GLOBAL_HTTP_LEDGER, RENDERER_ROOT, SNAPSHOT_PATH } from "./paths";

it.skipIf(process.env.AGENT_EVAL_REAL_CALLS !== "confirmed-text-only-global-40")("explicit real text-only evaluation", async () => {
  const phase = process.env.AGENT_EVAL_PHASE;
  if (phase !== "baseline" && phase !== "after" && phase !== "retest") throw new Error("必须显式指定 baseline/after/retest");
  mkdirSync(EVALUATION_TEMP, { recursive: true });
  // Read only the previously isolated snapshot. Never reads source profile/DB.
  const snapshot = JSON.parse(readFileSync(SNAPSHOT_PATH, "utf8")) as SelectionSnapshot;
  validateSnapshot(snapshot);
  const summary = await runEvaluation({ phase, mode: "real", snapshot,
    runtimeDirectory: phase === "baseline" ? BASELINE_SOURCE : join(RENDERER_ROOT, "lib"),
    ledgerDirectory: GLOBAL_HTTP_LEDGER, outputDirectory: EVALUATION_LOG,
    send: await originalProviderSender(snapshot.providerProxy), phaseLimit: phase === "retest" ? 6 : 20 });
  // No credentials, headers, connection URL or raw provider object on stdout.
  console.log(JSON.stringify({ runId: summary.runId, calls: summary.calls, globalReserved: summary.globalReserved,
    results: summary.results, stopped: summary.stopped }, null, 2));
});
