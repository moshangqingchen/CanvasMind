import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { cangyuanCurrentModel, type ModelDescriptor } from "@super-canvas/providers";
import { applyBananaImageCapabilities } from "@super-canvas/providers/banana-image-contract";
import { weAIModelDescriptors, WEAI_GEMINI_MODEL_GROUP } from "@super-canvas/providers/weai-models";
import type { ProviderConnectionView } from "../lib/client-api";
import { cyberAfeiCatalogFromPricing } from "../lib/cyberafei-catalog";
import { miaowuCatalogFromPricing } from "../lib/miaowu-catalog";
import { mikotoGroup, MIKOTO_BANANA_PRO_GROUP } from "../lib/mikoto-presets";
import { cleanModelDisplayName } from "../lib/model-display";
import { CANGYUAN_BACKUP_IMAGE_CONNECTOR, CANGYUAN_BANANA_PRO_4K_MODEL, CANGYUAN_IMAGE_CONNECTOR } from "../lib/provider-presets";

// The controls come from actual supplier contract builders. Storage uses a
// separate isolated REST connection and all paid requests remain blocked.
const seed = (id: string): ModelDescriptor => ({ id, name: id, operations: ["image.generate"], metadata: { canvasRunnable: true } });
const banana = (baseUrl: string, modelGroup: string, id: string) => applyBananaImageCapabilities({
  provider: "openai", config: { baseUrl, modelGroup, accountKeyGroup: modelGroup, usage: "canvas" },
}, seed(id));
const publicPricing = JSON.parse(readFileSync(new URL("../lib/miaowu-catalog-20261008.fixture.json", import.meta.url), "utf8"));
const cyber = cyberAfeiCatalogFromPricing({ data: [{ model_name: "gemini-3.1-flash-image-preview", quota_type: 1,
  model_price: 0.08, enable_groups: ["图片视频模型综合分组"], supported_endpoint_types: ["gemini"] }] });

type Fixture = { supplier: string; model: ModelDescriptor; key: string; ratioKey: string; values: string[]; labels: string[]; pixels?: boolean };
const fixtures: Fixture[] = [
  { supplier: "GenImage", model: banana("https://genimage.pro/v1", "geminiResponseUrl", "gemini-3-pro-image-preview"),
    key: "image_size", ratioKey: "aspect_ratio", values: ["1K", "2K", "4K"], labels: ["1K", "2K", "4K"] },
  { supplier: "PDog", model: banana("https://ai.whyshy.cn", "【生图】🍌香蕉nano-banana（稳定渠道）", "gemini-3.1-flash-image-preview"),
    key: "image_size", ratioKey: "aspect_ratio", values: ["1K", "2K", "4K"], labels: ["1K", "2K", "4K"] },
  { supplier: "Secure Skill Lite", model: banana("https://token.secure-skill.com/v1", "banana-全系列", "nano-banana-2-lite"),
    key: "image_size", ratioKey: "aspect_ratio", values: ["1K"], labels: ["1K"] },
  { supplier: "We-AI compatible", model: weAIModelDescriptors("gemini-3-pro-image", true, WEAI_GEMINI_MODEL_GROUP, "gemini-openai-compatible")[0]!,
    key: "size", ratioKey: "aspect_ratio", values: ["auto", "1K", "2K", "4K"], labels: ["自动", "1K", "2K", "4K"] },
  { supplier: "Cangyuan Nano 2.1", model: cangyuanCurrentModel(seed("gemini-nano-banana-2.1")),
    key: "quality", ratioKey: "aspect_ratio", values: ["1k", "2k", "4k"], labels: ["1K", "2K", "4K"] },
  { supplier: "Cangyuan legacy Banana", model: CANGYUAN_BACKUP_IMAGE_CONNECTOR.models!.find(model => model.id === CANGYUAN_BANANA_PRO_4K_MODEL)!,
    key: "quality", ratioKey: "aspect_ratio", values: ["auto", "low", "medium", "high"], labels: ["自动", "1K", "2K", "4K"] },
  { supplier: "Miaowu Banana Pro", model: miaowuCatalogFromPricing(publicPricing).models.find(model => model.id === "Image-nano-banana-pro")!,
    key: "resolution", ratioKey: "aspect_ratio", values: ["1080p", "2K"], labels: ["标准", "2K"], pixels: true },
  { supplier: "Mikoto Banana Pro 1K/2K", model: mikotoGroup(MIKOTO_BANANA_PRO_GROUP)!.models[0]!,
    key: "image_size", ratioKey: "aspect_ratio", values: ["1K", "2K"], labels: ["1K", "2K"] },
  { supplier: "CyberAfei Flash", model: cyber.groups["图片视频模型综合分组"]![0]!,
    key: "imageSize", ratioKey: "aspectRatio", values: ["auto", "1K", "2K", "4K"], labels: ["自动", "1K", "2K", "4K"] },
];

test.beforeAll(() => {
  expect(process.env.PLAYWRIGHT_BASE_URL, "Banana supplier contracts require the isolated test profile").toBeFalsy();
  for (const fixture of fixtures) expect(fixture.model, fixture.supplier).toBeTruthy();
});

async function setup(page: Page, request: APIRequestContext, f: Fixture) {
  await page.setViewportSize({ width: 1440, height: 1080 });
  const label = "香蕉参数验收";
  const errors: string[] = [];
  let submissions = 0, upstreamRequests = 0, modelReads = 0;
  page.on("pageerror", error => errors.push(error.message));
  await page.route(/^https:\/\//u, route => { upstreamRequests++; return route.abort(); });
  await page.route(/\/api\/runs(?:\?.*)?$/u, route => {
    if (route.request().method() === "POST") { submissions++; return route.abort(); }
    return route.continue();
  });
  await page.route(/\/api\/suppliers(?:\?.*)?$/u, route => route.fulfill({ json: [] }));
  await page.route("**/api/suppliers/catalog-upgrade", route => route.fulfill({ json: { phase: "complete", updatedConnectionIds: [] } }));
  const model = f.model;
  const created = await request.post("/api/providers", { data: { name: `${f.supplier} 香蕉合同隔离验收`, provider: "rest",
    config: { baseUrl: "https://banana-contract-ui.invalid", defaultModel: model.id, usage: "canvas",
      connector: { ...structuredClone(CANGYUAN_IMAGE_CONNECTOR), allowedHosts: ["banana-contract-ui.invalid"], models: [model], restrictModels: true } },
  } });
  expect(created.ok()).toBeTruthy();
  const stored = await created.json();
  const connection: ProviderConnectionView = { ...stored, apiKey: "", apiKeySet: true, apiKeyUsable: true,
    config: { ...stored.config, supplierKey: "isolated-banana-contract", supplierName: f.supplier,
      modelGroup: "isolated", accountKeyGroup: "isolated", modelScanStatus: "live", modelScanComplete: true,
      modelCatalogModels: [model], scannedModelIds: [model.id] } };
  await page.route(/\/api\/providers(?:\?.*)?$/u, route => route.request().method() === "GET"
    ? route.fulfill({ json: [connection] }) : route.continue());
  await page.route(`**/api/providers/${connection.id}/models*`, route => {
    modelReads++;
    return route.fulfill({ json: [model], headers: { "X-Model-Scan-Status": "live", "X-Model-Scan-Complete": "true" } });
  });
  const response = await request.post("/api/canvas", { data: { title: `${f.supplier} 香蕉参数`, graph: {
    schemaVersion: 1, viewport: { x: 0, y: 0, zoom: 1 }, edges: [], nodes: [{
      id: "banana", type: "workflow", position: { x: 80, y: 60 }, style: { width: 420, height: 180 },
      data: { nodeType: "image-generation", label, provider: "rest", connectionId: connection.id, model: model.id,
        qualityMode: "custom", parameters: { [f.key]: f.values.at(-1),
          ...(model.parameters?.some(parameter => parameter.key === f.ratioKey) ? { [f.ratioKey]: "1:1" } : {}) }, parts: [],
        inputs: [{ id: "prompt", kind: "text", label: "提示词" }], outputs: [{ id: "result", kind: "image", label: "图片" }] },
    }],
  } } });
  expect(response.ok()).toBeTruthy();
  const canvas = await response.json();
  const panel = page.getByRole("dialog", { name: `${label} 模型与参数`, exact: true });
  const open = async () => {
    await page.getByRole("button", { name: `打开 ${label} 模型与参数`, exact: true }).click();
    await expect(panel).toBeVisible();
  };
  const saved = async () => (await (await request.get(`/api/canvas/${canvas.id}`)).json()).graph.nodes[0].data;
  const safe = () => {
    expect({ submissions, upstreamRequests, errors }).toEqual({ submissions: 0, upstreamRequests: 0, errors: [] });
    expect(modelReads).toBeGreaterThan(0);
  };
  await page.goto(`/canvas/${canvas.id}`);
  await open();
  return { panel, open, saved, safe, label };
}

for (const fixture of fixtures) test(`${fixture.supplier} 的 Banana 档位保持原生 ${fixture.key}/${fixture.ratioKey} 并保存恢复`, async ({ page, request }, testInfo) => {
  const f = await setup(page, request, fixture);
  try {
    const tiers = f.panel.getByRole("group", { name: "自动与输出分辨率快捷档位", exact: true });
    const ratio = f.panel.getByRole("combobox", { name: "画面比例", exact: true });
    const picker = f.panel.getByRole("combobox", { name: `${f.label} 模型`, exact: true });
    await expect(picker).toContainText(`ID: ${fixture.model.id}`);
    await expect(picker).toHaveAttribute("title", `${cleanModelDisplayName(fixture.model.name, fixture.model.metadata?.priceLabel)} · ${fixture.model.id}`);
    await expect(tiers.getByRole("button")).toHaveText(fixture.labels);
    await expect(f.panel.getByRole("button", { name: "1080p", exact: true })).toHaveCount(0);
    await expect(f.panel.getByRole("combobox", { name: /质量|清晰度|输出分辨率|^分辨率$/u })).toHaveCount(0);
    await expect(f.panel.getByLabel("图片宽度", { exact: true })).toHaveCount(fixture.pixels ? 1 : 0);
    await expect(f.panel.getByLabel("图片高度", { exact: true })).toHaveCount(fixture.pixels ? 1 : 0);
    const ratioDescriptor = fixture.model.parameters!.find(parameter => parameter.key === fixture.ratioKey)!;
    expect(await ratio.locator("option").evaluateAll(options => options.map(option => (option as HTMLOptionElement).value).filter(Boolean)))
      .toEqual(ratioDescriptor.options!.map(option => String(option.value)));
    await ratio.selectOption("9:16");
    // A provider's K labels can have unrelated wire values, such as low/medium.
    // Every button must preserve those values and both original parameter keys.
    for (let index = 0; index < fixture.values.length; index++) {
      const choice = tiers.getByRole("button", { name: fixture.labels[index], exact: true });
      await choice.click();
      await expect(choice).toHaveAttribute("aria-pressed", "true");
      await expect.poll(async () => (await f.saved()).parameters)
        .toEqual({ [fixture.key]: fixture.values[index], [fixture.ratioKey]: "9:16" });
    }
    await page.reload(); await f.open();
    await expect(tiers.getByRole("button", { name: fixture.labels.at(-1), exact: true })).toHaveAttribute("aria-pressed", "true");
    await expect(ratio).toHaveValue("9:16");
    await expect.poll(async () => (await f.saved()).parameters)
      .toEqual({ [fixture.key]: fixture.values.at(-1), [fixture.ratioKey]: "9:16" });
    await f.panel.screenshot({ path: testInfo.outputPath(`${fixture.supplier.replace(/[^a-z0-9]/giu, "-")}-banana-parameters.png`) });
  } finally { f.safe(); }
});

test("精确尺寸枚举显示统一档位与只读像素，保持原始 size 并保存恢复", async ({ page, request }, testInfo) => {
  const model: ModelDescriptor = { id: "isolated-exact-size", name: "精确尺寸枚举验收", operations: ["image.generate"],
    outputKinds: ["image"], metadata: { canvasRunnable: true, qualitySupport: "provider-decided" }, parameters: [{
      key: "size", label: "精确尺寸", control: "select", valueType: "string", required: true, default: "auto",
      options: [
        { label: "自动", value: "auto" },
        { label: "1K · 1:1 · 1024 × 1024", value: "1024x1024" },
        { label: "2K · 3:4 · 1080 × 1440", value: "1080x1440" },
        { label: "4K · 9:16 · 2160 × 3840", value: "2160x3840" },
      ],
    }] };
  const f = await setup(page, request, { supplier: "Declared exact size", model, key: "size", ratioKey: "aspect_ratio",
    values: ["1024x1024", "1080x1440", "2160x3840", "auto"], labels: ["自动", "1K", "2K", "4K"] });
  try {
    const tiers = f.panel.getByRole("group", { name: "自动与输出分辨率快捷档位", exact: true });
    const preset = f.panel.getByRole("combobox", { name: "输出分辨率预设", exact: true });
    const width = f.panel.getByLabel("图片宽度", { exact: true });
    const height = f.panel.getByLabel("图片高度", { exact: true });
    await expect(f.panel.getByText("分辨率", { exact: true })).toBeVisible();
    await expect(tiers.getByRole("button")).toHaveText(["自动", "1K", "2K", "4K"]);
    await expect(tiers.getByRole("button", { name: "自动", exact: true })).toHaveAttribute("aria-pressed", "true");
    await expect(preset).toHaveValue("auto");
    await expect(width).toHaveJSProperty("readOnly", true);
    await expect(height).toHaveJSProperty("readOnly", true);
    await expect(f.panel.getByRole("checkbox", { name: /16/u })).toHaveCount(0);
    await expect(f.panel.getByRole("combobox", { name: "画面比例", exact: true })).toHaveCount(0);
    await expect(f.panel.getByRole("combobox", { name: "质量", exact: true })).toHaveCount(0);

    await tiers.getByRole("button", { name: "2K", exact: true }).click();
    await expect(preset).toHaveValue("1080x1440");
    // 1080 is not divisible by 16: native enum selection must never round it.
    await expect(width).toHaveValue("1080");
    await expect(height).toHaveValue("1440");
    await expect.poll(async () => (await f.saved()).parameters).toEqual({ size: "1080x1440" });

    await tiers.getByRole("button", { name: "自动", exact: true }).click();
    await preset.selectOption("2160x3840");
    await expect(tiers.getByRole("button", { name: "4K", exact: true })).toHaveAttribute("aria-pressed", "true");
    await expect(width).toHaveValue("2160");
    await expect(height).toHaveValue("3840");
    await expect.poll(async () => (await f.saved()).parameters).toEqual({ size: "2160x3840" });
    await page.reload(); await f.open();
    await expect(preset).toHaveValue("2160x3840");
    await expect(width).toHaveValue("2160");
    await expect(height).toHaveValue("3840");
    await expect.poll(async () => (await f.saved()).parameters).toEqual({ size: "2160x3840" });
    await f.panel.screenshot({ path: testInfo.outputPath("exact-size-enum-parameters.png") });
  } finally { f.safe(); }
});
