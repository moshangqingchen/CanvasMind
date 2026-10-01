import { expect, test } from "@playwright/test";
import { imageSizeOptions, type ModelDescriptor } from "@super-canvas/providers";
import type { ProviderConnectionView } from "../lib/client-api";

for (const entry of ["toolbar", "context-menu"]) {
  test(`新建默认 We-AI Image 2.5 4K max，刷新和手选保持：${entry}`, async ({ page, request }, info) => {
    await page.setViewportSize({ width: 1600, height: 1000 });
    const rawModels: ModelDescriptor[] = ["flare", "sunburst"].map(variant => ({
      id: `gpt-image-2.5-${variant}`, name: `Image 2.5 ${variant}`, operations: ["image.generate", "image.edit"], parameters: [],
    }));
    // A live inventory can supply generic assumed controls instead of a real
    // API schema. It must not lower the user's exact We-AI request preset.
    const scannedModels = rawModels.map(model => ({ ...model, metadata: {
      qualitySupport: "assumed", imageRequestResolutions: ["4K"],
      imageCapabilityEvidence: [{ resolution: "4K", status: "assumed" }],
    }, parameters: [
      { key: "size", label: "尺寸", control: "dimensions" as const, default: "auto", options: imageSizeOptions(["1K", "2K"], 2048) },
      { key: "quality", label: "质量", control: "select" as const, default: "high", options: ["low", "medium", "high"].map(value => ({ value, label: value })) },
    ] }));
    const otherModel: ModelDescriptor = { id: "gpt-image-2", name: "手选图片模型", operations: ["image.generate"],
      parameters: [{ key: "quality", label: "质量", control: "select", default: "high", options: [{ value: "high", label: "高" }] }] };
    const weai: ProviderConnectionView = { id: "isolated-weai-image25", name: "We-AI Image 2.5", provider: "openai", apiKey: "", apiKeySet: true, apiKeyUsable: true,
      config: { supplierKey: "weai", supplierName: "We-AI", usage: "canvas", baseUrl: "https://asian-acc.we-token.cc/v1",
        modelGroup: "生图-openai-adobe-image2.5专属", accountKeyGroup: "生图-openai-adobe-image2.5专属", defaultModel: "gpt-image-2.5-sunburst",
        modelScanStatus: "live", modelCatalogModels: rawModels } };
    const other: ProviderConnectionView = { ...weai, id: "isolated-manual-supplier", name: "手选供应商", config: {
      supplierKey: "custom-manual-default", supplierName: "手选供应商", usage: "canvas", modelGroup: "图片组",
      baseUrl: "https://manual.invalid/v1", defaultModel: otherModel.id, modelScanStatus: "live", modelCatalogModels: [otherModel],
    } };
    await page.route(/\/api\/providers(?:\?.*)?$/, route => route.fulfill({ json: [other, weai] }));
    let scans = 0, submissions = 0;
    await page.route(`**/api/providers/${weai.id}/models*`, route => { scans++; return route.fulfill({ json: scannedModels, headers: { "X-Model-Scan-Status": "live" } }); });
    await page.route(`**/api/providers/${other.id}/models*`, route => route.fulfill({ json: [otherModel], headers: { "X-Model-Scan-Status": "live" } }));
    await page.route("**/api/runs", async route => {
      if (route.request().method() === "POST") { submissions++; await route.abort(); }
      else await route.continue();
    });
    const existingParameters = { size: "2048x2048", size_tier: "2K", quality: "high" };
    const response = await request.post("/api/canvas", { data: { title: "We-AI 默认参数回归", graph: {
      schemaVersion: 1, viewport: { x: 0, y: 0, zoom: 1 }, edges: [], nodes: [{
        id: "existing", type: "workflow", position: { x: 80, y: 60 }, style: { width: 420, height: 180 }, data: {
          nodeType: "image-generation", label: "既有手选", provider: "openai", connectionId: weai.id, model: "gpt-image-2.5-flare",
          qualityMode: "custom", parameters: existingParameters, parts: [],
          inputs: [{ id: "prompt", kind: "text", label: "提示词" }, { id: "references", kind: "image[]", label: "参考图" }],
          outputs: [{ id: "images", kind: "image", label: "图片" }],
        },
      }] } } });
    expect(response.ok()).toBeTruthy();
    const canvas = await response.json();
    const saved = async () => (await (await request.get(`/api/canvas/${canvas.id}`)).json()).graph.nodes as { id: string; data: Record<string, unknown> }[];
    try {
      await page.goto(`/canvas/${canvas.id}`);
      if (entry === "toolbar") await page.getByRole("button", { name: "新建图片节点", exact: true }).click();
      else {
        await page.locator(".react-flow__pane").click({ button: "right", position: { x: 700, y: 520 } });
        await page.getByRole("menu", { name: "新建节点" }).getByRole("menuitem", { name: "图片节点", exact: true }).click();
      }
      await expect.poll(async () => (await saved()).find(node => node.id !== "existing")?.data).toMatchObject({
        provider: "openai", connectionId: weai.id, model: "gpt-image-2.5-sunburst", parameters: { quality: "max", size: "2880x2880", size_tier: "4K" },
      });
      const open = () => page.getByRole("button", { name: "打开 图片生成 模型与参数", exact: true }).click();
      await open();
      const panel = page.getByRole("dialog", { name: "图片生成 模型与参数", exact: true });
      const supplier = panel.getByRole("combobox", { name: "图片生成 供应商", exact: true });
      const quality = panel.getByLabel("质量", { exact: true });
      const size = panel.getByLabel("输出分辨率预设", { exact: true });
      await expect(supplier).toHaveValue("weai");
      await expect(panel.getByRole("combobox", { name: "图片生成 模型", exact: true })).toContainText("Image 2.5 sunburst");
      await expect(quality).toHaveValue("max");
      await expect(size).toHaveValue("2880x2880");
      await expect.poll(() => scans).toBeGreaterThan(0);
      await page.reload();
      await open();
      await expect(quality).toHaveValue("max");
      await expect(size).toHaveValue("2880x2880");
      expect((await saved()).find(node => node.id === "existing")?.data).toMatchObject({
        model: "gpt-image-2.5-flare", connectionId: weai.id, parameters: existingParameters,
      });
      await quality.selectOption("high");
      await panel.getByRole("group", { name: "自动与输出分辨率快捷档位" }).getByRole("button", { name: "2K", exact: true }).click();
      await size.selectOption("2048x2048");
      await expect.poll(async () => (await saved()).find(node => node.id !== "existing")?.data.parameters)
        .toMatchObject({ quality: "high", size: "2048x2048", size_tier: "2K" });
      await page.reload();
      await open();
      await expect(quality).toHaveValue("high");
      await expect(size).toHaveValue("2048x2048");
      await supplier.selectOption("custom-manual-default");
      await expect.poll(async () => (await saved()).find(node => node.id !== "existing")?.data.connectionId).toBe(other.id);
      await page.reload();
      await open();
      await expect(supplier).toHaveValue("custom-manual-default");
      await expect(panel.getByRole("combobox", { name: "图片生成 模型", exact: true })).toContainText("手选图片模型");
      expect(submissions).toBe(0);
      await page.screenshot({ path: info.outputPath("weai-default-and-manual-choice.png") });
    } finally {
      await request.delete(`/api/projects/${canvas.id}`);
    }
  });
}
