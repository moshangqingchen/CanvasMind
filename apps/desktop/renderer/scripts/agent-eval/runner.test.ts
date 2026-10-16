import { mkdtempSync, mkdirSync, readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EVALUATION_CASES } from "./cases";
import { runEvaluation, validateSnapshot } from "./runner";
import { EVALUATION_TEMP, RENDERER_ROOT, BASELINE_SOURCE } from "./paths";
import { testSelection } from "./test-fixture";
import { blockedOperation } from "./guard";
import { resolveSnapshotModel } from "./fixture";

afterEach(() => { vi.unstubAllGlobals(); });
function directory() { mkdirSync(EVALUATION_TEMP, { recursive: true }); return mkdtempSync(join(EVALUATION_TEMP, "runtime-test-")); }
function response(decision: unknown, responseEndpoint: boolean) {
  return new Response(JSON.stringify(responseEndpoint
    ? { status: "completed", output_text: JSON.stringify(decision), usage: { input_tokens: 10, output_tokens: 20, total_tokens: 30 } }
    : { choices: [{ message: { content: JSON.stringify(decision) }, finish_reason: "stop" }], usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 } }),
  { headers: { "content-type": "application/json" } });
}
describe("actual agent/adapter isolated pipeline", () => {
  it.skipIf(!existsSync(join(BASELINE_SOURCE, "agent-service.ts")))("frozen baseline covers reply, compatibility fallback, read-only tool round and unexecuted plan with one ledger", async () => {
    const outputDirectory = directory();
    const ledgerDirectory = join(outputDirectory, "attempts");
    let calls = 0;
    const cases = [EVALUATION_CASES[0], EVALUATION_CASES[1], EVALUATION_CASES[10], EVALUATION_CASES[5]];
    const result = await runEvaluation({ phase: "baseline", mode: "offline-fixture", snapshot: testSelection(),
      runtimeDirectory: BASELINE_SOURCE, outputDirectory, ledgerDirectory,
      cases, send: async (url, init) => {
        calls++;
        const body = JSON.parse(String(init?.body));
        expect(body.model).toBe("eval-test-model");
        expect(init?.redirect).toBe("manual");
        if (calls === 2) return new Response('{"error":{"message":"unsupported endpoint route not found"}}', { status: 404 });
        const decision = calls === 4 ? { type: "tool", tool: "read_canvas", message: "读取所选文字", assetIds: [] }
          : calls === 6 ? { type: "proposal", summary: "待审阅的文字版式方案", assumptions: [], calls: [], texts: [{ id: "copy", title: "文案", content: "下班后，给自己一页" }] }
          : { type: "reply", message: "离线fixture响应，不是真实模型评测。" };
        return response(decision, String(url).endsWith("/responses"));
      } });
    expect(result.results.every(item => item.status === "succeeded")).toBe(true);
    expect(result.calls).toBe(6);
    expect(result.globalReserved).toBe(6);
    const plan = JSON.parse(readFileSync(join(result.runDirectory, `${cases[3].id}.json`), "utf8"));
    expect(plan.output.plans).toHaveLength(1);
    expect(plan.output.plans[0].status).toBe("awaiting_approval");
    expect(plan.invariant).toEqual({ canvasUnchanged: true, noExecution: true, noChatPlan: true, textOnlyInputs: true, sourceDataAccess: false });
    const allLogs = readdirSync(ledgerDirectory).map(name => readFileSync(join(ledgerDirectory, name), "utf8")).join("\n");
    expect(allLogs).not.toContain(testSelection().connection.apiKey);
  });
  it("can evaluate current source without importing the original server", async () => {
    const outputDirectory = directory();
    const result = await runEvaluation({ phase: "baseline", mode: "offline-fixture", snapshot: testSelection(),
      runtimeDirectory: join(RENDERER_ROOT, "lib"), outputDirectory, ledgerDirectory: join(outputDirectory, "attempts"),
      cases: EVALUATION_CASES.slice(0, 1), send: async () => response({ type: "reply", message: "当前源码离线fixture" }, false) });
    expect(result.calls).toBe(1);
    expect(result.results[0].status).toBe("succeeded");
  });
  it.skipIf(!existsSync(join(BASELINE_SOURCE, "agent-service.ts")))("counts baseline schema repair as another HTTP attempt", async () => {
    const outputDirectory = directory();
    let calls = 0;
    const result = await runEvaluation({ phase: "baseline", mode: "offline-fixture", snapshot: testSelection(),
      runtimeDirectory: BASELINE_SOURCE, outputDirectory, ledgerDirectory: join(outputDirectory, "attempts"),
      cases: EVALUATION_CASES.slice(0, 1), send: async () => {
        calls++;
        return response(calls === 1 ? { type: "clarify", message: "无效的空问题列表", questions: [] }
          : { type: "reply", message: "修复后的离线回复" }, false);
      } });
    expect(result.calls).toBe(2);
    expect(result.results[0].status).toBe("succeeded");
  });
  it("stops later cases after an upstream failure without paid replay", async () => {
    const outputDirectory = directory();
    const send = vi.fn(async () => new Response('{"error":{"message":"quota exhausted"}}', { status: 429 }));
    const result = await runEvaluation({ phase: "after", mode: "offline-fixture", snapshot: testSelection(),
      runtimeDirectory: join(RENDERER_ROOT, "lib"), outputDirectory, ledgerDirectory: join(outputDirectory, "attempts"),
      cases: EVALUATION_CASES.slice(0, 3), send });
    expect(send).toHaveBeenCalledOnce();
    expect(result.results.map(item => item.status)).toEqual(["failed", "not-run", "not-run"]);
  });
  it("rejects a mismatched snapshot, helper selection and all execution/storage operations", () => {
    const snapshot = testSelection();
    expect(() => validateSnapshot({ ...snapshot, option: { ...snapshot.option, modelId: "other" } })).toThrow();
    expect(() => resolveSnapshotModel(snapshot, "helper", snapshot.connection.model)).toThrow();
    expect(() => resolveSnapshotModel(snapshot, snapshot.connection.id, snapshot.connection.model, "high")).toThrow();
    for (const name of ["materialize", "execute", "upload", "storage.get", "runService.prepareRun"])
      expect(() => blockedOperation(name)).toThrow("硬阻断");
  });
});
