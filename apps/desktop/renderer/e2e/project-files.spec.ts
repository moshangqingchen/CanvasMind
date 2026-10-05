import { randomUUID } from "node:crypto";
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");
type FileItem = { fileId: string; name: string; section: "draft" | "finished"; kind: string; subfolder: string; contentUrl: string; previewUrl: string };
type Asset = { id: string; name: string };
type SavedNode = { id: string; data: { nodeType?: string; assetId?: string } };

test.beforeAll(() => {
  expect(process.env.PLAYWRIGHT_BASE_URL, "项目文件测试必须使用 globalSetup 创建的隔离目录").toBeFalsy();
});

async function files(request: APIRequestContext, projectId: string): Promise<FileItem[]> {
  const response = await request.get(`/api/projects/${projectId}/files`);
  expect(response.ok()).toBeTruthy();
  return (await response.json()).files;
}

async function fixture(page: Page, request: APIRequestContext, withFinished = false) {
  const pageErrors: string[] = [];
  let submissions = 0;
  page.on("pageerror", error => pageErrors.push(error.message));
  await page.route(/\/api\/runs(?:\?.*)?$/, route => {
    if (route.request().method() === "POST") { submissions++; return route.abort(); }
    return route.continue();
  });
  const suffix = randomUUID();
  const create = async (side: string) => {
    const response = await request.post("/api/canvas", { data: { title: `项目文件${side}-${suffix}`, graph: {
      schemaVersion: 1, viewport: { x: 0, y: 0, zoom: 1 }, nodes: withFinished && side === "A" ? [{
        id: "fake-source", type: "workflow", position: { x: 80, y: 80 }, data: {
          nodeType: "image-generation", label: "隔离模拟成品", provider: "fake", connectionId: "fake-default", model: "fake-image-v1",
          fakeScenario: "sync", parts: [{ type: "text", text: "Internal PNG fixture only" }], parameters: { n: 1 },
          inputs: [], outputs: [{ id: "images", kind: "image", label: "图片" }],
        },
      }] : [], edges: [],
    } } });
    expect(response.ok()).toBeTruthy();
    return (await response.json()).id as string;
  };
  const a = await create("A"), b = await create("B");
  const assets: Asset[] = [];
  for (const name of ["alpha-project-file.png", "beta-project-file.png", "gamma-project-file.png", "foreign-project-file.png"]) {
    const response = await request.post("/api/assets/upload", { multipart: { file: { name, mimeType: "image/png", buffer: png } } });
    expect(response.status()).toBe(201);
    assets.push(await response.json());
  }
  for (const [projectId, assetIds] of [[a, assets.slice(0, 3).map(asset => asset.id)], [b, [assets[0]!.id, assets[3]!.id]]] as const) {
    const response = await request.post(`/api/projects/${projectId}/archive`, { data: { assetIds } });
    expect(response.ok()).toBeTruthy();
  }
  if (withFinished) {
    // The only allowed run is this fixed in-process fake provider. Page-origin
    // generation remains blocked, and no live supplier is configured here.
    const graph = (await (await request.get(`/api/canvas/${a}`)).json()).graph;
    expect(graph.nodes[0].data).toMatchObject({ provider: "fake", connectionId: "fake-default", model: "fake-image-v1" });
    const submitted = await request.post("/api/runs", { data: { canvasId: a, clientRequestId: `project-files-${suffix}`, scope: "node", nodeId: "fake-source" } });
    expect(submitted.status()).toBe(201);
    const runId = (await submitted.json()).run.id;
    await expect.poll(async () => (await (await request.get(`/api/runs/${runId}`)).json()).run.status).toBe("succeeded");
    const snapshot = await (await request.get(`/api/runs/${runId}`)).json();
    const outputId = snapshot.nodes.find((node: { nodeId: string }) => node.nodeId === "fake-source").outputAssetIds[0];
    const download = await request.get(`/api/assets/${outputId}/content?download=1`);
    expect(download.ok()).toBeTruthy();
    expect(download.headers()["content-type"]).toContain("image/png");
    expect(await download.body()).toEqual(png);
  }
  const aFiles = await files(request, a), bFiles = await files(request, b);
  expect(aFiles).toHaveLength(withFinished ? 5 : 3);
  expect(bFiles).toHaveLength(2);
  expect(aFiles.every(file => file.kind === "image")).toBe(true);
  expect(aFiles.filter(file => file.section === "finished")).toHaveLength(withFinished ? 1 : 0);
  const savedNodes = async (): Promise<SavedNode[]> => (await (await request.get(`/api/canvas/${a}`)).json()).graph.nodes;
  return { a, b, assets, aFiles, bFiles, savedNodes, safe: () => {
    expect(submissions).toBe(0);
    expect(pageErrors).toEqual([]);
  } };
}

test("项目文件默认成品缩略图、草稿平铺与预览，多选放入保存和删除仅作用于项目副本", async ({ page, request }, info) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 1440, height: 1000 });
  const f = await fixture(page, request, true);
  const projectImageRequests: URL[] = [];
  page.on("request", incoming => {
    const url = new URL(incoming.url());
    if (url.pathname === `/api/projects/${f.a}/files/content`) projectImageRequests.push(url);
  });
  const open = () => page.getByRole("button", { name: "项目文件", exact: true }).click();
  const panel = page.getByRole("dialog", { name: "项目文件", exact: true });
  const draftTab = panel.getByRole("tab", { name: /^草稿/u });
  const draftGrid = panel.locator('[aria-label="草稿文件列表"]');
  const alpha = f.aFiles.find(file => file.name.startsWith("alpha-project-file"))!;
  const beta = f.aFiles.find(file => file.name.startsWith("beta-project-file"))!;
  const finished = f.aFiles.find(file => file.section === "finished")!;
  try {
    await page.goto(`/canvas/${f.a}`);
    await open();
    await expect(panel.getByRole("tab", { name: /^成品/u })).toHaveAttribute("aria-selected", "true");
    const finishedCard = panel.locator(`article[data-file-id="${finished.fileId}"]`);
    await expect(panel.locator("article[data-file-id]")).toHaveCount(1);
    await expect(finishedCard.locator("img")).toHaveAttribute("src", finished.previewUrl);
    await expect.poll(() => finishedCard.locator("img").evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(1);
    expect(projectImageRequests.length).toBeGreaterThan(0);
    expect(projectImageRequests.every(url => url.searchParams.get("preview") === "640")).toBe(true);

    await finishedCard.getByRole("button", { name: `预览 ${finished.name}`, exact: true }).click();
    const preview = page.getByRole("dialog", { name: "项目文件预览", exact: true });
    await expect(preview.locator("img")).toHaveAttribute("src", finished.contentUrl);
    await expect.poll(() => preview.locator("img").evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(1);
    expect(projectImageRequests.some(url => url.searchParams.get("fileId") === finished.fileId && !url.searchParams.has("preview"))).toBe(true);
    await preview.getByRole("button", { name: "关闭文件预览", exact: true }).click();

    await draftTab.click();
    await expect(draftGrid.locator("article[data-file-id]")).toHaveCount(4);
    await expect.poll(() => draftGrid.locator("img").evaluateAll(images => images.every(image => (image as HTMLImageElement).naturalWidth === 1))).toBe(true);
    await page.screenshot({ path: info.outputPath("project-files-desktop.png") });
    await expect(panel.locator(`article[data-file-id="${f.bFiles.find(file => file.name.startsWith("foreign-project-file"))!.fileId}"]`)).toHaveCount(0);
    const search = panel.getByRole("searchbox", { name: "搜索项目文件", exact: true });
    await search.fill("alpha-project-file");
    await expect(draftGrid.locator("article[data-file-id]")).toHaveCount(1);
    await expect(draftGrid.locator(`article[data-file-id="${alpha.fileId}"]`)).toBeVisible();
    await search.fill("no-such-project-file");
    await expect(panel.getByText("没有找到匹配的文件", { exact: true })).toBeVisible();
    await search.fill("");
    await expect(draftGrid.locator("article[data-file-id]")).toHaveCount(4);
    await page.setViewportSize({ width: 390, height: 844 });
    await expect.poll(() => panel.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
    const bounds = (await panel.boundingBox())!;
    expect(bounds.x).toBeGreaterThanOrEqual(0);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(391);
    expect(await draftGrid.evaluate(element => getComputedStyle(element).gridTemplateColumns.split(" ").length)).toBe(2);
    await page.screenshot({ path: info.outputPath("project-files-narrow.png") });
    await page.setViewportSize({ width: 1440, height: 1000 });

    await panel.getByRole("checkbox", { name: `选择 ${alpha.name}`, exact: true }).check();
    await panel.getByRole("checkbox", { name: `选择 ${beta.name}`, exact: true }).check();
    const importedResponse = page.waitForResponse(response => new URL(response.url()).pathname === `/api/projects/${f.a}/files/import` && response.request().method() === "POST");
    await panel.getByRole("button", { name: "放入画布 (2)", exact: true }).click();
    const imported = await (await importedResponse).json();
    expect(imported.failed).toEqual([]);
    expect(imported.assets).toHaveLength(2);
    const importedIds = (imported.assets as Asset[]).map(asset => asset.id);
    await expect(panel).toHaveCount(0);
    await expect.poll(async () => (await f.savedNodes()).map(node => node.data.assetId).filter(Boolean)).toEqual(expect.arrayContaining(importedIds));
    const importedNodes = (await f.savedNodes()).filter(node => node.data.assetId && importedIds.includes(node.data.assetId));
    await page.reload();
    for (const node of importedNodes) await expect(page.locator(`.react-flow__node[data-id="${node.id}"] img`).first()).toBeVisible();
    await open(); await draftTab.click();
    await panel.getByRole("button", { name: `删除 ${alpha.name}`, exact: true }).click();
    const confirmSingle = page.getByRole("alertdialog", { name: "删除 1 个项目文件？", exact: true });
    await expect(confirmSingle).toContainText("已放入画布的素材保留");
    await confirmSingle.getByRole("button", { name: "确认删除", exact: true }).click();
    await expect(panel.locator(`article[data-file-id="${alpha.fileId}"]`)).toHaveCount(0);
    expect((await request.get(alpha.contentUrl)).ok()).toBe(false);
    expect((await request.get(`/api/assets/${f.assets[0]!.id}`)).ok()).toBeTruthy();
    expect(await (await request.get(`/api/assets/${f.assets[0]!.id}/content`)).body()).toEqual(png);

    const remaining = (await files(request, f.a)).filter(file => file.section === "draft");
    expect(remaining).toHaveLength(3);
    await panel.getByRole("checkbox", { name: "全选当前分类文件", exact: true }).check();
    await panel.getByRole("button", { name: `删除所选 (${remaining.length})`, exact: true }).click();
    await page.getByRole("alertdialog", { name: `删除 ${remaining.length} 个项目文件？`, exact: true }).getByRole("button", { name: "确认删除", exact: true }).click();
    await expect(panel.getByText("还没有草稿媒体", { exact: true })).toBeVisible();
    expect((await files(request, f.a)).map(file => file.fileId)).toEqual([finished.fileId]);
    await panel.getByRole("button", { name: "关闭项目文件", exact: true }).click();
    await page.reload();
    expect((await f.savedNodes()).map(node => node.data.assetId)).toEqual(expect.arrayContaining(importedIds));
    for (const id of importedIds) expect(await (await request.get(`/api/assets/${id}/content`)).body()).toEqual(png);
    expect((await files(request, f.b)).map(file => file.fileId).sort()).toEqual(f.bFiles.map(file => file.fileId).sort());
    const sharedOtherCopy = f.bFiles.find(file => file.name.startsWith("alpha-project-file"))!;
    expect(await (await request.get(sharedOtherCopy.contentUrl)).body()).toEqual(png);

    await page.goto(`/canvas/${f.b}`); await open();
    await expect(panel.getByRole("tab", { name: /^成品/u })).toHaveAttribute("aria-selected", "true");
    await expect(panel.getByText("还没有成品文件", { exact: true })).toBeVisible();
    await draftTab.click();
    await expect(draftGrid.locator("article[data-file-id]")).toHaveCount(2);
    for (const file of f.bFiles) await expect(draftGrid.locator(`article[data-file-id="${file.fileId}"]`)).toBeVisible();
  } finally { f.safe(); }
});

test("项目文件标识不能跨项目读取、导入或删除", async ({ page, request }) => {
  const f = await fixture(page, request);
  try {
    const foreign = f.bFiles.find(file => file.name.startsWith("foreign-project-file"))!;
    const deniedRead = await request.get(`/api/projects/${f.a}/files/content?fileId=${foreign.fileId}`);
    expect(deniedRead.ok()).toBe(false);
    for (const action of ["import", "delete"]) {
      const response = await request.post(`/api/projects/${f.a}/files/${action}`, { data: { fileIds: [foreign.fileId] } });
      expect(response.status()).toBe(action === "delete" ? 409 : 200);
      const result = await response.json();
      expect(action === "import" ? result.assets : result.deletedIds).toEqual([]);
      expect(result.failed).toEqual([expect.objectContaining({ fileId: foreign.fileId })]);
    }
    expect((await files(request, f.a)).map(file => file.fileId).sort()).toEqual(f.aFiles.map(file => file.fileId).sort());
    expect((await files(request, f.b)).map(file => file.fileId).sort()).toEqual(f.bFiles.map(file => file.fileId).sort());
    expect((await request.get(foreign.contentUrl)).ok()).toBeTruthy();
    expect(await f.savedNodes()).toEqual([]);
  } finally { f.safe(); }
});

test("批量删除分批提交，后批失败保留未确认文件与已成功结果", async ({ page, request }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const f = await fixture(page, request);
  const virtual = Array.from({ length: 101 }, (_, i) => {
    const fileId = (i + 1).toString(16).padStart(64, "0");
    const contentUrl = `/api/projects/${f.a}/files/content?fileId=${fileId}`;
    return { fileId, name: `batch-${String(i).padStart(3, "0")}.png`, kind: "image", mimeType: "image/png", size: png.length,
      modifiedAt: "2026-10-05T00:00:00.000Z", section: "draft", subfolder: "外界素材/图片", contentUrl,
      previewUrl: `${contentUrl}&preview=640`, canDelete: true };
  });
  const batches: string[][] = [];
  await page.route(`**/api/projects/${f.a}/files`, route => route.fulfill({ json: { files: virtual, ignoredFiles: 0 } }));
  await page.route(`**/api/projects/${f.a}/files/content?*`, route => route.fulfill({ contentType: "image/png", body: png }));
  await page.route(`**/api/projects/${f.a}/files/delete`, route => {
    const ids = route.request().postDataJSON().fileIds as string[];
    batches.push(ids);
    return batches.length === 1 ? route.fulfill({ json: { deletedIds: ids, failed: [] } })
      : route.fulfill({ status: 500, json: { error: "isolated second batch failure" } });
  });
  try {
    await page.goto(`/canvas/${f.a}`);
    await page.getByRole("button", { name: "项目文件", exact: true }).click();
    const panel = page.getByRole("dialog", { name: "项目文件", exact: true });
    await panel.getByRole("tab", { name: /^草稿/u }).click();
    await panel.getByRole("checkbox", { name: "全选当前分类文件", exact: true }).check();
    await panel.getByRole("button", { name: "删除所选 (101)", exact: true }).click();
    await page.getByRole("alertdialog", { name: "删除 101 个项目文件？", exact: true }).getByRole("button", { name: "确认删除", exact: true }).click();
    await expect(panel.getByRole("status")).toContainText("已删除 100 个项目文件");
    await expect(panel.getByRole("alert")).toContainText("1 个文件未确认删除");
    await expect(panel.locator("article[data-file-id]")).toHaveCount(1);
    await expect(panel.getByRole("checkbox", { name: `选择 ${virtual[100]!.name}`, exact: true })).toBeChecked();
    expect(batches.map(batch => batch.length)).toEqual([100, 1]);
    expect(new Set(batches.flat()).size).toBe(101);
    // Every deletion was mocked; the physical project fixtures are untouched.
    expect((await files(request, f.a)).map(file => file.fileId).sort()).toEqual(f.aFiles.map(file => file.fileId).sort());
  } finally { f.safe(); }
});

test("单独删除保留其他已选文件，取消不提交且409保留选择和具体原因", async ({ page, request }) => {
  const f = await fixture(page, request);
  const alpha = f.aFiles.find(file => file.name.startsWith("alpha-project-file"))!;
  const beta = f.aFiles.find(file => file.name.startsWith("beta-project-file"))!;
  const gamma = f.aFiles.find(file => file.name.startsWith("gamma-project-file"))!;
  const deleteRequests: string[][] = [];
  await page.route(`**/api/projects/${f.a}/files/delete`, route => {
    const ids = route.request().postDataJSON().fileIds as string[];
    deleteRequests.push(ids);
    return ids.length === 1 && ids[0] === gamma.fileId
      ? route.fulfill({ json: { deletedIds: ids, failed: [] } })
      : route.fulfill({ status: 409, json: { deletedIds: [], failed: ids.map(fileId => ({ fileId, message: "文件已发生变化，请刷新后重试" })) } });
  });
  try {
    await page.goto(`/canvas/${f.a}`);
    await page.getByRole("button", { name: "项目文件", exact: true }).click();
    const panel = page.getByRole("dialog", { name: "项目文件", exact: true });
    await panel.getByRole("tab", { name: /^草稿/u }).click();
    const alphaSelected = panel.getByRole("checkbox", { name: `选择 ${alpha.name}`, exact: true });
    const betaSelected = panel.getByRole("checkbox", { name: `选择 ${beta.name}`, exact: true });
    await alphaSelected.check();
    await betaSelected.check();

    const confirm = page.getByRole("alertdialog", { name: "删除 1 个项目文件？", exact: true });
    await panel.getByRole("button", { name: `删除 ${gamma.name}`, exact: true }).click();
    await confirm.getByRole("button", { name: "取消", exact: true }).click();
    await expect(confirm).toHaveCount(0);
    expect(deleteRequests).toEqual([]);
    await expect(alphaSelected).toBeChecked();
    await expect(betaSelected).toBeChecked();

    await panel.getByRole("button", { name: `删除 ${gamma.name}`, exact: true }).click();
    await confirm.getByRole("button", { name: "确认删除", exact: true }).click();
    await expect(panel.locator(`article[data-file-id="${gamma.fileId}"]`)).toHaveCount(0);
    await expect(panel.getByRole("status")).toContainText("已删除 1 个项目文件");
    await expect(alphaSelected).toBeChecked();
    await expect(betaSelected).toBeChecked();
    await expect(panel.getByRole("button", { name: "删除所选 (2)", exact: true })).toBeVisible();

    await panel.getByRole("button", { name: `删除 ${alpha.name}`, exact: true }).click();
    await confirm.getByRole("button", { name: "确认删除", exact: true }).click();
    await expect(panel.getByRole("alert")).toContainText("文件已发生变化，请刷新后重试");
    await expect(panel.locator(`article[data-file-id="${alpha.fileId}"]`)).toBeVisible();
    await expect(alphaSelected).toBeChecked();
    await expect(betaSelected).toBeChecked();
    expect(deleteRequests).toEqual([[gamma.fileId], [alpha.fileId]]);
    expect((await files(request, f.a)).map(file => file.fileId).sort()).toEqual(f.aFiles.map(file => file.fileId).sort());
    expect(await f.savedNodes()).toEqual([]);
  } finally { f.safe(); }
});
