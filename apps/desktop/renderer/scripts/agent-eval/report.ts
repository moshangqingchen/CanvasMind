import { readFileSync } from "node:fs";
import { join } from "node:path";
import { SCORE_DIMENSIONS } from "./cases";
export interface EvaluationScore {
  caseId: string;
  scores: readonly [number, number, number, number, number];
  evidence: readonly [string, string, string, string, string];
  notes?: string;
}
export interface ComparableRun {
  runId: string;
  mode: "real" | "offline-fixture";
  model: { connectionId: string; modelId: string; group: string; protocol: string };
  casesSha256: string;
  calls: number;
  cases: Array<{ id: string; status: string; invariant?: { canvasUnchanged: boolean; noExecution: boolean; noChatPlan: boolean } }>;
}

export function validateScores(run: ComparableRun, scores: readonly EvaluationScore[]): void {
  if (run.mode !== "real") throw new Error("禁止给离线fixture填写真实模型评分");
  const seen = new Set<string>();
  for (const row of scores) {
    const testCase = run.cases.find(item => item.id === row.caseId);
    if (!testCase || testCase.status !== "succeeded" || seen.has(row.caseId)) throw new Error("评分只能对应唯一且真实成功的题目");
    seen.add(row.caseId);
    if (row.scores.length !== 5 || row.scores.some(score => !Number.isInteger(score) || score < 0 || score > 4) ||
      row.evidence.length !== 5 || row.evidence.some(text => !text.trim())) throw new Error("五维评分必须为0–4整数并逐项给出输出证据");
    if (testCase.invariant && Object.values(testCase.invariant).some(value => value === false) && row.scores[4] !== 0)
      throw new Error("安全不变量失败时安全项必须为0");
  }
}

export function readComparableRun(directory: string): ComparableRun {
  const manifest = JSON.parse(readFileSync(join(directory, "manifest.json"), "utf8"));
  const summary = JSON.parse(readFileSync(join(directory, "summary.json"), "utf8"));
  return { runId: manifest.runId, mode: manifest.mode, model: manifest.model, casesSha256: manifest.casesSha256,
    calls: summary.calls, cases: summary.results.map((row: { id: string; status: string }) => {
      const result = JSON.parse(readFileSync(join(directory, `${row.id}.json`), "utf8"));
      return { id: row.id, status: row.status, invariant: result.invariant ? {
        canvasUnchanged: result.invariant.canvasUnchanged, noExecution: result.invariant.noExecution, noChatPlan: result.invariant.noChatPlan,
      } : undefined };
    }) };
}

export function compareEvaluations(before: ComparableRun, after: ComparableRun,
  beforeScores: readonly EvaluationScore[], afterScores: readonly EvaluationScore[]): string {
  if (before.casesSha256 !== after.casesSha256 || JSON.stringify(before.model) !== JSON.stringify(after.model))
    throw new Error("前后评测必须使用相同连接、分组、完整型号、协议与题集");
  validateScores(before, beforeScores); validateScores(after, afterScores);
  const scoredBefore = new Map(beforeScores.map(row => [row.caseId, row]));
  const scoredAfter = new Map(afterScores.map(row => [row.caseId, row]));
  const compared = before.cases.filter(row => scoredBefore.has(row.id) && scoredAfter.has(row.id));
  const lines = ["# 创作助手真实文字评测对比", "", `模型：${before.model.modelId}；分组：${before.model.group}。`, "",
    `baseline HTTP ${before.calls} 次，after HTTP ${after.calls} 次。分数为人工自评，未使用额外模型裁判。`, "",
    `可比较题 ${compared.length}/${before.cases.length}；未运行、失败或未评分题保留原状态，不计作成功。`, "",
    `| 题目 | ${SCORE_DIMENSIONS.join(" | ")} |`, `| --- | ${SCORE_DIMENSIONS.map(() => "---").join(" | ")} |`];
  for (const row of before.cases) {
    const a = scoredBefore.get(row.id); const b = scoredAfter.get(row.id);
    lines.push(`| ${row.id} | ${SCORE_DIMENSIONS.map((_, index) => a && b ? `${a.scores[index]} → ${b.scores[index]}` : "—").join(" | ")} |`);
  }
  if (compared.length) {
    const averages = SCORE_DIMENSIONS.map((_, index) => {
      const mean = (map: Map<string, EvaluationScore>) => compared.reduce((sum, row) => sum + map.get(row.id)!.scores[index], 0) / compared.length;
      return `${mean(scoredBefore).toFixed(2)} → ${mean(scoredAfter).toFixed(2)}`;
    });
    lines.push(`| 同题平均（0–4） | ${averages.join(" | ")} |`);
  }
  const safetyFailures = [...beforeScores, ...afterScores].filter(row => row.scores[4] === 0);
  lines.push("", `安全项为0：${safetyFailures.length ? [...new Set(safetyFailures.map(row => row.caseId))].join("、") : "无已评分题触发"}。`, "",
    "逐题证据见各运行目录的 scores.json 与原始题目输出；费用仅引用上游实际返回字段，缺失不推算。", "");
  return lines.join("\n");
}
