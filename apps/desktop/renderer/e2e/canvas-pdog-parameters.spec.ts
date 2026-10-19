import { expect, test, type Page, type APIRequestContext } from "./helpers/canvas-offline-test";
import { imageSizeOptions, type ModelDescriptor } from "@super-canvas/providers";
import { parseSupplierGroupDetails, supplierGroupModelPriceDetails, supplierGroupPriceLabel, supplierGroupResolutionLabel } from "@super-canvas/providers/supplier-group-details";
import type { ProviderConnectionView } from "../lib/client-api";
import { cleanModelDisplayName } from "../lib/model-display";
import { chooseParameterOption, expectParameterValue, openParameterDetails, readParameterOptions } from "./helpers/parameter-controls";

const supplierKey = "custom-pdog-isolated-e2e";
const groups = {
  upscale: "【生图】image2/2.5-1K2K4K(超分组)",
  native: "【生图】image2/2.5-2K4K(原生)",
  banana: "【生图】🍌香蕉nano-banana（稳定渠道）",
};
const descriptions = {
  upscale: "0.03/张，1K/2K/4K同价，1K为原生，2K4K为超分，比例可自由调整",
  native: "0.08一张，原生2K/4K",
  banana: "香蕉2：0.07/张, ID：gemini-3.1-flash-image-preview\n香蕉pro：0.08/张, ID：gemini-3-pro-image",
};
const bananaIds = ["gemini-3.1-flash-image-preview", "gemini-3-pro-image"];

function cachedModel(id: string, group: keyof typeof groups): ModelDescriptor {
  const details = parseSupplierGroupDetails({ name: groups[group], description: descriptions[group] }, "key-groups")!;
  const scoped = supplierGroupModelPriceDetails(details, id, bananaIds);
  return {
    id, name: id, operations: ["image.generate", "image.edit"], inputKinds: ["text", "image[]"], outputKinds: ["image"],
    // Reproduce a pre-update cache and generic live inventory. The UI restores
    // the user preset while retaining the supplier's explicit group limits.
    parameters: [
      { key: "size", label: "尺寸", control: "dimensions", default: "auto", options: imageSizeOptions(["1K", "2K", "4K"], 4096) },
      { key: "quality", label: "质量", control: "select", default: "max", options: ["low", "medium", "high", "xhigh", "max"].map(value => ({ value, label: value })) },
    ],
    metadata: { qualitySupport: "assumed", priceSource: "supplier-group", priceStatus: "documented",
      priceLabel: supplierGroupPriceLabel(scoped), supplierGroupResolutionLabel: supplierGroupResolutionLabel(details) },
  };
}

const inventories: Record<keyof typeof groups, ModelDescriptor[]> = {
  upscale: [cachedModel("gpt-image-2", "upscale"), cachedModel("gpt-image-2.5-flare", "upscale"), cachedModel("gpt-image-2.5-sunburst", "upscale")],
  native: [cachedModel("gpt-image-2", "native"), cachedModel("gpt-image-2.5-flare", "native")],
  banana: bananaIds.map(id => cachedModel(id, "banana")),
};
const connections: ProviderConnectionView[] = (Object.keys(groups) as Array<keyof typeof groups>).map(group => ({
  id: `isolated-pdog-${group}`, name: `pDog ${group}`, provider: "openai", apiKey: "", apiKeySet: true, apiKeyUsable: true,
  config: { supplierKey, supplierName: "pDog", usage: "canvas", baseUrl: "https://ai.whyshy.cn",
    modelGroup: groups[group], accountKeyGroup: groups[group], defaultModel: inventories[group][0]!.id,
    modelScanStatus: "live", modelCatalogModels: inventories[group] },
}));

test.beforeAll(() => {
  // These tests persist real canvas records only in globalSetup's mkdtemp
  // profile. Never allow an externally supplied server/profile to be reused.
  expect(process.env.PLAYWRIGHT_BASE_URL, "pDog regression requires the isolated globalSetup server").toBeFalsy();
});

async function setup(page: Page, request: APIRequestContext, group: keyof typeof groups, modelId?: string) {
  await page.setViewportSize({ width: 1600, height: 1080 });
  let submissions = 0, upstreamRequests = 0, scans = 0;
  await page.route("https://ai.whyshy.cn/**", route => { upstreamRequests++; return route.abort(); });
  await page.route(/\/api\/providers(?:\?.*)?$/, route => route.fulfill({ json: connections }));
  await page.route(/\/api\/suppliers(?:\?.*)?$/, route => route.fulfill({ json: [] }));
  for (const connection of connections) {
    const kind = connection.id.slice("isolated-pdog-".length) as keyof typeof groups;
    await page.route(`**/api/providers/${connection.id}/models*`, route => {
      scans++;
      return route.fulfill({ json: inventories[kind], headers: { "X-Model-Scan-Status": "live" } });
    });
  }
  await page.route("**/api/runs", async route => {
    if (route.request().method() === "POST") { submissions++; await route.abort(); }
    else await route.continue();
  });
  const connection = connections.find(connection => connection.id === `isolated-pdog-${group}`)!;
  const response = await request.post("/api/canvas", { data: { title: `pDog isolated ${group}`, graph: {
    schemaVersion: 1, viewport: { x: 0, y: 0, zoom: 1 }, edges: [], nodes: [{
      id: "pdog-image", type: "workflow", position: { x: 80, y: 60 }, style: { width: 420, height: 180 },
      data: { nodeType: "image-generation", label: "pDog 文档验收", provider: "openai", connectionId: connection.id,
        model: modelId ?? connection.config.defaultModel, qualityMode: "highest", parameters: {}, parts: [],
        inputs: [{ id: "prompt", kind: "text", label: "提示词" }], outputs: [{ id: "images", kind: "image", label: "图片" }] },
    }],
  } } });
  expect(response.ok()).toBeTruthy();
  const canvas = await response.json();
  const saved = async () => (await (await request.get(`/api/canvas/${canvas.id}`)).json()).graph.nodes[0].data;
  const open = () => page.getByRole("button", { name: "打开 pDog 文档验收 模型与参数", exact: true }).click();
  await page.goto(`/canvas/${canvas.id}`);
  await open();
  const panel = page.getByRole("dialog", { name: "pDog 文档验收 模型与参数", exact: true });
  return { canvas, saved, open, panel, safety: () => ({ submissions, upstreamRequests }), scans: () => scans };
}

test("pDog Image 2 旧缓存应用 high 质量、全部比例与档位，手选参数保存重载保持", async ({ page, request }, info) => {
  const fixture = await setup(page, request, "upscale");
  const { panel, saved, open } = fixture;
  const quality = panel.getByLabel("质量", { exact: true });
  const preset = panel.getByLabel("输出分辨率预设", { exact: true });
  const tiers = panel.getByRole("group", { name: "自动与输出分辨率快捷档位" });
  await expectParameterValue(quality, "high");
  expect((await readParameterOptions(quality)).filter(option => option.value && !option.disabled && !option.value.startsWith("__")).map(option => option.value))
    .toEqual(["auto", "low", "medium", "high"]);
  await expect.poll(fixture.scans).toBeGreaterThan(0);
  const ratios = ["1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3", "5:4", "4:5", "21:9", "9:21"];
  for (const tier of ["1K", "2K", "4K"]) {
    await tiers.getByRole("button", { name: tier, exact: true }).click();
    await expect(tiers.getByRole("button", { name: tier, exact: true })).toHaveAttribute("aria-pressed", "true");
    const options = (await readParameterOptions(preset)).filter(option => option.value && !option.disabled && !option.value.startsWith("__"));
    expect(options.length).toBeGreaterThanOrEqual(12);
    expect(options.filter(option => option.value === "auto")).toHaveLength(1);
    for (const ratio of ratios) expect(options.some(option => option.label.startsWith(ratio) && option.label.includes(tier))).toBeTruthy();
  }
  await chooseParameterOption(quality, "low");
  await chooseParameterOption(preset, "2160x3840");
  await expect.poll(async () => (await saved()).parameters).toMatchObject({ quality: "low", size: "2160x3840", size_tier: "4K" });
  await page.reload(); await open();
  await expectParameterValue(quality, "low");
  await expectParameterValue(preset, "2160x3840");
  await expect(tiers.getByRole("button", { name: "4K", exact: true })).toHaveAttribute("aria-pressed", "true");
  await chooseParameterOption(quality, "medium");
  await tiers.getByRole("button", { name: "2K", exact: true }).click();
  await chooseParameterOption(preset, "2048x896");
  await expect.poll(async () => (await saved()).parameters).toMatchObject({ quality: "medium", size: "2048x896", size_tier: "2K" });
  await page.reload(); await open();
  await expectParameterValue(quality, "medium");
  await expectParameterValue(preset, "2048x896");
  await expect(tiers.getByRole("button", { name: "2K", exact: true })).toHaveAttribute("aria-pressed", "true");
  await tiers.getByRole("button", { name: "自动", exact: true }).click();
  await expect.poll(async () => (await saved()).parameters.size).toBe("auto");
  await expect.poll(async () => Object.hasOwn((await saved()).parameters, "size_tier")).toBe(false);
  await page.reload(); await open();
  await expectParameterValue(preset, "auto");
  await expectParameterValue(quality, "medium");
  expect(fixture.safety()).toEqual({ submissions: 0, upstreamRequests: 0 });
  await panel.screenshot({ path: info.outputPath("pdog-cached-gpt-parameters.png") });
});

test("pDog 同型号切换分组展示原生与超分说明，并保存分组选择", async ({ page, request }, info) => {
  const fixture = await setup(page, request, "upscale");
  const { panel, saved, open } = fixture;
  await openParameterDetails(panel, "价格明细");
  await openParameterDetails(panel, "价格与参数依据");
  const price = panel.getByLabel("当前参数价格", { exact: true });
  await expect(price).toContainText("0.03/张");
  await expect(price).toContainText("说明原生 1K");
  await expect(price).toContainText("说明超分 2K / 4K");
  const group = panel.getByRole("combobox", { name: "pDog 文档验收 模型群组", exact: true });
  if (await group.count()) await group.selectOption(groups.native);
  else {
    await panel.getByRole("button", { name: "pDog 文档验收 线路", exact: true }).click();
    const routes = panel.getByRole("dialog", { name: "pDog 文档验收 候选线路", exact: true });
    await routes.locator('[data-route-id="isolated-pdog-native"]').locator("button[data-route-choice]").click();
  }
  await expect.poll(async () => (await saved()).connectionId).toBe("isolated-pdog-native");
  await expect(price).toContainText("0.08一张");
  await expect(price).toContainText("说明原生 2K / 4K");
  await expect(price).not.toContainText("说明超分");
  await page.reload(); await open();
  if (await group.count()) await expect(group).toHaveValue(groups.native);
  else await expect(panel.getByRole("button", { name: "pDog 文档验收 线路", exact: true })).toContainText(groups.native);
  await expect(panel.getByRole("combobox", { name: "pDog 文档验收 模型", exact: true })).toContainText("GPT Image 2");
  expect(fixture.safety()).toEqual({ submissions: 0, upstreamRequests: 0 });
  await panel.screenshot({ path: info.outputPath("pdog-native-group.png") });
});

for (const modelId of ["gpt-image-2.5-flare", "gpt-image-2.5-sunburst"]) {
test(`pDog 超分组 ${modelId} 默认 max，手选 high 后保存重载保持`, async ({ page, request }, info) => {
  const fixture = await setup(page, request, "upscale", modelId);
  const { panel, saved, open } = fixture;
  const quality = panel.getByLabel("质量", { exact: true });
  await expectParameterValue(quality, "max");
  expect((await readParameterOptions(quality)).filter(option => option.value === "max")).toHaveLength(1);
  await expect.poll(async () => (await saved()).parameters.quality).toBe("max");
  await page.reload(); await open();
  await expectParameterValue(quality, "max");
  await quality.scrollIntoViewIfNeeded();
  await panel.screenshot({ path: info.outputPath(`${modelId}-default-max.png`) });
  await chooseParameterOption(quality, "high");
  await expect.poll(async () => (await saved()).parameters.quality).toBe("high");
  await page.reload(); await open();
  await expectParameterValue(quality, "high");
  expect(fixture.safety()).toEqual({ submissions: 0, upstreamRequests: 0 });
  await quality.scrollIntoViewIfNeeded();
  await panel.screenshot({ path: info.outputPath(`${modelId}-max-and-manual-quality.png`) });
});
}

test("pDog 香蕉两个型号各自展示 0.07 与 0.08 报价，手选型号保存重载保持", async ({ page, request }, info) => {
  const fixture = await setup(page, request, "banana");
  const { panel, saved, open } = fixture;
  const price = panel.getByLabel("当前参数价格", { exact: true });
  await expect(price).toContainText("0.07/张");
  await expect(price).not.toContainText("0.08/张");
  const picker = panel.getByRole("combobox", { name: "pDog 文档验收 模型", exact: true });
  await picker.click();
  await panel.getByRole("combobox", { name: "搜索模型名称或 ID", exact: true }).fill(bananaIds[1]!);
  await panel.getByRole("option", { name: cleanModelDisplayName(bananaIds[1]!), exact: true }).click();
  await expect.poll(async () => (await saved()).model).toBe(bananaIds[1]);
  await expect(price).toContainText("0.08/张");
  await expect(price).not.toContainText("0.07/张");
  await page.reload(); await open();
  await expect(picker).toContainText(bananaIds[1]!);
  await expect(price).toContainText("0.08/张");
  await expect(price).not.toContainText("0.07/张");
  expect(fixture.safety()).toEqual({ submissions: 0, upstreamRequests: 0 });
  await panel.screenshot({ path: info.outputPath("pdog-banana-scoped-price.png") });
});
