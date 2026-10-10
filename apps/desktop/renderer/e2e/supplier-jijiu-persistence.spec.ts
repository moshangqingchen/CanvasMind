import { readFileSync } from "node:fs";
import { expect, test, type Locator } from "@playwright/test";
import { parseSupplierCatalog, scanProviderModelCatalog, type StructuredModelPricing } from "@super-canvas/providers";
import { applyJijiuImageCapabilities } from "@super-canvas/providers/jijiu-image-contract";
import type { ProviderConnectionView } from "../lib/client-api";

// The real API/database belong to globalSetup's temporary profile. Supplier
// reads are public sanitized fixtures, and no generation can leave the browser.
const official = JSON.parse(readFileSync(new URL("../../../../packages/providers/src/fixtures/jijiu-billing-20261010.json", import.meta.url), "utf8")) as {
  data: Array<{ model_name: string; enable_groups: string[] }>;
};
const origin = "https://newapi.jijiucanvas.com";
const modelId = "gpt-image-2-2K/4K";
const alternateModelId = "gpt-image-2";
const groupIds = ["default", "图片-GPT-image-2-2K/4K"];
const label = "极九档位持久化验收";
const catalog = parseSupplierCatalog(official, { supplierSiteUrl: origin, checkedAt: "2026-10-10T04:00:00Z" });

test("极九2K/4K与high经历目录刷新、同型号重选、型号及分组往返和新页面恢复", async ({ page, context, request }, testInfo) => {
  test.setTimeout(120_000);
  expect(process.env.PLAYWRIGHT_BASE_URL, "只允许 globalSetup 创建的隔离 profile").toBeFalsy();
  let submissions = 0, upstream = 0, scans = 0, automaticCompletions = 0;
  let automaticScanComplete = false;
  const errors: string[] = [];
  const reads = new Map<string, number>();
  context.on("page", active => active.on("pageerror", error => errors.push(error.message)));
  page.on("pageerror", error => errors.push(error.message));
  await context.route("**/*", route => {
    const url = new URL(route.request().url());
    if (url.pathname.startsWith("/api/runs") && route.request().method() === "POST") { submissions++; return route.abort(); }
    if (["http:", "https:"].includes(url.protocol) && !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) { upstream++; return route.abort(); }
    return route.continue();
  });
  const createdSupplier = await request.post("/api/suppliers", { data: {
    name: "极九持久化隔离供应商", siteUrl: "https://jijiu-persistence.invalid", apiUrl: "https://jijiu-persistence.invalid",
  } });
  expect(createdSupplier.ok()).toBeTruthy();
  const storedSupplier = await createdSupplier.json();
  const groups = catalog.groups.filter(group => groupIds.includes(group.id));
  expect(groups).toHaveLength(2);
  const supplier = { ...storedSupplier, siteUrl: origin, apiUrl: origin, scanStatus: "live", scanComplete: true,
    catalog: { groups }, state: { ...storedSupplier.state, sourceId: "jijiu-persistence-source" } };
  const connections: ProviderConnectionView[] = [];
  for (const groupId of groupIds) {
    const group = groups.find(item => item.id === groupId)!;
    const models = scanProviderModelCatalog(official.data.filter(row => row.enable_groups.includes(groupId)), { baseUrl: origin, modelGroup: groupId }).models.map(model => {
      const row = group.models.find(item => item.id === model.id)!;
      const native = applyJijiuImageCapabilities({ provider: "openai", config: { baseUrl: origin, modelGroup: groupId, accountKeyGroup: groupId, usage: "canvas" } }, model);
      return { ...native, name: model.id, pricing: row.metadata?.officialCatalogPricing as StructuredModelPricing,
        metadata: { ...native.metadata, ...row.metadata, canvasRunnable: true, priceLabel: row.priceLabel } };
    });
    expect(models.some(model => model.id === modelId)).toBeTruthy();
    if (groupId === "default") expect(models.some(model => model.id === alternateModelId)).toBeTruthy();
    const created = await request.post("/api/providers", { data: {
      name: `极九持久化隔离 · ${groupId}`, provider: "openai", apiKey: "offline-no-generation",
      config: { baseUrl: "https://jijiu-persistence.invalid", supplierId: supplier.id, supplierKey: supplier.supplierKey,
        usage: "canvas", modelGroup: groupId, accountKeyGroup: groupId, defaultModel: groupId === "default" ? alternateModelId : modelId },
    } });
    expect(created.ok()).toBeTruthy();
    const stored: ProviderConnectionView = await created.json();
    connections.push({ ...stored, apiKey: "", apiKeySet: true, apiKeyUsable: true,
      config: { ...stored.config, baseUrl: origin, supplierSourceId: "jijiu-persistence-source", supplierName: supplier.name,
        modelScanStatus: "live", modelScanComplete: true, modelCatalogModels: models, scannedModelIds: models.map(model => model.id) } });
    await context.route(`**/api/providers/${stored.id}/models*`, route => {
      reads.set(groupId, (reads.get(groupId) ?? 0) + 1);
      return route.fulfill({ json: models, headers: { "X-Model-Scan-Status": "live", "X-Model-Scan-Complete": "true" } });
    });
  }
  await context.route(/\/api\/providers(?:\?.*)?$/u, route => route.request().method() === "GET" ? route.fulfill({ json: connections }) : route.continue());
  await context.route(/\/api\/suppliers(?:\?.*)?$/u, route => route.request().method() === "GET" ? route.fulfill({ json: [supplier] }) : route.continue());
  await context.addInitScript(() => {
    const cleanup = () => () => {};
    Object.assign(window, { superCanvasDesktop: {
      getUpdate: async () => ({ desktop: true, phase: "idle", currentVersion: "0.2.86", enabled: true }),
      onUpdate: cleanup, onOpenUpdate: cleanup, onPrepareExit: cleanup, onDraining: cleanup,
      completePrepareExit: () => {}, cancelExit: async () => {},
    } });
  });
  await context.route("**/api/suppliers/catalog-upgrade", route => {
    if (automaticScanComplete) automaticCompletions++;
    return route.fulfill({ json: {
      revision: "jijiu-persistence-test", phase: automaticScanComplete ? "complete" : "running", total: 2,
      refreshed: automaticScanComplete ? 2 : 0, unavailable: 0, failed: 0,
      updatedConnectionIds: automaticScanComplete ? connections.map(connection => connection.id) : [],
    } });
  });
  await context.route(`**/api/suppliers/${supplier.id}/scan`, route => {
    scans++;
    expect(route.request().postDataJSON()).toMatchObject({ verifyCapabilities: false });
    return route.fulfill({ json: supplier });
  });
  const createdCanvas = await request.post("/api/canvas", { data: { title: label, graph: {
    schemaVersion: 1, viewport: { x: 0, y: 0, zoom: 1 }, edges: [], nodes: [{ id: "jijiu-persistence", type: "workflow",
      position: { x: 85, y: 60 }, style: { width: 420, height: 180 }, data: {
        nodeType: "image-generation", label, provider: "openai", connectionId: connections[0]!.id, model: modelId,
        parameters: { size: "2K", quality: "high", n: 1 }, qualityMode: "custom", parts: [],
        inputs: [{ id: "prompt", kind: "text", label: "提示词" }], outputs: [{ id: "result", kind: "image", label: "结果" }],
      } }],
  } } });
  expect(createdCanvas.ok()).toBeTruthy();
  const canvas = await createdCanvas.json();
  let currentCanvas = canvas;
  const saved = async () => (await (await request.get(`/api/canvas/${currentCanvas.id}`)).json()).graph.nodes[0].data;
  let active = page;
  const panel = () => active.getByRole("dialog", { name: `${label} 模型与参数`, exact: true });
  const picker = () => panel().getByRole("combobox", { name: `${label} 模型`, exact: true });
  const groupControl = () => panel().getByRole("combobox", { name: `${label} 模型群组`, exact: true });
  const quality = () => panel().getByRole("combobox", { name: "质量", exact: true });
  const tiers = () => panel().getByRole("group", { name: "自动与输出分辨率快捷档位", exact: true });
  const open = async () => {
    await active.getByRole("button", { name: `打开 ${label} 模型与参数`, exact: true }).click();
    await expect(panel()).toBeVisible();
    const sidebar = active.getByRole("button", { name: "智能体面板", exact: true });
    if (await sidebar.getAttribute("aria-expanded") === "true") await sidebar.click();
  };
  const choose = async (id: string) => {
    await picker().click();
    const identity = new RegExp(`^ID:\\s*${id.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}$`, "u");
    await panel().getByRole("option").filter({ has: active.locator('[id$="-id"]').filter({ hasText: identity }) }).click();
    await expect(picker()).toContainText(id);
  };
  const assertSelection = async (tier: string, group: string, targetPanel: Locator = panel()) => {
    await expect(groupControl()).toHaveValue(group);
    await expect(picker()).toContainText(modelId);
    await expect(tiers().getByRole("button")).toHaveText(["自动", "1K", "2K", "4K"]);
    await expect(tiers().getByRole("button", { name: tier, exact: true })).toHaveAttribute("aria-pressed", "true");
    await expect(quality()).toHaveValue("high");
    await expect(targetPanel.getByRole("alert")).toHaveCount(0);
    await expect.poll(saved).toMatchObject({ model: modelId, connectionId: connections.find(item => item.config.modelGroup === group)!.id,
      parameters: { size: tier, quality: "high" } });
  };
  const capture = async (name: string) => {
    await quality().scrollIntoViewIfNeeded();
    await panel().screenshot({ path: testInfo.outputPath(name) });
  };
  try {
    await active.setViewportSize({ width: 1600, height: 1080 });
    await active.goto(`/canvas/${canvas.id}`); await open();
    await assertSelection("2K", "default");
    await choose(modelId); await assertSelection("2K", "default");
    await tiers().getByRole("button", { name: "4K", exact: true }).click();
    await quality().selectOption("high");
    await assertSelection("4K", "default");
    const beforeAutomatic = reads.get("default") ?? 0;
    automaticScanComplete = true;
    await expect.poll(() => automaticCompletions).toBeGreaterThan(0);
    await expect.poll(() => reads.get("default") ?? 0).toBeGreaterThan(beforeAutomatic);
    await assertSelection("4K", "default");
    await choose(modelId); await assertSelection("4K", "default");
    await choose(alternateModelId);
    await expect.poll(saved).toMatchObject({ model: alternateModelId });
    // Restore a different selected model first so recovering 4K/high below
    // depends on persisted per-model history, not just current parameters.
    await active.reload(); await open();
    await expect(picker()).toContainText(alternateModelId);
    await choose(modelId); await assertSelection("4K", "default");
    await groupControl().selectOption(groupIds[1]!);
    await assertSelection("4K", groupIds[1]!);
    await choose(modelId);
    await tiers().getByRole("button", { name: "2K", exact: true }).click();
    await quality().selectOption("high");
    await assertSelection("2K", groupIds[1]!);
    await groupControl().selectOption("default"); await assertSelection("4K", "default");
    await groupControl().selectOption(groupIds[1]!); await assertSelection("2K", groupIds[1]!);
    await active.reload(); await open(); await assertSelection("2K", groupIds[1]!);
    await capture("jijiu-2k-high-after-refresh-switch-reload.png");
    await active.getByRole("button", { name: "API 设置", exact: true }).click();
    const settings = active.getByRole("dialog", { name: "供应商与模型设置", exact: true });
    await settings.getByRole("button", { name: "刷新全部供应商", exact: true }).click();
    await expect.poll(() => scans).toBe(1);
    await expect(settings.getByRole("button", { name: "刷新全部供应商", exact: true })).toBeEnabled();
    await settings.getByRole("button", { name: "关闭设置", exact: true }).click();
    if (!await panel().isVisible()) await open();
    await assertSelection("2K", groupIds[1]!);
    await groupControl().selectOption("default"); await assertSelection("4K", "default");
    await capture("jijiu-4k-high-after-manual-supplier-refresh.png");
    // Closing the page drops its renderer memory. This is a fresh renderer
    // check; actual installed-app process restart is validated separately.
    await active.close(); active = await context.newPage();
    await active.setViewportSize({ width: 1600, height: 1080 });
    await active.goto(`/canvas/${canvas.id}`); await open(); await assertSelection("4K", "default");
    await groupControl().selectOption(groupIds[1]!); await assertSelection("2K", groupIds[1]!);
    await capture("jijiu-2k-high-after-fresh-renderer.png");
    await groupControl().selectOption("default"); await assertSelection("4K", "default");
    await capture("jijiu-4k-high-after-fresh-renderer.png");
    // A separate canvas has no previous default-group selection. Its target
    // group's default is another model, but the current complete model exists.
    const reverseGraph = structuredClone(canvas.graph);
    reverseGraph.nodes[0].data.connectionId = connections[1]!.id;
    reverseGraph.nodes[0].data.parameters = { size: "2K", quality: "high", n: 1 };
    delete reverseGraph.nodes[0].data.modelParameterSelections;
    const reverseCreated = await request.post("/api/canvas", { data: { title: `${label} · 首次反向切组`, graph: reverseGraph } });
    expect(reverseCreated.ok()).toBeTruthy();
    currentCanvas = await reverseCreated.json();
    await active.goto(`/canvas/${currentCanvas.id}`); await open(); await assertSelection("2K", groupIds[1]!);
    await groupControl().selectOption("default"); await assertSelection("2K", "default");
    await active.reload(); await open(); await assertSelection("2K", "default");
    await capture("jijiu-2k-high-first-reverse-group-switch.png");
  } finally {
    expect({ submissions, upstream }).toEqual({ submissions: 0, upstream: 0 });
    expect(errors).toEqual([]);
  }
});
