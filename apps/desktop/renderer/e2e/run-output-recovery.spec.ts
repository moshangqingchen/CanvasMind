import { expect, test, type APIRequestContext } from "@playwright/test";

async function uploadTestImage(request: APIRequestContext) {
  const response = await request.post("/api/assets/upload", { multipart: { file: {
    name: "已取回原图.png", mimeType: "image/png",
    buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64"),
  } } });
  expect(response.ok()).toBeTruthy();
  return response.json() as Promise<{ id: string }>;
}

test("已取消任务从历史取回已有图片，不恢复生成或重复提交", async ({ page, request }) => {
  const asset = await uploadTestImage(request);
  const created = await request.post("/api/canvas", { data: {
    title: "归档恢复验收", graph: { schemaVersion: 1, nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 } },
  } });
  expect(created.ok()).toBeTruthy();
  const canvas = await created.json();
  let recovered = false;
  let recoveries = 0;
  let submissions = 0;
  const snapshot = () => ({
    run: { id: "saved-output-run", canvasId: canvas.id, clientRequestId: "saved-output-request",
      scope: "node", nodeId: "original-image", status: "cancelled", createdAt: "2026-09-22T06:30:00.000Z",
      canResume: false, canRecoverOutputs: !recovered },
    nodes: [{ id: "saved-output-node", nodeId: "original-image", status: "cancelled",
      outputAssetIds: recovered ? [asset.id] : [], errorJson: null }],
  });
  await page.route(/\/api\/runs(?:\?|\/|$)/, async (route) => {
    const url = new URL(route.request().url());
    if (route.request().method() === "POST") {
      if (url.pathname === "/api/runs/saved-output-run/recover-outputs") {
        recoveries++;
        recovered = true;
        await route.fulfill({ json: snapshot() });
      } else {
        submissions++;
        await route.fulfill({ status: 409, json: { error: "测试禁止重新提交或恢复执行" } });
      }
      return;
    }
    if (url.pathname === "/api/runs") {
      await route.fulfill({ json: [snapshot()] });
      return;
    }
    await route.continue();
  });
  await page.goto(`/canvas/${canvas.id}`);
  await page.getByRole("button", { name: "打开项目菜单", exact: true }).click();
  await page.getByRole("menuitem", { name: "运行历史", exact: true }).click();
  const history = page.getByRole("dialog", { name: "运行历史", exact: true });
  const recover = history.getByRole("button", { name: "取回已有图片", exact: true });
  await expect(recover).toBeVisible();
  await expect(history.getByRole("button", { name: "恢复任务", exact: true })).toHaveCount(0);
  await recover.click();
  await expect(history.getByRole("button", { name: "固定输出 1", exact: true })).toBeVisible();
  await expect(recover).toHaveCount(0);
  await expect(history.locator(".status-label")).toHaveText("cancelled");
  await history.getByRole("button", { name: "固定输出 1", exact: true }).click();
  await expect.poll(async () => {
    const saved = await (await request.get(`/api/canvas/${canvas.id}`)).json();
    return saved.graph.nodes.filter((node: { data: { assetId?: string; generatedResult?: boolean } }) =>
      node.data.assetId === asset.id && !node.data.generatedResult).length;
  }).toBe(1);
  await history.getByRole("button", { name: "关闭", exact: true }).click();
  await page.reload();
  const fixed = page.locator(".react-flow__node").filter({ hasText: "固定输出 · 已取回原图.png" });
  await expect(fixed).toBeVisible();
  await expect.poll(() => fixed.locator("img").evaluate((image: HTMLImageElement) => image.naturalWidth)).toBe(1);
  expect(recoveries).toBe(1);
  expect(submissions).toBe(0);
});

