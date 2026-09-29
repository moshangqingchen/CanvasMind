import { randomUUID } from "node:crypto";
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { CANGYUAN_IMAGE_CONNECTOR } from "../lib/provider-presets";

const originalPrompt = "保留原图版式。\n标题：新品上市，文字必须准确。";

async function createFixture(request: APIRequestContext, history: "parts" | "run" | "configuration" | "missing", kind: "image" | "video" = "image", failed = false) {
  const upload = await request.post("/api/assets/upload?name=reuse-prompt.png", {
    headers: { "content-type": "image/png" },
    data: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64"),
  });
  expect(upload.status()).toBe(201);
  const asset = await upload.json() as { id: string };
  const models = [
    { id: "default-model", name: "默认模型", operations: [`${kind}.generate`], isDefault: true },
    { id: "original-model", name: "原任务模型", operations: [`${kind}.generate`], parameters: [
      { key: "quality", label: "质量", control: "select", default: "high", options: ["low", "high"].map(value => ({ value, label: value })) },
    ] },
  ];
  const providerResponse = await request.post("/api/providers", { data: {
    name: "原任务供应商连接", provider: "rest", apiKey: "isolated-no-paid-generation",
    config: { baseUrl: "https://reuse.invalid", defaultModel: models[0].id,
      connector: { ...structuredClone(CANGYUAN_IMAGE_CONNECTOR), models } },
  } });
  expect(providerResponse.ok()).toBeTruthy();
  const connection = await providerResponse.json() as { id: string };
  const configuration = { provider: "rest", connectionId: connection.id, model: "original-model", parameters: kind === "image"
    ? { quality: "low", size: "1024x1536", n: 3, seed: 0 }
    : { quality: "low", duration: 10, aspect_ratio: "9:16", resolution: "720p", generate_audio: false, seed: 0 } };
  const id = `reuse-prompt-${randomUUID()}`;
  const nodes = [{
    id: "result", type: "workflow", position: { x: 40, y: 120 },
    style: { width: 260, height: 260 },
    data: {
      nodeType: "asset-input", label: "历史图片", ...(!failed && kind === "image" ? { assetId: asset.id } : {}), assetKind: kind,
      generatedResult: true, generatedStatus: failed ? "failed" : "succeeded", mediaAspectRatio: 1,
      ...(failed ? { generatedError: "供应商繁忙" } : {}),
      generatedFromNodeId: "source", generatedFromRunId: "reuse-history",
      ...(history === "parts" || history === "configuration" ? { generatedPromptParts: [{ type: "text", text: originalPrompt }] } : {}),
      ...(history === "parts" ? { generatedProvider: configuration.provider, generatedConnectionId: configuration.connectionId,
        generatedModel: configuration.model, generatedParameters: configuration.parameters } : {}),
      outputs: [{ id: "asset", kind: "image", label: "图片" }],
    },
  }, ...(history === "run" ? [] : [{
    id: "source", type: "workflow", position: { x: 600, y: 100 },
    style: { width: 420, height: 210 },
    data: {
      nodeType: "image-generation", label: "后来修改的节点", provider: "fake",
      connectionId: "fake-default", model: "fake-image-v1",
      parameters: { quality: "high", size: "auto", n: 1 },
      parts: [{ type: "text", text: "这是后来修改的提示词，不可当作历史内容" }],
      outputs: [{ id: "images", kind: "image", label: "图片" }],
    },
  }])];
  expect((await request.post("/api/canvas", { data: {
    id, title: id, graph: { schemaVersion: 1, nodes, edges: [], viewport: { x: 20, y: 20, zoom: 1 } },
  } })).status()).toBe(201);
  return { id, asset, nodes, configuration, models };
}

async function mockModels(page: Page, fixture: Awaited<ReturnType<typeof createFixture>>) {
  await page.route(`**/api/providers/${fixture.configuration.connectionId}/models*`, route => route.fulfill({ json: fixture.models }));
}

for (const { history, kind, failed } of [
  { history: "parts", kind: "image", failed: false },
  { history: "run", kind: "image", failed: false },
  { history: "configuration", kind: "image", failed: false },
  { history: "run", kind: "video", failed: true },
] as const) {
  test(`复用历史提示词及完整配置，新建可编辑节点且不自动生成：${history}-${kind}`, async ({ page, request }) => {
    const fixture = await createFixture(request, history, kind, failed);
    await mockModels(page, fixture);
    let submissions = 0;
    page.on("request", event => { if (event.method() === "POST" && new URL(event.url()).pathname === "/api/runs") submissions++; });
    let historyReads = 0;
    await page.route("**/api/runs/reuse-history?details=1", route => { historyReads++; return history === "parts"
      ? route.fulfill({ status: 404, json: { error: "历史运行已删除" } }) : route.fulfill({ json: {
      run: { id: "reuse-history" }, nodes: [{
        id: "historical-node", nodeId: "source", outputAssetIds: [fixture.asset.id],
        request: { prompt: originalPrompt, ...fixture.configuration },
      }],
    } }); });
    const snapshot = async () => (await (await request.get(`/api/canvas/${fixture.id}`)).json()).graph;
    try {
      await page.goto(`/canvas/${fixture.id}`);
      await page.getByRole("button", { name: "关闭智能体", exact: true }).click();
      await page.locator('.react-flow__node[data-id="result"] .generated-result-node').click();
      const toolbar = page.getByRole("toolbar", { name: "生成结果操作" });
      for (const width of [390, 1280]) {
        await page.setViewportSize({ width, height: 900 });
        await expect(toolbar).toBeVisible();
        for (const control of await toolbar.locator("button, a").all()) {
          await expect(control).toBeInViewport({ ratio: 1 });
          if (await control.isEnabled()) await control.click({ trial: true });
        }
        await page.screenshot({ path: test.info().outputPath(`reuse-toolbar-${width}.png`) });
      }
      await toolbar.getByRole("button", { name: "复用 历史图片 提示词" }).click();
      const editor = page.locator('.react-flow__node.selected [contenteditable="true"]');
      await expect(editor).toBeVisible();
      await expect(editor).toContainText("标题：新品上市，文字必须准确。");
      await expect.poll(async () => (await snapshot()).nodes.length).toBe(fixture.nodes.length + 1);
      const graph = await snapshot();
      const created = graph.nodes.find((node: { id: string }) => !fixture.nodes.some(old => old.id === node.id));
      expect(created.data.parts).toEqual([{ type: "text", text: originalPrompt }]);
      expect(created.data.nodeType).toBe(`${kind}-generation`);
      expect(created.data).toMatchObject({ ...fixture.configuration, qualityMode: "custom" });
      expect(historyReads).toBe(1);
      expect(created.data.generatedResult).toBeUndefined();
      expect(graph.edges.filter((edge: { source: string; target: string }) => edge.source === created.id || edge.target === created.id)).toEqual([]);
      expect(graph.nodes.find((node: { id: string }) => node.id === "result").data.assetId).toBe(!failed && kind === "image" ? fixture.asset.id : undefined);
      if (history === "parts") expect(graph.nodes.find((node: { id: string }) => node.id === "source").data.parts).toEqual(fixture.nodes[1].data.parts);
      await editor.fill("复用后继续修改的提示词");
      await page.keyboard.press("Control+s");
      await expect.poll(async () => (await snapshot()).nodes.find((node: { id: string }) => node.id === created.id).data.parts).toEqual([{ type: "text", text: "复用后继续修改的提示词" }]);
      await page.reload();
      await expect(page.locator(`.react-flow__node[data-id="${created.id}"]`)).toContainText("复用后继续修改的提示词");
      await page.getByRole("button", { name: `打开 ${kind === "video" ? "视频生成" : "图片生成"} 模型与参数`, exact: true }).click();
      const panel = page.getByRole("dialog", { name: `${kind === "video" ? "视频生成" : "图片生成"} 模型与参数`, exact: true });
      await expect(panel.getByRole("combobox", { name: `${kind === "video" ? "视频生成" : "图片生成"} 模型`, exact: true })).toContainText("原任务模型");
      await expect(panel.getByLabel("质量", { exact: true })).toHaveValue("low");
      expect((await snapshot()).nodes.find((node: { id: string }) => node.id === created.id).data).toMatchObject(fixture.configuration);
      expect(submissions).toBe(0);
    } finally {
      await page.close();
      await request.delete(`/api/projects/${fixture.id}`);
      await request.delete(`/api/assets/${fixture.asset.id}`);
      await request.delete(`/api/providers/${fixture.configuration.connectionId}`);
    }
  });
}

test("历史提示词缺失时保留画布，读取失败后可重试", async ({ page, request }) => {
  const fixture = await createFixture(request, "missing");
  await mockModels(page, fixture);
  const endpoint = "**/api/runs/reuse-history?details=1";
  let state: "failed" | "missing" | "configuration-missing" | "ready" = "failed";
  await page.route(endpoint, route => state === "failed"
    ? route.fulfill({ status: 503, json: { error: "test" } })
    : route.fulfill({ json: { run: { id: "reuse-history" }, nodes: [{
      nodeId: "source", outputAssetIds: [fixture.asset.id], request: state === "ready" ? { prompt: originalPrompt, ...fixture.configuration }
        : state === "configuration-missing" ? { prompt: originalPrompt } : {},
    }] } }));
  try {
    await page.goto(`/canvas/${fixture.id}`);
    await page.locator('.react-flow__node[data-id="result"] .generated-result-viewport').click();
    const reuse = page.getByRole("button", { name: "复用 历史图片 提示词" });
    await reuse.click();
    await expect(page.getByText("读取原提示词或生成配置失败，请重试", { exact: true })).toBeVisible();
    state = "missing";
    await reuse.click();
    await expect(page.getByText("这张结果没有保存可复用的提示词", { exact: true })).toBeVisible();
    expect((await (await request.get(`/api/canvas/${fixture.id}`)).json()).graph.nodes).toHaveLength(fixture.nodes.length);
    state = "configuration-missing";
    await reuse.click();
    await expect(page.getByText("这张结果缺少原供应商、模型或生成参数，无法完整复用", { exact: true })).toBeVisible();
    expect((await (await request.get(`/api/canvas/${fixture.id}`)).json()).graph.nodes).toHaveLength(fixture.nodes.length);
    state = "ready";
    await reuse.click();
    await expect(page.locator('.react-flow__node.selected [contenteditable="true"]')).toContainText("标题：新品上市");
  } finally {
    await page.close();
    await request.delete(`/api/projects/${fixture.id}`);
    await request.delete(`/api/assets/${fixture.asset.id}`);
    await request.delete(`/api/providers/${fixture.configuration.connectionId}`);
  }
});
