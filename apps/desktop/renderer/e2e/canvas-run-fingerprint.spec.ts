import { expect, test, type Page } from "./helpers/canvas-offline-test";
import { waitForCanvasViewportStable } from "./canvas-test-actions";

const descriptor = {
  id: "gpt-image-2", name: "运行指纹隔离模型",
  operations: ["image.generate"], inputKinds: ["text"], outputKinds: ["image"],
  metadata: { canvasRunnable: true },
  parameters: [{ key: "quality", label: "质量", control: "select", default: "high",
    options: ["low", "high"].map(value => ({ value, label: value })) }],
};

async function dragBlankPane(page: Page) {
  const point = await page.locator(".react-flow__pane").evaluate(pane => {
    const bounds = pane.getBoundingClientRect();
    for (let y = Math.max(100, bounds.top + 30); y < Math.min(innerHeight - 120, bounds.bottom - 80); y += 35)
      for (let x = Math.max(100, bounds.left + 30); x < Math.min(innerWidth - 120, bounds.right - 80); x += 35)
        if (document.elementFromPoint(x, y) === pane && document.elementFromPoint(x + 45, y + 30) === pane)
          return { x, y };
    return null;
  });
  expect(point, "平移须从真实画布空白开始").not.toBeNull();
  await page.mouse.move(point!.x, point!.y);
  await page.mouse.down();
  try { await page.mouse.move(point!.x + 45, point!.y + 30, { steps: 8 }); }
  finally { await page.mouse.up(); }
}

for (const change of ["presentation", "prompt"] as const) {
  test(`素材校验期间${change === "presentation" ? "平移和拖动节点仍提交点击时参数" : "修改提示词会明确阻止提交"}`, async ({ page, request }) => {
    await page.addInitScript(() => localStorage.setItem("super-canvas:inspector-open", "false"));
    // All inventories and generation responses are browser fixtures. The
    // inherited setup also blocks non-loopback server sockets before connect.
    await page.route("https://**", route => route.abort("blockedbyclient"));
    const createdProvider = await request.post("/api/providers", { data: {
      name: "运行指纹隔离连接", provider: "openai", apiKey: "isolated-fingerprint-fixture",
      config: { baseUrl: "https://run-fingerprint.invalid", preset: "cyberafei-api",
        usage: "canvas", modelGroup: "隔离指纹回归", defaultModel: descriptor.id },
    } });
    expect(createdProvider.ok()).toBeTruthy();
    const connection = await createdProvider.json();
    let holdScan = false, heldScans = 0;
    let releaseScan!: () => void;
    const scanGate = new Promise<void>(resolve => { releaseScan = resolve; });
    await page.route(`**/api/providers/${connection.id}/models*`, async route => {
      if (holdScan) { heldScans++; await scanGate; }
      await route.fulfill({ json: [descriptor], headers: { "X-Model-Scan-Status": "live" } });
    });
    const created = await request.post("/api/canvas", { data: {
      title: "运行指纹浏览器回归", graph: {
        schemaVersion: 1, viewport: { x: 0, y: 0, zoom: 1 }, edges: [], nodes: [{
          id: "source", type: "workflow", position: { x: 170, y: 160 }, style: { width: 420, height: 210 },
          data: { nodeType: "image-generation", label: "运行指纹测试", provider: "openai",
            connectionId: connection.id, model: descriptor.id, qualityMode: "custom",
            parameters: { quality: "high" }, parts: [{ type: "text", text: "点击时的提示词" }],
            inputs: [{ id: "prompt", kind: "text", label: "提示词" }],
            outputs: [{ id: "images", kind: "image", label: "图片" }] },
        }],
      },
    } });
    expect(created.ok()).toBeTruthy();
    const canvas = await created.json();
    const submitted: Array<{ expectedRevision: number; runFingerprint: string; clientRequestId: string }> = [];
    let submittedCanvas: { revision: number; graph: { nodes: Array<{ id: string; position: { x: number; y: number }; data: unknown }> } } | undefined;
    const snapshot = {
      run: { id: `fingerprint-${change}`, canvasId: canvas.id, scope: "node", nodeId: "source", status: "failed", createdAt: new Date().toISOString() },
      nodes: [{ id: `fingerprint-node-${change}`, nodeId: "source", status: "failed", outputAssetIds: [],
        errorJson: { message: "隔离回归：模拟任务返回，无供应商请求", code: "FIXTURE_TASK" } }],
    };
    await page.route(/\/api\/runs(?:\?|\/|$)/u, async route => {
      if (route.request().method() === "POST") {
        submitted.push(route.request().postDataJSON());
        const saved = await request.get(`/api/canvas/${canvas.id}`);
        expect(saved.ok()).toBeTruthy();
        submittedCanvas = await saved.json();
        return route.fulfill({ json: snapshot });
      }
      return route.fulfill({ json: new URL(route.request().url()).pathname === "/api/runs"
        ? submitted.length ? [snapshot] : [] : snapshot });
    });
    await page.goto(`/canvas/${canvas.id}`);
    const source = page.locator('.react-flow__node[data-id="source"]');
    await expect(source).toBeVisible();
    await page.getByRole("button", { name: "打开 运行指纹测试 模型与参数", exact: true }).click();
    const panel = page.getByRole("dialog", { name: "运行指纹测试 模型与参数", exact: true });
    await expect(panel.getByLabel("质量", { exact: true })).toHaveValue("high");
    await panel.getByRole("button", { name: "关闭模型与参数面板", exact: true }).click();
    await expect(panel).toBeHidden();
    await waitForCanvasViewportStable(page);
    holdScan = true;
    try {
      // A normal focus refresh invalidates the 60-second inventory cache.
      // Hold that browser-only request so run validation awaits the same
      // pending promise instead of immediately returning a cached inventory.
      await page.evaluate(() => window.dispatchEvent(new Event("focus")));
      await expect.poll(() => heldScans, { message: "模拟目录刷新已挂起，运行校验将复用该pending请求" }).toBeGreaterThan(0);
      await page.getByRole("button", { name: "运行 运行指纹测试 节点", exact: true }).click();
      expect(submitted).toHaveLength(0);
      if (change === "presentation") {
        const viewport = page.locator(".react-flow__viewport");
        const transform = await viewport.evaluate(element => getComputedStyle(element).transform);
        await dragBlankPane(page);
        await expect.poll(() => viewport.evaluate(element => getComputedStyle(element).transform)).not.toBe(transform);
        await waitForCanvasViewportStable(page);
        const before = (await source.boundingBox())!;
        const dragPoint = await source.locator(".node-head").evaluate(head => {
          const bounds = head.getBoundingClientRect(), y = bounds.y + bounds.height / 2;
          // ReadableName is intentionally nodrag. Hit the exposed header gap,
          // rather than sampling a fixed coordinate inside its text span.
          for (let x = bounds.x + 20; x < bounds.right - 20; x += 10)
            if (document.elementFromPoint(x, y) === head) return { x, y };
          return null;
        });
        expect(dragPoint, "拖动须真实命中非nodrag的节点标题空白").not.toBeNull();
        await page.mouse.move(dragPoint!.x, dragPoint!.y);
        await page.mouse.down();
        try { await page.mouse.move(dragPoint!.x + 30, dragPoint!.y + 20, { steps: 8 }); }
        finally { await page.mouse.up(); }
        await expect.poll(async () => (await source.boundingBox())!.x - before.x).toBeGreaterThan(15);
      } else {
        await source.locator(".prompt-overview").click();
        await source.locator(".tiptap-prompt").fill("素材校验期间改变的提示词");
      }
    } finally {
      holdScan = false;
      releaseScan();
    }
    if (change === "presentation") {
      await expect.poll(() => submitted.length).toBe(1);
      await expect(page.locator(".generated-result-state.failed")).toHaveCount(1);
      expect(submitted[0]!.expectedRevision).toBe(submittedCanvas!.revision);
      expect(submitted[0]!.runFingerprint).toEqual(expect.any(String));
      expect(submitted[0]!.runFingerprint.length).toBeGreaterThan(0);
      expect(submittedCanvas!.graph.nodes.find(node => node.id === "source")!.data).toMatchObject({
        model: descriptor.id, parameters: { quality: "high" }, parts: [{ type: "text", text: "点击时的提示词" }],
      });
      expect(submittedCanvas!.graph.nodes.find(node => node.id === "source")!.position.x).toBeGreaterThan(185);
      await expect(page.locator(".toast").filter({ hasText: "提交前画布已修改" })).toHaveCount(0);
      expect(submitted).toHaveLength(1);
    } else {
      await expect(page.locator(".toast")).toContainText("本次未提交、未产生费用");
      expect(submitted).toHaveLength(0);
    }
  });
}

test("运行全部在提交等待期间平移自动保存，不把本次占位框加入执行范围", async ({ page, request }) => {
  await page.addInitScript(() => localStorage.setItem("super-canvas:inspector-open", "false"));
  const created = await request.post("/api/canvas", { data: {
    title: "全部运行占位框指纹回归", graph: {
      schemaVersion: 1, viewport: { x: 0, y: 0, zoom: 1 }, edges: [], nodes: [{
        id: "source", type: "workflow", position: { x: 170, y: 160 }, style: { width: 420, height: 210 },
        data: { nodeType: "image-generation", label: "全部运行测试", provider: "fake",
          connectionId: "fake-default", model: "fake-image-v1", fakeScenario: "async",
          parameters: { size: "1024x1024", quality: "high", n: 1 },
          parts: [{ type: "text", text: "全部运行点击时的参数" }],
          inputs: [{ id: "prompt", kind: "text", label: "提示词" }],
          outputs: [{ id: "images", kind: "image", label: "图片" }] },
      }],
    },
  } });
  expect(created.ok()).toBeTruthy();
  const canvas = await created.json();
  let submissions = 0, responseStatus: number | undefined;
  let body: { expectedRevision: number; runFingerprint: string; scope: string } | undefined;
  let snapshot: { run: { id: string } } | undefined;
  let releaseSubmit!: () => void;
  const submitGate = new Promise<void>(resolve => { releaseSubmit = resolve; });
  await page.route(/\/api\/runs(?:\?.*)?$/u, async route => {
    if (route.request().method() !== "POST") return route.continue();
    submissions++;
    body = route.request().postDataJSON();
    await submitGate;
    // The real local run API and Fake adapter validate the server fingerprint
    // fallback. No supplier adapter or paid endpoint is configured here.
    const response = await route.fetch();
    responseStatus = response.status();
    snapshot = await response.json();
    await route.fulfill({ response, json: snapshot });
  });
  await page.goto(`/canvas/${canvas.id}`);
  await expect(page.locator('.react-flow__node[data-id="source"]')).toBeVisible();
  await waitForCanvasViewportStable(page);
  try {
    await page.getByRole("button", { name: "运行全部", exact: true }).click();
    await expect.poll(() => submissions).toBe(1);
    expect(body).toMatchObject({ scope: "all", runFingerprint: expect.any(String) });
    await expect(page.locator(".generated-result-node")).toHaveCount(1);
    await dragBlankPane(page);
    await expect.poll(async () => (await (await request.get(`/api/canvas/${canvas.id}`)).json()).revision,
      { message: "预检窗口内平移的自动保存必须真实写入较新revision" }).toBeGreaterThan(body!.expectedRevision);
    const saved = await (await request.get(`/api/canvas/${canvas.id}`)).json();
    expect(saved.graph.nodes.filter((node: { data: { generatedResult?: boolean } }) => node.data.generatedResult)).toHaveLength(0);
  } finally { releaseSubmit(); }
  await expect.poll(() => responseStatus).toBe(201);
  await expect(page.locator('.generated-result-node[data-generated-status="succeeded"]')).toHaveCount(1);
  await expect.poll(async () => {
    const detailed = await (await request.get(`/api/runs/${snapshot!.run.id}?details=1`)).json();
    return detailed.nodes.find((node: { nodeId: string }) => node.nodeId === "source")?.request;
  }).toMatchObject({ provider: "fake", prompt: "全部运行点击时的参数", parameters: { quality: "high" } });
  expect(submissions).toBe(1);
});
