import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { expect, test, type Page, type APIRequestContext } from "./helpers/canvas-offline-test";
import type { CanvasDocument, CanvasNode } from "../components/types";

const screenshots = resolve(process.env.CANVAS_LAYOUT_EVIDENCE_DIR ?? resolve(process.cwd(), "../../../.codex-logs/2026-10-16-canvas-layout/screenshots"));
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");

async function fixture(page: Page, request: APIRequestContext) {
  await page.setViewportSize({ width: 1800, height: 1050 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.addInitScript(() => localStorage.setItem("super-canvas:inspector-open", "false"));
  let paid = 0, external = 0;
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  const models = [{ id: "fake-image-v1", name: "隔离图片模型", operations: ["image.generate", "image.edit"],
    inputKinds: ["text", "image[]"], outputKinds: ["image"], isDefault: true, limits: { maxInputImages: 8 }, metadata: { canvasRunnable: true } }];
  await page.route("**/*", route => {
    const url = new URL(route.request().url());
    if (["http:", "https:"].includes(url.protocol) && !["localhost", "127.0.0.1"].includes(url.hostname)) { external++; return route.abort(); }
    if (/\/api\/(?:runs|agent\/turn)(?:\?|\/|$)/u.test(url.pathname) && !["GET", "HEAD"].includes(route.request().method())) { paid++; return route.abort(); }
    if (url.pathname === "/api/providers" && route.request().method() === "GET") return route.fulfill({ json: [{ id: "fake-default", name: "隔离本地连接", provider: "fake", apiKeySet: false, apiKey: "",
      config: { usage: "canvas", defaultModel: "fake-image-v1", modelCatalogModels: models, modelScanStatus: "live", modelScanComplete: true, connector: { auth: { type: "none" }, models } } }] });
    if (url.pathname === "/api/providers/fake-default/models") return route.fulfill({ json: models, headers: { "X-Model-Scan-Status": "live", "X-Model-Scan-Complete": "true" } });
    return route.fallback();
  });
  const sources: CanvasNode[] = [];
  for (let index = 0; index < 6; index++) {
    const upload = await request.post("/api/assets/upload", { multipart: { file: { name: `${index + 1}.png`, mimeType: "image/png", buffer: png } } });
    expect(upload.ok()).toBeTruthy();
    const asset = await upload.json();
    sources.push({ id: `source-${index + 1}`, type: "workflow", position: { x: 100 + (index % 3) * 250, y: 100 + Math.floor(index / 3) * 380 },
      style: { width: 220, height: 240 }, data: { nodeType: "asset-input", label: `${index + 1}.png`, assetId: asset.id, assetKind: "image", mediaAspectRatio: 1,
        inputs: [], outputs: [{ id: "asset", kind: "image", label: "图片" }] } });
  }
  const graph: CanvasDocument = { schemaVersion: 1, viewport: { x: 0, y: 0, zoom: 1 }, edges: [], nodes: [...sources, {
    id: "target", type: "workflow", position: { x: 1120, y: 260 }, style: { width: 340, height: 260 }, data: {
      nodeType: "image-generation", label: "图片生成", provider: "fake", connectionId: "fake-default", model: "fake-image-v1", parameters: {},
      parts: [], inputs: [{ id: "prompt", kind: "text", label: "提示词" }, { id: "references", kind: "image[]", label: "参考图", multiple: true }],
      outputs: [{ id: "images", kind: "image", label: "图片" }],
    },
  }] };
  const response = await request.post("/api/canvas", { data: { title: `隔离批量连线验收 ${crypto.randomUUID()}`, graph } });
  expect(response.ok()).toBeTruthy();
  const { id } = await response.json();
  await page.goto(`/canvas/${id}`);
  await expect(page.locator(".react-flow__node")).toHaveCount(7);
  const agent = page.getByRole("button", { name: "智能体面板", exact: true });
  if (await agent.getAttribute("aria-expanded") === "true") await agent.click();
  await page.getByRole("button", { name: "Fit View", exact: true }).click();
  await page.waitForTimeout(900);
  for (let index = 1; index <= 6; index++) await page.locator(`.react-flow__node[data-id="source-${index}"] .node-head`).click({ modifiers: index > 1 ? ["Control"] : [] });
  await expect(page.locator(".react-flow__node.selected")).toHaveCount(6);
  const saved = async (): Promise<CanvasDocument> => (await (await request.get(`/api/canvas/${id}`)).json()).graph;
  return { id, saved, check: () => expect({ paid, external, errors }).toEqual({ paid: 0, external: 0, errors: [] }) };
}

async function dragBatch(page: Page, point: { x: number; y: number }) {
  const port = page.getByRole("button", { name: "批量连接 6 个图片", exact: true });
  const from = (await port.boundingBox())!;
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down(); await page.mouse.move(point.x, point.y, { steps: 10 });
  await expect(page.locator('.node-card[data-connection-active="true"]')).not.toHaveCount(0);
  await page.mouse.up();
}

test("多选批量点按阅读顺序连到参考图，单次撤销且刷新保留", async ({ page, request }) => {
  const f = await fixture(page, request);
  await mkdir(screenshots, { recursive: true });
  await page.screenshot({ path: resolve(screenshots, "batch-connection-before.png") });
  const target = page.locator('.react-flow__node[data-id="target"] .node-head');
  const box = (await target.boundingBox())!;
  await dragBatch(page, { x: box.x + box.width / 2, y: box.y + box.height / 2 });
  await expect(page.getByText("已连接 6 个素材到「图片生成」", { exact: true })).toBeVisible();
  await expect.poll(async () => (await f.saved()).edges.map(edge => edge.source)).toEqual(["source-1", "source-2", "source-3", "source-4", "source-5", "source-6"]);
  await page.screenshot({ path: resolve(screenshots, "batch-connection-after.png") });
  const undo = page.locator('[data-canvas-island="actions"]').getByRole("button", { name: "撤销", exact: true });
  await undo.click();
  await expect.poll(async () => (await f.saved()).edges.length).toBe(0);
  await expect(undo).toBeDisabled();
  await page.locator('[data-canvas-island="actions"]').getByRole("button", { name: "重做", exact: true }).click();
  await expect.poll(async () => (await f.saved()).edges.length).toBe(6);
  await page.reload(); await expect(page.locator(".react-flow__edge")).toHaveCount(6);
  f.check();
});

test("批量拖到空白创建一个节点并在一次操作中连接所有源", async ({ page, request }) => {
  const f = await fixture(page, request);
  const pane = (await page.locator(".react-flow__pane").boundingBox())!;
  await dragBatch(page, { x: pane.x + pane.width * .78, y: pane.y + pane.height * .8 });
  await page.getByRole("menuitem", { name: "图片编辑", exact: true }).click();
  await expect.poll(async () => (await f.saved()).edges.length).toBe(6);
  const graph = await f.saved();
  const targetIds = new Set(graph.edges.map(edge => edge.target));
  expect(targetIds.size).toBe(1); expect(targetIds.has("target")).toBe(false);
  await page.locator('[data-canvas-island="actions"]').getByRole("button", { name: "撤销", exact: true }).click();
  await expect.poll(async () => ({ edges: (await f.saved()).edges.length, nodes: (await f.saved()).nodes.length })).toEqual({ edges: 0, nodes: 7 });
  f.check();
});

test("批量拖动失焦后清除预览，原选区保持且不保存连线", async ({ page, request }) => {
  const f = await fixture(page, request);
  const port = page.getByRole("button", { name: "批量连接 6 个图片", exact: true });
  const from = (await port.boundingBox())!;
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2); await page.mouse.down();
  await page.mouse.move(from.x + 90, from.y + 30, { steps: 3 });
  await expect(page.locator('.node-card[data-connection-active="true"]')).toHaveCount(7);
  await page.evaluate(() => window.dispatchEvent(new Event("blur")));
  await expect(page.locator('.node-card[data-connection-active="true"]')).toHaveCount(0);
  await expect(page.locator(".react-flow__node.selected")).toHaveCount(6);
  await page.mouse.up();
  expect((await f.saved()).edges).toHaveLength(0);
  f.check();
});
