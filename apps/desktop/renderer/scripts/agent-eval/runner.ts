import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import type { AgentEvent } from "../../lib/agent-contracts";
import { EVALUATION_CASES, SCORE_DIMENSIONS, SCORE_RUBRIC, type EvaluationCase } from "./cases";
import { createEvaluationRepository, SYNTHETIC_CANVAS_ID, SYNTHETIC_TEXT_NODE_ID, type SelectionSnapshot } from "./fixture";
import { countHttpAttempts, writeExclusiveJson, type AttemptIdentity } from "./budget";
import { makeSecretRedactor } from "./guard";
import { createEvaluationTransport, type EvaluationSender } from "./transport";
import { loadIsolatedRuntime } from "./runtime";
import { EVALUATION_LOG, GLOBAL_HTTP_LEDGER } from "./paths";

export function validateSnapshot(snapshot: SelectionSnapshot): void {
  if (snapshot.schemaVersion !== 1 || !snapshot.selectionSource || !snapshot.selectedAt ||
    !snapshot.connection.apiKey || !snapshot.record.encryptedSecret || !snapshot.option.available ||
    snapshot.connection.id !== snapshot.record.id || snapshot.connection.id !== snapshot.option.connectionId ||
    snapshot.connection.model !== snapshot.option.modelId || snapshot.connection.protocol !== snapshot.option.protocol ||
    !snapshot.connection.capabilities.text || snapshot.connection.reasoningEffort)
    throw new Error("评测连接快照缺失或与已确认的模型身份不一致");
}

export interface EvaluationRunOptions {
  phase: AttemptIdentity["phase"];
  mode: "real" | "offline-fixture";
  snapshot: SelectionSnapshot;
  runtimeDirectory: string;
  outputDirectory: string;
  ledgerDirectory: string;
  send: EvaluationSender;
  phaseLimit?: number;
  cases?: readonly EvaluationCase[];
}

function runtimeSourceHashes(directory: string, prefix = ""): Record<string, string> {
  return Object.fromEntries(readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name)).flatMap(entry => {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) return Object.entries(runtimeSourceHashes(join(directory, entry.name), relative));
    return entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")
      ? [[relative, createHash("sha256").update(readFileSync(join(directory, entry.name))).digest("hex")]] : [];
  }));
}

/** No live DB, app server, source canvas/session or asset store is opened here. */
export async function runEvaluation(options: EvaluationRunOptions) {
  const realLedger = resolve(options.ledgerDirectory) === resolve(GLOBAL_HTTP_LEDGER);
  if ((options.mode === "real" && (!realLedger || resolve(options.outputDirectory) !== resolve(EVALUATION_LOG))) ||
    (options.mode === "offline-fixture" && realLedger)) throw new Error("真实调用必须共用固定账本；fixture禁止占用真实账本");
  validateSnapshot(options.snapshot);
  mkdirSync(options.outputDirectory, { recursive: true });
  const secrets = [options.snapshot.connection.apiKey, options.snapshot.record.encryptedSecret,
    options.snapshot.providerProxy ?? "", ...Object.values(options.snapshot.connection.headers ?? {})]
    .filter((value): value is string => typeof value === "string" && Boolean(value));
  const redact = makeSecretRedactor(secrets);
  const safe = (value: unknown) => JSON.parse(redact(JSON.stringify(value))) as unknown;
  const manifestPath = join(options.runtimeDirectory, "agent-service.ts");
  const sourceSha256 = createHash("sha256").update(readFileSync(manifestPath)).digest("hex");
  const sourceFiles = runtimeSourceHashes(options.runtimeDirectory);
  const runtimeSha256 = createHash("sha256").update(JSON.stringify(sourceFiles)).digest("hex");
  const testCases = options.cases ?? EVALUATION_CASES;
  let currentCase = testCases[0];
  const transport = createEvaluationTransport({ connection: options.snapshot.connection, secrets,
    ledgerDirectory: options.ledgerDirectory, send: options.send, phaseLimit: options.phaseLimit,
    identity: () => ({ phase: options.phase, caseId: currentCase.id, connectionId: options.snapshot.connection.id,
      modelId: options.snapshot.connection.model, intent: currentCase.intent }),
    inputSummary: () => `${currentCase.label}：${currentCase.message.slice(0, 160)}` });
  const runtime = await loadIsolatedRuntime({ runtimeDirectory: options.runtimeDirectory,
    snapshot: options.snapshot, fetch: transport.fetch });
  const runId = `${options.phase}-${Date.now()}-${randomUUID().slice(0, 8)}`;
  const runDirectory = join(options.outputDirectory, runId);
  mkdirSync(runDirectory, { recursive: false });
  writeExclusiveJson(join(runDirectory, "manifest.json"), { runId, phase: options.phase, mode: options.mode,
    startedAt: new Date().toISOString(), sourceSha256, runtimeSha256, sourceFiles, fixtureCatalog: true,
    model: { connectionId: options.snapshot.connection.id, modelId: options.snapshot.connection.model,
      supplier: options.snapshot.option.supplierName, group: options.snapshot.option.group,
      protocol: options.snapshot.connection.protocol },
    casesSha256: createHash("sha256").update(JSON.stringify(testCases)).digest("hex"),
    globalReservedAtStart: countHttpAttempts(options.ledgerDirectory), rubric: SCORE_RUBRIC, scoreDimensions: SCORE_DIMENSIONS,
  });
  const results: Array<{ id: string; status: string; durationMs: number; calls: number }> = [];
  for (const testCase of testCases) {
    currentCase = testCase;
    if (transport.stopped()) {
      writeExclusiveJson(join(runDirectory, `${testCase.id}.json`), { case: testCase, status: "not-run",
        mode: options.mode, reason: transport.stopped(), scores: null });
      results.push({ id: testCase.id, status: "not-run", durationMs: 0, calls: 0 });
      continue;
    }
    const repository = await createEvaluationRepository(options.snapshot, testCase);
    runtime.setRepository(repository);
    const session = await runtime.createAgentSession(SYNTHETIC_CANVAS_ID);
    const beforeCanvas = await repository.getCanvas(SYNTHETIC_CANVAS_ID);
    const events: AgentEvent[] = [];
    const beforeCalls = transport.calls();
    const started = performance.now();
    let error: string | undefined;
    let status: string;
    try {
      status = await runtime.runAgentTurn({ canvasId: SYNTHETIC_CANVAS_ID, sessionId: session.id,
        requestId: `eval-${runId}-${testCase.id}`, connectionId: options.snapshot.connection.id,
        modelId: options.snapshot.connection.model, message: testCase.message, intent: testCase.intent,
        attachmentAssetIds: [], selectedNodeIds: testCase.selectedText ? [SYNTHETIC_TEXT_NODE_ID] : [], reasoningEffort: "auto",
      }, event => events.push(event));
    } catch (caught) {
      status = "failed";
      error = redact(caught instanceof Error ? caught.message : String(caught));
      transport.halt("本题真实调用或解析失败；停止后续真实题，不换模型、不自动重发");
    }
    const output = await runtime.getAgentSession(session.id);
    const afterCanvas = await repository.getCanvas(SYNTHETIC_CANVAS_ID);
    const invariant = { canvasUnchanged: JSON.stringify(beforeCanvas) === JSON.stringify(afterCanvas),
      noExecution: output.plans.every(plan => !plan.workflowRunId && plan.status === "awaiting_approval"),
      noChatPlan: testCase.intent !== "chat" || output.plans.length === 0,
      textOnlyInputs: true, sourceDataAccess: false };
    const durationMs = Math.round(performance.now() - started);
    const calls = transport.calls() - beforeCalls;
    writeExclusiveJson(join(runDirectory, `${testCase.id}.json`), safe({ case: testCase, mode: options.mode, status,
      completedAt: new Date().toISOString(), durationMs, httpAttempts: calls, ...(error ? { error } : {}),
      output, events, invariant, scores: null, scoringNotes: "需根据真实输出逐题人工自评，fixture不得作为真实评测得分。" }));
    results.push({ id: testCase.id, status, durationMs, calls });
    if (!invariant.canvasUnchanged || !invariant.noExecution || !invariant.noChatPlan)
      throw new Error("隔离评测安全不变量失败，停止后续调用");
  }
  const summary = { runId, phase: options.phase, mode: options.mode, sourceSha256, runtimeSha256, results,
    calls: transport.calls(), globalReserved: countHttpAttempts(options.ledgerDirectory),
    ...(transport.stopped() ? { stopped: transport.stopped() } : {}) };
  writeExclusiveJson(join(runDirectory, "summary.json"), summary);
  return { ...summary, runDirectory };
}
