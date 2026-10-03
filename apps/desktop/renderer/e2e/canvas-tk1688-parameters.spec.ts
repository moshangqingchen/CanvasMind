import { expect, test } from "@playwright/test";
import { parseTk1688Marketplace } from "@super-canvas/providers";
import { CANGYUAN_IMAGE_CONNECTOR } from "../lib/provider-presets";

const baseModel = "gpt-image-2.5-sunburst";
const marketplace = {
  success: true,
  data: {
    total: 3,
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
    ],
  },
};

const models = parseTk1688Marketplace(marketplace,
  { success: true, data: { payment_fx_rate_cny_per_usd: 6.8896, platform_markup_percent: 20 } },
  { checkedAt: "2026-10-03T12:00:00.000Z", keyModelIds: [baseModel],
    accountModelIds: marketplace.data.items.map(item => item.alias) }).models;

for (const variant of ["fixed", "two-tiers", "smart"] as const) {
  test(`词元模型广场 ${variant} 参数、商家型号与保存恢复`, async ({ page, request }, testInfo) => {
    await page.setViewportSize({ width: 1440, height: 1080 });
    const modelId = variant === "fixed" ? `${baseModel}@s47c261`
      : variant === "two-tiers" ? `${baseModel}@s46c264` : baseModel;
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
    const values = async (label: string) => panel.getByLabel(label, { exact: true }).locator("option")
      // The shared panel adds an empty "model default" choice to every select.
      .evaluateAll(options => options.map(option => (option as HTMLOptionElement).value).filter(Boolean));
    if (variant === "fixed") {
      expect(await values("精确尺寸")).toEqual(["3840x2160"]);
      await expect(panel.getByLabel("数量", { exact: true })).toHaveCount(0);
      await expect(panel.getByLabel("图片宽度", { exact: true })).toHaveCount(0);
      await expect(panel.getByLabel("精确尺寸", { exact: true })).toHaveValue("3840x2160");
    } else {
      expect(await values("分辨率")).toEqual(variant === "two-tiers" ? ["auto", "1K", "2K"] : ["auto"]);
      if (variant === "two-tiers") {
        await panel.getByLabel("分辨率", { exact: true }).selectOption("2K");
        await panel.getByLabel("画面比例", { exact: true }).selectOption("3:2");
      } else await expect(panel.getByLabel("数量", { exact: true })).toHaveCount(0);
    }
    const qualityOptions = await values("质量");
    expect(qualityOptions).not.toContain("xhigh");
    expect(qualityOptions).not.toContain("max");
    await panel.getByLabel("返回格式", { exact: true }).selectOption("b64_json");
    await expect.poll(async () => (await (await request.get(`/api/canvas/${canvas.id}`)).json()).graph.nodes[0].data)
      .toMatchObject({ model: modelId, parameters: { response_format: "b64_json",
        ...(variant === "two-tiers" ? { resolution: "2K", aspect_ratio: "3:2" } : {}) } });
    await page.reload(); await open();
    await expect(panel.getByLabel("返回格式", { exact: true })).toHaveValue("b64_json");
    if (variant === "two-tiers") await expect(panel.getByLabel("分辨率", { exact: true })).toHaveValue("2K");
    if (variant === "fixed") await expect(panel.getByLabel("精确尺寸", { exact: true })).toHaveValue("3840x2160");
    expect(submitted).toBe(0);
    await page.screenshot({ path: testInfo.outputPath(`tk1688-${variant}-parameters.png`) });
  });
}
