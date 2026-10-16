import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import sharp from "sharp";
import { expect, test, type Page } from "@playwright/test";
import type { AssetView, CanvasDocument, CanvasNode } from "../components/types";
import type { MaterialDropEventView } from "../lib/client-api";

const screenshotDirectory = resolve(process.cwd(), "../../../.codex-logs/2026-10-16-canvas-layout/screenshots");
const now = "2026-10-16T00:00:00.000Z";

async function fixture(page: Page, origin: string, options: { fallbackDimensions?: boolean; order?: "filename" | "connection" } = {}) {
  await page.setViewportSize({ width: 1800, height: 1200 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.addInitScript(input => {
    localStorage.setItem("super-canvas:inspector-open", "false");
    localStorage.setItem("supercanvas:canvas-arrangement-order", input.order);
    if (input.fallbackDimensions) Object.defineProperty(window, "createImageBitmap", { value: undefined, configurable: true });
  }, { fallbackDimensions: options.fallbackDimensions, order: options.order ?? "filename" });
  const files = await Promise.all(["10.png", "2.png", "1.png", "6.png", "4.png", "3.png"].map(async (name, index) => {
    const width = index % 2 ? 120 : 40, height = index % 2 ? 40 : 100;
    const bytes = await sharp({ create: { width, height, channels: 4, background: { r: 132 + index * 8, g: 125 + index * 6, b: 156 + index * 5, alpha: 1 } } }).png().toBuffer();
    const asset: AssetView = { id: `grid-${index}`, name, kind: "image", mimeType: "image/png", size: bytes.length,
      storageKey: `isolated-import-grid/${name}`, metadata: options.fallbackDimensions ? {} : { width, height }, createdAt: now };
    return { name, width, height, bytes, asset };
  }));
  const id = "canvas-import-grid-isolated";
  const canvas = { id, title: "批量素材网格隔离验收", revision: 1, graph: {
    schemaVersion: 1, viewport: { x: 0, y: 0, zoom: .55 }, drawings: [], edges: [], nodes: [{
      id: "obstacle", type: "workflow", position: { x: 1300, y: 1300 }, style: { width: 340, height: 210 },
      data: { nodeType: "prompt", label: "保留原节点", inputs: [], outputs: [{ id: "prompt", kind: "text", label: "文字" }], parts: [] },
    }],
  } as CanvasDocument };
  const counts = { outbound: 0, paid: 0, unexpectedMutations: 0, uploads: 0, claims: 0, imports: 0 };
  const errors: string[] = [], assets: AssetView[] = [], drops: MaterialDropEventView[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.route("**/*", async route => {
    const request = route.request(), url = new URL(request.url()), path = url.pathname, method = request.method();
    if (url.origin !== origin && !["data:", "blob:", "about:"].includes(url.protocol)) { counts.outbound++; return route.abort("blockedbyclient"); }
    if (!path.startsWith("/api/")) return route.continue();
    if (path === "/api/projects") return route.fulfill({ json: { projects: [{ id, title: canvas.title, nodeCount: canvas.graph.nodes.length, createdAt: now, updatedAt: now }] } });
    if (path === `/api/canvas/${id}`) {
      if (method === "PUT") {
        const body = request.postDataJSON() as { graph: CanvasDocument; expectedRevision: number };
        expect(body.expectedRevision).toBe(canvas.revision); canvas.graph = body.graph; canvas.revision++;
      }
      return route.fulfill({ json: canvas });
    }
    if (path === "/api/assets/upload" && method === "POST") {
      counts.uploads++;
      const name = url.searchParams.get("name") ?? request.postDataBuffer()?.toString().match(/filename="([^"]+)"/u)?.[1];
      const source = files.find(file => file.name === name) ?? files[0]!;
      const asset = { ...source.asset, name: name ?? source.name };
      assets.push(asset); return route.fulfill({ status: 201, json: asset });
    }
    if (path === "/api/assets/import-source") {
      counts.imports++; const asset = files[1]!.asset; assets.push(asset);
      return route.fulfill({ json: { assets: [asset], failures: [] } });
    }
    if (path === "/api/integrations/material-drops") {
      if (method === "GET") return route.fulfill({ json: drops });
      const dropId = (request.postDataJSON() as { id: string }).id;
      const index = drops.findIndex(drop => drop.id === dropId), drop = drops.splice(index, 1)[0]!;
      if (method === "DELETE") return route.fulfill({ json: { ok: true } });
      counts.claims++; const asset = files.find(file => file.name === drop.name)!.asset; assets.push(asset);
      return route.fulfill({ json: asset });
    }
    if (path === "/api/assets") return route.fulfill({ json: assets });
    const file = files.find(item => path.startsWith(`/api/assets/${item.asset.id}`));
    if (file) return path === `/api/assets/${file.asset.id}`
      ? route.fulfill({ json: { ...file.asset, actualDimensions: { width: file.width, height: file.height } } })
      : route.fulfill({ contentType: "image/png", body: file.bytes });
    if (path === `/api/projects/${id}/archive`) return route.fulfill({ json: { archivedAssetIds: [] } });
    if (path === "/api/suppliers/catalog-upgrade") return route.fulfill({ json: { phase: "complete", updatedConnectionIds: [] } });
    if (path === "/api/runs" && method !== "GET" || path === "/api/agent/turn") { counts.paid++; return route.abort("blockedbyclient"); }
    if (method !== "GET" && method !== "HEAD") { counts.unexpectedMutations++; return route.abort("blockedbyclient"); }
    if (["/api/providers", "/api/suppliers", "/api/runs", "/api/agent/models", "/api/agent/sessions"].includes(path)) return route.fulfill({ json: [] });
    return route.fulfill({ json: { groups: [], items: [], runs: [], drops: [] } });
  });
  await page.goto(`/canvas/${id}`);
  await expect(page.locator('.react-flow__node[data-id="obstacle"]')).toBeVisible();
  const agent = page.getByRole("button", { name: "智能体面板", exact: true });
  if (await agent.getAttribute("aria-expanded") === "true") await agent.click();
  return { canvas, files, counts, errors, drops,
    drop: async (mixed = false) => {
      await page.locator(".react-flow__pane").evaluate((pane, input) => {
        const transfer = new DataTransfer();
        if (input.mixed) transfer.setData("text/html", `<img src="data:image/png;base64,${input.files[0]!.base64}"><img src="https://isolated-download.invalid/2.png">`);
        else for (const file of input.files) transfer.items.add(new File([Uint8Array.from(atob(file.base64), char => char.charCodeAt(0))], file.name, { type: "image/png" }));
        const bounds = pane.getBoundingClientRect();
        const options = { dataTransfer: transfer, bubbles: true, cancelable: true, clientX: bounds.left + 260, clientY: bounds.top + 260 };
        pane.dispatchEvent(new DragEvent("dragover", options)); pane.dispatchEvent(new DragEvent("drop", options));
      }, { mixed, files: files.map(file => ({ name: file.name, base64: file.bytes.toString("base64") })) });
    },
    imported: () => canvas.graph.nodes.filter(node => node.data.assetId),
    check: () => { expect(counts).toMatchObject({ outbound: 0, paid: 0, unexpectedMutations: 0 }); expect(errors).toEqual([]); },
  };
}

function expectClear(nodes: readonly CanvasNode[]) {
  nodes.forEach((a, index) => nodes.slice(index + 1).forEach(b => {
    const aw = Number(a.style?.width ?? 300), ah = Number(a.style?.height ?? 230), bw = Number(b.style?.width ?? 300), bh = Number(b.style?.height ?? 230);
    expect(a.position.x + aw + 23 <= b.position.x || b.position.x + bw + 23 <= a.position.x ||
      a.position.y + ah + 23 <= b.position.y || b.position.y + bh + 23 <= a.position.y).toBe(true);
  }));
}

test("多文件拖入按文件名自然排序成三列网格，加载尺寸后无重叠且一次撤销全部导入", async ({ page, baseURL }) => {
  const f = await fixture(page, new URL(baseURL!).origin);
  await f.drop();
  await expect.poll(() => f.imported().length).toBe(6);
  await expect(page.locator(".react-flow__node.selected")).toHaveCount(6);
  const ordered = [...f.imported()].sort((a, b) => a.position.y - b.position.y || a.position.x - b.position.x);
  expect(ordered.map(node => node.data.label)).toEqual(["1.png", "2.png", "3.png", "4.png", "6.png", "10.png"]);
  expect(new Set(ordered.slice(0, 3).map(node => node.position.y)).size).toBe(1);
  expect(ordered[3]!.position.y).toBeGreaterThan(ordered[0]!.position.y);
  expectClear(f.canvas.graph.nodes);
  await mkdir(screenshotDirectory, { recursive: true });
  await page.screenshot({ path: resolve(screenshotDirectory, "imports-grid-after.png") });
  const positions = f.imported().map(node => ({ id: node.id, position: node.position, style: node.style }));
  await page.reload();
  await expect(page.locator(".react-flow__node")).toHaveCount(7);
  expect(f.imported().map(node => ({ id: node.id, position: node.position, style: node.style }))).toEqual(positions);
  f.check();
});

test("图像预解码不可用时，预览加载使卡片变高仍保持同批各行不重叠", async ({ page, baseURL }) => {
  const f = await fixture(page, new URL(baseURL!).origin, { fallbackDimensions: true, order: "connection" });
  await f.drop();
  await expect.poll(() => f.imported().length).toBe(6);
  await expect.poll(() => f.imported().filter(node => Number(node.style?.height) > 600).length).toBe(3);
  expectClear(f.canvas.graph.nodes);
  expect([...f.imported()].sort((a, b) => a.position.y - b.position.y || a.position.x - b.position.x).map(node => node.data.label))
    .toEqual(["10.png", "2.png", "1.png", "6.png", "4.png", "3.png"]);
  await page.getByRole("button", { name: "撤销", exact: true }).click();
  await expect(page.locator(".react-flow__node")).toHaveCount(1);
  await page.getByRole("button", { name: "重做", exact: true }).click();
  await expect(page.locator(".react-flow__node")).toHaveCount(7);
  f.check();
});

test("网页下载素材与内嵌本地图片组成同一网格并只占一个撤销检查点", async ({ page, baseURL }) => {
  const f = await fixture(page, new URL(baseURL!).origin);
  await f.drop(true);
  await expect.poll(() => f.imported().length).toBe(2);
  await expect(page.locator(".react-flow__node.selected")).toHaveCount(2);
  const nodes = f.imported(); expect(nodes[0]!.position.y).toBe(nodes[1]!.position.y); expectClear(f.canvas.graph.nodes);
  await page.getByRole("button", { name: "撤销", exact: true }).click();
  await expect(page.locator(".react-flow__node")).toHaveCount(1);
  expect(f.counts).toMatchObject({ imports: 1, uploads: 1 }); f.check();
});

test("同一轮询与1.5秒内同落点的桥接素材延续网格且共用一次撤销", async ({ page, baseURL }) => {
  const f = await fixture(page, new URL(baseURL!).origin);
  const enqueue = (index: number) => f.drops.push({ id: `bridge-grid-${index}`, name: f.files[index]!.name,
    mimeType: "image/png", size: f.files[index]!.bytes.length, screenX: -10_000, screenY: -10_000, previewAvailable: false, createdAt: now });
  enqueue(0); enqueue(1);
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect.poll(() => f.counts.claims).toBe(2);
  enqueue(2);
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect.poll(() => f.imported().length).toBe(3);
  await expect(page.locator(".react-flow__node.selected")).toHaveCount(3);
  expectClear(f.canvas.graph.nodes);
  await page.getByRole("button", { name: "撤销", exact: true }).click();
  await expect(page.locator(".react-flow__node")).toHaveCount(1);
  f.check();
});
