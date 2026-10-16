import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { EVALUATION_CASES } from "./cases";
import { BASELINE_SOURCE, EVALUATION_LOG, RENDERER_ROOT } from "./paths";
import { runEvaluation } from "./runner";
import { testSelection } from "./test-fixture";

afterEach(() => { vi.unstubAllGlobals(); });

/** Deterministic protocol fixtures, never a claim about real model quality. */
function fixtureDecision(index: number): unknown {
  const testCase = EVALUATION_CASES[index];
  if (testCase.id === "05-storyboard") return {
    type: "artifact", message: "纯离线分镜 fixture，仅验证成果结构与30秒时间轴。", artifact: {
      kind: "storyboard", title: "下班夜读（离线结构 fixture）", content: "无真实模型响应", totalDuration: 30,
      characters: [{ id: "reader", description: "同一位不露脸的下班读者" }],
      shots: Array.from({ length: 6 }, (_, shot) => ({ id: `shot-${shot + 1}`, start: shot * 5, end: (shot + 1) * 5,
        camera: shot % 2 ? "近景，固定机位" : "中景，缓慢推进", action: "同一位读者步入书店并翻开书页，不露脸。",
        prompt: "暖灯光照亮纸页，保留人物衣着一致；只展示手部与背影。", sound: "翻页声", characterIds: ["reader"] })),
    },
  };
  if (testCase.id === "07-client-edit" || testCase.id === "09-ambiguous") return {
    type: "clarify", message: "纯离线追问 fixture，不代表模型实际追问质量。", questions: [
      { id: "source", question: "请先确认最关键的素材或用途？", options: ["补充客户原图", "先补充用途与品牌"] },
      { id: "scope", question: "本轮先审阅哪一类内容？", options: ["画面方向", "文案信息", "尺寸与数量"] },
    ],
  };
  if (testCase.intent === "canvas-plan") return {
    type: "proposal", summary: "纯离线文字方案 fixture，保持待审阅且不放入画布。", assumptions: [], calls: [],
    texts: [{ id: "copy", title: "离线结构验证", content: `${testCase.label}：人工编写的固定 fixture，不是真实模型成果。` }],
  };
  return { type: "reply", message: `纯离线 fixture：${testCase.label}。仅验证对话协议和无执行边界，不用于真实质量评分。` };
}

for (const [phase, runtimeDirectory] of [
  ["baseline", BASELINE_SOURCE], ["after", join(RENDERER_ROOT, "lib")],
] as const) {
  it.skipIf(!existsSync(join(runtimeDirectory, "agent-service.ts")))(`all 14 ${phase} cases remain isolated and unexecuted with explicit offline fixtures`, async () => {
    const outputDirectory = join(EVALUATION_LOG, "offline-rework");
    mkdirSync(outputDirectory, { recursive: true });
    const ledgerDirectory = join(outputDirectory, `fixture-attempts-${phase}-${Date.now()}`);
    let calls = 0;
    const summary = await runEvaluation({ phase, mode: "offline-fixture", snapshot: testSelection(), runtimeDirectory,
      ledgerDirectory, outputDirectory, cases: EVALUATION_CASES,
      send: async (url) => {
        const decision = fixtureDecision(calls++);
        return new Response(JSON.stringify(String(url).endsWith("/responses")
          ? { status: "completed", output_text: JSON.stringify(decision) }
          : { choices: [{ message: { content: JSON.stringify(decision) }, finish_reason: "stop" }] }),
        { headers: { "content-type": "application/json" } });
      },
    });
    expect(summary.calls).toBe(14);
    expect(summary.results).toHaveLength(14);
    expect(summary.results.every(row => row.status === "succeeded")).toBe(true);
    for (const row of summary.results) {
      const result = JSON.parse(readFileSync(join(summary.runDirectory, `${row.id}.json`), "utf8"));
      expect(result.mode).toBe("offline-fixture");
      expect(result.scores).toBeNull();
      expect(result.invariant).toEqual({ canvasUnchanged: true, noExecution: true, noChatPlan: true,
        textOnlyInputs: true, sourceDataAccess: false });
    }
  });
}
