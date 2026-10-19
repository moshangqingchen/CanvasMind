import { expect, test } from "./helpers/canvas-offline-test";
import { createPortableProjectPackage } from "../lib/project-transfer";
import type { CanvasDocument } from "../components/types";
import type { APIRequestContext, Page } from "@playwright/test";

const originalBytes = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");
async function importFixture(page: Page, request: APIRequestContext) {
  const title = `同名原项目-${crypto.randomUUID()}`;
  const source = await (await request.post("/api/projects", { data: { title } })).json();
  const target = await (await request.post("/api/projects", { data: { title: `目标-${crypto.randomUUID()}` } })).json();
  const graph: CanvasDocument = { schemaVersion: 1, nodes: [{ id: "before-import", type: "workflow", position: { x: 80, y: 80 },
    data: { nodeType: "prompt", label: "初始化完成", parts: [{ type: "text", text: "original target" }], outputs: [{ id: "prompt", kind: "text", label: "提示词" }] } }],
    edges: [], viewport: { x: 0, y: 0, zoom: 1 } };
  expect((await request.put(`/api/canvas/${target.project.id}`, { data: { graph } })).ok()).toBe(true);
  await page.goto(`/canvas/${target.project.id}`);
  await expect(page.locator('[data-id="before-import"]')).toBeVisible();
  const bundle = await createPortableProjectPackage({ title, graph: { ...graph, nodes: [{ id: "same-name-package", type: "workflow", position: { x: 80, y: 80 },
    data: { nodeType: "asset-input", label: "原图", assetId: "package-original", assetKind: "image", outputs: [{ id: "asset", kind: "image", label: "图片" }] } }] },
    assets: [{ id: "package-original", name: "reference.png", kind: "image", mimeType: "image/png", size: originalBytes.length,
      storageKey: "fixture", metadata: {}, createdAt: new Date().toISOString() }], fetchAsset: async () => new Response(originalBytes) });
  const open = async () => {
    await page.locator('input[type="file"][accept*=".json"]').setInputFiles({ name: "duplicate.supercanvas", mimeType: "application/zip", buffer: Buffer.from(await bundle.arrayBuffer()) });
    const dialog = page.getByRole("dialog", { name: "确认替换当前画布" });
    await dialog.getByRole("checkbox").uncheck();
    return dialog;
  };
  return { title, source: source.project.id, target: target.project.id, graph, open };
}

test("导入同名项目包先选择后缀名称并保留有效素材引用", async ({ page, request }) => {
  const f = await importFixture(page, request);
  let generation = 0;
  page.on("request", event => { if (new URL(event.url()).pathname === "/api/runs" && event.method() === "POST") generation++; });
  const dialog = await f.open();
  await dialog.getByRole("button", { name: "替换当前画布", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByText(`完整项目已导入：“${f.title}（导入）”（1 个素材）`, { exact: true })).toBeVisible();
  const persisted = await (await request.get(`/api/canvas/${f.target}`)).json();
  expect(persisted.title).toBe(`${f.title}（导入）`);
  const asset = persisted.graph.nodes.find((node: { id: string }) => node.id === "same-name-package").data.assetId;
  expect(await (await request.get(`/api/assets/${asset}/content`)).body()).toEqual(originalBytes);
  expect((await (await request.get(`/api/canvas/${f.source}`)).json()).title).toBe(f.title);
  await page.reload();
  await expect(page.locator('[data-id="same-name-package"]')).toBeVisible();
  expect(generation).toBe(0);
});

test("导入名称竞态的明确409清理临时原件而不误报未知", async ({ page, request }) => {
  const f = await importFixture(page, request);
  const counts = { rejected: 0, generation: 0 };
  const cleanups: { deletedIds: string[]; skippedIds?: string[] }[] = [];
  page.on("response", response => {
    if (new URL(response.url()).pathname === "/api/assets/bulk-delete") void response.json().then(body => cleanups.push(body));
  });
  page.on("request", event => { if (new URL(event.url()).pathname === "/api/runs" && event.method() === "POST") counts.generation++; });
  await page.route(`**/api/canvas/${f.target}`, async route => {
    if (route.request().method() !== "PUT" || !route.request().postDataJSON()?.graph.nodes.some((node: { id: string }) => node.id === "same-name-package")) return route.continue();
    counts.rejected++;
    await route.fulfill({ status: 409, json: { code: "PROJECT_NAME_CONFLICT", error: "项目名称已存在，请换一个名称" } });
  });
  const dialog = await f.open();
  await dialog.getByRole("button", { name: "替换当前画布", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText("项目名称已存在，请换一个名称");
  await expect(dialog.getByRole("alert")).not.toContainText("导入结果未知");
  await expect.poll(() => cleanups.length).toBe(1);
  expect(cleanups[0]!.deletedIds).toHaveLength(1);
  expect((await request.get(`/api/assets/${cleanups[0]!.deletedIds[0]}/content`)).status()).toBe(404);
  expect((await (await request.get(`/api/canvas/${f.target}`)).json()).graph).toEqual(f.graph);
  expect(counts).toEqual({ rejected: 1, generation: 0 });
  await page.reload();
  await expect(page.locator('[data-id="before-import"]')).toBeVisible();
  await expect(page.locator('[data-id="same-name-package"]')).toHaveCount(0);
  expect(counts).toEqual({ rejected: 1, generation: 0 });
});

test("旧本地草稿引用已回滚素材时只拒绝一次并丢弃该草稿版本", async ({ page, request }) => {
  const f = await importFixture(page, request);
  const uploaded = await request.post("/api/assets/upload", { multipart: { file: { name: "rolled-back.png", mimeType: "image/png", buffer: originalBytes } } });
  expect(uploaded.status()).toBe(201);
  const asset = await uploaded.json();
  const cleaned = await request.post("/api/assets/bulk-delete", { data: { assetIds: [asset.id], onlyUnreferenced: true } });
  expect((await cleaned.json()).deletedIds).toEqual([asset.id]);
  const baseline = await (await request.get(`/api/canvas/${f.target}`)).json();
  let attempts = 0, generation = 0;
  page.on("request", incoming => {
    const path = new URL(incoming.url()).pathname;
    if (path === `/api/canvas/${f.target}` && incoming.method() === "PUT" && incoming.postDataJSON()?.graph.nodes.some((node: { id: string }) => node.id === "rejected-draft")) attempts++;
    if (path === "/api/runs" && incoming.method() === "POST") generation++;
  });
  const draft = { canvasId: f.target, title: baseline.title, baseRevision: baseline.revision, version: Date.now(),
    graph: { ...f.graph, nodes: [{ id: "rejected-draft", type: "workflow", position: { x: 80, y: 80 }, data: {
      nodeType: "asset-input", label: "已回滚素材", assetId: asset.id, assetKind: "image", outputs: [{ id: "asset", kind: "image", label: "图片" }],
    } }] } };
  await page.evaluate(async draft => {
    const session = sessionStorage.getItem("super-canvas-draft-session") ?? crypto.randomUUID();
    sessionStorage.setItem("super-canvas-draft-session", session);
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const open = indexedDB.open("super-canvas-drafts", 1);
      open.onupgradeneeded = () => open.result.createObjectStore("drafts");
      open.onsuccess = () => resolve(open.result); open.onerror = () => reject(open.error);
    });
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction("drafts", "readwrite");
      transaction.objectStore("drafts").put(draft, `${session}:${draft.canvasId}`);
      transaction.oncomplete = () => resolve(); transaction.onerror = () => reject(transaction.error);
    });
    database.close();
  }, draft);
  await page.reload();
  await expect(page.getByText(/素材 .* 已由未引用回滚清理，无法保存/u).first()).toBeVisible();
  expect(attempts).toBe(1);
  await page.reload();
  await expect(page.locator('[data-id="before-import"]')).toBeVisible();
  await expect(page.locator('[data-id="rejected-draft"]')).toHaveCount(0);
  expect(attempts).toBe(1);
  expect(generation).toBe(0);
});

test("导入拒绝后草稿恢复写入失败时保留临时原件", async ({ page, request }) => {
  const f = await importFixture(page, request);
  const counts = { cleanup: 0, generation: 0, rejected: 0 };
  const uploaded: string[] = [];
  page.on("request", event => {
    const path = new URL(event.url()).pathname;
    if (path === "/api/assets/bulk-delete") counts.cleanup++;
    if (path === "/api/runs" && event.method() === "POST") counts.generation++;
  });
  page.on("response", response => {
    if (new URL(response.url()).pathname === "/api/assets/upload" && response.status() === 201)
      void response.json().then(asset => uploaded.push(asset.id));
  });
  await page.route(`**/api/canvas/${f.target}`, async route => {
    if (route.request().method() !== "PUT" || !route.request().postDataJSON()?.graph.nodes.some((node: { id: string }) => node.id === "same-name-package")) return route.continue();
    counts.rejected++;
    await page.evaluate(() => {
      const put = IDBObjectStore.prototype.put;
      IDBObjectStore.prototype.put = function(value, key) {
        if (value?.graph?.nodes?.some((node: { id: string }) => node.id === "before-import"))
          throw new DOMException("isolated draft storage failure", "QuotaExceededError");
        return put.call(this, value, key);
      };
    });
    await route.fulfill({ status: 409, json: { code: "PROJECT_NAME_CONFLICT", error: "项目名称已存在，请换一个名称" } });
  });
  const dialog = await f.open();
  await dialog.getByRole("button", { name: "替换当前画布", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText("本地草稿未能确认，素材已保留");
  await expect.poll(() => uploaded.length).toBe(1);
  expect(await (await request.get(`/api/assets/${uploaded[0]}/content`)).body()).toEqual(originalBytes);
  expect(counts).toEqual({ cleanup: 0, generation: 0, rejected: 1 });
});

test("完整项目 PUT 已保存但正文损坏时保留原文件与画布引用", async ({ page, request }) => {
  const bytes = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");
  const created = await request.post("/api/projects", { data: { title: `导入响应隔离-${Date.now()}` } });
  expect(created.status()).toBe(201);
  const { project } = await created.json();
  const initialized = await request.put(`/api/canvas/${project.id}`, { data: { graph: { schemaVersion: 1,
    nodes: [{ id: "before-import", type: "workflow", position: { x: 80, y: 80 }, data: { nodeType: "prompt", label: "初始化完成",
      parts: [{ type: "text", text: "initial fixture" }], outputs: [{ id: "prompt", kind: "text", label: "提示词" }] } }],
    edges: [], viewport: { x: 0, y: 0, zoom: 1 },
  } } });
  expect(initialized.ok()).toBe(true);
  await page.goto(`/canvas/${project.id}`);
  await expect(page.locator('[data-id="before-import"]')).toBeVisible();
  const graph: CanvasDocument = { schemaVersion: 1, nodes: [{ id: "package-reference", type: "workflow", position: { x: 80, y: 80 },
    data: { nodeType: "asset-input", label: "原图", assetId: "original-id", assetKind: "image", outputs: [{ id: "asset", kind: "image", label: "图片" }] } }],
    edges: [], viewport: { x: 0, y: 0, zoom: 1 } };
  const bundle = await createPortableProjectPackage({ title: `导入包-${project.id}`, graph, assets: [{ id: "original-id", name: "reference.png",
    kind: "image", mimeType: "image/png", size: bytes.length, storageKey: "fixture", metadata: {}, createdAt: new Date().toISOString() }],
    fetchAsset: async () => new Response(bytes) });
  const counts = { committed: 0, cleanup: 0, generation: 0 };
  page.on("request", event => {
    if (new URL(event.url()).pathname === "/api/assets/bulk-delete") counts.cleanup++;
    if (new URL(event.url()).pathname === "/api/runs" && event.method() === "POST") counts.generation++;
  });
  await page.route(`**/api/canvas/${project.id}`, async route => {
    if (route.request().method() !== "PUT" || !route.request().postDataJSON()?.graph?.nodes?.some((node: { id: string }) => node.id === "package-reference")) return route.continue();
    const committed = await route.fetch();
    expect(committed.ok()).toBe(true);
    counts.committed++;
    await route.fulfill({ status: 200, body: "invalid-success-body", contentType: "application/json" });
  });
  await page.locator('input[type="file"][accept*=".json"]').setInputFiles({ name: "preserve.supercanvas", mimeType: "application/zip",
    buffer: Buffer.from(await bundle.arrayBuffer()) });
  const dialog = page.getByRole("dialog", { name: "确认替换当前画布" });
  await dialog.getByRole("checkbox").uncheck();
  await dialog.getByRole("button", { name: "替换当前画布", exact: true }).click();
  await expect(dialog.getByText(/导入结果未知，素材已保留/u)).toBeVisible();
  const persisted = await (await request.get(`/api/canvas/${project.id}`)).json();
  expect(persisted.graph.nodes, JSON.stringify({ counts, persisted })).toEqual(expect.arrayContaining([expect.objectContaining({ id: "package-reference" })]));
  const assetId = persisted.graph.nodes.find((node: { id: string }) => node.id === "package-reference").data.assetId;
  const original = await request.get(`/api/assets/${assetId}/content`);
  expect(original.ok()).toBe(true);
  expect(await original.body()).toEqual(bytes);
  expect(counts).toEqual({ committed: 2, cleanup: 0, generation: 0 });
  await page.reload();
  await expect(page.locator('[data-id="package-reference"]')).toBeVisible();
});
