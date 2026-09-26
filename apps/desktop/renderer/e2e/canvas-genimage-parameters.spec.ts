import { expect, test } from "@playwright/test";
import { bindScannedModelProtocols } from "../lib/scanned-model-protocols";
import { CANGYUAN_IMAGE_CONNECTOR } from "../lib/provider-presets";

test("基因形象声明参数可选择、保存和恢复，打开面板不提交生成", async ({ page, request }, testInfo) => {
  const descriptor = bindScannedModelProtocols({ provider: "openai", config: {
    baseUrl: "https://genimage.pro/v1", modelGroup: "gptResponseBase64", usage: "canvas",
  } }, [{ id: "gpt-image-2.5-flare", name: "Flare", operations: ["image.generate"], metadata: { canvasRunnable: true } }]).models[0]!;
  const response = await request.post("/api/providers", { data: {
    name: "隔离基因参数验收", provider: "rest", apiKey: "isolated-no-generation", config: {
      baseUrl: "https://genimage-parameters.invalid", defaultModel: descriptor.id,
      connector: { ...structuredClone(CANGYUAN_IMAGE_CONNECTOR), models: [descriptor] },
    },
  } });
  expect(response.ok()).toBeTruthy();
  const connection = await response.json();
  const created = await request.post("/api/canvas", { data: { title: "基因参数验收", graph: {
    schemaVersion: 1, viewport: { x: 0, y: 0, zoom: 1 }, edges: [], nodes: [{ id: "image", type: "workflow",
      position: { x: 80, y: 60 }, style: { width: 420, height: 180 }, data: { nodeType: "image-generation", label: "基因参数",
        provider: "rest", connectionId: connection.id, model: descriptor.id, parameters: { size: "auto", quality: "max" }, parts: [],
        inputs: [{ id: "prompt", kind: "text", label: "提示词" }], outputs: [{ id: "images", kind: "image", label: "图片" }] } }],
  } } });
  const canvas = await created.json();
  let submissions = 0;
  await page.route("**/api/runs", async route => {
    if (route.request().method() === "POST") { submissions++; await route.abort(); } else await route.continue();
  });
  await page.goto(`/canvas/${canvas.id}`);
  const open = () => page.getByRole("button", { name: "打开 基因参数 模型与参数", exact: true }).click();
  await open();
  const panel = page.getByRole("dialog", { name: "基因参数 模型与参数" });
  const sizes = panel.getByLabel("输出分辨率预设", { exact: true });
  const tiers = panel.getByRole("group", { name: "自动与输出分辨率快捷档位" });
  await expect(panel.getByLabel("质量", { exact: true })).toHaveValue("max");
  for (const [tier, size] of [["2K", "2720x1536"], ["4K", "2160x3840"]]) {
    await tiers.getByRole("button", { name: tier!, exact: true }).click();
    await sizes.selectOption(size!);
    await expect.poll(async () => (await (await request.get(`/api/canvas/${canvas.id}`)).json()).graph.nodes[0].data.parameters)
      .toMatchObject({ size, size_tier: tier, quality: "max" });
  }
  await page.reload(); await open();
  await expect(sizes).toHaveValue("2160x3840");
  await expect(panel.getByLabel("质量", { exact: true })).toHaveValue("max");
  expect(submissions).toBe(0);
  await page.screenshot({ path: testInfo.outputPath("genimage-parameters.png") });
});
