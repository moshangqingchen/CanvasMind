import { expect, test } from "@playwright/test";
import { bindScannedModelProtocols } from "../lib/scanned-model-protocols";
import { CANGYUAN_IMAGE_CONNECTOR } from "../lib/provider-presets";
import { effectiveImageCapabilities } from "../lib/supplier-capabilities";

for (const [modelGroup, quality] of [["生图（2k4k 高质量）", "high"], ["生图（2k4k 中质量）", "medium"]]) {
  test(`声明的尺寸与质量显示、保存并恢复：${modelGroup}`, async ({ page, request }, testInfo) => {
    const descriptor = bindScannedModelProtocols({ provider: "openai", config: {
      supplierKey: "mikoto", modelGroup, baseUrl: "https://api.mikoto.vip", customGroup: true,
    } }, [{ id: "gpt-image-2", name: "参数验收模型", operations: ["image.generate", "image.edit"], metadata: { canvasRunnable: true } }]).models[0]!;
    const connectionResponse = await request.post("/api/providers", { data: {
      name: `隔离参数验收 ${quality}`, provider: "rest", apiKey: "isolated-no-paid-generation",
      config: { baseUrl: "https://parameters.invalid", defaultModel: descriptor.id,
        connector: { ...structuredClone(CANGYUAN_IMAGE_CONNECTOR), models: [descriptor] } },
    } });
    expect(connectionResponse.ok()).toBeTruthy();
    const connection = await connectionResponse.json();
    const canvasResponse = await request.post("/api/canvas", { data: {
      title: "声明能力验收", graph: { schemaVersion: 1, viewport: { x: 0, y: 0, zoom: 1 }, edges: [], nodes: [{
        id: "image", type: "workflow", position: { x: 80, y: 60 }, style: { width: 420, height: 180 },
        data: { nodeType: "image-generation", label: "参数验收", provider: "rest", connectionId: connection.id,
          model: descriptor.id, parameters: { size: "auto", quality }, parts: [],
          inputs: [{ id: "prompt", kind: "text", label: "提示词" }], outputs: [{ id: "images", kind: "image", label: "图片" }] },
      }] },
    } });
    const canvas = await canvasResponse.json();
    let submitted = 0;
    await page.route("**/api/runs", async route => {
      if (route.request().method() === "POST") { submitted++; await route.abort(); }
      else await route.continue();
    });
    await page.goto(`/canvas/${canvas.id}`);
    const open = () => page.getByRole("button", { name: "打开 参数验收 模型与参数", exact: true }).click();
    await open();
    const panel = page.getByRole("dialog", { name: "参数验收 模型与参数" });
    const tiers = panel.getByRole("group", { name: "自动与输出分辨率快捷档位" });
    const size = panel.getByLabel("输出分辨率预设", { exact: true });
    const qualitySelect = panel.getByLabel("质量", { exact: true });
    await expect(qualitySelect).toHaveValue(quality!);
    expect(await qualitySelect.locator("option").evaluateAll(options => options.map(option => (option as HTMLOptionElement).value).filter(Boolean))).toEqual([quality]);
    for (const [tier, pixels] of [["2K", "2560x1440"], ["4K", "2160x3840"]]) {
      await tiers.getByRole("button", { name: tier!, exact: true }).click();
      await size.selectOption(pixels!);
      await expect.poll(async () => (await (await request.get(`/api/canvas/${canvas.id}`)).json()).graph.nodes[0].data.parameters)
        .toMatchObject({ size: pixels, size_tier: tier, quality });
    }
    await page.reload();
    await open();
    await expect(size).toHaveValue("2160x3840");
    await expect(qualitySelect).toHaveValue(quality!);
    expect(submitted).toBe(0);
    await page.screenshot({ path: testInfo.outputPath("parameters.png") });
  });
}

for (const variant of ["flare", "sunburst"]) {
  test(`Mikoto Image 2.5 ${variant} 完整质量档位、旧选择与保存恢复`, async ({ page, request }, testInfo) => {
    const modelGroup = "生图（2k4k 高质量）";
    const id = `gpt-image-2.5-${variant}`;
    const descriptor = effectiveImageCapabilities({
      supplier: { id: "mikoto", name: "MikotoPro", supplierKey: "mikoto", kind: "newapi", apiUrl: "https://api.mikoto.vip",
        siteUrl: "https://api.mikoto.vip", scanStatus: "live", createdAt: "now", updatedAt: "now", catalog: { groups: [{
          id: modelGroup, label: modelGroup, models: [], details: { source: "model-plaza",
            description: "image2 0.1一张 能高质量\nimage2.5 flare 0.13一张 支持五档质量\nimage2.5 sub 0.16一张 支持五档质量" },
        }] } },
      connection: { id: "cached-key", provider: "openai", config: { accountKeyGroup: modelGroup } }, fingerprint: "f",
      model: { id, name: `Image 2.5 ${variant}`, operations: ["image.generate"],
        metadata: { canvasRunnable: true, imageCapabilityPolicy: 2, qualitySupport: "declared" },
        parameters: [{ key: "quality", label: "质量", control: "select", default: "high", options: [{ value: "high", label: "高" }] }] },
    }).model;
    const connectionResponse = await request.post("/api/providers", { data: {
      name: `Mikoto 2.5 ${variant} isolated`, provider: "rest", apiKey: "isolated-no-paid-generation",
      config: { baseUrl: "https://parameters.invalid", defaultModel: id,
        connector: { ...structuredClone(CANGYUAN_IMAGE_CONNECTOR), models: [descriptor] } },
    } });
    expect(connectionResponse.ok()).toBeTruthy();
    const connection = await connectionResponse.json();
    const canvasResponse = await request.post("/api/canvas", { data: {
      title: `Image 2.5 ${variant} regression`, graph: { schemaVersion: 1, viewport: { x: 0, y: 0, zoom: 1 }, edges: [], nodes: [{
        id: "image", type: "workflow", position: { x: 80, y: 60 }, style: { width: 420, height: 180 },
        data: { nodeType: "image-generation", label: "质量验收", provider: "rest", connectionId: connection.id, model: id,
          qualityMode: variant === "sunburst" ? "custom" : "highest",
          parameters: { size: "auto", quality: "high" }, parts: [{ type: "text", text: "mock only" }],
          inputs: [{ id: "prompt", kind: "text", label: "提示词" }], outputs: [{ id: "images", kind: "image", label: "图片" }] },
      }] },
    } });
    expect(canvasResponse.ok()).toBeTruthy();
    const canvas = await canvasResponse.json();
    // A saved fallback says high; asynchronous discovery restores max.
    await page.route(`**/api/providers/${connection.id}/models*`, route => route.fulfill({ json: [descriptor] }));
    let submitted = 0;
    await page.route("**/api/runs", async route => {
      if (route.request().method() === "POST") { submitted++; await route.abort(); }
      else await route.continue();
    });
    await page.goto(`/canvas/${canvas.id}`);
    const open = () => page.getByRole("button", { name: "打开 质量验收 模型与参数", exact: true }).click();
    await open();
    const panel = page.getByRole("dialog", { name: "质量验收 模型与参数" });
    const quality = panel.getByLabel("质量", { exact: true });
    await expect(quality).toHaveValue(variant === "sunburst" ? "high" : "max");
    expect(await quality.locator("option").evaluateAll(options => options.map(option => (option as HTMLOptionElement).value).filter(Boolean)))
      .toEqual(["auto", "low", "medium", "high", "xhigh", "max"]);
    for (const value of ["auto", "low", "medium", "high", "xhigh", "max"]) {
      await quality.selectOption(value);
      await expect.poll(async () => (await (await request.get(`/api/canvas/${canvas.id}`)).json()).graph.nodes[0].data.parameters.quality).toBe(value);
      if (value === "low") {
        await page.reload();
        await open();
        await expect(quality).toHaveValue("low");
      }
    }
    await page.reload();
    await open();
    await expect(quality).toHaveValue("max");
    expect(submitted).toBe(0);
    await page.screenshot({ path: testInfo.outputPath("image25-quality-max.png") });
  });
}
