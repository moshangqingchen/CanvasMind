import { idleCatalogCheckFixture } from "./helpers/catalog-check-fixture";
import { readFileSync } from "node:fs";
import { expect, test } from "./helpers/canvas-offline-test";
import type { ModelDescriptor } from "@super-canvas/providers";
import { chooseParameterOption, expectParameterValue, openParameterDetails, readParameterOptions } from "./helpers/parameter-controls";

const fixture = JSON.parse(readFileSync(new URL("../lib/fixtures/mikoto-installed-r4-one-k-safe.json", import.meta.url), "utf8")) as {
  rows: { model: ModelDescriptor }[];
};

for (const modelId of ["gpt-image-2.5-flare", "gpt-image-2.5-sunburst"]) {
  test(`${modelId} 的1K比例尺寸与六档质量可选，保留手选high和自定义宽高且零提交`, async ({ page, request }, testInfo) => {
    expect(process.env.PLAYWRIGHT_BASE_URL).toBeFalsy();
    await page.setViewportSize({ width: 1440, height: 1080 });
    const model = structuredClone(fixture.rows.find(row => row.model.id === modelId)!.model);
    const created = await request.post("/api/providers", { data: { name: "隔离 Mikoto 1K 参数", provider: "openai",
      config: { baseUrl: "https://mikoto-g5-parameters.invalid", defaultModel: modelId, usage: "canvas",
        modelScanStatus: "live", modelScanComplete: true, modelCatalogModels: [model], scannedModelIds: [modelId] } } });
    expect(created.ok()).toBeTruthy();
    const stored = await created.json();
    const connection = { ...stored, apiKey: "", apiKeySet: true, apiKeyUsable: true, config: { ...stored.config,
      baseUrl: "https://api.mikoto.vip", supplierKey: "mikoto", supplierName: "MikotoPro",
      accountKeyGroupId: "5", accountKeyGroup: "生图（1k）" } };
    let submissions = 0, upstreamRequests = 0;
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.route("https://api.mikoto.vip/**", route => { upstreamRequests++; return route.abort(); });
    await page.route("https://mikoto-g5-parameters.invalid/**", route => { upstreamRequests++; return route.abort(); });
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
    const response = await request.post("/api/canvas", { data: { title: "Mikoto 1K 参数隔离回归", graph: {
      schemaVersion: 1, viewport: { x: 0, y: 0, zoom: 1 }, edges: [], nodes: [{ id: "mikoto-g5-image", type: "workflow",
        position: { x: 80, y: 60 }, style: { width: 420, height: 180 }, data: { nodeType: "image-generation",
          label: "Mikoto 1K 参数", provider: "openai", connectionId: connection.id, model: modelId, qualityMode: "custom",
          parameters: { size: "4097x2051", size_tier: "1K", aspect_ratio: "auto", quality: "high" }, parts: [],
          inputs: [{ id: "prompt", kind: "text", label: "提示词" }], outputs: [{ id: "images", kind: "image", label: "图片" }] } }],
    } } });
    expect(response.ok()).toBeTruthy();
    const canvas = await response.json();
    const saved = async () => (await (await request.get(`/api/canvas/${canvas.id}`)).json()).graph.nodes[0].data.parameters;
    const open = () => page.getByRole("button", { name: "打开 Mikoto 1K 参数 模型与参数", exact: true }).click();
    await page.goto(`/canvas/${canvas.id}`); await open();
    const panel = page.getByRole("dialog", { name: "Mikoto 1K 参数 模型与参数", exact: true });
    const tiers = panel.getByRole("group", { name: "自动与输出分辨率快捷档位", exact: true });
    const ratio = panel.getByRole("textbox", { name: "Mikoto画面比例偏好", exact: true });
    const width = panel.getByLabel("图片宽度", { exact: true });
    const height = panel.getByLabel("图片高度", { exact: true });
    const quality = panel.getByLabel("质量", { exact: true });
    const preset = panel.getByRole("combobox", { name: "输出分辨率预设", exact: true });
    await expect(tiers.getByRole("button")).toHaveText(["自动", "1K"]);
    await expect(tiers.getByRole("button", { name: "1K", exact: true })).toHaveAttribute("aria-pressed", "true");
    await expectParameterValue(quality, "high"); await expect(ratio).toHaveCount(0);
    expect((await readParameterOptions(quality)).filter(option => option.value && !option.disabled && !option.value.startsWith("__")).map(option => option.value)).toEqual(["auto", "low", "medium", "high", "xhigh", "max"]);
    await openParameterDetails(panel, "自定义宽高");
    await expect(width).toHaveValue("4097"); await expect(height).toHaveValue("2051");
    await expect(width).toHaveJSProperty("readOnly", false);
    for (const input of [width, height]) {
      await expect(input).toHaveAttribute("step", "1");
      await expect(input).not.toHaveAttribute("max", /.+/);
      await expect(input).not.toHaveAttribute("min", "256");
    }
    const ratioOptions = await readParameterOptions(preset);
    expect(ratioOptions.find(option => option.value === "1360x768")?.label).toContain("16:9");
    expect(ratioOptions.find(option => option.value === "1360x768")?.label).toContain("1K");
    await chooseParameterOption(preset, "1360x768");
    await expect.poll(saved).toMatchObject({ size: "1360x768", size_tier: "1K", aspect_ratio: "16:9", quality: "high" });
    await chooseParameterOption(preset, "768x1360");
    await expect.poll(saved).toMatchObject({ size: "768x1360", size_tier: "1K", aspect_ratio: "9:16", quality: "high" });
    await width.fill("2051"); await height.fill("2049"); await height.press("Tab");
    await expect.poll(saved).toMatchObject({ size: "2051x2049", size_tier: "1K", quality: "high" });
    await expect.poll(async () => (await saved()).aspect_ratio).toBeUndefined();
    await chooseParameterOption(quality, "auto");
    await expect.poll(saved).toMatchObject({ size: "2051x2049", size_tier: "1K", quality: "auto" });
    await chooseParameterOption(quality, "high");
    await page.reload(); await open();
    await expectParameterValue(quality, "high"); await expect(ratio).toHaveCount(0);
    await openParameterDetails(panel, "自定义宽高");
    await expect(width).toHaveValue("2051"); await expect(height).toHaveValue("2049");
    await expect(tiers.getByRole("button", { name: "1K", exact: true })).toHaveAttribute("aria-pressed", "true");
    await panel.screenshot({ path: testInfo.outputPath(`${modelId}-g5-parameters.png`) });
    expect({ submissions, upstreamRequests, errors }).toEqual({ submissions: 0, upstreamRequests: 0, errors: [] });
  });
}
