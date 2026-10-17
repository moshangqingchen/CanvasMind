import { idleCatalogCheckFixture } from "./helpers/catalog-check-fixture";
import { expect, test, type Page } from "./helpers/canvas-offline-test";
import type { AssetView, CanvasDocument } from "../components/types";
import { clickBlankCanvas } from "./canvas-test-actions";

const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");
type ImportHistoryWindow = typeof window & { __importHistorySuccesses: string[] };

async function fixture(page: Page, origin: string) {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.addInitScript(() => {
    localStorage.setItem("super-canvas:inspector-open", "false");
    const w = window as ImportHistoryWindow;
    w.__importHistorySuccesses = [];
    document.addEventListener("DOMContentLoaded", () => {
      // Keep only bounded strings, never toast DOM, responses or graph objects.
      const observer = new MutationObserver(() => {
        for (const element of document.querySelectorAll(".toast-success")) {
          const text = element.textContent ?? "";
          if (!w.__importHistorySuccesses.includes(text)) w.__importHistorySuccesses.push(text);
        }
        w.__importHistorySuccesses.splice(0, Math.max(0, w.__importHistorySuccesses.length - 20));
      });
      observer.observe(document.body, { subtree: true, childList: true, characterData: true });
      window.addEventListener("pagehide", () => observer.disconnect(), { once: true });
    }, { once: true });
  });
  const id = "pending-import-history-isolated", now = "2026-10-15T00:00:00.000Z";
  const canvas: { id: string; title: string; revision: number; graph: CanvasDocument } = {
    id, title: "导入中撤销重做回归", revision: 1,
    graph: { schemaVersion: 1, viewport: { x: 0, y: 0, zoom: .75 }, edges: [], drawings: [], nodes: [{
      id: "existing-prompt", type: "workflow", position: { x: 120, y: 160 }, style: { width: 320, height: 200 },
      data: { nodeType: "prompt", label: "原提示词", parts: [{ type: "text", text: "撤销重做不能丢失导入任务" }],
        inputs: [], outputs: [{ id: "prompt", kind: "text", label: "提示词" }] },
    }] },
  };
  const asset: AssetView = { id: "pending-history-image", name: "pending-history.png", kind: "image", mimeType: "image/png",
    storageKey: "isolated-test/pending-history.png", size: png.length, metadata: { source: "upload", width: 1, height: 1 }, createdAt: now };
  const assets: AssetView[] = [];
  const counts = { outbound: 0, paid: 0, unexpectedMutations: 0, uploadStarted: 0, uploadFinished: 0, archive: 0, saves: 0 };
  const errors: string[] = [], warnings: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (["error", "warning"].includes(message.type())) warnings.push(message.text()); });
  let releaseUpload = () => {};
  const heldUpload = new Promise<void>(resolve => { releaseUpload = resolve; });
  await page.route("**/*", async route => {
    const request = route.request(), url = new URL(request.url());
    if (url.origin !== origin && !["data:", "blob:", "about:"].includes(url.protocol)) {
      counts.outbound++; return route.abort("blockedbyclient");
    }
    const path = url.pathname, method = request.method();
    if (!path.startsWith("/api/")) return route.continue();
    if (path === "/api/projects") return route.fulfill({ json: { projects: [{ id, title: canvas.title,
      nodeCount: canvas.graph.nodes.length, createdAt: now, updatedAt: now }] } });
    if (path === `/api/canvas/${id}`) {
      if (method === "PUT") {
        const body = request.postDataJSON() as { graph: CanvasDocument; title?: string; expectedRevision?: number };
        expect(body.expectedRevision).toBe(canvas.revision);
        canvas.graph = body.graph; canvas.title = body.title ?? canvas.title; canvas.revision++; counts.saves++;
      }
      return route.fulfill({ json: canvas });
    }
    if (path === "/api/assets/upload" && method === "POST") {
      counts.uploadStarted++;
      await heldUpload;
      assets.push(asset);
      await route.fulfill({ status: 201, json: { ...asset, url: `/api/assets/${asset.id}/content` } });
      counts.uploadFinished++;
      return;
    }
    if (path === "/api/assets") return route.fulfill({ json: assets });
    if (path === `/api/assets/${asset.id}`) return route.fulfill({ json: { ...asset, actualDimensions: { width: 1, height: 1 } } });
    if (path.startsWith(`/api/assets/${asset.id}/`)) return route.fulfill({ contentType: "image/png", body: png });
    if (path === `/api/projects/${id}/archive`) { counts.archive++; return route.fulfill({ json: { archivedAssetIds: [asset.id] } }); }
    if (path === "/api/suppliers/catalog-upgrade") return route.fulfill({ json: idleCatalogCheckFixture() });
    if (path === "/api/runs" && method !== "GET" || path === "/api/agent/turn") {
      counts.paid++; return route.abort("blockedbyclient");
    }
    if (method !== "GET" && method !== "HEAD") { counts.unexpectedMutations++; return route.abort("blockedbyclient"); }
    if (["/api/providers", "/api/suppliers", "/api/runs", "/api/agent/models", "/api/agent/sessions"].includes(path))
      return route.fulfill({ json: [] });
    if (path.endsWith("/chat")) return route.fulfill({ json: { messages: [] } });
    return route.fulfill({ json: { groups: [], items: [], runs: [], drops: [] } });
  });
  await page.goto(`/canvas/${id}`);
  await expect(page.locator('.react-flow__node[data-id="existing-prompt"]')).toBeVisible();
  const agent = page.getByRole("button", { name: "智能体面板", exact: true });
  if (await agent.getAttribute("aria-expanded") === "true") await agent.click();
  const actions = page.locator('[data-canvas-island="actions"]');
  const pending = page.locator('.react-flow__node[data-id^="pending-import-"]');
  return {
    canvas, asset, counts, pending, releaseUpload,
    undo: actions.getByRole("button", { name: "撤销", exact: true }),
    redo: actions.getByRole("button", { name: "重做", exact: true }),
    successes: () => page.evaluate(() => (window as ImportHistoryWindow).__importHistorySuccesses),
    startImport: async () => {
      await clickBlankCanvas(page);
      await page.evaluate(encoded => {
        const bytes = Uint8Array.from(atob(encoded), value => value.charCodeAt(0));
        const clipboardData = new DataTransfer();
        clipboardData.items.add(new File([bytes], "pending-history.png", { type: "image/png" }));
        document.dispatchEvent(new ClipboardEvent("paste", { clipboardData, bubbles: true, cancelable: true }));
      }, png.toString("base64"));
      await expect.poll(() => counts.uploadStarted).toBe(1);
      await expect(pending).toHaveCount(1);
      return (await pending.getAttribute("data-id"))!;
    },
    check: () => {
      expect(counts).toMatchObject({ outbound: 0, paid: 0, unexpectedMutations: 0, uploadStarted: 1, uploadFinished: 1 });
      expect(errors).toEqual([]); expect(warnings).toEqual([]);
    },
  };
}

test("后台导入跨Undo/Redo保留原占位ID，完成后同ID替换并保存素材", async ({ page, baseURL }) => {
  test.setTimeout(45_000);
  const f = await fixture(page, new URL(baseURL ?? "http://127.0.0.1:3211").origin);
  try {
    await page.getByRole("button", { name: "新建提示词节点", exact: true }).click();
    const added = page.locator('.react-flow__node[data-id^="prompt-"]');
    await expect(added).toHaveCount(1);
    const addedId = (await added.getAttribute("data-id"))!;
    await expect.poll(() => f.canvas.graph.nodes.some(node => node.id === addedId)).toBe(true);
    const importId = await f.startImport();
    const originalPreview = await f.pending.locator("img").getAttribute("src");
    expect(originalPreview).toMatch(/^blob:/u);
    // The import checkpoint and the earlier real node edit are two history
    // steps; neither may remove the independent asynchronous placeholder.
    await f.undo.click();
    await expect(f.pending).toHaveAttribute("data-id", importId);
    await expect(added).toHaveCount(1);
    await f.undo.click();
    await expect(added).toHaveCount(0);
    await expect(f.pending).toHaveAttribute("data-id", importId);
    await expect(f.pending.locator("img")).toHaveAttribute("src", originalPreview!);
    await f.redo.click();
    await expect(added).toHaveCount(1);
    await expect(f.pending).toHaveAttribute("data-id", importId);
    await f.redo.click();
    await expect(f.pending).toHaveAttribute("data-id", importId);
    expect(f.canvas.graph.nodes.some(node => node.data.pendingImport)).toBe(false);
    f.releaseUpload();
    const imported = page.locator(`.react-flow__node[data-id="${importId}"]`);
    await expect(imported.locator(".node-card")).not.toHaveAttribute("data-pending-import", "true");
    await expect(imported.locator("img")).toHaveAttribute("src", /\/api\/assets\/pending-history-image\/(?:content|preview)/u);
    await expect.poll(() => f.canvas.graph.nodes.find(node => node.id === importId)?.data.assetId).toBe(f.asset.id);
    expect(f.canvas.graph.nodes.filter(node => node.data.assetId === f.asset.id)).toHaveLength(1);
    expect(f.canvas.graph.nodes.some(node => node.id === addedId)).toBe(true);
    await expect.poll(f.successes).toContainEqual(expect.stringContaining("已完成 1 张剪贴板图片导入"));
    f.check();
  } finally { f.releaseUpload(); }
});

test("显式删除导入占位后Undo/Redo与晚完成均不复活，也不提示导入成功", async ({ page, baseURL }) => {
  test.setTimeout(45_000);
  const f = await fixture(page, new URL(baseURL ?? "http://127.0.0.1:3211").origin);
  try {
    const importId = await f.startImport();
    await f.pending.locator(".node-title").click({ button: "right" });
    await page.getByRole("menu", { name: "pending-history.png 的操作", exact: true })
      .getByRole("menuitem", { name: /^删除节点/u }).click();
    await expect(f.pending).toHaveCount(0);
    await f.undo.click();
    await expect(f.pending).toHaveCount(0);
    await f.redo.click();
    await expect(f.pending).toHaveCount(0);
    const response = page.waitForResponse(value => new URL(value.url()).pathname === "/api/assets/upload");
    f.releaseUpload();
    await (await response).finished();
    await expect.poll(() => f.counts.archive).toBe(1);
    await page.getByRole("button", { name: "打开节点与素材库", exact: true }).click();
    // The upload really completed and is available in the library; the user's
    // deleted canvas placeholder must still remain absent.
    await expect(page.locator(".asset-name", { hasText: "pending-history.png" })).toBeVisible();
    await expect(page.locator(`.react-flow__node[data-id="${importId}"]`)).toHaveCount(0);
    expect(f.canvas.graph.nodes.map(node => node.id)).toEqual(["existing-prompt"]);
    expect((await f.successes()).some(text => /已完成.*剪贴板图片导入/u.test(text))).toBe(false);
    f.check();
  } finally { f.releaseUpload(); }
});
