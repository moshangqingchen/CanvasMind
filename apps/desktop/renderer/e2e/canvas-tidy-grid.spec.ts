import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { expect, test, type Page } from "@playwright/test";
import type { AssetView, CanvasDocument, CanvasNode } from "../components/types";
import { CANVAS_ARRANGEMENT_ORDER_KEY } from "../lib/canvas-arrangement";
import { clickBlankCanvas } from "./canvas-test-actions";

const screenshots = fileURLToPath(new URL("../../../../.codex-logs/2026-10-16-canvas-layout/screenshots/", import.meta.url));
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");
const connectionOrder = [7, 2, 9, 1, 5, 10, 3, 8, 6, 4];
const positions = (graph: CanvasDocument) => Object.fromEntries(graph.nodes.map(node => [node.id, node.position]));
const sourceIds = Array.from({ length: 10 }, (_, index) => `tidy-asset-${index + 1}`);

async function fixture(page: Page, origin: string) {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.addInitScript(() => {
    localStorage.setItem("super-canvas:inspector-open", "false");
  });
  const id = "isolated-tidy-input-grid", now = "2026-10-16T00:00:00.000Z";
  const assets: AssetView[] = sourceIds.map((sourceId, index) => ({ id: `${sourceId}-image`, name: `${index + 1}.png`,
    kind: "image", mimeType: "image/png", size: png.length, storageKey: `isolated/${index + 1}.png`,
    metadata: { width: 1, height: 1 }, createdAt: now }));
  const sources: CanvasNode[] = sourceIds.map((sourceId, index) => ({ id: sourceId, type: "workflow",
    position: { x: 80, y: 80 + index * 280 }, style: { width: 240, height: 240 },
    data: { nodeType: "asset-input", label: `${index + 1}.png`, assetId: assets[index]!.id, assetKind: "image",
      inputs: [], outputs: [{ id: "asset", kind: "image", label: "图片" }] } }));
  const canvas: { id: string; title: string; revision: number; graph: CanvasDocument } = {
    id, title: "十张参考图整理网格", revision: 1,
    graph: { schemaVersion: 1, viewport: { x: 0, y: 0, zoom: .5 }, nodes: [...sources,
      { id: "tidy-target", type: "workflow", position: { x: 800, y: 1200 }, style: { width: 376, height: 272 },
        data: { nodeType: "image-generation", label: "图片生成", provider: "fake", connectionId: "fake-default", model: "fake-image-v1",
          inputs: [{ id: "prompt", kind: "text", label: "提示词" }, { id: "references", kind: "image[]", label: "参考图", multiple: true }],
          outputs: [{ id: "images", kind: "image", label: "图片" }], parts: [], parameters: { size: "1024x1024", quality: "auto" } } }],
    edges: connectionOrder.map(index => ({ id: `tidy-edge-${index}`, source: `tidy-asset-${index}`, sourceHandle: "asset",
      target: "tidy-target", targetHandle: "references", type: "smoothstep" })) },
  };
  const counts = { outbound: 0, generation: 0, unexpectedMutations: 0, saves: 0 };
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.route("**/*", async route => {
    const request = route.request(), url = new URL(request.url()), path = url.pathname, method = request.method();
    if (url.origin !== origin && !["data:", "blob:", "about:"].includes(url.protocol)) {
      counts.outbound++; return route.abort("blockedbyclient");
    }
    if (!path.startsWith("/api/")) return route.continue();
    if (path === `/api/canvas/${id}`) {
      if (method === "PUT") {
        const body = request.postDataJSON() as { graph: CanvasDocument; title?: string; expectedRevision?: number };
        expect(body.expectedRevision).toBe(canvas.revision);
        canvas.graph = body.graph; canvas.title = body.title ?? canvas.title; canvas.revision++; counts.saves++;
      }
      return route.fulfill({ json: canvas });
    }
    if (path === "/api/projects") return route.fulfill({ json: { projects: [{ id, title: canvas.title, nodeCount: canvas.graph.nodes.length, createdAt: now, updatedAt: now }] } });
    if (path === "/api/assets") return route.fulfill({ json: assets });
    const asset = assets.find(item => path.startsWith(`/api/assets/${item.id}`));
    if (asset) return path === `/api/assets/${asset.id}`
      ? route.fulfill({ json: { ...asset, actualDimensions: { width: 1, height: 1 } } })
      : route.fulfill({ contentType: "image/png", body: png });
    if (path === "/api/suppliers/catalog-upgrade") return route.fulfill({ json: { phase: "complete", updatedConnectionIds: [] } });
    if ((path === "/api/runs" && method !== "GET") || path === "/api/agent/turn") {
      counts.generation++; return route.abort("blockedbyclient");
    }
    if (method !== "GET" && method !== "HEAD") { counts.unexpectedMutations++; return route.abort("blockedbyclient"); }
    if (["/api/providers", "/api/suppliers", "/api/runs", "/api/agent/models", "/api/agent/sessions", "/api/integrations/material-drops"].includes(path)) return route.fulfill({ json: [] });
    if (path.endsWith("/chat")) return route.fulfill({ json: { messages: [] } });
    return route.fulfill({ json: { groups: [], items: [], runs: [], drops: [] } });
  });
  await page.goto(`/canvas/${id}`);
  await expect(page.locator(".react-flow__node")).toHaveCount(11);
  await page.getByRole("button", { name: "Fit View", exact: true }).click();
  await page.waitForTimeout(1200);
  return { canvas, counts, errors, tidy: page.getByRole("button", { name: "一键整理画布", exact: true }) };
}

async function assertGrid(page: Page, graph: CanvasDocument, expectedOrder: number[]) {
  const nodes = graph.nodes.filter(node => sourceIds.includes(node.id));
  const ordered = [...nodes].sort((a, b) => a.position.y - b.position.y || a.position.x - b.position.x);
  expect(ordered.map(node => node.id)).toEqual(expectedOrder.map(index => `tidy-asset-${index}`));
  expect(new Set(nodes.map(node => node.position.x)).size).toBe(4);
  expect(new Set(nodes.map(node => node.position.y)).size).toBe(3);
  for (let index = 1; index < ordered.length; index++) {
    if (index % 4) expect(ordered[index]!.position.y).toBe(ordered[index - 1]!.position.y);
    else expect(ordered[index]!.position.y).toBeGreaterThan(ordered[index - 1]!.position.y);
  }
  const bounds = await page.locator(".react-flow__node").evaluateAll(elements => elements.map(element => {
    const box = element.getBoundingClientRect();
    return { id: (element as HTMLElement).dataset.id, x: box.x, y: box.y, width: box.width, height: box.height };
  }));
  for (let a = 0; a < bounds.length; a++) for (let b = a + 1; b < bounds.length; b++) {
    const first = bounds[a]!, second = bounds[b]!;
    expect(first.x + first.width <= second.x + .5 || second.x + second.width <= first.x + .5 ||
      first.y + first.height <= second.y + .5 || second.y + second.height <= first.y + .5, `${first.id} overlaps ${second.id}`).toBe(true);
  }
}

test.use({ viewport: { width: 1800, height: 1100 } });

test("十个扇入素材行优先网格化，切换顺序与快捷键共用偏好，撤销和重开保持位置", async ({ page, baseURL }) => {
  test.setTimeout(60_000);
  const f = await fixture(page, new URL(baseURL ?? "http://127.0.0.1:3211").origin);
  await mkdir(screenshots, { recursive: true });
  const before = positions(f.canvas.graph);
  const edges = structuredClone(f.canvas.graph.edges);
  await page.screenshot({ path: `${screenshots}/tidy-grid-before.png` });
  await page.getByRole("button", { name: "排列顺序", exact: true }).click();
  await expect(page.getByRole("menuitemradio", { name: /按文件名称$/u })).toHaveAttribute("aria-checked", "true");
  await page.keyboard.press("Escape");
  await f.tidy.click();
  await expect(page.locator(".canvas-wrap")).not.toHaveClass(/is-layout-animating/);
  await expect.poll(() => positions(f.canvas.graph)).not.toEqual(before);
  await assertGrid(page, f.canvas.graph, Array.from({ length: 10 }, (_, index) => index + 1));
  expect(f.canvas.graph.edges).toEqual(edges);
  const named = positions(f.canvas.graph);
  await page.screenshot({ path: `${screenshots}/tidy-grid-after-filename.png` });
  await page.getByRole("button", { name: "排列顺序", exact: true }).click();
  await page.getByRole("menuitemradio", { name: "按连线顺序", exact: true }).click();
  await expect.poll(() => page.evaluate(key => localStorage.getItem(key), CANVAS_ARRANGEMENT_ORDER_KEY)).toBe("connection");
  await clickBlankCanvas(page);
  await page.keyboard.press("o");
  await expect.poll(() => positions(f.canvas.graph)).not.toEqual(named);
  await assertGrid(page, f.canvas.graph, connectionOrder);
  const connected = positions(f.canvas.graph);
  await page.screenshot({ path: `${screenshots}/tidy-grid-after-connection.png` });
  await clickBlankCanvas(page);
  await page.keyboard.press("Control+z");
  await expect.poll(() => positions(f.canvas.graph)).toEqual(named);
  await page.keyboard.press("Control+Shift+z");
  await expect.poll(() => positions(f.canvas.graph)).toEqual(connected);
  await page.reload();
  await expect(page.locator(".react-flow__node")).toHaveCount(11);
  await page.getByRole("button", { name: "排列顺序", exact: true }).click();
  await expect(page.getByRole("menuitemradio", { name: /按连线顺序$/u })).toHaveAttribute("aria-checked", "true");
  expect(positions(f.canvas.graph)).toEqual(connected);
  expect(f.canvas.graph.edges).toEqual(edges);
  expect(f.counts).toMatchObject({ outbound: 0, generation: 0, unexpectedMutations: 0 });
  expect(f.errors).toEqual([]);
  await expect(page.locator(".toast-error")).toHaveCount(0);
});
