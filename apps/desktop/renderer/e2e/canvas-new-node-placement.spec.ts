import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { canvasUsableArea } from "../lib/canvas-usable-area";

type GraphNode = {
  id: string; type: string; position: { x: number; y: number };
  style?: { width: number; height: number }; data: { nodeType: string; label: string; parts?: Array<{ type: string; text: string }>; outputs?: Array<{ id: string; kind: string; label: string }> };
};
type Graph = { schemaVersion: number; nodes: GraphNode[]; edges: unknown[]; viewport: { x: number; y: number; zoom: number } };

test.use({ viewport: { width: 1600, height: 1000 } });
test.beforeEach(async ({ page }) => { await page.emulateMedia({ reducedMotion: "reduce" }); });

function prompt(id: string, x: number, y: number): GraphNode {
  return { id, type: "workflow", position: { x, y }, style: { width: 360, height: 210 },
    data: { nodeType: "prompt", label: id, parts: [{ type: "text", text: "隔离节点位置回归" }], outputs: [{ id: "prompt", kind: "text", label: "提示词" }] } };
}

async function openIsolatedCanvas(page: Page, request: APIRequestContext, graph: Graph) {
  const response = await request.post("/api/canvas", { data: { title: `节点位置回归 ${Date.now()}`, graph } });
  expect(response.ok()).toBeTruthy();
  const canvas = await response.json() as { id: string };
  let externalAttempts = 0;
  let runSubmissions = 0;
  const pageErrors: string[] = [];
  page.on("pageerror", error => pageErrors.push(error.message));
  const baseOrigin = new URL(response.url()).origin;
  await page.route("**/*", async route => {
    const req = route.request(), url = new URL(req.url());
    if (url.origin !== baseOrigin && !["data:", "blob:", "about:"].includes(url.protocol)) {
      externalAttempts++; return route.abort("blockedbyclient");
    }
    if (req.method() === "GET" && ["/api/providers", "/api/suppliers", "/api/agent/models"].includes(url.pathname)) return route.fulfill({ json: [] });
    if (url.pathname === "/api/runs" && req.method() === "POST") { runSubmissions++; return route.abort("blockedbyclient"); }
    return route.continue();
  });
  await page.goto(`/canvas/${canvas.id}`);
  await expect(page.getByRole("button", { name: "新建提示词节点", exact: true })).toBeEnabled();
  const readGraph = async () => {
    const saved = await request.get(`/api/canvas/${canvas.id}`);
    expect(saved.ok()).toBeTruthy();
    return (await saved.json() as { graph: Graph }).graph;
  };
  return { readGraph, check: () => { expect(pageErrors).toEqual([]); expect(externalAttempts).toBe(0); expect(runSubmissions).toBe(0); } };
}

test("大幅平移缩放后点击添加，Prompt 在当前画布中心显示并按 8px 保存", async ({ page, request }) => {
  const original = prompt("offscreen-original", 0, 0);
  const graph: Graph = { schemaVersion: 1, nodes: [original], edges: [], viewport: { x: -4800, y: 2400, zoom: 0.65 } };
  const canvas = await openIsolatedCanvas(page, request, graph);
  // Read actual visible chrome, rather than assuming that a full-width topbar
  // or a dock consumes a fixed number of pixels in the new island layout.
  const screen = await page.locator(".canvas-wrap").evaluate(element => {
    const rect = (bounds: DOMRect) => ({ left: bounds.left, top: bounds.top, right: bounds.right, bottom: bounds.bottom });
    const chrome = element.closest(".canvas-editor")!;
    const obstacles = [...chrome.querySelectorAll<HTMLElement>(
      '[data-canvas-island], .editor-rail, .canvas-toolbar, .react-flow__controls, .workspace > .inspector.mobile-open, .canvas-parameter-deck:not([hidden])',
    )].filter(item => {
      const style = getComputedStyle(item);
      return style.display !== "none" && style.visibility !== "hidden";
    }).map(item => rect(item.getBoundingClientRect()));
    return { bounds: rect(element.getBoundingClientRect()), obstacles };
  });
  const usable = canvasUsableArea(screen.bounds, screen.obstacles);
  const center = { x: screen.bounds.left + usable.x + usable.width / 2,
    y: screen.bounds.top + usable.y + usable.height / 2 };
  await page.getByRole("button", { name: "新建提示词节点", exact: true }).click();
  const added = page.locator('.react-flow__node[data-id^="prompt-"]');
  await expect(added).toHaveCount(1);
  await expect(added).toBeVisible();
  const box = await added.boundingBox(), view = await page.locator(".canvas-wrap").boundingBox();
  expect(box).not.toBeNull(); expect(view).not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(screen.bounds.left + usable.x);
  expect(box!.y).toBeGreaterThanOrEqual(screen.bounds.top + usable.y);
  expect(box!.x + box!.width).toBeLessThanOrEqual(screen.bounds.left + usable.x + usable.width);
  expect(box!.y + box!.height).toBeLessThanOrEqual(screen.bounds.top + usable.y + usable.height);
  expect(Math.abs(box!.x + box!.width / 2 - center.x)).toBeLessThanOrEqual(4);
  expect(Math.abs(box!.y + box!.height / 2 - center.y)).toBeLessThanOrEqual(4);
  for (const obstacle of screen.obstacles) expect(
    box!.x + box!.width <= obstacle.left || box!.x >= obstacle.right ||
    box!.y + box!.height <= obstacle.top || box!.y >= obstacle.bottom,
  ).toBe(true);
  await expect(added).toBeInViewport({ ratio: 1 });
  await expect.poll(async () => (await canvas.readGraph()).nodes.length).toBe(2);
  const saved = await canvas.readGraph();
  const node = saved.nodes.find(item => item.id !== original.id)!;
  expect(node.position.x).toBeGreaterThan(6000);
  expect(node.position.y).toBeLessThan(-2000);
  expect(Math.abs(node.position.x % 8)).toBe(0);
  expect(Math.abs(node.position.y % 8)).toBe(0);
  expect(saved.nodes.find(item => item.id === original.id)).toMatchObject(original);
  expect(saved.viewport.zoom).toBeCloseTo(graph.viewport.zoom, 5);
  canvas.check();
});

test("没有 API 的新增失败不会清除重做，也不产生空撤销", async ({ page, request }) => {
  const canvas = await openIsolatedCanvas(page, request, {
    schemaVersion: 1, nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 },
  });
  await page.getByRole("button", { name: "新建提示词节点", exact: true }).click();
  const added = page.locator('.react-flow__node[data-id^="prompt-"]');
  await expect(added).toHaveCount(1);
  const id = await added.getAttribute("data-id");
  const undo = page.getByRole("button", { name: "撤销", exact: true });
  const redo = page.getByRole("button", { name: "重做", exact: true });
  await undo.click();
  await expect(added).toHaveCount(0);
  await expect(redo).toBeEnabled();
  await page.getByRole("button", { name: "新建图片节点", exact: true }).click();
  const settings = page.getByRole("dialog", { name: "供应商与模型设置", exact: true });
  await expect(settings).toBeVisible();
  await settings.getByRole("button", { name: "关闭设置", exact: true }).click();
  await expect(undo).toBeDisabled();
  await expect(redo).toBeEnabled();
  await redo.click();
  await expect(added).toHaveAttribute("data-id", id!);
  await expect.poll(async () => (await canvas.readGraph()).nodes.map(node => node.id)).toEqual([id]);
  await undo.click();
  await expect(added).toHaveCount(0);
  await expect(undo).toBeDisabled();
  canvas.check();
});

test("选中节点右侧被占用时连续添加会避让卡片，并保留原节点与连线", async ({ page, request }) => {
  const originals = [prompt("placement-anchor", 120, 176), prompt("placement-blocker", 504, 176)];
  const graph: Graph = { schemaVersion: 1, nodes: originals, edges: [], viewport: { x: 0, y: 0, zoom: 0.7 } };
  const canvas = await openIsolatedCanvas(page, request, graph);
  await page.locator('.react-flow__node[data-id="placement-anchor"] .node-title').click();
  for (let index = 0; index < 3; index++) {
    await page.getByRole("button", { name: "新建提示词节点", exact: true }).click();
    await expect.poll(async () => (await canvas.readGraph()).nodes.length).toBe(originals.length + index + 1);
  }
  const saved = await canvas.readGraph();
  for (const original of originals) expect(saved.nodes.find(node => node.id === original.id)).toMatchObject(original);
  expect(saved.edges).toEqual(graph.edges);
  for (const node of saved.nodes.filter(item => !originals.some(original => original.id === item.id))) {
    expect(Math.abs(node.position.x % 8)).toBe(0); expect(Math.abs(node.position.y % 8)).toBe(0);
    for (const other of saved.nodes.filter(item => item.id !== node.id)) expect(
      node.position.x + node.style!.width + 24 <= other.position.x || node.position.x >= other.position.x + other.style!.width + 24 ||
      node.position.y + node.style!.height + 24 <= other.position.y || node.position.y >= other.position.y + other.style!.height + 24,
    ).toBe(true);
  }
  await expect(page.locator('.react-flow__node[data-id^="prompt-"]').last()).toBeVisible();
  canvas.check();
});
