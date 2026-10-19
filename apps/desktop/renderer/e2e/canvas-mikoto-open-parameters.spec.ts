import { idleCatalogCheckFixture } from "./helpers/catalog-check-fixture";
import { expect, test } from "./helpers/canvas-offline-test";
import type { ModelDescriptor } from "@super-canvas/providers";
import { chooseParameterOption, expectParameterValue, openParameterDetails } from "./helpers/parameter-controls";

for (const modelId of ["gpt-image-2.5-flare", "gpt-image-2.5-sunburst"]) {
  test(`${modelId} 保留最高质量、档位和比例，独立宽高保存重载且不提交生成`, async ({ page, request }, testInfo) => {
    expect(process.env.PLAYWRIGHT_BASE_URL).toBeFalsy();
    await page.setViewportSize({ width: 1440, height: 1080 });
    const model: ModelDescriptor = { id: modelId, name: modelId, operations: ["image.generate", "image.edit"],
      parameters: [{ key: "quality", label: "质量（quality）", control: "text", valueType: "string" }],
      metadata: { mikotoImageContract: true, imageQualityEnumPublished: false, supplierPriceGroupId: "39" },
      pricing: { kind: "per-image", currency: "USD", unitAmount: 0.12,
        checkedAt: "2026-10-11T04:48:27.246Z", sourceUrl: "https://api.mikoto.vip/api/v1/channels/available", confidence: "exact" } };
    const created = await request.post("/api/providers", { data: { name: "隔离 Mikoto 开放参数", provider: "openai",
      config: { baseUrl: "https://mikoto-parameters.invalid", defaultModel: modelId, usage: "canvas",
        modelScanStatus: "live", modelScanComplete: true, modelCatalogModels: [model], scannedModelIds: [modelId] } } });
    expect(created.ok()).toBeTruthy();
    const stored = await created.json();
    const connection = { ...stored, apiKey: "", apiKeySet: true, apiKeyUsable: true, config: { ...stored.config,
      baseUrl: "https://api.mikoto.vip/", supplierKey: "mikoto", supplierName: "MikotoPro",
      accountKeyGroupId: "39", accountKeyGroup: "生图（2k4k 高质量）" } };
    let submissions = 0, upstreamRequests = 0;
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.route("https://api.mikoto.vip/**", route => { upstreamRequests++; return route.abort(); });
    await page.route("https://mikoto-parameters.invalid/**", route => { upstreamRequests++; return route.abort(); });
    await page.route(/\/api\/runs(?:\?.*)?$/u, route => {
      if (route.request().method() === "POST") { submissions++; return route.abort(); }
      return route.continue();
    });
    await page.route(/\/api\/suppliers(?:\?.*)?$/u, route => route.fulfill({ json: [] }));
    await page.route("**/api/suppliers/catalog-upgrade*", route => route.fulfill({ json: idleCatalogCheckFixture() }));
    await page.route(/\/api\/providers(?:\?.*)?$/u, route => route.request().method() === "GET"
      ? route.fulfill({ json: [connection] }) : route.continue());
    await page.route(`**/api/providers/${connection.id}/models*`, route => route.fulfill({ json: [model],
      headers: { "X-Model-Scan-Status": "live", "X-Model-Scan-Complete": "true" } }));
    const response = await request.post("/api/canvas", { data: { title: `Mikoto 开放参数隔离回归 ${crypto.randomUUID()}`, graph: {
      schemaVersion: 1, viewport: { x: 0, y: 0, zoom: 1 }, edges: [], nodes: [{ id: "mikoto-image", type: "workflow",
        position: { x: 80, y: 60 }, style: { width: 420, height: 180 }, data: { nodeType: "image-generation",
          label: "Mikoto 开放参数", provider: "openai", connectionId: connection.id, model: modelId, qualityMode: "custom",
          parameters: { size: "3840x2160", size_tier: "4K", aspect_ratio: "16:9", quality: "max" }, parts: [],
          inputs: [{ id: "prompt", kind: "text", label: "提示词" }], outputs: [{ id: "images", kind: "image", label: "图片" }] } }],
    } } });
    expect(response.ok()).toBeTruthy();
    const canvas = await response.json();
    const saved = async () => (await (await request.get(`/api/canvas/${canvas.id}`)).json()).graph.nodes[0].data.parameters;
    const open = () => page.getByRole("button", { name: "打开 Mikoto 开放参数 模型与参数", exact: true }).click();
    await page.goto(`/canvas/${canvas.id}`); await open();
    const panel = page.getByRole("dialog", { name: "Mikoto 开放参数 模型与参数", exact: true });
    const tiers = panel.getByRole("group", { name: "自动与输出分辨率快捷档位", exact: true });
    const ratio = panel.getByRole("textbox", { name: /画面比例偏好/u });
    const width = panel.getByLabel("图片宽度", { exact: true });
    const height = panel.getByLabel("图片高度", { exact: true });
    const quality = panel.getByLabel("质量", { exact: true });
    const preset = panel.getByRole("combobox", { name: "输出分辨率预设", exact: true });
    await expect(tiers.getByRole("button")).toHaveText(["自动", "2K", "4K"]);
    await expectParameterValue(quality, "max"); await expect(ratio).toHaveCount(0);
    await openParameterDetails(panel, "自定义宽高");
    await expect(width).toHaveJSProperty("readOnly", false);
    await expect(width).toHaveAttribute("step", "1"); await expect(width).not.toHaveAttribute("max", /.+/);
    await tiers.getByRole("button", { name: "2K", exact: true }).click();
    await expect.poll(saved).toMatchObject({ size_tier: "2K", size: "2720x1536", aspect_ratio: "16:9", quality: "max" });
    await chooseParameterOption(preset, "1536x2720");
    await expect.poll(saved).toMatchObject({ size_tier: "2K", size: "1536x2720", aspect_ratio: "9:16", quality: "max" });
    await width.fill("1152"); await height.fill("2048"); await height.press("Tab");
    await expect.poll(saved).toMatchObject({ size_tier: "2K", size: "1152x2048", quality: "max" });
    await expect.poll(async () => (await saved()).aspect_ratio).toBeUndefined();
    await page.reload(); await open();
    await expectParameterValue(quality, "max"); await expect(ratio).toHaveCount(0);
    await openParameterDetails(panel, "自定义宽高");
    await expect(width).toHaveValue("1152"); await expect(height).toHaveValue("2048");
    await expect(tiers.getByRole("button", { name: "2K", exact: true })).toHaveAttribute("aria-pressed", "true");
    await panel.screenshot({ path: testInfo.outputPath(`${modelId}-open-parameters.png`) });
    expect({ submissions, upstreamRequests, errors }).toEqual({ submissions: 0, upstreamRequests: 0, errors: [] });
  });
}
