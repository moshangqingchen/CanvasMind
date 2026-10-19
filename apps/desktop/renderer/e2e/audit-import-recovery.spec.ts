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
