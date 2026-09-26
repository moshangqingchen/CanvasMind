import { randomUUID } from "node:crypto";
import { expect, test, type APIRequestContext } from "@playwright/test";

const originalPrompt = "保留原图版式。\n标题：新品上市，文字必须准确。";

async function createFixture(request: APIRequestContext, history: "parts" | "run" | "missing") {
  const upload = await request.post("/api/assets/upload?name=reuse-prompt.png", {
    headers: { "content-type": "image/png" },
    data: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64"),
  });
  expect(upload.status()).toBe(201);
  const asset = await upload.json() as { id: string };
  const id = `reuse-prompt-${randomUUID()}`;
  const nodes = [{
    id: "result", type: "workflow", position: { x: 40, y: 120 },
    style: { width: 260, height: 260 },
    data: {
      nodeType: "asset-input", label: "历史图片", assetId: asset.id, assetKind: "image",
      generatedResult: true, generatedStatus: "succeeded", mediaAspectRatio: 1,
      generatedFromNodeId: "source", generatedFromRunId: "reuse-history",
      ...(history === "parts" ? { generatedPromptParts: [{ type: "text", text: originalPrompt }] } : {}),
      outputs: [{ id: "asset", kind: "image", label: "图片" }],
    },
  }, ...(history === "run" ? [] : [{
    id: "source", type: "workflow", position: { x: 600, y: 100 },
    style: { width: 420, height: 210 },
    data: {
      nodeType: "image-generation", label: "后来修改的节点", provider: "fake",
      connectionId: "fake-default", model: "fake-image-v1",
      parts: [{ type: "text", text: "这是后来修改的提示词，不可当作历史内容" }],
      outputs: [{ id: "images", kind: "image", label: "图片" }],
    },
  }])];
  expect((await request.post("/api/canvas", { data: {
    id, title: id, graph: { schemaVersion: 1, nodes, edges: [], viewport: { x: 20, y: 20, zoom: 1 } },
  } })).status()).toBe(201);
  return { id, asset, nodes };
}

for (const history of ["parts", "run"] as const) {
  test(`复用历史提示词新建可编辑节点且不自动生成：${history}`, async ({ page, request }) => {
    const fixture = await createFixture(request, history);
    let submissions = 0;
    page.on("request", event => { if (event.method() === "POST" && new URL(event.url()).pathname === "/api/runs") submissions++; });
    await page.route("**/api/runs/reuse-history?details=1", route => route.fulfill({ json: {
      run: { id: "reuse-history" }, nodes: [{
        id: "historical-node", nodeId: "source", outputAssetIds: [fixture.asset.id],
        request: { prompt: originalPrompt },
      }],
    } }));
    const snapshot = async () => (await (await request.get(`/api/canvas/${fixture.id}`)).json()).graph;
    try {
      await page.goto(`/canvas/${fixture.id}`);
      await page.getByRole("button", { name: "关闭智能体", exact: true }).click();
      await page.locator('.react-flow__node[data-id="result"] .generated-result-viewport').click();
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
      expect(created.data.nodeType).toBe("image-generation");
      expect(created.data.generatedResult).toBeUndefined();
      expect(graph.edges.filter((edge: { source: string; target: string }) => edge.source === created.id || edge.target === created.id)).toEqual([]);
      expect(graph.nodes.find((node: { id: string }) => node.id === "result").data.assetId).toBe(fixture.asset.id);
      if (history === "parts") expect(graph.nodes.find((node: { id: string }) => node.id === "source").data.parts).toEqual(fixture.nodes[1].data.parts);
      await editor.fill("复用后继续修改的提示词");
      await page.keyboard.press("Control+s");
      await expect.poll(async () => (await snapshot()).nodes.find((node: { id: string }) => node.id === created.id).data.parts).toEqual([{ type: "text", text: "复用后继续修改的提示词" }]);
      await page.reload();
      await expect(page.locator(`.react-flow__node[data-id="${created.id}"]`)).toContainText("复用后继续修改的提示词");
      expect(submissions).toBe(0);
    } finally {
      await page.close();
      await request.delete(`/api/projects/${fixture.id}`);
      await request.delete(`/api/assets/${fixture.asset.id}`);
    }
  });
}

test("历史提示词缺失时保留画布，读取失败后可重试", async ({ page, request }) => {
  const fixture = await createFixture(request, "missing");
  const endpoint = "**/api/runs/reuse-history?details=1";
  let state: "failed" | "missing" | "ready" = "failed";
  await page.route(endpoint, route => state === "failed"
    ? route.fulfill({ status: 503, json: { error: "test" } })
    : route.fulfill({ json: { run: { id: "reuse-history" }, nodes: [{
      nodeId: "source", outputAssetIds: [fixture.asset.id], request: state === "ready" ? { prompt: originalPrompt } : {},
    }] } }));
  try {
    await page.goto(`/canvas/${fixture.id}`);
    await page.locator('.react-flow__node[data-id="result"] .generated-result-viewport').click();
    const reuse = page.getByRole("button", { name: "复用 历史图片 提示词" });
    await reuse.click();
    await expect(page.getByText("读取原提示词失败，请重试", { exact: true })).toBeVisible();
    state = "missing";
    await reuse.click();
    await expect(page.getByText("这张结果没有保存可复用的提示词", { exact: true })).toBeVisible();
    expect((await (await request.get(`/api/canvas/${fixture.id}`)).json()).graph.nodes).toHaveLength(fixture.nodes.length);
    state = "ready";
    await reuse.click();
    await expect(page.locator('.react-flow__node.selected [contenteditable="true"]')).toContainText("标题：新品上市");
  } finally {
    await page.close();
    await request.delete(`/api/projects/${fixture.id}`);
    await request.delete(`/api/assets/${fixture.asset.id}`);
  }
});
