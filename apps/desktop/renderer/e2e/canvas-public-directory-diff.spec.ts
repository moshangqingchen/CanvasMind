import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import type { ModelDescriptor } from "@super-canvas/providers";
import type { SupplierCatalogModel } from "../lib/client-suppliers";

const video = (id: string): ModelDescriptor => ({ id, name: id, operations: ["video.generate"], outputKinds: ["video"],
  metadata: { canvasRunnable: true, priceLabel: "¥0.62/秒" }, parameters: [
    { key: "resolution", label: "分辨率", control: "select", default: "720p", options: [{ label: "720p", value: "720p" }, { label: "1080p", value: "1080p" }] },
    { key: "duration", label: "时长（秒）", control: "number", valueType: "integer", default: 10, min: 1, max: 30 },
  ] });
const publicVideo = (id: string): SupplierCatalogModel => ({ id, name: id, capability: "video", outputKinds: ["video"],
  priceLabel: "480p ¥0.4/秒 · 720p ¥0.62/秒 · 1080p ¥1.45/秒", metadata: { secureSkillCatalogPricing: {
    kind: "tiered", currency: "CNY", billingUnit: "second", confidence: "exact", checkedAt: "2026-10-08T14:33:39.047Z",
    sourceUrl: "https://token.secure-skill.com/api/v1/pricing/channels",
    tiers: [["480p", .4], ["720p", .62], ["1080p", 1.45]].map(([resolution, price]) => ({ id: resolution, label: resolution, dimension: "resolution", value: resolution, price })),
  } } });

type DirectoryReadFailure = "stale" | "failed" | "partial" | "http503";
async function fixture(page: Page, request: APIRequestContext, nodeType: "video-generation" | "image-generation",
  keyModels: ModelDescriptor[], publicModels: SupplierCatalogModel[], failed: DirectoryReadFailure | false = false,
  reactiveScanUpdates = false) {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  let submissions = 0;
  let directoryReads = 0;
  let directoryMode = failed;
  let scanRevision = 0;
  await page.route("**/api/runs**", async route => {
    if (route.request().method() === "POST") { submissions++; await route.abort(); }
    else await route.continue();
  });
  await page.route("**/api/suppliers/catalog-upgrade", route => route.fulfill({ json: { revision: "isolated-directory-test", phase: "complete", total: 0, refreshed: 0, unavailable: 0, failed: 0, updatedConnectionIds: [] } }));
  const supplierResponse = await request.post("/api/suppliers", { data: { name: "目录差异隔离供应商", siteUrl: "https://directory-diff.invalid", apiUrl: "https://directory-diff.invalid" } });
  expect(supplierResponse.ok()).toBeTruthy();
  const supplier = await supplierResponse.json();
  const providerResponse = await request.post("/api/providers", { data: {
    name: "目录差异隔离 Key", provider: "rest", apiKey: "isolated-no-paid-generation",
    config: { supplierId: supplier.id, supplierSourceId: supplier.state?.sourceId, supplierKey: supplier.supplierKey,
      baseUrl: supplier.apiUrl, modelGroup: "exact-group", customGroup: true, usage: "canvas", defaultModel: keyModels[0]!.id,
      modelScanStatus: "live", scannedModelIds: keyModels.map(model => model.id), modelCatalogModels: keyModels,
      connector: { submit: { method: "POST", path: "/documented-media", bodyMode: "json" }, mappings: [], output: { path: "$.url", kind: nodeType === "video-generation" ? "video" : "image" }, models: keyModels } },
  } });
  expect(providerResponse.ok()).toBeTruthy();
  const connection = await providerResponse.json();
  if (reactiveScanUpdates) await page.route(/\/api\/providers(?:\?.*)?$/u, route => route.request().method() === "GET"
    ? route.fulfill({ json: [{ ...connection, config: { ...connection.config,
      modelScanRequestId: `isolated-scan-${scanRevision}`, modelScanStatus: "live", modelScanComplete: !directoryMode } }] })
    : route.continue());
  await page.route("**/api/suppliers", route => {
    directoryReads++;
    return route.fulfill({ json: [{ ...supplier, scanStatus: "live", scanComplete: true,
      catalog: { groups: [{ id: "exact-group", label: "同一分组", source: "catalog", models: publicModels }] } }] });
  });
  let returnedModels = keyModels;
  await page.route(`**/api/providers/${connection.id}/models*`, route => route.fulfill({
    status: directoryMode === "http503" ? 503 : 200,
    json: directoryMode === "http503" ? { error: "隔离测试：目录暂时不可达" } : returnedModels,
    headers: { "X-Model-Scan-Status": directoryMode === "stale" ? "stale" : directoryMode === "failed" || directoryMode === "http503" ? "failed" : "live",
      "X-Model-Scan-Complete": directoryMode ? "false" : "true" } }));
  await page.route("**/api/suppliers/*/billing*", route => route.fulfill({ json: { status: "unconfirmed" } }));
  const canvasResponse = await request.post("/api/canvas", { data: { title: "官网与 Key 目录差异", graph: {
    schemaVersion: 1, viewport: { x: 0, y: 0, zoom: 1 }, edges: [], nodes: [{
      id: "directory-node", type: "workflow", position: { x: 55, y: 40 }, style: { width: 420, height: 180 },
      data: { nodeType, label: "目录差异", provider: "rest", connectionId: connection.id, model: keyModels[0]!.id,
        parameters: nodeType === "video-generation" ? { resolution: "720p", duration: 10 } : {}, parts: [], inputs: [{ id: "prompt", kind: "text", label: "提示词" }],
        outputs: [{ id: "media", kind: nodeType === "video-generation" ? "video" : "image", label: "输出" }] },
    }],
  } } });
  expect(canvasResponse.ok()).toBeTruthy();
  const canvas = await canvasResponse.json();
  const panel = page.getByRole("dialog", { name: "目录差异 模型与参数", exact: true });
  const picker = panel.getByRole("combobox", { name: "目录差异 模型", exact: true });
  const openPicker = async () => {
    const sidebar = page.getByRole("button", { name: "智能体面板", exact: true });
    if ((await sidebar.getAttribute("aria-expanded")) === "true") await sidebar.click();
    await page.getByRole("button", { name: "打开 目录差异 模型与参数", exact: true }).click();
    await expect(picker).toContainText(keyModels[0]!.id);
    await picker.click();
  };
  await page.goto(`/canvas/${canvas.id}`);
  await openPicker();
  let directoryCycles = 1;
  return { panel, picker, list: panel.getByRole("listbox"), menu: panel.locator(".node-model-select-options"),
    summary: panel.getByRole("status", { name: "官网与 Key 目录对照" }), search: panel.getByRole("combobox", { name: "搜索模型名称或 ID", exact: true }),
    readNode: async () => (await (await request.get(`/api/canvas/${canvas.id}`)).json()).graph.nodes[0].data,
    confirmDirectoryWithPendingProtocol: async () => {
      directoryMode = false;
      returnedModels = keyModels.map(model => ({ ...model, metadata: { ...model.metadata, canvasRunnable: false, canvasUnavailableReason: "调用协议待确认" } }));
      directoryCycles++;
      await page.reload();
      await openPicker();
    },
    refreshDirectoryWithSameModels: async () => {
      expect(reactiveScanUpdates).toBe(true);
      directoryMode = false;
      scanRevision++;
      directoryCycles++;
      const refreshed = page.waitForResponse(response => new URL(response.url()).pathname === `/api/providers/${connection.id}/models` &&
        response.headers()["x-model-scan-complete"] === "true");
      await page.evaluate(() => window.dispatchEvent(new CustomEvent("supplier-catalog-upgraded")));
      const response = await refreshed;
      expect(response.ok()).toBe(true);
      expect(await response.json()).toEqual(keyModels);
    },
    assertSafe: () => { expect(submissions).toBe(0); expect(errors).toEqual([]); expect(directoryReads).toBeLessThanOrEqual(2 * directoryCycles); } };
}

test("相同型号与报价的 Key 扫描从局部完成变成完整完成后，菜单原地更新确认状态并允许选择", async ({ page, request }) => {
  expect(process.env.PLAYWRIGHT_BASE_URL, "此回归必须启动独立临时数据库，不能复用正式服务").toBeUndefined();
  const key = [video("video-confirmed-a"), video("video-confirmed-b")];
  const ui = await fixture(page, request, "video-generation", key, key.map(model => publicVideo(model.id)), "partial", true);
  const canvasUrl = page.url();
  const before = await ui.readNode();
  await expect(ui.summary).toContainText("官网目录 2");
  await expect(ui.summary).toContainText("Key 目录待确认");
  const choice = ui.list.getByRole("option", { name: "video-confirmed-b", exact: true });
  await expect(choice).toContainText("0.62");

  // Refresh the same open menu repeatedly; neither reloading nor new model rows
  // may be needed to make the newly confirmed inventory visible to React.
  for (let scan = 0; scan < 3; scan++) {
    await ui.refreshDirectoryWithSameModels();
    await expect(ui.summary).toContainText("Key 2");
    await expect(ui.summary).toContainText("双方 2");
    await expect(ui.summary).toContainText("官网额外 0");
    await expect(ui.summary).not.toContainText("待确认");
    await expect(ui.picker).toHaveAttribute("aria-expanded", "true");
    await expect(choice).toHaveAttribute("aria-disabled", "false");
    await expect(choice).toContainText("0.62");
    expect(page.url()).toBe(canvasUrl);
    expect((await ui.readNode()).model).toBe(before.model);
    expect((await ui.readNode()).parameters).toEqual(before.parameters);
  }

  await choice.click();
  await expect.poll(async () => (await ui.readNode()).model).toBe("video-confirmed-b");
  expect((await ui.readNode()).parameters).toEqual(before.parameters);
  ui.assertSafe();
});

test("官网18、Key15、交集10：八个目录型号显示官方价，键鼠拒选并保留当前模型与参数", async ({ page, request }, testInfo) => {
  const key = Array.from({ length: 15 }, (_, i) => video(`video-key-${i}`));
  const official = [...key.slice(0, 10).map(model => publicVideo(model.id)), ...Array.from({ length: 8 }, (_, i) => publicVideo(`video-official-${i}`))];
  const ui = await fixture(page, request, "video-generation", key, official);
  await expect(ui.summary).toContainText("官网目录 18");
  await expect(ui.summary).toContainText("Key 15");
  await expect(ui.summary).toContainText("双方 10");
  await expect(ui.summary).toContainText("官网额外 8");
  await expect(ui.list.getByRole("option")).toHaveCount(24);
  await expect(ui.list.locator('[data-catalog-only="true"]')).toHaveCount(8);
  const before = await ui.readNode();
  const extra = ui.list.getByRole("option", { name: "video-official-0", exact: true });
  await expect(extra).toHaveAttribute("aria-disabled", "true");
  await expect(extra).toContainText("0.62 CNY / 秒");
  await expect(extra).toContainText("官网已列出 · 当前 Key 未返回");
  await extra.scrollIntoViewIfNeeded();
  const extraBox = await extra.boundingBox();
  expect(extraBox).not.toBeNull();
  await page.mouse.click(extraBox!.x + extraBox!.width / 2, extraBox!.y + extraBox!.height / 2);
  await ui.search.fill("video-official-0");
  await ui.search.press("Home");
  await ui.search.press("Enter");
  await expect(ui.picker).toHaveAttribute("aria-expanded", "true");
  expect((await ui.readNode()).model).toBe(before.model);
  expect((await ui.readNode()).parameters).toEqual(before.parameters);
  await page.screenshot({ path: testInfo.outputPath("public-only-price-and-reason.png") });
  await ui.search.fill("");
  await ui.list.getByRole("option", { name: "video-key-1", exact: true }).click();
  await expect.poll(async () => (await ui.readNode()).model).toBe("video-key-1");
  const saved = await ui.readNode();
  expect(saved.catalogPickerDirectory).toBeUndefined();
  expect(saved.modelOptions).toBeUndefined();
  ui.assertSafe();
});

test("图片节点只展示图片目录差集，窄窗口保留报价和说明而不混入视频、音乐、语音与理解", async ({ page, request }, testInfo) => {
  await page.setViewportSize({ width: 620, height: 620 });
  const key: ModelDescriptor[] = [{ id: "gpt-image-2", name: "gpt-image-2", operations: ["image.generate"], outputKinds: ["image"], metadata: { canvasRunnable: true } }];
  const official: SupplierCatalogModel[] = [{ id: "gpt-image-2", capability: "image", outputKinds: ["image"] },
    { id: "gpt-image-3", capability: "image", outputKinds: ["image"], priceLabel: "¥0.15/张" }, publicVideo("video-only"),
    { id: "lyria-3-pro", capability: "music", outputKinds: ["audio"] }, { id: "tts-1", capability: "other", outputKinds: ["audio"] },
    { id: "image-understanding", capability: "image", outputKinds: ["text"], inputKinds: ["image"] }];
  const ui = await fixture(page, request, "image-generation", key, official);
  await expect(ui.summary).toContainText("官网目录 2");
  await expect(ui.list.getByRole("option")).toHaveCount(3);
  await expect(ui.list.getByRole("option", { name: "GPT Image 3", exact: true })).toContainText("¥0.15/张");
  await expect(ui.list.getByRole("option", { name: /video-only|lyria|tts|understanding/u })).toHaveCount(0);
  await expect.poll(() => ui.menu.evaluate(element => {
    const box = element.getBoundingClientRect();
    return box.left >= 11 && box.top >= 11 && box.right <= innerWidth - 11 && box.bottom <= innerHeight - 11 && element.scrollWidth <= element.clientWidth + 1;
  })).toBe(true);
  await ui.search.fill("gpt-image-3");
  await expect(ui.list.getByRole("option", { name: "GPT Image 3", exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("narrow-image-directory.png") });
  ui.assertSafe();
});

for (const failure of ["stale", "failed", "partial", "http503"] as const) test(`Key目录${failure}时官网价格仍可查看，只提示待确认且不声称未开通或无权限`, async ({ page, request }) => {
  const ui = await fixture(page, request, "video-generation", [video("video-key")], [publicVideo("video-extra")], failure);
  await expect(ui.summary).toContainText("Key 目录待确认");
  const extra = ui.list.getByRole("option", { name: "video-extra", exact: true });
  await expect(extra).toHaveAttribute("aria-disabled", "true");
  await expect(extra).toContainText("Key 目录待确认");
  await expect(extra).not.toContainText("当前 Key 未返回");
  await expect(extra).not.toContainText(/未开通|无权限/u);
  if (failure === "stale") {
    await ui.confirmDirectoryWithPendingProtocol();
    await expect(ui.summary).toContainText("Key 1");
    await expect(ui.summary).not.toContainText("目录待确认");
    await expect(ui.list.getByRole("option", { name: "video-key", exact: true })).toHaveAttribute("aria-disabled", "true");
    await expect(ui.list.getByRole("option", { name: "video-extra", exact: true })).toContainText("官网已列出 · 当前 Key 未返回");
  }
  ui.assertSafe();
});
