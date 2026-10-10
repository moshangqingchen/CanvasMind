import { readFileSync } from "node:fs";
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { parseSupplierCatalog, remainingVideoModel, scanProviderModelCatalog, type ModelDescriptor, type StructuredModelPricing } from "@super-canvas/providers";
import { applyJijiuImageCapabilities } from "@super-canvas/providers/jijiu-image-contract";
import type { ProviderConnectionView } from "../lib/client-api";

// Public, sanitized official evidence; storage uses an invalid host and every
// browser upstream request/run submission is blocked. No real account is used.
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

async function setup(page: Page, request: APIRequestContext, kind: "image" | "video", initialGroup: string, options: { incomplete?: boolean; wrongGroup?: boolean } = {}) {
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
  const first = modelMap.get(initialGroup)![0]!;
  const parameters = Object.fromEntries((first.parameters ?? []).filter(parameter => parameter.default !== undefined).map(parameter => [parameter.key, parameter.default]));
  const createdCanvas = await request.post("/api/canvas", { data: { title: "极九目录参数离线验收", graph: {
    schemaVersion: 1, viewport: { x: 0, y: 0, zoom: 1 }, edges: [], nodes: [{ id: "jijiu-media", type: "workflow", position: { x: 85, y: 60 }, style: { width: 420, height: 180 },
      data: { nodeType: `${kind}-generation`, label, provider: "openai", connectionId: connection.id, model: first.id, parameters, qualityMode: "custom", parts: [],
        inputs: [{ id: "prompt", kind: "text", label: "提示词" }], outputs: [{ id: "result", kind, label: "结果" }] } }],
  } } });
  expect(createdCanvas.ok()).toBeTruthy();
  const canvas = await createdCanvas.json();
  const panel = page.getByRole("dialog", { name: `${label} 模型与参数`, exact: true });
  const picker = panel.getByRole("combobox", { name: `${label} 模型`, exact: true });
  const groupControl = panel.getByRole("combobox", { name: `${label} 模型群组`, exact: true });
  const summary = panel.getByLabel("官网与 Key 目录对照", { exact: true });
  const open = async () => {
    await page.getByRole("button", { name: `打开 ${label} 模型与参数`, exact: true }).click();
    await expect(panel).toBeVisible();
    const sidebar = page.getByRole("button", { name: "智能体面板", exact: true });
    if (await sidebar.getAttribute("aria-expanded") === "true") await sidebar.click();
    await expect(groupControl).toHaveValue(initialGroup);
  };
  const menu = async () => { if (await picker.getAttribute("aria-expanded") !== "true") await picker.click(); await expect(panel.getByRole("listbox")).toBeVisible(); };
  const option = (id: string) => panel.getByRole("option").filter({ has: page.locator('[id$="-id"]').filter({ hasText: new RegExp(`^ID:\\s*${id.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}$`, "u") }) });
  const choose = async (id: string) => { await menu(); await option(id).click(); await expect(picker).toContainText(id); };
  const selectGroup = async (group: string) => {
    await groupControl.selectOption(group); await expect(groupControl).toHaveValue(group);
    await expect.poll(() => reads.get(group) ?? 0).toBeGreaterThan(0);
    await menu(); await expect(summary).toContainText(`Key ${modelMap.get(group)!.length}`);
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
  await expect(price).toContainText(String(model.metadata?.priceLabel));
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
          await expect(f.panel.getByLabel("质量", { exact: true })).toHaveCount(0);
          await expect(f.panel.getByLabel("输出格式", { exact: true })).toHaveCount(0);
          await expect(f.panel.locator('input[aria-label="图片宽度"]:not([readonly]),input[aria-label="图片高度"]:not([readonly])')).toHaveCount(0);
          const size = model.parameters!.find(parameter => ["size", "image_size"].includes(parameter.key))!;
          const tiers = f.panel.getByRole("group", { name: "自动与输出分辨率快捷档位", exact: true });
          await expect(tiers.getByRole("button")).toHaveText(size.options!.map(option => option.value === "auto" ? "自动" : option.label));
          await expect.poll(() => tiers.getByRole("button").evaluateAll(buttons => Math.max(0, ...buttons.flatMap(button => [
            button.scrollHeight - button.clientHeight, button.scrollWidth - button.clientWidth,
          ])))).toBeLessThanOrEqual(1);
          for (const choice of size.options!) {
            const button = tiers.getByRole("button", { name: choice.value === "auto" ? "自动" : choice.label, exact: true });
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
            await expect(select.locator('option:not([value=""])')).toHaveText(["30 秒"]);
            await expect(select).toHaveValue("30");
          } else {
            const slider = f.panel.getByRole("slider", { name: "视频时长", exact: true });
            await expect(slider).toHaveAttribute("min", String(duration.min)); await expect(slider).toHaveAttribute("max", String(duration.max));
            const repair = f.panel.getByRole("button", { name: `使用 ${duration.min} 秒`, exact: true });
            if (await repair.count()) await repair.click();
            await slider.press("Home"); await expect(slider).toHaveValue(String(duration.min));
          }
          const resolution = f.panel.getByRole("combobox", { name: "输出分辨率", exact: true });
          const expected = model.parameters!.find(parameter => parameter.key === "resolution")?.options?.map(option => String(option.value)) ?? [];
          // An invalid saved value remains visible but cannot become a new
          // selectable supplier option. Explicitly choose the documented/default
          // value before checking the next model and its price.
          expect(await resolution.locator('option:not([value=""]):not([disabled])').evaluateAll(options => options.map(option => (option as HTMLOptionElement).value))).toEqual(expected);
          for (const saved of await resolution.locator('option[disabled]').all()) await expect(saved).toContainText("已保存");
          await resolution.selectOption(expected[0] ?? "");
          await expect(resolution.locator('option[disabled]')).toHaveCount(0);
          const price = f.panel.getByLabel("当前参数价格", { exact: true });
          const summary = price.locator(":scope > span").filter({ hasText: "当前组合价格" }).locator("strong");
          const estimate = price.locator(":scope > span").filter({ hasText: "本次预计费用" }).locator("strong");
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
            await expect(summary).toHaveText(examples[model.id]![0]);
            await expect(estimate).toHaveText(examples[model.id]![1]);
          }
          if (["稳定seedance-2.5全参E", "wan3.0-video", "wan3.0-video-prime"].includes(model.id)) await expect(estimate).toHaveCount(0);
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

test("极九固定30、4–29与mini4–10切换保存，错误分组型号不可运行", async ({ page, request }, testInfo) => {
  const f = await setup(page, request, "video", "视频SD2.0", { wrongGroup: true });
  try {
    await f.menu(); await expect(f.summary).toContainText("Key 6");
    const wrong = f.option("稳定seedance-2.5参图参音F");
    await expect(wrong).toHaveAttribute("aria-disabled", "true"); await expect(wrong).toContainText("分组");
    await f.choose("SD2.0mini稳定903C");
    const slider = f.panel.getByRole("slider", { name: "视频时长", exact: true });
    await slider.press("End"); await expect(slider).toHaveValue("10");
    await f.panel.getByRole("combobox", { name: "输出分辨率", exact: true }).selectOption("480p");
    await expect.poll(async () => (await f.saved()).parameters).toMatchObject({ duration: 10, resolution: "480p" });
    await page.reload(); await f.open(); await expect(slider).toHaveValue("10");
    await f.selectGroup("稳定满血视频模型"); await f.choose("稳定seedance-2.5参图参音F");
    await slider.press("End"); await expect(slider).toHaveValue("29");
    await f.panel.getByRole("combobox", { name: "输出分辨率", exact: true }).selectOption("720p");
    await expect.poll(async () => (await f.saved()).parameters).toMatchObject({ duration: 29, resolution: "720p" });
    await f.panel.screenshot({ path: testInfo.outputPath("jijiu-f-29-seconds.png") });
    await f.selectGroup("视频SD.2.5"); await f.choose("SD2.5特价30-10-10-线路一");
    await expect(f.panel.getByRole("combobox", { name: "视频时长", exact: true })).toHaveValue("30");
    await expect(slider).toHaveCount(0);
    await expect.poll(async () => (await f.saved()).parameters.duration).toBe(30);
  } finally { f.safe(); }
});

test("极九目录内容相同时完成状态仍更新，切换与页面刷新保持确认", async ({ page, request }, testInfo) => {
  const f = await setup(page, request, "video", "视频SD2.0", { incomplete: true });
  try {
    await f.menu(); await expect(f.summary).toContainText("Key 目录待确认");
    await f.finishScan();
    await expect(f.summary).toContainText("Key 5"); await expect(f.summary).toContainText("双方 5");
    await expect.poll(() => f.responses.length).toBeGreaterThan(1);
    expect(new Set(f.responses).size).toBe(1);
    await f.panel.screenshot({ path: testInfo.outputPath("jijiu-same-models-confirmed.png") });
    await f.selectGroup("视频WAN3"); await f.selectGroup("视频SD2.0");
    await expect(f.summary).toContainText("Key 5");
    await page.keyboard.press("Escape"); await expect.poll(async () => (await f.saved()).connectionId).toBeTruthy();
    await page.reload(); await f.open(); await f.menu(); await expect(f.summary).toContainText("Key 5");
  } finally { f.safe(); }
});
