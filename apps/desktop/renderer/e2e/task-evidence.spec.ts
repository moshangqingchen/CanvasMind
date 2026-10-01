import { expect, test } from "@playwright/test";
import type { RunSnapshot } from "../components/types";

for (const scenario of ["unknown", "capacity"] as const) {
  test(`错误记录保留真实渠道和原任务证据：${scenario}`, async ({ page, request }) => {
    const canvasResponse = await request.post("/api/canvas", { data: {
      title: "任务证据隔离回归",
      graph: { schemaVersion: 1, viewport: { x: 0, y: 0, zoom: 0.85 }, edges: [], nodes: [{
        id: "source", type: "workflow", position: { x: 80, y: 180 }, style: { width: 420, height: 210 },
        data: { nodeType: "image-generation", label: "证据回归", provider: "fake", connectionId: "fake-default", model: "fake-image-v1", fakeScenario: "fail",
          parts: [{ type: "text", text: "只使用本地模拟供应商" }], inputs: [{ id: "prompt", kind: "text", label: "提示词" }], outputs: [{ id: "images", kind: "image", label: "图片" }], parameters: { n: 1 } },
      }] },
    } });
    expect(canvasResponse.ok()).toBeTruthy();
    const canvas = await canvasResponse.json();
    let submissions = 0;
    const presentation = (snapshot: RunSnapshot): RunSnapshot => ({ ...snapshot,
      run: { ...snapshot.run, status: scenario === "unknown" ? "needs_attention" : "failed", canResume: false, canRecoverOutputs: false },
      nodes: snapshot.nodes.map(node => ({ ...node, status: scenario === "unknown" ? "needs_attention" : "failed", outputAssetIds: [],
        request: { provider: "openai", supplier: "custom:test", connectionName: "secure-skill", modelGroup: "image2.5特价", model: "gpt-image-2", operation: "image.generate" },
        taskEvidence: scenario === "capacity" ? { taskId: "img-bb5984b0-c8d2", status: "failed" } : undefined,
        errorJson: scenario === "unknown"
          ? { message: "上游 API 暂时不可用（HTTP 502），请稍后重试。", code: "HTTP 502", type: "网关或上游服务错误", statusCode: 502, api: "OpenAI Images API", providerMessage: "502 Bad Gateway" }
          : { message: "供应商未能完成生成任务，请检查请求内容。", code: "generation_failed", type: "供应商生成错误", api: "OpenAI Images API", providerMessage: "No available compatible accounts" },
      })),
    });
    await page.route(/\/api\/runs(?:\/[^/?]+)?(?:\?.*)?$/u, async route => {
      if (route.request().method() === "POST") submissions++;
      const response = await route.fetch();
      const payload = await response.json();
      await route.fulfill({ response, json: Array.isArray(payload) ? payload.map(presentation) : presentation(payload) });
    });
    await page.goto(`/canvas/${canvas.id}`);
    await page.getByRole("button", { name: "运行 证据回归 节点", exact: true }).click();
    const result = page.locator(".generated-result-state").first();
    await expect(result).toContainText("secure-skill · image2.5特价");
    if (scenario === "unknown") {
      await expect(result).toContainText("提交结果未知");
      await expect(result).toContainText("供应商任务号：未取得");
      await expect(result).toContainText("提交和费用尚未确认");
      await expect(result.getByRole("button", { name: /再次运行/ })).toHaveCount(0);
    } else {
      await expect(result).toContainText("已接单，任务失败");
      await expect(result).toContainText("img-bb5984b0-c8d2");
      await expect(result).toContainText("可用账号");
      await expect(result).not.toContainText("检查请求内容");
    }
    await result.getByRole("button", { name: /查看 .* 来源/ }).click();
    const details = page.getByRole("dialog", { name: "结果来源与参数" });
    await expect(details).toContainText("本地运行编号");
    await expect(details).toContainText("供应商任务号");
    if (scenario === "capacity") await expect(details.getByRole("button", { name: "复制供应商任务号" })).toBeVisible();
    await details.getByRole("button", { name: "关闭来源详情" }).click();
    await page.getByRole("button", { name: "打开项目菜单", exact: true }).click();
    await page.getByRole("menuitem", { name: "运行历史", exact: true }).click();
    const history = page.getByRole("dialog", { name: "运行历史" });
    await history.locator("summary").filter({ hasText: "查看任务进度" }).first().click();
    await expect(history).toContainText("secure-skill · image2.5特价");
    await expect(history).toContainText(scenario === "capacity" ? "img-bb5984b0-c8d2" : "供应商任务号：未取得");
    expect(submissions).toBe(1);
  });
}
