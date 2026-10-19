import { expectDirectoryStat, expectQuotedAmount, estimateAmount } from "./helpers/readable-facts";
import { readFileSync } from "node:fs";
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { parseSupplierCatalog, remainingVideoModel, scanProviderModelCatalog, type ModelDescriptor, type StructuredModelPricing } from "@super-canvas/providers";
import { applyJijiuImageCapabilities } from "@super-canvas/providers/jijiu-image-contract";
import type { ProviderConnectionView } from "../lib/client-api";

// Public, sanitized official evidence; storage uses an invalid host and every
// browser upstream request/run submission is blocked. No real account is used.
// Keep this historical directory to cover saved group/model compatibility;
// parameter controls still follow the current frozen supplier contracts.
const official = JSON.parse(readFileSync(new URL("../../../../packages/providers/src/fixtures/jijiu-billing-20261010.json", import.meta.url), "utf8")) as {
  group_ratio: Record<string, number>;
  data: Array<{ model_name: string; tags: string; enable_groups: string[] }>;
};
const origin = "https://newapi.jijiucanvas.com";
const catalog = parseSupplierCatalog(official, { supplierSiteUrl: origin, checkedAt: "2026-10-10T04:00:00Z" });
const groups = catalog.groups.filter(group => Object.hasOwn(official.group_ratio, group.id) && group.models.some(model => ["image", "video"].includes(model.capability)));
const label = "极九离线参数验收";
const modelsFor = (group: string) => {
  const declared = groups.find(item => item.id === group)!;
  return scanProviderModelCatalog(official.data.filter(row => row.enable_groups.includes(group)), { baseUrl: origin, modelGroup: group }).models.map(model => {
    const row = declared.models.find(item => item.id === model.id)!;
    const native = applyJijiuImageCapabilities({ provider: "openai", config: { baseUrl: origin, modelGroup: group, accountKeyGroup: group, usage: "canvas" } }, model);
    return { ...native, name: model.id, pricing: row.metadata?.officialCatalogPricing as StructuredModelPricing,
      metadata: { ...native.metadata, ...row.metadata, canvasRunnable: true, priceLabel: row.priceLabel } };
  });
};

test.beforeAll(() => {
  expect(process.env.PLAYWRIGHT_BASE_URL, "极九回归必须使用隔离 profile 与数据库").toBeFalsy();
  expect(groups).toHaveLength(9);
});

async function setup(page: Page, request: APIRequestContext, kind: "image" | "video", initialGroup: string, options: { incomplete?: boolean; wrongGroup?: boolean; initialModelId?: string; initialParameters?: Record<string, unknown> } = {}) {
  await page.setViewportSize({ width: 1600, height: 1080 });
  await page.clock.setFixedTime(new Date("2026-10-10T04:00:00Z"));
  let submissions = 0, upstream = 0, complete = !options.incomplete;
  const errors: string[] = [], responses: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.route("**/*", route => {
    const url = new URL(route.request().url());
    if (url.pathname.startsWith("/api/runs") && route.request().method() === "POST") { submissions++; return route.abort(); }
    if (["http:", "https:"].includes(url.protocol) && !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) { upstream++; return route.abort(); }
    return route.continue();
  });
  const createdSupplier = await request.post("/api/suppliers", { data: { name: "极九api · 隔离验收", siteUrl: "https://jijiu-offline.invalid", apiUrl: "https://jijiu-offline.invalid" } });
  expect(createdSupplier.ok()).toBeTruthy();
  const storedSupplier = await createdSupplier.json();
  const supplier = { ...storedSupplier, siteUrl: origin, apiUrl: origin, scanStatus: "live", scanComplete: true,
    catalog: { groups }, state: { ...storedSupplier.state, sourceId: "jijiu-offline-source" } };
  const connections: ProviderConnectionView[] = [], modelMap = new Map<string, ModelDescriptor[]>(), reads = new Map<string, number>();
  for (const group of groups) {
    const models: ModelDescriptor[] = modelsFor(group.id);
    if (options.wrongGroup && group.id === initialGroup) models.push(remainingVideoModel("jijiu", "稳定seedance-2.5参图参音F", undefined, { group: group.id })!);
    const created = await request.post("/api/providers", { data: { name: `极九隔离 · ${group.id}`, provider: "openai", apiKey: "offline-only-no-generation",
      config: { baseUrl: "https://jijiu-offline.invalid", supplierId: supplier.id, supplierKey: supplier.supplierKey, usage: "canvas", modelGroup: group.id, accountKeyGroup: group.id } } });
    expect(created.ok()).toBeTruthy();
    const stored: ProviderConnectionView = await created.json();
    const connection: ProviderConnectionView = { ...stored, apiKey: "", apiKeySet: true, apiKeyUsable: true,
      config: { ...stored.config, baseUrl: origin, supplierSourceId: "jijiu-offline-source", supplierName: supplier.name, modelScanStatus: "live", modelScanComplete: complete,
        modelCatalogModels: models, scannedModelIds: models.map(model => model.id) } };
    connections.push(connection); modelMap.set(group.id, models);
    await page.route(`**/api/providers/${stored.id}/models*`, route => {
      reads.set(group.id, (reads.get(group.id) ?? 0) + 1);
      if (group.id === initialGroup) responses.push(JSON.stringify(models));
      return route.fulfill({ json: models, headers: { "X-Model-Scan-Status": "live", "X-Model-Scan-Complete": String(complete) } });
    });
  }
  await page.route(/\/api\/providers(?:\?.*)?$/u, route => route.request().method() === "GET" ? route.fulfill({ json: connections }) : route.continue());
  await page.route(/\/api\/suppliers(?:\?.*)?$/u, route => route.request().method() === "GET" ? route.fulfill({ json: [supplier] }) : route.continue());
  const connection = connections.find(item => item.config.modelGroup === initialGroup)!;
  const first = options.initialModelId ? modelMap.get(initialGroup)!.find(model => model.id === options.initialModelId)! : modelMap.get(initialGroup)![0]!;
  const parameters = { ...Object.fromEntries((first.parameters ?? []).filter(parameter => parameter.default !== undefined).map(parameter => [parameter.key, parameter.default])), ...options.initialParameters };
  const createdCanvas = await request.post("/api/canvas", { data: { title: "极九目录参数离线验收", graph: {
    schemaVersion: 1, viewport: { x: 0, y: 0, zoom: 1 }, edges: [], nodes: [{ id: "jijiu-media", type: "workflow", position: { x: 85, y: 60 }, style: { width: 420, height: 180 },
      data: { nodeType: `${kind}-generation`, label, provider: "openai", connectionId: connection.id, model: first.id, parameters, qualityMode: "custom", parts: [],
        inputs: [{ id: "prompt", kind: "text", label: "提示词" }], outputs: [{ id: "result", kind, label: "结果" }] } }],
  } } });
  expect(createdCanvas.ok()).toBeTruthy();
  const canvas = await createdCanvas.json();
  const panel = page.getByRole("dialog", { name: `${label} 模型与参数`, exact: true });
  const picker = panel.getByRole("combobox", { name: `${label} 模型`, exact: false });
  const groupControl = panel.getByRole("combobox", { name: `${label} 模型群组`, exact: true });
  const summary = panel.getByLabel("官网与 Key 目录对照", { exact: true });
  const open = async (expectedGroup = initialGroup) => {
    await page.getByRole("button", { name: `打开 ${label} 模型与参数`, exact: true }).click();
    await expect(panel).toBeVisible();
    const sidebar = page.getByRole("button", { name: "智能体面板", exact: true });
    if (await sidebar.getAttribute("aria-expanded") === "true") await sidebar.click();
    await expect(groupControl).toHaveValue(expectedGroup);
  };
  const menu = async () => { if (await picker.getAttribute("aria-expanded") !== "true") await picker.click(); await expect(panel.getByRole("listbox")).toBeVisible(); };
  const option = (id: string) => panel.getByRole("option").filter({ has: page.locator('[id$="-id"]').filter({ hasText: new RegExp(`^ID:\\s*${id.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}$`, "u") }) });
  const choose = async (id: string) => { await menu(); await option(id).click(); await expect(picker).toContainText(id); };
  const selectGroup = async (group: string) => {
    await groupControl.selectOption(group); await expect(groupControl).toHaveValue(group);
    await expect.poll(() => reads.get(group) ?? 0).toBeGreaterThan(0);
    await menu(); await expectDirectoryStat(summary, "Key", modelMap.get(group)!.length);
    await expect(panel.getByRole("listbox").getByRole("option")).toHaveCount(modelMap.get(group)!.length + 1);
  };
  const saved = async () => (await (await request.get(`/api/canvas/${canvas.id}`)).json()).graph.nodes[0].data;
  await page.goto(`/canvas/${canvas.id}`); await open();
  return { panel, picker, menu, option, choose, selectGroup, modelMap, summary, saved, open,
    finishScan: async () => {
      complete = true; for (const item of connections) item.config.modelScanComplete = true;
      await page.evaluate(() => window.dispatchEvent(new Event("supplier-catalog-upgraded")));
    }, responses,
    safe: () => { expect({ submissions, upstream }).toEqual({ submissions: 0, upstream: 0 }); expect(errors).toEqual([]); },
  };
}

async function assertPriceSource(panel: ReturnType<Page["getByRole"]>, model: ModelDescriptor) {
  const price = panel.getByLabel("当前参数价格", { exact: true });
  const details = price.locator("details").filter({ hasText: "价格与参数依据" });
  if (!await details.evaluate(element => (element as HTMLDetailsElement).open)) await price.getByText("价格与参数依据", { exact: true }).click();
  const tariff = model.pricing;
  expect(tariff, `${model.id} 的官方价格记录`).toBeDefined();
  const unit = tariff!.billingUnit === "second" ? "秒" : "次";
  const rates = tariff!.tiers?.map(tier => tier.price) ?? [tariff!.unitAmount];
  expect(rates.length).toBeGreaterThan(0);
  for (const amount of rates) await expectQuotedAmount(price.getByRole("region", { name: "型号报价", exact: true }), amount!, tariff!.currency, unit);
  for (const tier of tariff!.tiers ?? []) if (tier.value !== undefined) await expect(price).toContainText(String(tier.value));
  await expect(price.getByRole("link", { name: "查看价格来源", exact: true })).toHaveAttribute("href", `${origin}/api/pricing`);
}

for (const kind of ["image", "video"] as const) test(`极九 ${kind} 全分组完整型号、报价来源与合法参数控件`, async ({ page, request }, testInfo) => {
  test.setTimeout(180_000);
  const relevant = groups.filter(group => group.models.some(model => model.capability === kind));
  const f = await setup(page, request, kind, relevant[0]!.id);
  const seen = new Set<string>();
  try {
    for (const group of relevant) {
      await f.selectGroup(group.id);
      const models = f.modelMap.get(group.id)!;
      for (const model of models) {
        await f.menu();
        const option = f.option(model.id);
        await expect(option).toHaveAttribute("aria-disabled", "false");
        await option.click(); await expect(f.picker).toContainText(model.id); seen.add(model.id);
        if (kind === "image") {
          if (model.id.startsWith("gpt-image-2")) {
            const quality = f.panel.getByLabel("质量", { exact: true });
            expect(await quality.locator('option:not([value=""])').evaluateAll(options => options.map(option => (option as HTMLOptionElement).value))).toEqual(model.id.startsWith("gpt-image-2.5") ? ["auto", "low", "medium", "high", "xhigh", "max"] : ["auto", "low", "medium", "high"]);
            await quality.selectOption("high");
          } else await expect(f.panel.getByLabel("质量", { exact: true })).toHaveCount(0);
          await expect(f.panel.getByLabel("输出格式", { exact: true })).toHaveCount(0);
          const openPixelSize = ["gpt-image-2", "gpt-image-2.5", "gpt-image-2.5-sunburst"].includes(model.id);
          const editableDimensions = f.panel.locator('input[aria-label="图片宽度"]:not([readonly]),input[aria-label="图片高度"]:not([readonly])');
          await expect(editableDimensions).toHaveCount(openPixelSize ? 2 : 0);
          if (openPixelSize) {
            // The supplier declares an open WIDTHxHEIGHT size string. Its
            // example is not an exhaustive range, alignment or native K tier.
            const width = f.panel.getByRole("spinbutton", { name: "图片宽度", exact: true });
            const height = f.panel.getByRole("spinbutton", { name: "图片高度", exact: true });
            await expect(width).not.toHaveAttribute("max", /.+/u);
            await expect(height).not.toHaveAttribute("max", /.+/u);
            await expect(width).not.toHaveAttribute("step", "16");
            await width.fill("1024"); await height.fill("1024"); await height.blur();
            await expect.poll(async () => (await f.saved()).parameters.size).toBe("1024x1024");
          }
          const size = model.parameters!.find(parameter => ["size", "image_size"].includes(parameter.key))!;
          const tiers = f.panel.getByRole("group", { name: "自动与输出分辨率快捷档位", exact: true });
          await expect(tiers.getByRole("button")).toHaveText(openPixelSize ? ["自动", "1K", "2K", "4K"] : size.options!.map(option => option.value === "auto" ? "自动" : option.label));
          await expect.poll(() => tiers.getByRole("button").evaluateAll(buttons => Math.max(0, ...buttons.flatMap(button => [
            button.scrollHeight - button.clientHeight, button.scrollWidth - button.clientWidth,
          ])))).toBeLessThanOrEqual(1);
          for (const choice of size.options!) {
            const button = tiers.getByRole("button", { name: choice.value === "auto" ? "自动" : openPixelSize ? "1K" : choice.label, exact: true });
            await button.click(); await expect(button).toHaveAttribute("aria-pressed", "true");
          }
          await tiers.getByRole("button", { name: "自动", exact: true }).click();
          if (size.key === "image_size") {
            const ratio = f.panel.getByRole("combobox", { name: "画面比例", exact: true });
            expect(await ratio.locator('option:not([value=""])').evaluateAll(options => options.map(option => (option as HTMLOptionElement).value))).toEqual(["auto"]);
            await ratio.selectOption("auto");
            await expect(f.panel.getByRole("textbox", { name: "图片宽度", exact: true })).toHaveValue("");
            await expect(f.panel.getByRole("textbox", { name: "图片高度", exact: true })).toHaveValue("");
          }
        } else {
          const duration = model.parameters!.find(parameter => parameter.key === "duration")!;
          if (duration.control === "select") {
            const select = f.panel.getByRole("combobox", { name: "视频时长", exact: true });
            const values = duration.options!.map(option => String(option.value));
            expect(await select.locator('option:not([value=""]):not([disabled])').evaluateAll(options => options.map(option => (option as HTMLOptionElement).value))).toEqual(values);
            const selected = String(duration.default ?? duration.options![0]!.value);
            await select.selectOption(selected); await expect(select).toHaveValue(selected);
            await expect.poll(async () => (await f.saved()).parameters.duration).toBe(Number(selected));
          } else if (duration.allowCustomValue && duration.max === undefined) {
            // Minimax's current guide leaves the API upper bound open. Keep
            // its positive-integer editor instead of inventing a capped slider.
            expect(duration.min).toBe(1);
            const input = f.panel.getByRole("spinbutton", { name: "视频时长", exact: true });
            await expect(input).toHaveAttribute("min", "1");
            await expect(input).toHaveAttribute("step", "1");
            await expect(input).not.toHaveAttribute("max");
            await expect(f.panel.getByRole("slider", { name: "视频时长", exact: true })).toHaveCount(0);
            await input.fill("23"); await input.blur();
            await expect(input).toHaveValue("23");
            await expect.poll(async () => (await f.saved()).parameters.duration).toBe(23);
          } else {
            const slider = f.panel.getByRole("slider", { name: "视频时长", exact: true });
            await expect(slider).toHaveAttribute("min", String(duration.min)); await expect(slider).toHaveAttribute("max", String(duration.max));
            const repair = f.panel.getByRole("button", { name: `使用 ${duration.min} 秒`, exact: true });
            if (await repair.count()) await repair.click();
            await slider.press("Home"); await expect(slider).toHaveValue(String(duration.min));
          }
          const resolutionDescriptor = model.parameters!.find(parameter => parameter.key === "resolution")!;
          const expected = resolutionDescriptor.options?.map(option => String(option.value)) ?? [];
          // An invalid saved value remains visible but cannot become a new
          // selectable supplier option. Explicitly choose the documented/default
          // value before checking the next model and its price.
          if (resolutionDescriptor.control === "text") {
            // A declared string with no enum remains editable. Leave it blank
            // for the supplier default rather than fabricate a select option.
            expect(resolutionDescriptor.allowCustomValue).toBe(true);
            const resolution = f.panel.getByRole("textbox", { name: "输出分辨率", exact: true });
            await resolution.fill(String(resolutionDescriptor.default ?? "")); await resolution.blur();
            await expect(resolution).toHaveValue(String(resolutionDescriptor.default ?? ""));
          } else {
            const resolution = f.panel.getByRole("combobox", { name: "输出分辨率", exact: true });
            expect(await resolution.locator('option:not([value=""]):not([disabled])').evaluateAll(options => options.map(option => (option as HTMLOptionElement).value))).toEqual(expected);
            for (const saved of await resolution.locator('option[disabled]').all()) await expect(saved).toContainText("已保存");
            await resolution.selectOption(expected[0] ?? "");
            await expect(resolution.locator('option[disabled]')).toHaveCount(0);
          }
          const price = f.panel.getByLabel("当前参数价格", { exact: true });
          const summary = price.getByRole("region", { name: "型号报价", exact: true });
          const estimate = estimateAmount(price);
          // Independent official examples test real parameter-to-price rendering,
          // in addition to the full directory/source evidence checked below.
          const examples: Record<string, [string, string]> = {
            "满血seedance-2.5全参A": ["12 CNY / 次", "12 CNY"],
            "满血seedance-2.5全参B": ["0.5 CNY / 秒", "2 CNY"],
            "稳定seedance-2.5参图参音F": ["0.4 CNY / 秒", "1.6 CNY"],
            "SD2.0mini稳定903C": ["0.6 CNY / 次", "0.6 CNY"],
            "SD2.5特价30-10-10-线路一": ["6 CNY / 次", "6 CNY"],
            "MinimaxH3特价版": ["0.8 CNY / 次", "0.8 CNY"],
          };
          if (examples[model.id]) {
            const [amount, currency, , unit] = examples[model.id]![0].split(" ");
            await expectQuotedAmount(summary, amount!, currency!, unit!);
            await expect(estimate).toHaveText(examples[model.id]![1]);
          }
          // The merged October 14 E contract bills output seconds only: 4s at 480p is 1 CNY.
          if (model.id === "稳定seedance-2.5全参E") await expect(estimate).toHaveText("1 CNY");
          if (["wan3.0-video", "wan3.0-video-prime"].includes(model.id)) await expect(estimate).toHaveCount(0);
          if (["SD2.5特价30-10-10-线路一", "稳定seedance-2.5参图参音F", "SD2.0mini稳定903C"].includes(model.id)) {
            await assertPriceSource(f.panel, model);
            await f.panel.screenshot({ path: testInfo.outputPath(`${model.id}-parameters.png`) });
          }
        }
        await assertPriceSource(f.panel, model);
        const file = `${group.id}-${model.id}`.replace(/[^\p{L}\p{N}_.-]+/gu, "-");
        await f.panel.locator(".node-config-popover-body").evaluate(element => { element.scrollTop = 0; });
        await f.panel.screenshot({ path: testInfo.outputPath(`${file}-controls.png`) });
        await f.panel.getByLabel("当前参数价格", { exact: true }).scrollIntoViewIfNeeded();
        await f.panel.screenshot({ path: testInfo.outputPath(`${file}-price.png`) });
      }
    }
    expect(seen.size).toBe(kind === "image" ? 7 : 18);
    await f.panel.screenshot({ path: testInfo.outputPath(`jijiu-${kind}-final-group.png`) });
  } finally { f.safe(); }
});

test("极九高档GPT的原生K档与独立最高质量保存、刷新和切组保持一致", async ({ page, request }, testInfo) => {
  const f = await setup(page, request, "image", "default");
  const modelId = "gpt-image-2-2K/4K";
  const tiers = f.panel.getByRole("group", { name: "自动与输出分辨率快捷档位", exact: true });
  const quality = f.panel.getByRole("combobox", { name: "质量", exact: true });
  try {
    await f.choose(modelId);
    await expect(tiers.getByRole("button")).toHaveText(["自动", "1K", "2K", "4K"]);
    expect(await quality.locator('option:not([value=""])').evaluateAll(options => options.map(option => (option as HTMLOptionElement).value))).toEqual(["auto", "low", "medium", "high"]);
    const notes = f.panel.locator(".parameter-contract-details");
    await expect(notes).toHaveCount(1);
    await expect(notes).not.toHaveAttribute("open", "");
    await expect(f.panel.locator(".parameter-group-note")).toHaveCount(0);
    for (const tier of ["1K", "2K", "4K"]) {
      await tiers.getByRole("button", { name: tier, exact: true }).click();
      await quality.selectOption("high");
      await expect(tiers.getByRole("button", { name: tier, exact: true })).toHaveAttribute("aria-pressed", "true");
      await expect.poll(async () => (await f.saved()).parameters).toMatchObject({ size: tier, quality: "high" });
      await expect(f.panel.getByRole("textbox", { name: "图片宽度", exact: true })).toHaveValue("");
      await expect(f.panel.getByRole("textbox", { name: "图片高度", exact: true })).toHaveValue("");
    }
    const price = f.panel.getByLabel("当前参数价格", { exact: true });
    await expectQuotedAmount(price.getByRole("region", { name: "型号报价", exact: true }), 0.1, "CNY", "次");
    await expect(price.getByRole("region", { name: "型号报价", exact: true })).toContainText("按次");
    await expect(estimateAmount(price)).toHaveText("0.1 CNY");
    await quality.scrollIntoViewIfNeeded();
    await f.panel.screenshot({ path: testInfo.outputPath("jijiu-gpt-4k-high-controls.png") });
    await page.reload(); await f.open();
    await expect(f.picker).toContainText(modelId);
    await expect(tiers.getByRole("button", { name: "4K", exact: true })).toHaveAttribute("aria-pressed", "true");
    await expect(quality).toHaveValue("high");
    await f.selectGroup("图片-GPT-image-2-2K/4K"); await f.choose(modelId);
    // The same supplier/model carries the current legal selection into a new
    // group; an already configured group restores its own saved selection.
    await expect(tiers.getByRole("button", { name: "4K", exact: true })).toHaveAttribute("aria-pressed", "true");
    await expect(quality).toHaveValue("high");
    await expect.poll(async () => (await f.saved()).parameters).toMatchObject({ size: "4K", quality: "high" });
    await tiers.getByRole("button", { name: "2K", exact: true }).click();
    await quality.selectOption("high");
    await expect.poll(async () => (await f.saved()).parameters).toMatchObject({ size: "2K", quality: "high" });
    await f.selectGroup("default"); await f.choose(modelId);
    await expect(tiers.getByRole("button", { name: "4K", exact: true })).toHaveAttribute("aria-pressed", "true");
    await expect(quality).toHaveValue("high");
    await expect.poll(async () => (await f.saved()).parameters).toMatchObject({ size: "4K", quality: "high" });
    await f.selectGroup("图片-GPT-image-2-2K/4K"); await f.choose(modelId);
    await expect(tiers.getByRole("button", { name: "2K", exact: true })).toHaveAttribute("aria-pressed", "true");
    await expect(quality).toHaveValue("high");
    await expect.poll(async () => (await f.saved()).parameters).toMatchObject({ size: "2K", quality: "high" });
    await f.selectGroup("default"); await f.choose(modelId);
    await page.reload(); await f.open();
    await expect(tiers.getByRole("button", { name: "4K", exact: true })).toHaveAttribute("aria-pressed", "true");
    await f.selectGroup("图片-GPT-image-2-2K/4K"); await f.choose(modelId);
    await expect(tiers.getByRole("button", { name: "2K", exact: true })).toHaveAttribute("aria-pressed", "true");
    await expect(quality).toHaveValue("high");
    await quality.scrollIntoViewIfNeeded();
    await f.panel.screenshot({ path: testInfo.outputPath("jijiu-gpt-2k-high-independent-group.png") });
    await quality.selectOption("auto");
    await expect.poll(async () => (await f.saved()).parameters).toMatchObject({ size: "2K", quality: "auto" });
    await tiers.getByRole("button", { name: "自动", exact: true }).click();
    await expect.poll(async () => (await f.saved()).parameters).toMatchObject({ size: "auto", quality: "auto" });
    await expect(tiers.getByRole("button", { name: "自动", exact: true })).toHaveAttribute("aria-pressed", "true");
  } finally { f.safe(); }
});

test("极九5–30、F4–30与mini5–10边界选择和刷新保存，错误分组型号不可运行", async ({ page, request }, testInfo) => {
  const f = await setup(page, request, "video", "视频SD2.0", { wrongGroup: true });
  try {
    await f.menu(); await expectDirectoryStat(f.summary, "Key", "6");
    const wrong = f.option("稳定seedance-2.5参图参音F");
    await expect(wrong).toHaveAttribute("aria-disabled", "true");
    await expect(wrong).not.toContainText("时长：");
    await expect(wrong).not.toContainText("不支持");
    await f.choose("SD2.0mini稳定903C");
    const slider = f.panel.getByRole("slider", { name: "视频时长", exact: true });
    await expect(slider).toHaveAttribute("min", "5");
    await expect(slider).toHaveAttribute("max", "10");
    await slider.press("End"); await expect(slider).toHaveValue("10");
    await f.panel.getByRole("combobox", { name: "输出分辨率", exact: true }).selectOption("480p");
    await expect.poll(async () => (await f.saved()).parameters).toMatchObject({ duration: 10, resolution: "480p" });
    await page.reload(); await f.open(); await expect(slider).toHaveValue("10");
    await f.selectGroup("稳定满血视频模型"); await f.choose("稳定seedance-2.5参图参音F");
    await expect(slider).toHaveAttribute("min", "4");
    await expect(slider).toHaveAttribute("max", "30");
    await slider.press("End"); await expect(slider).toHaveValue("30");
    await f.panel.getByRole("combobox", { name: "输出分辨率", exact: true }).selectOption("480p");
    await expect.poll(async () => (await f.saved()).parameters).toMatchObject({ duration: 30, resolution: "480p" });
    await page.reload(); await f.open("稳定满血视频模型");
    await expect(f.picker).toContainText("稳定seedance-2.5参图参音F");
    await expect(slider).toHaveValue("30");
    await expect.poll(async () => (await f.saved()).parameters).toMatchObject({ duration: 30, resolution: "480p" });
    await f.panel.screenshot({ path: testInfo.outputPath("jijiu-f-30-seconds-480p.png") });
    await f.selectGroup("视频SD.2.5"); await f.choose("SD2.5特价30-10-10-线路一");
    // Video connection switches use the new contract's defaults; only image
    // selections currently restore per-connection history. This 5–30 contract
    // has no default, so the slider's 5 is a candidate, not a saved selection.
    await expect(f.panel.getByRole("combobox", { name: "视频时长", exact: true })).toHaveCount(0);
    await expect(slider).toHaveAttribute("min", "5");
    await expect(slider).toHaveAttribute("max", "30");
    await expect(slider).toHaveValue("5");
    await expect(slider).toHaveAttribute("aria-invalid", "true");
    await expect.poll(async () => (await f.saved()).parameters).not.toHaveProperty("duration");
    await slider.press("End"); await expect(slider).toHaveValue("30");
    await expect.poll(async () => (await f.saved()).parameters.duration).toBe(30);
    await page.reload(); await f.open("视频SD.2.5");
    await expect(f.picker).toContainText("SD2.5特价30-10-10-线路一");
    await expect(slider).toHaveValue("30");
    await expect.poll(async () => (await f.saved()).parameters.duration).toBe(30);
  } finally { f.safe(); }
});

test("极九视频比例快捷选择、自定义原值与供应商默认保存刷新", async ({ page, request }, testInfo) => {
  const writtenRatios: unknown[] = [];
  page.on("request", outgoing => {
    if (outgoing.method() !== "PUT" || !new URL(outgoing.url()).pathname.startsWith("/api/canvas/")) return;
    const body = outgoing.postDataJSON() as { graph?: { nodes?: Array<{ data?: { parameters?: Record<string, unknown> } }> } };
    for (const node of body.graph?.nodes ?? []) writtenRatios.push(node.data?.parameters?.aspect_ratio);
  });
  const modelId = "SD2.5特价30-10线路一";
  const f = await setup(page, request, "video", "视频SD.2.5", { initialModelId: modelId, initialParameters: { aspect_ratio: "3:2", duration: 30, resolution: "720p", seed: 0 } });
  try {
    const ratio = f.panel.getByRole("combobox", { name: "画面比例", exact: true });
    const custom = f.panel.getByRole("textbox", { name: "画面比例（自定义）", exact: true });
    await expect(f.panel.getByRole("slider", { name: "视频时长", exact: true })).toHaveAttribute("min", "4");
    await expect(f.panel.getByRole("slider", { name: "视频时长", exact: true })).toHaveAttribute("max", "30");
    await expect(f.panel.getByRole("combobox", { name: "输出分辨率", exact: true })).toHaveValue("720p");
    await expectQuotedAmount(f.panel.getByLabel("当前参数价格", { exact: true }).getByRole("region", { name: "型号报价", exact: true }), 1.5, "CNY", "次");
    await expect(ratio.locator("option")).toHaveText(["供应商默认", "16:9（横屏）", "9:16（竖屏）", "1:1（方形）", "自定义"]);
    await expect(ratio).toHaveValue("__custom_ratio__"); await expect(custom).toHaveValue("3:2");
    expect((await f.saved()).parameters.aspect_ratio).toBe("3:2");
    await page.reload(); await f.open();
    await expect(custom).toHaveValue("3:2");
    for (const value of ["16:9", "9:16", "1:1"]) {
      await ratio.selectOption(value); await expect(custom).toHaveCount(0);
      await expect.poll(async () => (await f.saved()).parameters.aspect_ratio).toBe(value);
    }
    await ratio.selectOption("__custom_ratio__");
    await expect(custom).toHaveValue("1:1");
    expect((await f.saved()).parameters.aspect_ratio).toBe("1:1");
    await custom.fill("21:9");
    await expect.poll(async () => (await f.saved()).parameters.aspect_ratio).toBe("21:9");
    await f.panel.screenshot({ path: testInfo.outputPath("jijiu-video-custom-ratio-21-9.png") });
    await page.reload(); await f.open(); await expect(custom).toHaveValue("21:9");
    await ratio.selectOption(""); await expect(custom).toHaveCount(0);
    await expect.poll(async () => (await f.saved()).parameters).not.toHaveProperty("aspect_ratio");
    await page.reload(); await f.open(); await expect(ratio).toHaveValue("");
    await ratio.selectOption("__custom_ratio__"); await expect(custom).toHaveValue("");
    expect((await f.saved()).parameters).not.toHaveProperty("aspect_ratio");
    await custom.fill("2.39:1");
    await expect.poll(async () => (await f.saved()).parameters.aspect_ratio).toBe("2.39:1");
    await f.choose("SD2.5特价30-10-10-线路二"); await f.choose(modelId);
    await expect(custom).toHaveValue("2.39:1");
    await expect.poll(async () => (await f.saved()).parameters.aspect_ratio).toBe("2.39:1");
    expect(writtenRatios.length).toBeGreaterThan(0);
    expect(writtenRatios.every(value => value === undefined || typeof value === "string" && /^\d+(?:\.\d+)?:\d+(?:\.\d+)?$/u.test(value))).toBe(true);
  } finally { f.safe(); }
});

test("极九F旧720p保留并提示，用户明确选480p与30秒后保存刷新", async ({ page, request }, testInfo) => {
  const f = await setup(page, request, "video", "稳定满血视频模型", {
    initialModelId: "稳定seedance-2.5参图参音F", initialParameters: { duration: 29, resolution: "720p" },
  });
  try {
    const resolution = f.panel.getByRole("combobox", { name: "输出分辨率", exact: true });
    await expect.poll(async () => (await f.saved()).parameters).toMatchObject({ duration: 29, resolution: "720p" });
    await expect(resolution).toHaveValue("720p");
    await expect(resolution).toHaveAttribute("aria-invalid", "true");
    await page.reload(); await f.open();
    await expect.poll(async () => (await f.saved()).parameters).toMatchObject({ duration: 29, resolution: "720p" });
    await resolution.selectOption("480p");
    const duration = f.panel.getByRole("slider", { name: "视频时长", exact: true });
    await expect(duration).toHaveAttribute("max", "30");
    await duration.press("End");
    await expect.poll(async () => (await f.saved()).parameters).toMatchObject({ duration: 30, resolution: "480p" });
    await page.reload(); await f.open();
    await expect(resolution).toHaveValue("480p"); await expect(duration).toHaveValue("30");
    await f.panel.screenshot({ path: testInfo.outputPath("jijiu-f-old-720p-explicitly-updated.png") });
  } finally { f.safe(); }
});

test("极九目录内容相同时完成状态仍更新，切换与页面刷新保持确认", async ({ page, request }, testInfo) => {
  const f = await setup(page, request, "video", "视频SD2.0", { incomplete: true });
  try {
    await f.menu(); await expectDirectoryStat(f.summary, "Key", "—");
    await f.finishScan();
    await expectDirectoryStat(f.summary, "Key", "5"); await expectDirectoryStat(f.summary, "双方", "5");
    await expect.poll(() => f.responses.length).toBeGreaterThan(1);
    expect(new Set(f.responses).size).toBe(1);
    await f.panel.screenshot({ path: testInfo.outputPath("jijiu-same-models-confirmed.png") });
    await f.selectGroup("视频WAN3"); await f.selectGroup("视频SD2.0");
    await expectDirectoryStat(f.summary, "Key", "5");
    await page.keyboard.press("Escape"); await expect.poll(async () => (await f.saved()).connectionId).toBeTruthy();
    await page.reload(); await f.open(); await f.menu(); await expectDirectoryStat(f.summary, "Key", "5");
  } finally { f.safe(); }
});
