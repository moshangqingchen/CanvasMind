import { expect, test } from "./helpers/canvas-offline-test";
import type { RunErrorDetails, RunSnapshot } from "../components/types";

// Presentation fixtures only. Runtime's material-preparation tests independently
// assert that failed preparation sends zero generation POSTs.
for (const accepted of [false, true]) test(accepted
  ? "素材错误代码遇到原受理任务时保留原任务和扣费待确认"
  : "素材准备失败在结果来源与历史中准确展示尚未提交和未扣费", async ({ page, request }, testInfo) => {
  const runId = `material-display-${accepted ? "accepted" : "unsubmitted"}`;
  const taskId = accepted ? "accepted-original-task" : undefined;
  const error: RunErrorDetails = {
    message: accepted ? "原任务已提交，恢复时素材准备失败；请核对原任务。" : "素材准备失败，尚未提交生成；当前生成尚未提交。原文件读取超时。",
    code: "MATERIAL_PREPARATION_FAILED", type: "素材准备失败", source: "local_validation", phase: "prepare",
    failureCategory: "local_network", submissionMayHaveOccurred: accepted,
    charge: accepted ? { status: "unknown", source: "unconfirmed" } : { status: "not_charged", source: "not_submitted" },
  };
  const response = await request.post("/api/canvas", { data: { title: `素材准备展示-${accepted ? "原任务" : "未提交"}`, graph: {
    schemaVersion: 1, viewport: { x: 0, y: 0, zoom: 1 }, edges: [], nodes: [{
      id: "material-result", type: "workflow", position: { x: 120, y: 100 }, style: { width: 430, height: 260 },
      data: { nodeType: "asset-input", label: "素材准备验收", assetKind: "image", generatedResult: true,
        generatedStatus: "failed", generatedFromRunId: runId, generatedFromNodeId: "material-source", generatedError: error,
        generatedProvider: "fake", generatedModel: "fake-image-v1", generatedDetails: { taskEvidence: taskId ? { taskId, status: "running" } : undefined },
        inputs: [], outputs: [] },
    }] },
  } });
  expect(response.ok()).toBe(true);
  const canvas = await response.json();
  const snapshot: RunSnapshot = {
    run: { id: runId, canvasId: canvas.id, scope: "node", nodeId: "material-source", status: "failed",
      createdAt: "2026-10-19T00:00:00.000Z", canResume: false, canRecoverOutputs: false },
    nodes: [{ id: `${runId}-node`, nodeId: "material-source", status: "failed", outputAssetIds: [], errorJson: error,
      taskEvidence: taskId ? { taskId, status: "running" } : undefined,
      request: { provider: "fake", connectionName: "本地展示夹具", model: "fake-image-v1", operation: "image.generate" } }],
  };
  let generationPosts = 0;
  await page.route(/\/api\/runs(?:\/[^/?]+)?(?:\?.*)?$/u, route => {
    if (route.request().method() === "POST") { generationPosts++; return route.abort(); }
    const path = new URL(route.request().url()).pathname;
    return route.fulfill({ json: path === "/api/runs" ? [snapshot] : snapshot });
  });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`/canvas/${canvas.id}`);
  const state = page.locator(".generated-result-state.failed").first();
  const summary = state.locator(".result-error-summary");
  await expect(summary).toBeVisible();
  if (!accepted) {
    await expect(summary).toContainText("素材准备失败，尚未提交生成");
    await expect(summary).toContainText("未产生生成费用");
    await expect(summary).not.toContainText(/原任务|账单|无法确认/u);
  } else await expect(summary).not.toContainText("未产生生成费用");
  await state.locator("summary").filter({ hasText: "来源与任务" }).click();
  await state.getByRole("button", { name: "查看 素材准备验收 来源", exact: true }).click();
  const details = page.getByRole("dialog", { name: "结果来源与参数" });
  await details.locator("summary").filter({ hasText: "查看完整错误详情" }).click();
  const diagnosis = details.getByLabel("失败诊断");
  await expect(diagnosis).toBeVisible();
  if (accepted) {
    await expect(details).toContainText(taskId!);
    await expect(diagnosis).toContainText("扣费待确认");
    await expect(diagnosis).toContainText("核对原任务和账单");
    await expect(details).not.toContainText("未产生生成费用");
  } else {
    await expect(diagnosis.locator('[data-charge="not_charged"]')).toContainText("未扣费");
    await expect(diagnosis).toContainText("请求尚未发送（本地确认）");
    await expect(diagnosis).toContainText("未产生生成费用");
    await expect(diagnosis).not.toContainText(/原任务|账单|无法确认/u);
  }
  await page.screenshot({ path: testInfo.outputPath(`material-preparation-${accepted ? "accepted" : "unsubmitted"}.png`) });
  await details.getByRole("button", { name: "关闭来源详情", exact: true }).click();
  await page.getByRole("button", { name: "打开项目菜单", exact: true }).click();
  await page.getByRole("menuitem", { name: "运行历史", exact: true }).click();
  const history = page.getByRole("dialog", { name: "运行历史" });
  await history.locator("details.task-failure").first().locator(":scope > summary").click();
  const historyDiagnosis = history.getByLabel("失败诊断").first();
  await expect(historyDiagnosis).toContainText(accepted ? "扣费待确认" : "未产生生成费用");
  if (accepted) await expect(historyDiagnosis).not.toContainText("未产生生成费用");
  else await expect(historyDiagnosis).not.toContainText(/原任务|账单|无法确认/u);
  expect(generationPosts).toBe(0);
});
