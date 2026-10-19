import { expect, test } from "./helpers/canvas-offline-test";
import { parseTk1688Marketplace } from "@super-canvas/providers";
import { CANGYUAN_IMAGE_CONNECTOR } from "../lib/provider-presets";
import { chooseParameterOption, expectParameterValue, openParameterDetails, readParameterOptions } from "./helpers/parameter-controls";

const baseModel = "gpt-image-2.5-sunburst";
const marketplace = {
  success: true,
  data: {
    total: 5,
    items: [
      { id: 75, base_model: baseModel, alias: `${baseModel}@s1c23`, supplier_id: 1,
        channel_no: "ID00023", charge_type: "per_request", input_price_usd: 0.0015,
        output_price_usd: 0, description: "生图1K", status: "active", channel_alive: true },
      { id: 599, base_model: baseModel, alias: `${baseModel}@s46c264`, supplier_id: 46,
        channel_no: "ID00264", charge_type: "per_request", input_price_usd: 0.0108,
        output_price_usd: 0.0108, description: "源头满血原生image/高并发/绝不超分/1K /2K",
        status: "active", channel_alive: true },
      { id: 570, base_model: baseModel, alias: `${baseModel}@s47c261`, supplier_id: 47,
        channel_no: "ID00261", charge_type: "per_request", input_price_usd: 0.03,
        output_price_usd: 0, description: "Adobe支持原生4K(3840*2160)，不支持N。",
        status: "active", channel_alive: true },
      { id: 571, base_model: baseModel, alias: `${baseModel}@s48c262`, supplier_id: 48,
        channel_no: "ID00262", charge_type: "per_request", input_price_usd: 0.03,
        output_price_usd: 0, description: "支持4K，不支持1K、不支持2K。",
        status: "active", channel_alive: true },
      { id: 572, base_model: baseModel, alias: `${baseModel}@s49c263`, supplier_id: 49,
        channel_no: "ID00263", charge_type: "per_request", input_price_usd: 0.03,
        output_price_usd: 0, description: "支持1K /2K /4K。",
        status: "active", channel_alive: true },
    ],
  },
};

const models = parseTk1688Marketplace(marketplace,
  { success: true, data: { payment_fx_rate_cny_per_usd: 6.8896, platform_markup_percent: 20 } },
  { checkedAt: "2026-10-03T12:00:00.000Z", keyModelIds: [baseModel],
    accountModelIds: marketplace.data.items.map(item => item.alias) }).models;

const cases = [
  { variant: "adobe-reference", modelId: `${baseModel}@s47c261`, tiers: ["自动", "1K", "2K", "4K"], size: "3520x2336" },
  { variant: "two-tiers", modelId: `${baseModel}@s46c264`, tiers: ["自动", "1K", "2K", "4K"], size: "2496x1680" },
  { variant: "smart", modelId: baseModel, tiers: ["自动", "1K", "2K", "4K"], size: "3520x2336" },
  { variant: "four-only", modelId: `${baseModel}@s48c262`, tiers: ["自动", "4K"], size: "3520x2336" },
  { variant: "all-tiers", modelId: `${baseModel}@s49c263`, tiers: ["自动", "1K", "2K", "4K"], size: "3520x2336" },
] as const;

for (const { variant, modelId, tiers: supportedTiers, size } of cases) {
  test(`词元模型广场 ${variant} 统一分辨率面板、商家型号与保存恢复`, async ({ page, request }, testInfo) => {
    await page.setViewportSize({ width: 1440, height: 1080 });
    const descriptor = models.find(model => model.id === modelId)!;
    expect(descriptor).toBeTruthy();
    const connected = await request.post("/api/providers", { data: {
      name: `词元隔离参数验收 ${variant}`, provider: "rest", apiKey: "isolated-no-paid-generation",
      config: { baseUrl: "https://api.tk1688.com/v1", defaultModel: modelId,
        connector: { ...structuredClone(CANGYUAN_IMAGE_CONNECTOR), models: [descriptor] } },
    } });
    expect(connected.ok()).toBeTruthy();
    const connection = await connected.json();
    const created = await request.post("/api/canvas", { data: {
      title: `词元市场参数 ${variant}`, graph: { schemaVersion: 1, viewport: { x: 0, y: 0, zoom: 1 }, edges: [], nodes: [{
        id: "image", type: "workflow", position: { x: 80, y: 60 }, style: { width: 420, height: 180 },
        data: { nodeType: "image-generation", label: "词元市场规格", provider: "rest", connectionId: connection.id,
          model: modelId, parameters: {}, parts: [],
          inputs: [{ id: "prompt", kind: "text", label: "提示词" }], outputs: [{ id: "images", kind: "image", label: "图片" }] },
      }] },
    } });
    expect(created.ok()).toBeTruthy();
    const canvas = await created.json();
    await page.route(`**/api/providers/${connection.id}/models*`, route => route.fulfill({ json: [descriptor] }));
    let submitted = 0;
    await page.route("**/api/runs", async route => {
      if (route.request().method() === "POST") { submitted++; await route.abort(); }
      else await route.continue();
    });
    await page.goto(`/canvas/${canvas.id}`);
    const open = () => page.getByRole("button", { name: "打开 词元市场规格 模型与参数", exact: true }).click();
    await open();
    const panel = page.getByRole("dialog", { name: "词元市场规格 模型与参数" });
    const values = async (label: string) => (await readParameterOptions(panel.getByLabel(label, { exact: true })))
      .filter(option => option.value && !option.disabled && !option.value.startsWith("__")).map(option => option.value);
    const tiers = panel.getByRole("group", { name: "自动与输出分辨率快捷档位" });
    const preset = panel.getByLabel("输出分辨率预设", { exact: true });
    const width = panel.getByLabel("图片宽度", { exact: true });
    const height = panel.getByLabel("图片高度", { exact: true });
    await openParameterDetails(panel, "自定义宽高");
    await expect(preset).toBeVisible();
    await expect(width).toBeVisible();
    await expect(height).toBeVisible();
    await expect(width).toBeEditable();
    await expect(height).toBeEditable();
    for (const tier of ["自动", "1K", "2K", "4K"]) {
      const button = tiers.getByRole("button", { name: tier, exact: true });
      if ((supportedTiers as readonly string[]).includes(tier)) await expect(button).toBeEnabled();
      else await expect(button).toHaveCount(0);
    }
    await expect(panel.getByLabel("精确尺寸", { exact: true })).toHaveCount(0);
    await expect(panel.getByLabel("画面比例", { exact: true })).toHaveCount(0);
    if (variant === "four-only") {
      const available = await values("输出分辨率预设");
      expect(available).toContain("2880x2880");
      for (const oldExample of ["1024x1024", "1536x1024", "1024x1536"]) expect(available).not.toContain(oldExample);
    }
    if (variant === "adobe-reference") {
      // Native 3840x2160 is a supplier example, so switching away from 4K
      // must update both saved tier aliases without retaining an old 4K value.
      await tiers.getByRole("button", { name: "4K", exact: true }).click();
      await tiers.getByRole("button", { name: "1K", exact: true }).click();
      await chooseParameterOption(preset, "1024x1024");
      await expect.poll(async () => (await (await request.get(`/api/canvas/${canvas.id}`)).json()).graph.nodes[0].data.parameters)
        .toMatchObject({ size: "1024x1024", size_tier: "1K", resolution: "1K" });
    }
    if (variant === "adobe-reference" || variant === "smart") await expect(panel.getByLabel("数量", { exact: true })).toHaveCount(0);
    const selectedTier = variant === "two-tiers" ? "2K" : "4K";
    await tiers.getByRole("button", { name: selectedTier, exact: true }).click();
    await expect(tiers.getByRole("button", { name: selectedTier, exact: true })).toHaveAttribute("aria-pressed", "true");
    await chooseParameterOption(preset, size);
    await expect(width).toHaveValue(size.split("x")[0]!);
    await expect(height).toHaveValue(size.split("x")[1]!);
    await expect(panel.getByLabel("当前参数价格", { exact: true })).toContainText(/¥\d+(?:\.\d+)?|\d+(?:\.\d+)? CNY/u);
    await expect(panel.getByLabel("当前参数价格", { exact: true })).not.toContainText(/USD|\$/u);
    const qualityOptions = await values("质量");
    expect(qualityOptions).toEqual(["auto", "low", "medium", "high", "xhigh", "max"]);
    await expectParameterValue(panel.getByLabel("质量", { exact: true }), "max");
    // An untouched default may remain implicit in the stored graph. Exercise
    // a deliberate selection before checking persistence of that exact value.
    await chooseParameterOption(panel.getByLabel("质量", { exact: true }), "high");
    await chooseParameterOption(panel.getByLabel("质量", { exact: true }), "max");
    await chooseParameterOption(panel.getByLabel("返回格式", { exact: true }), "b64_json");
    const expectedParameters = { response_format: "b64_json", size, size_tier: selectedTier, resolution: selectedTier, quality: "max" };
    await expect.poll(async () => (await (await request.get(`/api/canvas/${canvas.id}`)).json()).graph.nodes[0].data)
      .toMatchObject({ model: modelId, parameters: expectedParameters });
    const saved = (await (await request.get(`/api/canvas/${canvas.id}`)).json()).graph.nodes[0].data.parameters;
    expect(saved).toMatchObject(expectedParameters);
    await page.reload(); await open();
    await expectParameterValue(panel.getByLabel("返回格式", { exact: true }), "b64_json");
    await expectParameterValue(preset, size);
    await openParameterDetails(panel, "自定义宽高");
    await expect(width).toHaveValue(size.split("x")[0]!);
    await expect(height).toHaveValue(size.split("x")[1]!);
    await expect(tiers.getByRole("button", { name: selectedTier, exact: true })).toHaveAttribute("aria-pressed", "true");
    await expectParameterValue(panel.getByLabel("质量", { exact: true }), "max");
    expect(submitted).toBe(0);
    await panel.getByLabel("质量", { exact: true }).scrollIntoViewIfNeeded();
    await panel.screenshot({ path: testInfo.outputPath(`tk1688-${variant}-parameters.png`) });
  });
}
