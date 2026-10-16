import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import type { CanvasDocument, CanvasNode } from "../components/types";
import { clickBlankCanvas } from "./canvas-test-actions";

interface SavedCanvas { id: string; graph: CanvasDocument }
interface LayoutWrite { at: number; duringAnimation: boolean; graph: CanvasDocument }
type LayoutWindow = typeof window & { __layoutWrites: LayoutWrite[] };

function prompt(id: string, x: number, y: number): CanvasNode {
  return {
    id, type: "workflow", position: { x, y }, style: { width: 280, height: 210 },
    data: {
      nodeType: "prompt", label: `布局节点 ${id}`,
      parts: [{ type: "text", text: `保留 ${id} 的原始提示词与数据` }],
      inputs: [{ id: "in", kind: "text", label: "输入" }],
      outputs: [{ id: "prompt", kind: "text", label: "提示词" }],
      description: "隔离布局回归，不提交生成",
    },
  };
}

function messyGraph(): CanvasDocument {
  return {
    schemaVersion: 1, viewport: { x: 0, y: 0, zoom: 1 },
    nodes: [prompt("a", 760, 360), prompt("b", 80, 80), prompt("c", 430, 520), prompt("outside", 1050, 100)],
    edges: [
      { id: "a-b", source: "a", sourceHandle: "prompt", target: "b", targetHandle: "in", type: "smoothstep" },
      { id: "b-c", source: "b", sourceHandle: "prompt", target: "c", targetHandle: "in", type: "smoothstep" },
    ],
  };
}

const positions = (graph: CanvasDocument) => Object.fromEntries(graph.nodes.map(node => [node.id, node.position]));
const content = (graph: CanvasDocument) => graph.nodes.map(node => ({
  id: node.id, data: node.data, style: node.style, width: node.width, height: node.height,
}));
const anchor = (nodes: CanvasNode[]) => ({
  x: Math.min(...nodes.map(node => node.position.x)),
  y: Math.min(...nodes.map(node => node.position.y)),
});

async function saved(request: APIRequestContext, id: string): Promise<SavedCanvas> {
  const response = await request.get(`/api/canvas/${id}`);
  expect(response.ok()).toBeTruthy();
  return response.json();
}

async function openFixture(page: Page, request: APIRequestContext, graph = messyGraph(), fit = true) {
  let submissions = 0;
  await page.route(/\/api\/(?:runs|agent\/turn)(?:\?|\/|$)/u, async route => {
    if (route.request().method() === "GET") await route.continue();
    else { submissions++; await route.abort(); }
  });
  const response = await request.post("/api/canvas", { data: { title: "隔离布局交互回归", graph } });
  expect(response.ok()).toBeTruthy();
  const { id } = await response.json() as SavedCanvas;
  await page.goto(`/canvas/${id}`);
  await expect(page.locator(".react-flow__node")).toHaveCount(fit ? graph.nodes.length : 1);
  const inspector = page.getByRole("button", { name: "智能体面板", exact: true });
  if ((await inspector.getAttribute("aria-expanded")) === "true") await inspector.click();
  if (fit) await page.getByRole("button", { name: "Fit View", exact: true }).click();
  // Finish initialization, measured geometry and the fit-view autosave before
  // counting writes belonging to the layout transaction.
  await page.waitForTimeout(1200);
  await expect(page.locator('[data-canvas-island="actions"]').getByRole("button", { name: "撤销", exact: true })).toBeDisabled();
  await page.evaluate(canvasId => {
    const w = window as LayoutWindow;
    w.__layoutWrites = [];
    const original = window.fetch.bind(window);
    window.fetch = (input, init) => {
      const url = input instanceof Request ? input.url : String(input);
      const method = init?.method ?? (input instanceof Request ? input.method : "GET");
      if (method === "PUT" && new URL(url, location.href).pathname === `/api/canvas/${canvasId}`) {
        const body = typeof init?.body === "string" ? JSON.parse(init.body) as { graph: CanvasDocument } : null;
        if (body) w.__layoutWrites.push({
          at: performance.now(), duringAnimation: Boolean(document.querySelector(".canvas-wrap.is-layout-animating")), graph: body.graph,
        });
      }
      return original(input, init);
    };
  }, id);
  return {
    id, before: (await saved(request, id)).graph,
    tidy: page.getByRole("button", { name: "一键整理画布", exact: true }),
    assertNoSubmissions: () => expect(submissions).toBe(0),
  };
}

async function waitForLayoutSave(page: Page, request: APIRequestContext, id: string) {
  await expect(page.locator(".canvas-wrap")).not.toHaveClass(/is-layout-animating/);
  await expect.poll(() => page.evaluate(() => (window as LayoutWindow).__layoutWrites.length)).toBe(1);
  const [write] = await page.evaluate(() => (window as LayoutWindow).__layoutWrites);
  await expect.poll(async () => positions((await saved(request, id)).graph)).toEqual(positions(write!.graph));
  return (await saved(request, id)).graph;
}

test.use({ viewport: { width: 1600, height: 1000 }, trace: "on", video: "off" });

test.describe("actual port geometry", () => {
test.use({ deviceScaleFactor: 2 });
for (const scenario of ["prompt", "references", "offscreen"] as const) test(`整理按实际 ${scenario} 端口对齐异高链条和附着结果，二次整理无变化`, async ({ page, request }, testInfo) => {
  const input = scenario === "references" ? "references" : "prompt";
  const upstream = prompt("port-source", 800, 500);
  if (input === "references") upstream.data = { nodeType: "asset-input", label: "端口布局图片占位", assetKind: "image",
    outputs: [{ id: "asset", kind: "image", label: "图片" }] };
  const graph: CanvasDocument = { schemaVersion: 1, viewport: { x: 0, y: 0, zoom: 1 }, nodes: [
    upstream,
    { id: "port-generation", type: "workflow", position: { x: 53, y: 77 }, style: { width: 376, height: 272 },
      data: { nodeType: "image-generation", label: "实际端口偏移的 Fake 节点", provider: "fake", connectionId: "fake-default", model: "fake-image-v1",
        parameters: { size: "1024x1024", quality: "auto" },
        inputs: [{ id: "prompt", kind: "text", label: "提示词" }, { id: "references", kind: "image[]", label: "参考图", multiple: true }],
        outputs: [{ id: "images", kind: "image", label: "图片" }] } },
    { id: "port-result", type: "workflow", position: { x: 400, y: 320 }, style: { width: 316, height: 237 },
      data: { nodeType: "asset-input", label: "离线结果占位", assetKind: "image", generatedResult: true, generatedStatus: "failed",
        generatedError: "仅核对布局，不提交生成", generatedFromNodeId: "port-generation", generatedFromRunId: "port-layout-fixture", generatedOutputIndex: 0 } },
  ], edges: [{ id: "actual-port-chain", source: upstream.id, sourceHandle: input === "prompt" ? "prompt" : "asset",
    target: "port-generation", targetHandle: input, type: "smoothstep" }] };
  if (scenario === "offscreen") {
    upstream.position = { x: 80, y: 100 };
    graph.nodes[1]!.position = { x: 20_000, y: 20_000 };
    graph.nodes[2]!.position = { x: 21_000, y: 21_000 };
    // Production keeps canvases through 500 mounted. Cross that real threshold,
    // selecting only the original workflow so its distant neighbours stay put
    // and the post-tidy viewport fits the three nodes whose ports we inspect.
    for (const node of graph.nodes) node.selected = true;
    graph.nodes.push(...Array.from({ length: 498 }, (_, index) =>
      prompt(`culled-padding-${index}`, 50_000 + index * 500, 50_000)));
  }
  const fixture = await openFixture(page, request, graph, scenario !== "offscreen");
  if (scenario === "offscreen") {
    // React Flow forces an initial render until handleBounds exist, even with
    // saved dimensions. Verify the real culled state rather than asserting
    // that its required initialization measurement never happened.
    await expect(page.locator('.react-flow__node[data-id="port-generation"], .react-flow__node[data-id="port-result"]')).toHaveCount(0);
    await expect(page.locator(".react-flow__node")).toHaveCount(1);
    await expect(fixture.tidy).toHaveAttribute("title", /整理所选（3）/u);
  }
  await fixture.tidy.click();
  await expect(page.getByText("已整理 3 个节点", { exact: true })).toBeVisible();
  const after = await waitForLayoutSave(page, request, fixture.id);
  expect(anchor(after.nodes)).toEqual(anchor(fixture.before.nodes));
  expect(content(after)).toEqual(content(fixture.before));
  expect(after.edges).toEqual(fixture.before.edges);
  expect(after.edges).toHaveLength(2);
  if (scenario === "offscreen") for (const node of after.nodes.filter(node => node.id.startsWith("culled-padding-"))) {
    expect(node.position).toEqual(fixture.before.nodes.find(previous => previous.id === node.id)!.position);
  }
  const geometry = await page.evaluate(edges => {
    const zoom = new DOMMatrixReadOnly(document.querySelector<HTMLElement>(".react-flow__viewport")!.style.transform).a;
    return edges.map(edge => {
      const fromNode = document.querySelector<HTMLElement>(`.react-flow__node[data-id="${edge.source}"]`)!;
      const toNode = document.querySelector<HTMLElement>(`.react-flow__node[data-id="${edge.target}"]`)!;
      const from = fromNode.querySelector(`.react-flow__handle.source${edge.sourceHandle == null ? "" : `[data-handleid="${edge.sourceHandle}"]`}`)!.getBoundingClientRect();
      const to = toNode.querySelector(`.react-flow__handle.target${edge.targetHandle == null ? "" : `[data-handleid="${edge.targetHandle}"]`}`)!.getBoundingClientRect();
      const sourceY = from.y + from.height / 2, targetY = to.y + to.height / 2;
      const path = document.querySelector<SVGPathElement>(`.react-flow__edge[data-id="${edge.id}"] .react-flow__edge-path`)!;
      const fromPath = path.getPointAtLength(0).matrixTransform(path.getScreenCTM()!);
      const toPath = path.getPointAtLength(path.getTotalLength()).matrixTransform(path.getScreenCTM()!);
      return { id: edge.id, sourceOffset: (sourceY - fromNode.getBoundingClientRect().y) / zoom,
        targetOffset: (targetY - toNode.getBoundingClientRect().y) / zoom,
        handleDifference: Math.abs(sourceY - targetY) / zoom,
        pathDifference: Math.abs(fromPath.y - toPath.y) / zoom,
        attachmentError: Math.max(Math.abs(sourceY - fromPath.y), Math.abs(targetY - toPath.y)) / zoom };
    });
  }, after.edges);
  await testInfo.attach(`actual-${input}-port-geometry.json`, { body: JSON.stringify(geometry, null, 2), contentType: "application/json" });
  expect(Math.abs(geometry[0]!.sourceOffset - geometry[0]!.targetOffset)).toBeGreaterThan(3);
  for (const edge of geometry) {
    expect(edge.handleDifference, `${edge.id}: actual handle centers`).toBeLessThan(.25);
    expect(edge.pathDifference, `${edge.id}: actual SVG endpoints`).toBeLessThan(.25);
    expect(edge.attachmentError, `${edge.id}: path follows handles`).toBeLessThan(.25);
  }
  const generation = page.locator('.react-flow__node[data-id="port-generation"]');
  const selectionGeometry = () => generation.evaluate(element => {
    const zoom = new DOMMatrixReadOnly(document.querySelector<HTMLElement>(".react-flow__viewport")!.style.transform).a;
    const top = element.getBoundingClientRect().top;
    const card = element.querySelector<HTMLElement>(".node-card")!;
    return { border: getComputedStyle(card).borderTopWidth, offsets: [...element.querySelectorAll(".react-flow__handle")].map(handle => {
      const box = handle.getBoundingClientRect(); return (box.y + box.height / 2 - top) / zoom;
    }) };
  });
  // The offscreen fixture begins with three selected targets. Clear that real
  // selection before comparing the normal and selected structural borders.
  await clickBlankCanvas(page);
  const unselectedGeometry = await selectionGeometry();
  await generation.locator(".node-head").click();
  await expect(generation).toHaveClass(/selected/);
  const selectedGeometry = await selectionGeometry();
  expect(selectedGeometry.border).toBe(unselectedGeometry.border);
  selectedGeometry.offsets.forEach((offset, index) => expect(Math.abs(offset - unselectedGeometry.offsets[index]!)).toBeLessThan(.05));
  if (scenario === "offscreen") {
    for (const id of [upstream.id, "port-result"])
      await page.locator(`.react-flow__node[data-id="${id}"] ${id === "port-result" ? ".generated-result-node" : ".node-head"}`).click({ modifiers: ["Control"] });
    await expect(page.locator(".react-flow__node.selected")).toHaveCount(3);
  }
  await fixture.tidy.click();
  await expect(page.getByText("画布已经很整齐了", { exact: true })).toBeVisible();
  expect(positions((await saved(request, fixture.id)).graph)).toEqual(positions(after));
  expect(await page.evaluate(() => (window as LayoutWindow).__layoutWrites.length)).toBe(1);
  fixture.assertNoSubmissions();
});
});

test("整理两项选择保留原锚点，部分手动组不扩大选择，Ctrl+Z 还原", async ({ page, request }) => {
  const graph = messyGraph();
  for (const id of ["a", "outside"]) Object.assign(graph.nodes.find(node => node.id === id)!.data, {
    canvasGroupId: "partial-group", canvasGroupLabel: "不能扩大选择的组", canvasGroupColor: "#a78bfa",
  });
  const fixture = await openFixture(page, request, graph);
  await page.locator('.react-flow__node[data-id="a"] .node-head').click();
  await page.locator('.react-flow__node[data-id="b"] .node-head').click({ modifiers: ["Control"] });
  await expect(page.locator(".react-flow__node.selected")).toHaveCount(2);
  const selectedBefore = fixture.before.nodes.filter(node => ["a", "b"].includes(node.id));
  await fixture.tidy.click();
  await expect(page.getByText("已整理 2 个节点", { exact: true })).toBeVisible();
  const after = await waitForLayoutSave(page, request, fixture.id);
  expect(anchor(after.nodes.filter(node => ["a", "b"].includes(node.id)))).toEqual(anchor(selectedBefore));
  expect(after.nodes.find(node => node.id === "b")!.position.x).toBeGreaterThan(after.nodes.find(node => node.id === "a")!.position.x);
  for (const id of ["c", "outside"]) expect(after.nodes.find(node => node.id === id)!.position).toEqual(fixture.before.nodes.find(node => node.id === id)!.position);
  expect(content(after)).toEqual(content(fixture.before));
  expect(after.edges).toEqual(fixture.before.edges);
  await page.keyboard.press("Control+z");
  await expect.poll(async () => positions((await saved(request, fixture.id)).graph)).toEqual(positions(fixture.before));
  await expect(page.locator('[data-canvas-island="actions"]').getByRole("button", { name: "撤销", exact: true })).toBeDisabled();
  fixture.assertNoSubmissions();
});

test("全图整理保持手动组刚体与结果附着，内容和尺寸不变", async ({ page, request }) => {
  const graph = messyGraph();
  graph.nodes.find(node => node.id === "outside")!.position = { x: 430, y: 140 };
  for (const id of ["b", "outside"]) Object.assign(graph.nodes.find(node => node.id === id)!.data, {
    canvasGroupId: "whole-group", canvasGroupLabel: "保持内部布局", canvasGroupColor: "#a78bfa",
  });
  const source = graph.nodes.find(node => node.id === "c")!;
  source.data = { nodeType: "image-generation", label: "本地 Fake 生成节点", provider: "fake", connectionId: "fake-default", model: "fake-image-v1",
    parameters: { size: "1024x1024", quality: "auto" }, inputs: [{ id: "prompt", kind: "text", label: "提示词" }], outputs: [{ id: "images", kind: "image", label: "图片" }] };
  graph.edges.find(edge => edge.id === "b-c")!.targetHandle = "prompt";
  graph.nodes.push({ id: "result", type: "workflow", position: { x: 70, y: 730 }, style: { width: 220, height: 170 },
    data: { nodeType: "asset-input", label: "仅布局的结果占位", assetKind: "image", generatedResult: true, generatedStatus: "failed",
      generatedError: "离线布局占位，不提交请求", generatedFromNodeId: "c", generatedFromRunId: "layout-fixture", generatedOutputIndex: 0 } });
  const fixture = await openFixture(page, request, graph);
  await fixture.tidy.click();
  await expect(page.getByText("已整理 5 个节点", { exact: true })).toBeVisible();
  const after = await waitForLayoutSave(page, request, fixture.id);
  const offset = (document: CanvasDocument) => {
    const a = document.nodes.find(node => node.id === "b")!, b = document.nodes.find(node => node.id === "outside")!;
    return { x: b.position.x - a.position.x, y: b.position.y - a.position.y };
  };
  expect(offset(after)).toEqual(offset(fixture.before));
  expect(anchor(after.nodes)).toEqual(anchor(fixture.before.nodes));
  const arrangedSource = after.nodes.find(node => node.id === "c")!, result = after.nodes.find(node => node.id === "result")!;
  expect(result.position.x).toBeGreaterThanOrEqual(arrangedSource.position.x + (arrangedSource.measured?.width ?? 280) + 24);
  expect(result.data.generatedFromNodeId).toBe("c");
  expect(content(after)).toEqual(content(fixture.before));
  expect(after.edges).toEqual(fixture.before.edges);
  fixture.assertNoSubmissions();
});

test("300ms 整理逐帧移动节点、视口与连线，动画内不保存且结束仅保存一次，toast 可撤销", async ({ page, request }) => {
  const fixture = await openFixture(page, request);
  const capture = await fixture.tidy.evaluate(async element => {
    const w = window as LayoutWindow;
    const samples: Array<{ elapsed: number; active: boolean; x: number; y: number; viewport: string; endpointError: number }> = [];
    const start = performance.now();
    const sample = () => {
      const node = document.querySelector<HTMLElement>('.react-flow__node[data-id="a"]')!;
      const matrix = new DOMMatrixReadOnly(node.style.transform);
      const path = document.querySelector<SVGPathElement>('.react-flow__edge[data-id="a-b"] .react-flow__edge-path');
      let endpointError = Infinity;
      if (path && path.getScreenCTM()) {
        const point = (end: boolean) => path.getPointAtLength(end ? path.getTotalLength() : 0).matrixTransform(path.getScreenCTM()!);
        const from = document.querySelector('.react-flow__node[data-id="a"] .react-flow__handle.source[data-handleid="prompt"]')!.getBoundingClientRect();
        const to = document.querySelector('.react-flow__node[data-id="b"] .react-flow__handle.target[data-handleid="in"]')!.getBoundingClientRect();
        const p = point(false), q = point(true);
        // React Flow attaches LR edges to the outer edge of each handle,
        // rather than its center (getHandlePosition in @xyflow/system).
        endpointError = Math.max(Math.hypot(p.x - from.right, p.y - from.y - from.height / 2), Math.hypot(q.x - to.left, q.y - to.y - to.height / 2));
      }
      samples.push({ elapsed: performance.now() - start, active: Boolean(document.querySelector(".canvas-wrap.is-layout-animating")), x: matrix.m41, y: matrix.m42,
        viewport: document.querySelector<HTMLElement>(".react-flow__viewport")!.style.transform, endpointError });
    };
    (element as HTMLButtonElement).click();
    await new Promise<void>(resolve => {
      const tick = () => { sample(); if (performance.now() - start < 500) requestAnimationFrame(tick); else resolve(); };
      requestAnimationFrame(tick);
    });
    return { samples, writes: w.__layoutWrites };
  });
  const moving = capture.samples.filter(sample => sample.active);
  expect(moving.length).toBeGreaterThanOrEqual(3);
  expect(new Set(moving.map(sample => `${sample.x},${sample.y}`)).size).toBeGreaterThanOrEqual(3);
  expect(new Set(moving.map(sample => sample.viewport)).size).toBeGreaterThanOrEqual(3);
  expect(moving.some(sample => sample.elapsed >= 150)).toBe(true);
  const completed = capture.samples.find((sample, index) => !sample.active && capture.samples.slice(0, index).some(previous => previous.active));
  expect(completed).toBeDefined();
  expect(completed!.elapsed).toBeGreaterThanOrEqual(280);
  expect(capture.samples.at(-1)!.active).toBe(false);
  expect(Math.max(...moving.map(sample => sample.endpointError))).toBeLessThan(3);
  expect(capture.writes).toEqual([]);
  const after = await waitForLayoutSave(page, request, fixture.id);
  expect(positions(after)).not.toEqual(positions(fixture.before));
  const [write] = await page.evaluate(() => (window as LayoutWindow).__layoutWrites);
  expect(write!.duringAnimation).toBe(false);
  await page.waitForTimeout(750);
  expect(await page.evaluate(() => (window as LayoutWindow).__layoutWrites.length)).toBe(1);
  await page.locator(".toast").filter({ hasText: "已整理 4 个节点" }).getByRole("button", { name: "撤销", exact: true }).click();
  await expect.poll(async () => positions((await saved(request, fixture.id)).graph)).toEqual(positions(fixture.before));
  fixture.assertNoSubmissions();
});

test("已有修改后整理再 Ctrl+Z，旧整理 toast 不会再撤销此前修改", async ({ page, request }) => {
  const fixture = await openFixture(page, request);
  const originalParts = fixture.before.nodes.find(node => node.id === "a")!.data.parts;
  await page.locator('.react-flow__node[data-id="a"] .prompt-overview').click();
  const editor = page.locator('.react-flow__node[data-id="a"] .tiptap-prompt');
  await editor.fill("整理之前需要保留的独立修改");
  await editor.press("Control+s");
  await expect.poll(async () => (await saved(request, fixture.id)).graph.nodes.find(node => node.id === "a")!.data.parts)
    .toEqual([{ type: "text", text: "整理之前需要保留的独立修改" }]);
  await page.evaluate(() => { (window as LayoutWindow).__layoutWrites = []; });
  await fixture.tidy.click();
  const layoutToast = page.locator(".toast").filter({ hasText: "已整理 4 个节点" });
  await expect(layoutToast.getByRole("button", { name: "撤销", exact: true })).toBeVisible();
  await waitForLayoutSave(page, request, fixture.id);
  await clickBlankCanvas(page);
  await page.keyboard.press("Control+z");
  await expect(layoutToast).toHaveCount(0);
  await expect.poll(async () => {
    const graph = (await saved(request, fixture.id)).graph;
    return { positions: positions(graph), parts: graph.nodes.find(node => node.id === "a")!.data.parts };
  }).toEqual({ positions: positions(fixture.before), parts: [{ type: "text", text: "整理之前需要保留的独立修改" }] });
  // The earlier edit is still an independent undo step. The old layout action
  // is gone, so only an explicit second history operation can remove it.
  const undo = page.locator('[data-canvas-island="actions"]').getByRole("button", { name: "撤销", exact: true });
  await expect(undo).toBeEnabled();
  await undo.click();
  await expect.poll(async () => (await saved(request, fixture.id)).graph.nodes.find(node => node.id === "a")!.data.parts).toEqual(originalParts);
  await expect(undo).toBeDisabled();
  fixture.assertNoSubmissions();
});

test("整理后的新编辑撤下旧 toast 动作，正常撤销只还原新编辑", async ({ page, request }) => {
  const fixture = await openFixture(page, request);
  await fixture.tidy.click();
  const layoutToast = page.locator(".toast").filter({ hasText: "已整理 4 个节点" });
  await expect(layoutToast.getByRole("button", { name: "撤销", exact: true })).toBeVisible();
  const arranged = await waitForLayoutSave(page, request, fixture.id);
  await page.locator('.react-flow__node[data-id="a"] .prompt-overview').click();
  const editor = page.locator('.react-flow__node[data-id="a"] .tiptap-prompt');
  await editor.fill("整理之后的新修改不能被旧提示误撤销");
  await editor.press("Control+s");
  await expect(layoutToast).toHaveCount(0);
  await expect.poll(async () => (await saved(request, fixture.id)).graph.nodes.find(node => node.id === "a")!.data.parts)
    .toEqual([{ type: "text", text: "整理之后的新修改不能被旧提示误撤销" }]);
  expect(positions((await saved(request, fixture.id)).graph)).toEqual(positions(arranged));
  await clickBlankCanvas(page);
  await page.keyboard.press("Control+z");
  await expect.poll(async () => {
    const graph = (await saved(request, fixture.id)).graph;
    return { positions: positions(graph), parts: graph.nodes.find(node => node.id === "a")!.data.parts };
  }).toEqual({ positions: positions(arranged), parts: fixture.before.nodes.find(node => node.id === "a")!.data.parts });
  await expect(page.locator('[data-canvas-island="actions"]').getByRole("button", { name: "撤销", exact: true })).toBeEnabled();
  fixture.assertNoSubmissions();
});

for (const preference of ["system", "application"] as const) {
  test(`${preference} 减少动态效果即时整理，二次整理不保存或增加撤销`, async ({ page, request }) => {
    if (preference === "system") await page.emulateMedia({ reducedMotion: "reduce" });
    else await page.addInitScript(() => localStorage.setItem("super-canvas:gentle-motion", "off"));
    const fixture = await openFixture(page, request);
    const immediate = await fixture.tidy.evaluate(async element => {
      let animated = false;
      const wrap = document.querySelector<HTMLElement>(".canvas-wrap")!;
      const observer = new MutationObserver(() => { animated ||= wrap.classList.contains("is-layout-animating"); });
      observer.observe(wrap, { attributes: true, attributeFilter: ["class"] });
      (element as HTMLButtonElement).click();
      const firstFrame = await new Promise<Record<string, { x: number; y: number }>>(resolve => requestAnimationFrame(() => resolve(Object.fromEntries(
        [...document.querySelectorAll<HTMLElement>(".react-flow__node")].map(node => {
          const matrix = new DOMMatrixReadOnly(node.style.transform);
          return [node.dataset.id!, { x: matrix.m41, y: matrix.m42 }];
        }),
      ))));
      observer.disconnect();
      return { animated, firstFrame };
    });
    expect(immediate.animated).toBe(false);
    const arranged = await waitForLayoutSave(page, request, fixture.id);
    expect(immediate.firstFrame).toEqual(positions(arranged));
    expect(positions(arranged)).not.toEqual(positions(fixture.before));
    await fixture.tidy.click();
    await expect(page.getByText("画布已经很整齐了", { exact: true })).toBeVisible();
    await page.waitForTimeout(900);
    expect(await page.evaluate(() => (window as LayoutWindow).__layoutWrites.length)).toBe(1);
    expect(positions((await saved(request, fixture.id)).graph)).toEqual(positions(arranged));
    // Canvas history shortcuts intentionally yield to focused buttons. Return
    // focus to the pane after the second toolbar click before testing Ctrl+Z.
    await clickBlankCanvas(page);
    await page.keyboard.press("Control+z");
    await expect.poll(async () => positions((await saved(request, fixture.id)).graph)).toEqual(positions(fixture.before));
    await expect(page.locator('[data-canvas-island="actions"]').getByRole("button", { name: "撤销", exact: true })).toBeDisabled();
    fixture.assertNoSubmissions();
  });
}
