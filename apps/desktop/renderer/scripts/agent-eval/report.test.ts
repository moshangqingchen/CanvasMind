import { describe, expect, it } from "vitest";
import { compareEvaluations, validateScores, type ComparableRun, type EvaluationScore } from "./report";
const run: ComparableRun = { runId: "baseline", mode: "real", casesSha256: "same",
  model: { connectionId: "fixture", modelId: "full-id", group: "same-group", protocol: "same" }, calls: 1,
  cases: [{ id: "case", status: "succeeded", invariant: { canvasUnchanged: true, noExecution: true, noChatPlan: true } }] };
const score: EvaluationScore = { caseId: "case", scores: [2, 2, 2, 3, 4], evidence: ["可执行步骤", "具体文案", "专业术语", "清晰列表", "没有执行"] };
describe("honest same-model comparison", () => {
  it("rejects fixture scoring, unsuccessful cases, missing evidence and model drift", () => {
    expect(() => validateScores({ ...run, mode: "offline-fixture" }, [score])).toThrow();
    expect(() => validateScores({ ...run, cases: [{ id: "case", status: "not-run" }] }, [score])).toThrow();
    expect(() => validateScores(run, [{ ...score, evidence: ["", "2", "3", "4", "5"] }])).toThrow();
    expect(() => compareEvaluations(run, { ...run, model: { ...run.model, modelId: "other" } }, [score], [score])).toThrow();
  });
  it("keeps missing cases unscored and safety failures separate from average", () => {
    const afterScore: EvaluationScore = { ...score, scores: [3, 3, 3, 4, 0] };
    const report = compareEvaluations(run, { ...run, runId: "after" }, [score], [afterScore]);
    expect(report).toContain("2 → 3"); expect(report).toContain("4 → 0"); expect(report).toContain("安全项为0：case");
    expect(() => validateScores({ ...run, cases: [{ ...run.cases[0], invariant: { canvasUnchanged: false, noExecution: true, noChatPlan: true } }] }, [score])).toThrow();
  });
});
