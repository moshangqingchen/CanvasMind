import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { parseWeAiLegacyGroup, type ModelDescriptor } from "@super-canvas/providers";
import type { ProviderConnectionView } from "../lib/client-api";
import {
  applyWeAiLivePricing,
  WEAI_ADOBE_PER_REQUEST_GROUP,
  WEAI_ADOBE_PER_REQUEST_URL_GROUP,
  WEAI_ADOBE_TOKEN_GROUP,
  weAiCanvasModelDescriptors,
} from "../lib/weai-catalog";

test("WeAI 后台补全当前精确分组报价，保留完整型号、质量档及 token 单位", async ({ page, request }, info) => {
  const origin = "https://asian-acc.we-token.cc";
  const group = WEAI_ADOBE_PER_REQUEST_URL_GROUP;
  const modelId = "gpt-image-2";
  const checkedAt = "2026-10-08T23:40:00.000Z";
  const base = weAiCanvasModelDescriptors(group).find(model => model.id === modelId)!;
  expect(base).toBeDefined();
  const old = applyWeAiLivePricing([base], {
    groupId: group, source: "official-docs", sourceUrl: "https://docs.we-ai.cc/guides/image-generation-service.html",
    checkedAt: "2026-10-01T00:00:00.000Z", complete: false, multiplier: 1,
    models: { [modelId]: { kind: "per-request", multiplier: 1, tiers: [
      { id: "low", label: "LOW", price: .04 }, { id: "medium", label: "MEDIUM", price: .07 }, { id: "high", label: "HIGH", price: .15 },
    ] } },
  })[0]!;
  // This is the real automatic docs name shape that previously survived the
  // price refresh. The mapper's exact conversion is covered by its unit tests;
  // this browser fixture exercises consumption of the updated API descriptor.
  expect(old.name).toContain("LOW $0.04/次");
  expect(old.name).toContain(" · 1K/2K/4K）");
  const current: ModelDescriptor = { ...old, name: "GPT Image 2", pricing: {
    kind: "per-request", currency: "USD", billingUnit: "request", confidence: "exact", checkedAt,
    sourceUrl: `${origin}/api/v1/model-plaza-legacy/models?group_id=42`,
    tiers: [
      { id: "price_low", label: "low", dimension: "quality", value: "low", price: .03 },
      { id: "price_medium", label: "medium", dimension: "quality", value: "medium", price: .05 },
      { id: "price_high", label: "high", dimension: "quality", value: "high", price: .15 },
    ],
  }, metadata: { ...old.metadata, priceLabel: "LOW $0.03/次 · MEDIUM $0.05/次 · HIGH $0.15/次",
    priceSource: "supplier-catalog", priceStatus: "available", supplierPriceGroup: group, priceCheckedAt: checkedAt } };
  const tokenBase = weAiCanvasModelDescriptors(WEAI_ADOBE_TOKEN_GROUP).find(model => model.id === modelId)!;
  const legacyFixture = JSON.parse(readFileSync(new URL("../../../../packages/providers/src/__fixtures__/weai-legacy-price-20261008.json", import.meta.url), "utf8")) as {
    groups: { groupId: number; payload: unknown }[];
  };
  const tokenQuote = parseWeAiLegacyGroup(legacyFixture.groups.find(row => row.groupId === 101)!.payload, checkedAt, 101)!
    .selected!.models.find(model => model.id === modelId)!;
  expect(tokenQuote.pricing).toMatchObject({ currency: "USD", inputPerMillion: 3.5, outputPerMillion: 7, imageOutputPerMillion: 21 });
  const token: ModelDescriptor = { ...tokenBase, name: "GPT Image 2", pricing: tokenQuote.pricing,
    metadata: { ...tokenBase.metadata, priceLabel: tokenQuote.priceLabel, priceSource: "supplier-catalog",
    priceStatus: "available", supplierPriceGroup: WEAI_ADOBE_TOKEN_GROUP, priceCheckedAt: checkedAt } };
  const fixedNames: Record<string, string> = { "gpt-image-2-low": "GPT Image 2 LOW", "gpt-image-2-medium": "GPT Image 2 MEDIUM", "gpt-image-2-high": "GPT Image 2 HIGH" };
  const fixed = weAiCanvasModelDescriptors(WEAI_ADOBE_PER_REQUEST_GROUP).map(model => ({ ...model, name: fixedNames[model.id] ?? model.name, pricing: {
    kind: "per-request" as const, currency: "USD", billingUnit: "request" as const, confidence: "exact" as const, checkedAt,
    sourceUrl: `${origin}/api/v1/model-plaza-legacy/models?group_id=44`,
    tiers: [{ id: "request", label: "单次", dimension: "fixed" as const, value: "request", price: model.id.endsWith("-low") ? .03 : model.id.endsWith("-medium") ? .05 : .15 }],
  }, metadata: { ...model.metadata, priceSource: "supplier-catalog", priceStatus: "available",
    supplierPriceGroup: WEAI_ADOBE_PER_REQUEST_GROUP, priceCheckedAt: checkedAt } }));

  let currentCatalog = false;
  let releasePoll!: () => void;
  const pollGate = new Promise<void>(resolve => { releasePoll = resolve; });
  let generations = 0;
  const errors: string[] = [];
  const reads = new Map<string, number>();
  page.on("pageerror", error => errors.push(error.message));
  await page.addInitScript(() => {
    const cleanup = () => () => {};
    Object.assign(window, { superCanvasDesktop: {
      getUpdate: async () => ({ desktop: true, phase: "idle", currentVersion: "0.2.73", enabled: false }),
      onUpdate: cleanup, onOpenUpdate: cleanup, onPrepareExit: cleanup, onDraining: cleanup,
      completePrepareExit: () => {}, cancelExit: async () => {},
    } });
  });
  await page.route("**/api/runs**", route => {
    if (route.request().method() === "POST") { generations++; return route.abort(); }
    return route.continue();
  });
  const supplierResponse = await request.post("/api/suppliers", { data: {
    name: "WeAI 当前报价回归", siteUrl: origin, apiUrl: `${origin}/v1`,
  } });
  expect(supplierResponse.ok()).toBeTruthy();
  const supplier = await supplierResponse.json();
  const connections: ProviderConnectionView[] = [];
  const modelsFor = (connection: ProviderConnectionView): ModelDescriptor[] => connection.config.modelGroup === group
    ? [currentCatalog ? current : old] : connection.config.modelGroup === WEAI_ADOBE_TOKEN_GROUP ? [token] : fixed;
  for (const modelGroup of [group, WEAI_ADOBE_TOKEN_GROUP, WEAI_ADOBE_PER_REQUEST_GROUP]) {
    const created = await request.post("/api/providers", { data: {
      name: `WeAI 当前报价回归 · ${modelGroup}`, provider: "weai", apiKey: "isolated-WeAI-pricing-fixture-key",
      config: { supplierId: supplier.id, supplierKey: supplier.supplierKey, baseUrl: `${origin}/v1`, usage: "canvas",
        modelGroup, defaultModel: modelGroup === WEAI_ADOBE_PER_REQUEST_GROUP ? "gpt-image-2-low" : modelId },
    } });
    expect(created.ok()).toBeTruthy(); connections.push(await created.json());
  }
  await page.route(/\/api\/providers(?:\?.*)?$/u, async route => {
    if (route.request().method() !== "GET") return route.continue();
    const response = await route.fetch();
    const rows: ProviderConnectionView[] = await response.json();
    await route.fulfill({ response, json: rows.map(row => {
      const fixture = connections.find(connection => connection.id === row.id);
      if (!fixture) return row;
      const models = modelsFor(fixture);
      return { ...row, config: { ...row.config, modelCatalogModels: models, scannedModelIds: models.map(model => model.id),
        modelScanStatus: "live", modelScanAttemptStatus: "live", modelScanComplete: true,
        modelScanCheckedAt: checkedAt, modelScanLastSuccessAt: checkedAt } };
    }) });
  });
  await page.route("**/api/providers/*/models*", route => {
    const id = new URL(route.request().url()).pathname.split("/")[3]!;
    const connection = connections.find(connection => connection.id === id);
    reads.set(id, (reads.get(id) ?? 0) + 1);
    return route.fulfill({ json: connection ? modelsFor(connection) : [], headers: { "X-Model-Scan-Status": "live" } });
  });
  await page.route("**/api/suppliers/catalog-upgrade", async route => {
    const starting = route.request().method() === "POST";
    if (!starting) await pollGate;
    await route.fulfill({ status: starting ? 202 : 200, json: { phase: starting ? "running" : "complete",
      updatedConnectionIds: starting ? [] : [connections[0]!.id], total: 1, refreshed: starting ? 0 : 1, failed: 0, unavailable: 0 } });
  });
  const label = "WeAI 分组报价";
  const created = await request.post("/api/canvas", { data: { title: label, graph: {
    schemaVersion: 1, viewport: { x: 0, y: 0, zoom: 1 }, edges: [], nodes: [{
      id: "weai-pricing-node", type: "workflow", position: { x: 55, y: 70 }, style: { width: 420, height: 180 }, data: {
        nodeType: "image-generation", label, provider: "weai", connectionId: connections[0]!.id, model: modelId,
        parts: [], parameters: { quality: "low" }, inputs: [{ id: "prompt", kind: "text", label: "提示词" }],
        outputs: [{ id: "images", kind: "image", label: "图片" }],
      },
    }] },
  } });
  expect(created.ok()).toBeTruthy(); const canvas = await created.json();
  try {
    await page.setViewportSize({ width: 1440, height: 1080 });
    await page.goto(`/canvas/${canvas.id}`);
    const nodeModel = page.getByRole("button", { name: `打开 ${label} 模型与参数`, exact: true });
    await nodeModel.click();
    const panel = page.getByRole("dialog", { name: `${label} 模型与参数`, exact: true });
    await expect.poll(async () => {
      const [popup, rail] = await Promise.all([panel.boundingBox(), page.getByRole("navigation", { name: "创作工具", exact: true }).boundingBox()]);
      return !!popup && !!rail && popup.x >= rail.x + rail.width + 7;
    }).toBe(true);
    const supplierSelect = panel.getByRole("combobox", { name: `${label} 供应商`, exact: true });
    const supplierBounds = await supplierSelect.boundingBox();
    expect(supplierBounds).not.toBeNull();
    await supplierSelect.click({ position: { x: 2, y: supplierBounds!.height / 2 } });
    await expect(supplierSelect).toBeFocused();
    await page.keyboard.press("Escape");
    const quote = panel.getByLabel("当前供应商报价", { exact: true });
    const groups = panel.getByRole("combobox", { name: `${label} 模型群组`, exact: true });
    const quality = panel.getByLabel("质量（quality，可选）", { exact: true });
    await quality.selectOption("low");
    await expect(quote).toContainText("0.04 USD / 次（参考）");
    await expect(nodeModel).toContainText("LOW $0.04/次");
    await expect.poll(() => reads.get(connections[0]!.id) ?? 0).toBeGreaterThan(0);
    const beforeReads = reads.get(connections[0]!.id) ?? 0;
    currentCatalog = true; releasePoll();
    await expect(quote).toContainText("0.03 USD / 次");
    await expect(quote).not.toContainText("（参考）");
    await expect(nodeModel).toContainText("GPT Image 2");
    await expect(nodeModel).not.toContainText("$0.04");
    await expect(nodeModel).not.toContainText("$0.07");
    await expect(nodeModel).not.toHaveAttribute("title", /\$0\.(?:04|07)/u);
    await expect(quality).toHaveValue("low");
    await expect.poll(() => reads.get(connections[0]!.id) ?? 0).toBeGreaterThan(beforeReads);
    await quality.selectOption("medium"); await expect(quote).toContainText("0.05 USD / 次");
    await quality.selectOption("high"); await expect(quote).toContainText("0.15 USD / 次");
    const details = panel.getByLabel("当前参数价格", { exact: true });
    await details.getByText("价格与参数依据", { exact: true }).click();
    const source = details.getByRole("link", { name: "查看价格来源", exact: true });
    await expect(source).toHaveAttribute("href", current.pricing!.sourceUrl!);
    const sourceBounds = await source.boundingBox();
    expect(sourceBounds).not.toBeNull();
    // Hit-test the left edge without navigating to the real supplier site.
    await source.click({ trial: true, position: { x: 2, y: sourceBounds!.height / 2 } });
    await expect(details).toContainText("LOW $0.03/次");
    await page.screenshot({ path: info.outputPath("weai-current-exact-group-price.png") });

    await groups.selectOption(WEAI_ADOBE_TOKEN_GROUP);
    await expect(quote).toContainText("按实际用量计费，详见价格说明");
    await expect(quote).not.toContainText("0.15 USD / 次");
    await expect(details).not.toContainText("本次预计费用");
    await expect(details).toContainText("文本输入 $3.5/1M tokens（USD 额度）");
    await expect(details).toContainText("文本输出 $7/1M tokens（USD 额度）");
    await expect(details).toContainText("图像输出 $21/1M tokens（USD 额度）");
    await expect(details).not.toContainText("图像输出 $30/1M tokens");
    await expect(details.getByRole("link", { name: "查看价格来源", exact: true })).toHaveAttribute("href", `${origin}/api/v1/model-plaza-legacy/models?group_id=101`);
    await expect(nodeModel).not.toContainText("$0.04");
    await expect(nodeModel).not.toContainText("$0.07");
    await details.scrollIntoViewIfNeeded();
    await page.screenshot({ path: info.outputPath("weai-current-token-group-price.png") });
    await groups.selectOption(WEAI_ADOBE_PER_REQUEST_GROUP);
    await expect(quote).toContainText("0.03 USD / 次");
    const modelPicker = panel.getByRole("combobox", { name: `${label} 模型`, exact: true });
    await modelPicker.click(); await page.getByRole("option", { name: /GPT Image 2 MEDIUM/u }).click();
    await expect(quote).toContainText("0.05 USD / 次");
    await expect(nodeModel).toContainText("GPT Image 2 MEDIUM");
    await expect(nodeModel).not.toContainText("$0.07");
    await expect(nodeModel).not.toHaveAttribute("title", /\$0\.07/u);
    await expect.poll(async () => (await (await request.get(`/api/canvas/${canvas.id}`)).json()).graph.nodes[0].data)
      .toMatchObject({ connectionId: connections[2]!.id, model: "gpt-image-2-medium" });
    expect(generations).toBe(0); expect(errors).toEqual([]);
  } finally {
    releasePoll();
  }
});
