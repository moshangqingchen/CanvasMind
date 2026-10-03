import { expect, test } from "@playwright/test";
import { cangyuanCurrentModel } from "@super-canvas/providers";
import { CANGYUAN_IMAGE_CONNECTOR } from "../lib/provider-presets";
import type { CangyuanAvailabilityItem } from "../lib/cangyuan-availability-types";

test("渠道可用性按实际模型展示历史，准备中和停用不沿用绿色", async ({ page, request }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 1100 });
  const modelId = "gpt-image-2-4k";
  const descriptor = cangyuanCurrentModel({ id: modelId, name: "GPT Image 2 4K", operations: ["image.generate", "image.edit"] });
  const connectionResponse = await request.post("/api/providers", { data: {
    name: "隔离渠道监测", provider: "rest", apiKey: "isolated-no-paid-generation",
    config: { supplierKey: "cangyuan", modelGroup: "IMAGE", usage: "canvas", baseUrl: "https://availability.invalid",
      defaultModel: modelId, connector: { ...structuredClone(CANGYUAN_IMAGE_CONNECTOR), models: [descriptor] } },
  } });
  expect(connectionResponse.ok()).toBeTruthy();
  const connection = await connectionResponse.json();
  await page.route(`**/api/providers/${connection.id}/models*`, route => route.fulfill({
    json: [descriptor], headers: { "X-Model-Scan-Status": "live" },
  }));
  const created = await request.post("/api/canvas", { data: { title: "渠道可用性回归", graph: {
    schemaVersion: 1, viewport: { x: 0, y: 0, zoom: 1 }, edges: [], nodes: [{ id: "image", type: "workflow",
      position: { x: 80, y: 60 }, style: { width: 420, height: 180 }, data: {
        nodeType: "image-generation", label: "渠道监测", provider: "rest", connectionId: connection.id,
        model: modelId, parameters: {}, parts: [], inputs: [{ id: "prompt", kind: "text", label: "提示词" }],
        outputs: [{ id: "images", kind: "image", label: "图片" }],
      } }],
  } } });
  expect(created.ok()).toBeTruthy();
  const canvas = await created.json();
  const checkedAt = "2026-10-03T09:50:00Z";
  const endedAt = Date.parse(checkedAt) / 1000;
  const timeline = { startedAt: endedAt - 8 * 60 * 60, endedAt, bucketSeconds: 600,
    statuses: Array.from({ length: 48 }, (_, i) => i === 20 ? "unavailable" as const : i === 21 ? "degraded" as const : "available" as const) };
  const items: CangyuanAvailabilityItem[] = [{ name: "gpt-image-2", category: "image", latestStatus: "degraded", cause: "slow", timeline,
    routes: [
      { name: modelId, latestStatus: "available", pace: { kind: "generation", ms: 8120 }, timeline },
      { name: "gpt-image-2-2k", latestStatus: "unavailable", timeline },
    ],
  }];
  let mode: "preparing" | "ready" | "error" | "disabled" = "preparing";
  const queries: string[] = [];
  let submissions = 0;
  await page.route("**/api/runs", async route => {
    if (route.request().method() === "POST") { submissions++; await route.abort(); }
    else await route.continue();
  });
  await page.route(`**/api/providers/${connection.id}/availability*`, async route => {
    queries.push(new URL(route.request().url()).search);
    if (mode === "error") return route.fulfill({ status: 503, json: { error: "isolated availability error" } });
    await route.fulfill({ json: { checkedAt, enabled: mode !== "disabled", ready: mode === "ready",
      items: mode === "disabled" ? [] : items, source: "live" } });
  });
  await page.clock.install({ time: new Date(checkedAt) });
  await page.goto(`/canvas/${canvas.id}`);
  await page.getByRole("button", { name: "打开 渠道监测 模型与参数", exact: true }).click();
  const panel = page.getByRole("dialog", { name: "渠道监测 模型与参数" });
  const monitor = panel.getByRole("region", { name: "当前模型渠道可用性" });
  await expect(monitor.locator('[data-tone="preparing"]')).toHaveText("准备中");
  await expect(monitor).toContainText("以下为上次记录");
  await expect(monitor.getByRole("img")).toHaveCount(48);
  await expect(monitor.locator('[data-tone="available"]')).toHaveCount(0);

  mode = "ready";
  await page.clock.fastForward(60_100);
  await expect(monitor.locator('[data-tone="available"]')).toHaveText("正常");
  await expect(monitor).toContainText("生成耗时中位数 8.1 秒");
  await expect(monitor).toContainText("每 10 分钟一块");
  await expect(monitor).toContainText("不是调用成功率承诺");
  await expect(monitor).not.toContainText("近期可用率");
  await expect(monitor.locator('[role="img"][data-status="unavailable"]')).toHaveCount(1);
  await panel.getByRole("combobox", { name: "渠道监测 模型", exact: true }).click();
  // The public monitoring route does not add a model that this Key did not scan.
  await expect(panel.getByRole("listbox").getByRole("option")).toHaveCount(2);
  await expect(panel.getByRole("listbox")).not.toContainText("gpt-image-2-2k");
  await page.keyboard.press("Escape");
  await monitor.screenshot({ path: testInfo.outputPath("cangyuan-availability-monitor.png") });
  await page.screenshot({ path: testInfo.outputPath("cangyuan-availability.png") });

  mode = "preparing";
  await page.clock.fastForward(60_100);
  await expect(monitor.locator('[data-tone="preparing"]')).toBeVisible();
  await expect(monitor).toContainText("上次读取");
  await expect(monitor.locator('[data-tone="available"]')).toHaveCount(0);
  mode = "error";
  await page.clock.fastForward(60_100);
  await expect(monitor.locator('[data-tone="error"]')).toHaveText("更新失败");
  mode = "disabled";
  await page.clock.fastForward(60_100);
  await expect(monitor.locator('[data-tone="disabled"]')).toHaveText("监测已停用");
  await expect(monitor.getByRole("img")).toHaveCount(0);
  expect(queries.length).toBeGreaterThanOrEqual(5);
  expect(queries.every(query => !query.includes("window_days"))).toBeTruthy();
  expect(submissions).toBe(0);
});
