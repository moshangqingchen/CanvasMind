import { expect, type APIRequestContext, type Page } from "@playwright/test";
import sharp from "sharp";
import type { CanvasDocument, RunSnapshot } from "../../components/types";
import type { SupplierRecord } from "../../lib/client-suppliers";
import { loadRealMemoryFixture } from "./p0-memory-real-fixture";
import type { createAgentModelsMemoryResponder } from "./p0-memory-agent-models";
import { readMemoryCatalogArm, type createMemoryCatalogResponder, type MemoryCatalogSettingsTarget } from "./p0-memory-catalog-fixture";

export const memoryScenarios = ["home", "canvas-idle", "agent-open", "settings-open", "task-center-open", "fake-polling"] as const;
export type MemoryScenario = typeof memoryScenarios[number];

/** Same geometry, media sizes and node mix as canvas-ui-performance.spec.ts. */
export async function createMemoryFixture(request: APIRequestContext, scenario: MemoryScenario,
  catalog?: ReturnType<typeof createMemoryCatalogResponder>) {
  const fixtureKind = process.env.P0_MEMORY_FIXTURE ?? "synthetic";
  if (!["synthetic", "real"].includes(fixtureKind)) throw new Error("Unknown P0_MEMORY_FIXTURE");
  const models = [{ id: "fake-image-v1", name: "Fake", operations: ["image.generate"], inputKinds: ["text"], outputKinds: ["image"], metadata: { canvasRunnable: true } }];
  const response = await request.post("/api/providers", { data: { name: "隔离内存采样 Fake", provider: "fake", apiKey: "local-test-only",
    config: { usage: "canvas", defaultModel: "fake-image-v1", connector: { auth: { type: "none" }, models } } } });
  expect(response.ok()).toBeTruthy(); const provider = await response.json();
  await response.dispose();
  const real = fixtureKind === "real" ? await loadRealMemoryFixture(request, provider.id) : null;
  const imageIds: string[] = real?.imageIds ?? [];
  for (let i = 0; !real && i < 8; i++) {
    const buffer = await sharp({ create: { width: 2048, height: 1536, channels: 3, background: { r: 35 + i * 20, g: 70, b: 170 - i * 10 } } }).png().toBuffer();
    const uploaded = await request.post("/api/assets/upload", { multipart: { file: { name: `p0-memory-${scenario}-${i}.png`, mimeType: "image/png", buffer } } });
    expect(uploaded.ok()).toBeTruthy(); imageIds.push((await uploaded.json()).id); await uploaded.dispose();
  }
  const graph: CanvasDocument = real?.graph ?? { schemaVersion: 1, viewport: { x: 0, y: 0, zoom: 1 },
    nodes: Array.from({ length: 120 }, (_, i) => ({ id: `ui-perf-${i}`, type: "workflow", position: { x: (i % 12) * 440, y: Math.floor(i / 12) * 340 },
      style: { width: i % 3 === 2 ? 300 : 360, height: i % 3 === 2 ? 225 : 260 },
      data: i % 3 === 0 ? { nodeType: "prompt", label: `提示词 ${i}`, parts: [{ type: "text", text: "电影感森林与柔和晨光，画布流畅度基准" }],
        inputs: [], outputs: [{ id: "prompt", kind: "text", label: "提示词" }] }
        : i % 3 === 1 ? { nodeType: "image-generation", label: `图像生成 ${i}`, provider: "fake", connectionId: provider.id, model: "fake-image-v1", parameters: {}, parts: [],
          inputs: [{ id: "prompt", kind: "text", label: "提示词" }], outputs: [{ id: "images", kind: "image", label: "图片" }] }
        : { nodeType: "asset-input", label: `图片结果 ${i}`, assetId: imageIds[i % 8], assetKind: "image", generatedResult: true, generatedStatus: "succeeded", mediaAspectRatio: 4 / 3,
          generatedFromNodeId: `ui-perf-${i - 1}`, generatedModel: "fake-image-v1", inputs: [], outputs: [{ id: "image", kind: "image", label: "图片" }] },
    })),
    edges: Array.from({ length: 80 }, (_, i) => { const group = Math.floor(i / 2) * 3; return { id: `ui-perf-edge-${i}`, source: `ui-perf-${group + i % 2}`,
      target: `ui-perf-${group + i % 2 + 1}`, sourceHandle: i % 2 ? "images" : "prompt", targetHandle: i % 2 ? undefined : "prompt" }; }),
  };
  if (catalog && fixtureKind !== "real") throw new Error("Full catalog arm requires the prepared real canvas fixture");
  const catalogBinding = catalog?.bindGraph(graph) ?? null;
  const at = new Date().toISOString();
  const generators = graph.nodes.filter(node => ["image-generation", "video-generation", "audio-generation", "music-generation", "text-generation"].includes(node.data.nodeType ?? ""));
  const pollingGenerators = generators.slice(0, 8);
  if (scenario === "fake-polling") {
    for (const [group, generator] of pollingGenerators.entries()) {
      const source = generator.data;
      source.status = "running"; source.runStartedAt = at;
      const result = graph.nodes.find(node => node.data.generatedFromNodeId === generator.id)?.data;
      if (result) { delete result.assetId; result.generatedStatus = "running"; result.generatedFromRunId = `p0-fake-run-${group}`; }
    }
  }
  const created = await request.post("/api/canvas", { data: { title: `P0 隔离 ${scenario}`, graph } });
  expect(created.ok()).toBeTruthy(); const canvas = await created.json() as { id: string };
  await created.dispose();
  const runs: RunSnapshot[] = scenario === "fake-polling" ? pollingGenerators.map((node, group) => ({
    run: { id: `p0-fake-run-${group}`, canvasId: canvas.id, scope: "node", nodeId: node.id, status: "running", createdAt: at, updatedAt: at },
    nodes: [{ id: `p0-fake-node-run-${group}`, nodeId: node.id, status: "running", updatedAt: at, outputAssetIds: [], errorJson: null }],
  // Match the observed profile's history scale without copying user run data.
  })) : scenario === "task-center-open" ? Array.from({ length: 533 }, (_, i) => ({
    run: { id: `p0-history-${i}`, canvasId: canvas.id, scope: "node", status: i % 2 ? "failed" : "succeeded", createdAt: at, updatedAt: at },
    nodes: [{ id: `p0-history-node-${i}`, nodeId: generators[i % generators.length]?.id ?? graph.nodes[0]!.id, status: i % 2 ? "failed" : "succeeded", outputAssetIds: [], errorJson: i % 2 ? { message: "隔离 Fake 失败样本" } : null }],
  })) : [];
  return { canvas, provider, models, runs, at, imageIds, assets: real?.assets ?? [],
    evidence: { ...(real?.evidence ?? { source: "canvas-ui-performance.spec.ts synthetic mixed nodes and local color PNGs", nodes: graph.nodes.length, edges: graph.edges.length, assets: imageIds.length, images: imageIds.length }), catalogBinding, mockedRunCount: runs.length },
    fixtureKind, settingsTarget: catalog?.settingsTarget ?? null, primaryNodeId: generators[0]?.id ?? graph.nodes[0]!.id,
    originalSelectedNodeIds: graph.nodes.filter(node => node.selected).map(node => node.id) };
}

export async function restoreMemorySelection(page: Page, fixture: Awaited<ReturnType<typeof createMemoryFixture>>) {
  const selection = process.env.P0_MEMORY_SELECTION ?? "original";
  if (!["original", "generator"].includes(selection)) throw new Error("P0_MEMORY_SELECTION must be original or generator");
  const desired = selection === "generator" ? [fixture.primaryNodeId] : fixture.originalSelectedNodeIds;
  const current = await page.locator(".react-flow__node.selected").evaluateAll(nodes => nodes.map(node => node.getAttribute("data-id")).filter(Boolean));
  if (JSON.stringify([...current].sort()) === JSON.stringify([...desired].sort())) return;
  if (!desired.length) {
    // Clicking empty space changes selection only; no generated task is invoked.
    await page.locator(".react-flow__pane").click({ position: { x: 8, y: 8 } });
    return;
  }
  for (const [index, id] of desired.entries()) {
    const node = page.locator(`.react-flow__node[data-id=${JSON.stringify(id)}]`);
    const box = await node.boundingBox(); const viewport = page.viewportSize() ?? await page.evaluate(() => ({ width: innerWidth, height: innerHeight }));
    if (!box || box.x < 0 || box.y < 0 || box.x + box.width > viewport.width || box.y + box.height > viewport.height)
      await page.getByRole("button", { name: "Fit View", exact: true }).click();
    const title = node.locator(".node-title:visible").first();
    const target = await title.count() ? title : node;
    await target.click({ modifiers: index ? ["Control"] : [] });
  }
  await expect(page.locator(".react-flow__node.selected")).toHaveCount(desired.length);
  await expect(page.locator(".node-config-popover")).toHaveCount(0);
}

export async function installMemoryRoutes(page: Page, baseURL: string, fixture: Awaited<ReturnType<typeof createMemoryFixture>>,
  agentModels?: ReturnType<typeof createAgentModelsMemoryResponder>, catalog?: ReturnType<typeof createMemoryCatalogResponder>) {
  const state = { blockedSubmissions: 0, blockedExternal: 0, runReads: 0, eventReads: 0,
    mockedCatalogCalls: 0, mockedCatalogPostCalls: 0, mockedCatalogGetCalls: 0 };
  const catalogPolling = process.env.P0_MEMORY_CATALOG_POLL === "1";
  const suppliers: SupplierRecord[] = [{ id: "p0-supplier", supplierKey: "p0-supplier", name: "隔离采样供应商", kind: "openai-compatible",
    siteUrl: "https://p0-memory.invalid", apiUrl: "https://p0-memory.invalid/v1", createdAt: fixture.at, updatedAt: fixture.at,
    scanStatus: "live", scannedAt: fixture.at,
    catalog: { groups: [{ id: "fake", label: "隔离 Fake 组", source: "catalog", models: [{ id: "fake-image-v1", name: "Fake", capability: "image" }] }] } }];
  await page.route("**/*", async route => {
    const req = route.request(); const url = new URL(req.url()); const path = url.pathname;
    if (url.origin !== new URL(baseURL).origin && !["data:", "blob:", "about:"].includes(url.protocol)) {
      state.blockedExternal++; return route.abort("blockedbyclient");
    }
    // The real preload activates DesktopBridge's startup POST. Fulfill this
    // exact endpoint before the mutation guard; it must never reach the server.
    if (path === "/api/suppliers/catalog-upgrade" && ["POST", "GET"].includes(req.method())) {
      state.mockedCatalogCalls++;
      if (req.method() === "POST") state.mockedCatalogPostCalls++; else state.mockedCatalogGetCalls++;
      return route.fulfill({ status: req.method() === "POST" ? 202 : 200, headers: { "Cache-Control": "no-store" },
        json: { revision: "p0-isolated-mock", phase: catalogPolling ? "running" : "complete", total: 0, refreshed: 0,
          unavailable: 0, failed: 0, updatedConnectionIds: [] } });
    }
    if (path.startsWith("/api/") && !["GET", "HEAD"].includes(req.method()) && !(req.method() === "PUT" && path === `/api/canvas/${fixture.canvas.id}`)) {
      state.blockedSubmissions++; return route.abort("blockedbyclient");
    }
    if (agentModels && path === "/api/agent/models" && req.method() === "GET") {
      await agentModels.handle(route);
      return;
    }
    if (catalog && await catalog.handle(route)) return;
    if (path === "/api/suppliers") return route.fulfill({ json: suppliers });
    if (fixture.fixtureKind === "real" && path === "/api/assets") return route.fulfill({ json: fixture.assets });
    if (fixture.fixtureKind === "real" && /^\/api\/assets\/[^/]+$/.test(path)) {
      const asset = fixture.assets.find(item => path.endsWith(item.id));
      if (asset) {
        if (!url.searchParams.has("dimensions")) return route.fulfill({ json: asset });
        const response = await route.fetch();
        const actual = await response.json();
        return route.fulfill({ response, json: { ...actual, ...asset, actualDimensions: actual.actualDimensions } });
      }
    }
    if (path.startsWith("/api/suppliers/")) return route.fulfill({ json: path.endsWith("/verification") ? null : {} });
    if (path === "/api/providers") return route.fulfill({ json: [{ ...fixture.provider, apiKey: "", apiKeySet: true, apiKeyUsable: true,
      config: { ...fixture.provider.config, supplierId: "p0-supplier", supplierKey: "p0-supplier", modelGroup: "fake", modelCatalogModels: fixture.models,
        scannedModelIds: ["fake-image-v1"], modelScanStatus: "live", modelScanCheckedAt: fixture.at, modelScanLastSuccessAt: fixture.at } }] });
    if (/^\/api\/providers\/.+\/models$/.test(path)) return route.fulfill({ json: fixture.models, headers: { "X-Model-Scan-Status": "live" } });
    if (path === "/api/runs") {
      state.runReads++; const ids = url.searchParams.get("runIds")?.split(",");
      return route.fulfill({ json: ids ? fixture.runs.filter(item => ids.includes(item.run.id)) : fixture.runs });
    }
    if (/^\/api\/runs\/.+\/events$/.test(path)) {
      state.eventReads++;
      // Native EventSource remains intact. A short mocked stream reconnects
      // every 5 s and exercises the app's ordinary snapshot/polling cleanup.
      return route.fulfill({ contentType: "text/event-stream", body: 'retry: 5000\ndata: {"type":"fake-tick"}\n\n', headers: { "Cache-Control": "no-store" } });
    }
    if (/^\/api\/runs\/[^/]+$/.test(path)) {
      state.runReads++; const run = fixture.runs.find(item => path.endsWith(item.run.id));
      return route.fulfill({ status: run ? 200 : 404, json: run ?? { error: "Unknown isolated fake run" } });
    }
    return route.continue();
  });
  return state;
}

async function openSettings(page: Page, target?: MemoryCatalogSettingsTarget | null) {
  const settings = page.getByRole("dialog", { name: "供应商与模型设置", exact: true });
  if (!await settings.isVisible()) {
    const home = page.getByRole("button", { name: "供应商与模型", exact: true });
    if (await home.isVisible()) await home.click();
    else await page.getByRole("button", { name: "API 设置", exact: false }).click();
  }
  await expect(settings).toBeVisible();
  if (readMemoryCatalogArm() === "simple") await expect(settings.getByRole("heading", { name: "隔离采样供应商", exact: true })).toBeVisible();
  else await expect(settings.getByRole("tab", { name: "模型与分组", exact: true })).toBeVisible();
  if (target) {
    const supplier = settings.locator(".sm-supplier-item").filter({ has: page.getByText(target.supplierName, { exact: true }) });
    await expect(supplier).toHaveCount(1);
    if (!await supplier.evaluate(element => element.classList.contains("is-selected"))) await supplier.click();
    const modelsTab = settings.getByRole("tab", { name: "模型与分组", exact: true });
    if (await modelsTab.getAttribute("aria-selected") !== "true") await modelsTab.click();
    const group = settings.getByRole("button", { name: target.groupId, exact: true });
    await expect(group).toBeVisible();
    if (await group.getAttribute("aria-expanded") !== "true") await group.click();
    const card = settings.locator(".sm-group-card").filter({ has: page.getByRole("button", { name: target.groupId, exact: true }) });
    const modelToggle = card.locator(".sm-model-toggle");
    await expect(modelToggle).toBeVisible();
    if (await modelToggle.getAttribute("aria-expanded") !== "true") await modelToggle.click();
    await expect(card.locator(".sm-model-lists")).toBeVisible();
  }
  return settings;
}

async function openTasks(page: Page) {
  const tasks = page.getByRole("dialog", { name: "运行历史", exact: true });
  if (!await tasks.isVisible()) {
    const direct = page.getByRole("button", { name: "打开任务中心", exact: true });
    if (await direct.isVisible()) await direct.click();
    else { await page.getByRole("button", { name: "打开项目菜单", exact: true }).click(); await page.getByRole("menuitem", { name: "运行历史", exact: true }).click(); }
  }
  await expect(tasks).toBeVisible(); return tasks;
}

export async function setScenarioView(page: Page, scenario: MemoryScenario, fixture?: Awaited<ReturnType<typeof createMemoryFixture>>) {
  if (scenario === "home") { await expect(page.getByRole("textbox", { name: "搜索画布", exact: true })).toBeVisible(); return; }
  await expect(page.locator('.react-flow__node').first()).toBeAttached();
  const inspector = page.getByRole("button", { name: "智能体面板", exact: true });
  const expanded = await inspector.getAttribute("aria-expanded") === "true";
  if (expanded !== (scenario === "agent-open")) await inspector.click();
  if (scenario === "agent-open") await expect(page.getByRole("textbox", { name: "创作任务要求", exact: true })).toBeVisible();
  if (scenario === "settings-open") await openSettings(page, fixture?.settingsTarget);
  if (scenario === "task-center-open") await openTasks(page);
}

/** Returns each panel to its starting state before the next memory sample. */
export async function performMemoryOperation(page: Page, scenario: MemoryScenario, index: number, fixture?: Awaited<ReturnType<typeof createMemoryFixture>>) {
  if (scenario === "home") {
    const search = page.getByRole("textbox", { name: "搜索画布", exact: true });
    await search.fill("P0"); await search.fill("");
    const list = page.getByRole("button", { name: "列表视图", exact: true });
    if (await list.isVisible()) { await list.click(); await page.getByRole("button", { name: "网格视图", exact: true }).click(); }
    const settings = await openSettings(page); await settings.getByRole("button", { name: "关闭设置", exact: true }).click();
    return;
  }
  if (scenario === "settings-open") {
    const settings = await openSettings(page, fixture?.settingsTarget);
    await settings.getByRole("tab", { name: "连接配置", exact: true }).click();
    await settings.getByRole("tab", { name: "模型与分组", exact: true }).click();
    if (fixture?.settingsTarget) {
      const search = settings.getByLabel("查找分组或模型", { exact: true });
      await search.fill(fixture.settingsTarget.searchModelId);
      await search.press("Enter");
      await settings.getByRole("button", { name: "清除分组筛选", exact: true }).click();
      await openSettings(page, fixture.settingsTarget);
      const virtual = settings.locator(".sm-model-virtual").first();
      const scroll = await virtual.isVisible() ? virtual : settings.locator(".sm-detail");
      await scroll.evaluate(element => { element.scrollTop = element.scrollHeight; });
      await page.waitForTimeout(100);
      await scroll.evaluate(element => { element.scrollTop = 0; });
    }
    await settings.getByRole("button", { name: "关闭设置", exact: true }).click();
    await openSettings(page, fixture?.settingsTarget); return;
  }
  if (scenario === "task-center-open") {
    const tasks = await openTasks(page);
    const search = tasks.getByRole("textbox", { name: "搜索任务", exact: true });
    if (await search.isVisible()) { await search.fill("Fake"); await search.fill(""); }
    else {
      const status = tasks.getByRole("combobox", { name: "筛选任务状态", exact: true });
      await status.selectOption("succeeded"); await status.selectOption("all");
    }
    await tasks.getByRole("button", { name: "关闭", exact: true }).click(); await openTasks(page); return;
  }
  if (scenario === "agent-open") {
    const input = page.getByRole("textbox", { name: "创作任务要求", exact: true });
    await input.fill(`仅本地输入 ${index}`); await input.fill("");
    const inspector = page.getByRole("button", { name: "智能体面板", exact: true });
    await inspector.click(); await inspector.click();
    await expect(input).toBeVisible(); return;
  }
  await page.getByRole("button", { name: "Fit View", exact: true }).click();
  const pane = await page.locator(".react-flow__pane").boundingBox(); expect(pane).not.toBeNull();
  await page.mouse.move(pane!.x + pane!.width / 2, pane!.y + 20);
  await page.mouse.down({ button: "middle" }); await page.mouse.move(pane!.x + pane!.width / 2 + 70, pane!.y + 45, { steps: 15 }); await page.mouse.up({ button: "middle" });
  await page.mouse.wheel(0, -120); await page.mouse.wheel(0, 120);
  await page.getByRole("button", { name: "Fit View", exact: true }).click();
  const tasks = await openTasks(page); await tasks.getByRole("button", { name: "关闭", exact: true }).click();
}
