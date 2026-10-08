import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import type { ModelDescriptor } from "@super-canvas/providers";
import { miaowuCatalogFromPricing, miaowuConnectorForModels, miaowuUnparameterizedVideoDescriptor } from "../lib/miaowu-catalog";

const publicPricing = JSON.parse(readFileSync(new URL("../lib/miaowu-catalog-20261008.fixture.json", import.meta.url), "utf8"));
const directories: { openaiModels: { id: string }[] } = JSON.parse(readFileSync(new URL("../lib/miaowu-server-20261008.fixture.json", import.meta.url), "utf8"));

// These fixtures contain public model contracts and directory IDs only. No
// production canvas, account identity, credentials or generation is used.
const catalog = miaowuCatalogFromPricing(publicPricing);
const genericIds = new Set(directories.openaiModels.map(model => model.id));
const pending = directories.openaiModels.filter(model => !catalog.models.some(item => item.id === model.id)).map(model => ({
  ...miaowuUnparameterizedVideoDescriptor(model.id),
  metadata: { parameterSource: "key-model-scan", parameterControlsUnavailable: true, modality: "video", canvasRunnable: false,
    canvasUnavailableReason: "该型号的视频参数与调用协议待供应商文档确认", miaowuVideoContractPending: true },
}));
const completeModels: ModelDescriptor[] = [...catalog.models, ...pending];
const genericModels = completeModels.filter(model => genericIds.has(model.id));
const publicModels = catalog.models.map(model => ({ id: model.id, capability: model.outputKinds?.includes("image") ? "image" : "video",
  outputKinds: model.outputKinds, metadata: model.metadata, priceLabel: model.metadata?.priceLabel }));
const legacyPublicModels = publicModels.map(model => /^(?:dola-|jimeng-)/u.test(model.id)
  ? { ...model, capability: "chat", outputKinds: ["text"], metadata: { catalogCapability: "chat" } } : model);

for (const deliverWhileRunning of [false, true]) test(`Miaowu canvas updates the twenty-three-model directory ${deliverWhileRunning ? "during a running batch without duplicate completion" : "after completion"}`, async ({ page, request }, testInfo) => {
  expect(process.env.PLAYWRIGHT_BASE_URL, "Only the isolated test profile is allowed").toBeFalsy();
  await page.setViewportSize({ width: 1440, height: 1080 });
  let upgraded = false, finished = false, generations = 0, upstreamRequests = 0, modelReads = 0, upgradeEvents = 0, completionResponses = 0;
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.route("https://api.miaowuai.store/**", route => { upstreamRequests++; return route.abort(); });
  await page.route(/\/api\/runs(?:\?.*)?$/u, route => {
    if (route.request().method() === "POST") { generations++; return route.abort(); }
    return route.continue();
  });
  await page.addInitScript(() => {
    const cleanup = () => () => {};
    Object.assign(window, { miaowuUpgradeNotifications: 0, superCanvasDesktop: {
      getUpdate: async () => ({ desktop: true, phase: "idle", currentVersion: "0.2.71", enabled: true }),
      onUpdate: cleanup, onOpenUpdate: cleanup, onPrepareExit: cleanup, onDraining: cleanup,
      completePrepareExit: () => {}, cancelExit: async () => {},
    } });
    window.addEventListener("supplier-catalog-upgraded", () => {
      (window as unknown as { miaowuUpgradeNotifications: number }).miaowuUpgradeNotifications++;
    });
  });
  const created = await request.post("/api/providers", { data: { name: "Miaowu isolated upgrade", provider: "rest",
    config: { baseUrl: "https://miaowu-isolated.invalid", defaultModel: "seedance-2.0-mini-deal", usage: "canvas" } } });
  expect(created.ok()).toBeTruthy();
  const stored = await created.json();
  const connection = () => ({ ...stored, apiKey: "", apiKeySet: true, apiKeyUsable: true, config: {
    ...stored.config, supplierId: "miaowu-isolated", supplierSourceId: "miaowu-isolated-source", supplierKey: "miaowu",
    supplierName: "喵呜目录隔离验收", preset: "miaowu-openai-videos", baseUrl: "https://api.miaowuai.store", modelGroup: "default", accountKeyGroup: "default",
    modelScanStatus: "live", modelScanComplete: true, modelCatalogModels: upgraded ? completeModels : genericModels,
    scannedModelIds: (upgraded ? completeModels : genericModels).map(model => model.id),
    connector: miaowuConnectorForModels(upgraded ? completeModels : genericModels),
  } });
  await page.route(/\/api\/providers(?:\?.*)?$/u, route => route.request().method() === "GET" ? route.fulfill({ json: [connection()] }) : route.continue());
  await page.route(`**/api/providers/${stored.id}/models*`, route => {
    modelReads++;
    return route.fulfill({ json: upgraded ? completeModels : genericModels,
      headers: { "X-Model-Scan-Status": "live", "X-Model-Scan-Complete": "true" } });
  });
  await page.route(/\/api\/suppliers(?:\?.*)?$/u, route => route.fulfill({ json: [{ id: "miaowu-isolated", supplierKey: "miaowu", name: "喵呜目录隔离验收",
    siteUrl: "https://api.miaowuai.store", apiUrl: "https://api.miaowuai.store", kind: "newapi", state: { sourceId: "miaowu-isolated-source", visibility: "visible" },
    scanStatus: "live", scanComplete: true, catalog: { groups: [{ id: "default", label: "default", source: "catalog", status: "available",
      models: upgraded ? publicModels : legacyPublicModels }] } }] }));
  await page.route("**/api/suppliers/catalog-upgrade", route => {
    if (upgraded) upgradeEvents++;
    const phase = upgraded && (finished || !deliverWhileRunning) ? "complete" : "running";
    if (phase === "complete") completionResponses++;
    return route.fulfill({ json: { phase, updatedConnectionIds: upgraded ? [stored.id] : [] } });
  });
  const response = await request.post("/api/canvas", { data: { title: "Miaowu directory upgrade isolated", graph: {
    schemaVersion: 1, viewport: { x: 0, y: 0, zoom: 1 }, edges: [], nodes: [{ id: "miaowu-video", type: "workflow", position: { x: 80, y: 60 },
      style: { width: 420, height: 180 }, data: { nodeType: "video-generation", label: "喵呜升级验收", provider: "rest", connectionId: stored.id,
        model: "seedance-2.0-mini-deal", qualityMode: "custom", parameters: { resolution: "720p", duration: 4, aspect_ratio: "16:9" }, parts: [],
        inputs: [{ id: "prompt", kind: "text", label: "提示词" }], outputs: [{ id: "video", kind: "video", label: "视频" }] } }],
  } } });
  expect(response.ok()).toBeTruthy();
  const canvas = await response.json();
  await page.goto(`/canvas/${canvas.id}`);
  await page.getByRole("button", { name: "打开 喵呜升级验收 模型与参数", exact: true }).click();
  const panel = page.getByRole("dialog", { name: "喵呜升级验收 模型与参数", exact: true });
  const picker = panel.getByRole("combobox", { name: "喵呜升级验收 模型", exact: true });
  await picker.click();
  const directory = panel.getByRole("status", { name: "官网与 Key 目录对照" });
  await expect(directory).toContainText("官网目录 8");
  await expect(directory).toContainText("Key 11");
  const firstReads = modelReads;
  upgraded = true;
  await expect(directory).toContainText("官网目录 11");
  await expect(directory).toContainText("Key 16");
  expect(upgradeEvents).toBeGreaterThan(0);
  expect(modelReads).toBeGreaterThan(firstReads);
  const notifications = () => page.evaluate(() => (window as unknown as { miaowuUpgradeNotifications: number }).miaowuUpgradeNotifications);
  await expect.poll(notifications).toBe(1);
  if (deliverWhileRunning) {
    expect(completionResponses).toBe(0);
    finished = true;
    await expect.poll(() => completionResponses).toBe(1);
    expect(await notifications()).toBe(1);
  }
  const search = panel.getByRole("combobox", { name: "搜索模型名称或 ID" });
  await search.fill("dola");
  const dola = panel.getByRole("option").filter({ hasText: "dola-seedance" });
  await expect(dola).toHaveCount(2);
  for (const option of await dola.all()) await expect(option).toHaveAttribute("aria-disabled", "false");
  await expect(dola.first()).toContainText("0.875");
  await panel.screenshot({ path: testInfo.outputPath("miaowu-dola-after-upgrade.png") });
  expect({ generations, upstreamRequests, errors }).toEqual({ generations: 0, upstreamRequests: 0, errors: [] });
});
