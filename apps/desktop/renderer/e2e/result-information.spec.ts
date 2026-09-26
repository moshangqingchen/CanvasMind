import { expect, test } from "@playwright/test";

test("new run preserves its input summary in the saved canvas", async ({ page, request }) => {
  const canvas = await (await request.post("/api/canvas", { data: { title: "新任务来源验收", graph: {
    schemaVersion: 1, viewport: { x: 0, y: 0, zoom: 0.8 }, edges: [], nodes: [{
      id: "source", type: "workflow", position: { x: 80, y: 160 }, data: {
        nodeType: "image-generation", label: "来源测试", provider: "fake", connectionId: "fake-default", model: "fake-image-v1",
        parts: [{ type: "text", text: "Original generation prompt" }], parameters: { n: 1 },
        inputs: [], outputs: [{ id: "images", kind: "image", label: "图片" }],
      },
    }],
  } } })).json();
  await page.goto(`/canvas/${canvas.id}`);
  const submitted = page.waitForResponse((response) => response.url().endsWith("/api/runs") && response.request().method() === "POST");
  await page.getByRole("button", { name: "运行 来源测试 节点", exact: true }).click();
  const started = await submitted;
  expect(started.ok()).toBeTruthy();
  const runId = (await started.json()).run.id;
  await expect.poll(async () => (await (await request.get(`/api/runs/${runId}`)).json()).run.status).toBe("succeeded");
  const ordinary = await (await request.get(`/api/runs/${runId}`)).json();
  expect(ordinary.nodes[0].request.prompt).toBeUndefined();
  const detailed = await (await request.get(`/api/runs/${runId}?details=1`)).json();
  expect(detailed.nodes[0].request.prompt).toBe("Original generation prompt");
  expect(detailed.nodes[0].request.inputAssets).toEqual([]);
  await expect(page.locator('.generated-result-node[data-generated-status="succeeded"]')).toHaveCount(1);
  await expect.poll(async () => {
    const graph = (await (await request.get(`/api/canvas/${canvas.id}`)).json()).graph;
    return graph.nodes.find((node: { data: { generatedResult?: boolean } }) => node.data.generatedResult)?.data.generatedDetails;
  }).toMatchObject({ inputAssets: [], inputAssetIds: [], outputCount: 1 });
});

test("result provenance shows submitted references and prompt on desktop and mobile", async ({ page, request, context }, testInfo) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const response = await request.post("/api/assets/upload", { multipart: { file: {
    name: "Reference.png", mimeType: "image/png",
    buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64"),
  } } });
  expect(response.ok()).toBeTruthy();
  const asset = await response.json();
  const details = {
    operation: "image.edit", inputAssetIds: [asset.id, "deleted-reference", asset.id, "video-reference"],
    inputAssets: [
      { id: asset.id, name: "Original reference.png", kind: "image", role: "reference" },
      { id: "deleted-reference", name: "Deleted reference.png", kind: "image", role: "reference" },
      { id: "video-reference", name: "Motion.mp4", kind: "video", role: "reference" },
    ], outputCount: 1, finishedAt: "2026-09-24T00:01:31Z",
  };
  const canvas = await (await request.post("/api/canvas", { data: { title: "来源详情验收", graph: {
    schemaVersion: 1, viewport: { x: 0, y: 0, zoom: 0.7 }, edges: [], nodes: [{
      id: "result", type: "workflow", position: { x: 200, y: 200 }, style: { width: 320, height: 240 }, data: {
        nodeType: "asset-input", label: "来源验收", assetKind: "image", assetId: asset.id,
        generatedResult: true, generatedStatus: "succeeded", generatedFromRunId: "history-run", generatedFromNodeId: "deleted-source",
        generatedModel: "gpt-image-2.5-flare", generatedConnectionName: "测试供应商 · 图片", generatedOutputIndex: 0,
        generatedCreatedAt: "2026-09-24T00:00:00Z", generatedDetails: details,
        generatedParameters: { n: 3, size: "2992x2768", quality: "max" },
        generatedPromptParts: [{ type: "text", text: "Local prompt" }], inputs: [], outputs: [],
      },
    }],
  } } })).json();
  let available = true;
  await page.route("**/api/runs/history-run?details=1", (route) => available ? route.fulfill({ json: {
    run: { id: "history-run" }, nodes: [{ id: "node-run", nodeId: "deleted-source", status: "succeeded", outputAssetIds: [asset.id], updatedAt: details.finishedAt,
      request: { ...details, prompt: "Historical prompt: preserve both reference images.", parameters: { n: 3, size: "2992x2768", quality: "max" } },
    }],
  } }) : route.fulfill({ status: 404, json: { error: "missing" } }));
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`/canvas/${canvas.id}`);
  await page.getByRole("button", { name: "查看 来源验收 来源" }).click();
  const dialog = page.getByRole("dialog", { name: "结果来源与参数" });
  const value = (label: string) => dialog.getByText(label, { exact: true }).locator("+ dd");
  await expect(value("参考图张数")).toHaveText("2 张");
  await expect(value("其他参考素材")).toHaveText("1 个视频，0 个音频");
  await expect(value("请求数量")).toHaveText("3 张");
  await expect(value("已保存结果")).toHaveText("1 张，当前为第 1 张");
  await expect(value("耗时（含排队）")).toHaveText("1 分 31 秒");
  await expect(dialog.getByLabel("生成提示词").locator("pre")).toHaveText("Historical prompt: preserve both reference images.");
  await expect(dialog.getByLabel("参考素材详情").locator("li")).toHaveCount(3);
  await expect(dialog.getByLabel("参考素材详情")).toContainText("Deleted reference.png");
  await expect.poll(() => dialog.locator("img").evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("result-details-desktop.png") });
  await dialog.getByRole("button", { name: "复制完整信息" }).click();
  const copied = JSON.parse(await page.evaluate(() => navigator.clipboard.readText()));
  expect(copied.referenceImageCount).toBe(2);
  expect(copied.prompt).toBe("Historical prompt: preserve both reference images.");
  await page.screenshot({ path: testInfo.outputPath("result-details-desktop-bottom.png") });
  await page.setViewportSize({ width: 390, height: 844 });
  await dialog.evaluate((element) => { element.scrollTop = 0; });
  expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  const bounds = await dialog.boundingBox();
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390);
  await page.screenshot({ path: testInfo.outputPath("result-details-mobile.png") });
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  available = false;
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.getByRole("button", { name: "查看 来源验收 来源" }).click();
  await expect(dialog).toContainText("任务记录不可用");
  await expect(value("参考图张数")).toHaveText("2 张");
  await expect(dialog.getByLabel("生成提示词").locator("pre")).toHaveText("Local prompt");
  await dialog.getByRole("button", { name: "查看 Original reference.png", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole("dialog", { name: "素材预览", exact: true })).toBeVisible();
});
