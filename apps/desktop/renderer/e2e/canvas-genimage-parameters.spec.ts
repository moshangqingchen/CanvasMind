import { expect, test } from "@playwright/test";
import { bindScannedModelProtocols } from "../lib/scanned-model-protocols";
import { CANGYUAN_IMAGE_CONNECTOR } from "../lib/provider-presets";

test("基因形象声明参数可选择、保存和恢复，打开面板不提交生成", async ({ page, request }, testInfo) => {
  expect(process.env.PLAYWRIGHT_BASE_URL).toBeFalsy();
  const descriptor = bindScannedModelProtocols({ provider: "openai", config: {
    baseUrl: "https://genimage.pro/v1", modelGroup: "gptResponseBase64", usage: "canvas",
  } }, [{ id: "gpt-image-2.5-flare", name: "Flare", operations: ["image.generate"], metadata: { canvasRunnable: true } }]).models[0]!;
  const response = await request.post("/api/providers", { data: {
    name: "隔离基因参数验收", provider: "rest", apiKey: "isolated-no-generation", config: {
      baseUrl: "https://genimage-parameters.invalid", defaultModel: descriptor.id,
      connector: { ...structuredClone(CANGYUAN_IMAGE_CONNECTOR), models: [descriptor], restrictModels: true },
    },
  } });
  expect(response.ok()).toBeTruthy();
  const connection = await response.json();
  const created = await request.post("/api/canvas", { data: { title: "基因参数验收", graph: {
    schemaVersion: 1, viewport: { x: 0, y: 0, zoom: 1 }, edges: [], nodes: [{ id: "image", type: "workflow",
      position: { x: 80, y: 60 }, style: { width: 420, height: 180 }, data: { nodeType: "image-generation", label: "基因参数",
        provider: "rest", connectionId: connection.id, model: descriptor.id,
        qualityMode: "custom", parameters: { size: "4K", quality: "max", aspect_ratio: "16:9" }, parts: [],
        inputs: [{ id: "prompt", kind: "text", label: "提示词" }], outputs: [{ id: "images", kind: "image", label: "图片" }] } }],
  } } });
  const canvas = await created.json();
  let submissions = 0, upstreamRequests = 0;
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.route("https://genimage.pro/**", route => { upstreamRequests++; return route.abort(); });
  await page.route("https://genimage-parameters.invalid/**", route => { upstreamRequests++; return route.abort(); });
  await page.route("**/api/runs", async route => {
    if (route.request().method() === "POST") { submissions++; await route.abort(); } else await route.continue();
  });
  await page.goto(`/canvas/${canvas.id}`);
  const open = () => page.getByRole("button", { name: "打开 基因参数 模型与参数", exact: true }).click();
  await open();
  const panel = page.getByRole("dialog", { name: "基因参数 模型与参数" });
  const tiers = panel.getByRole("group", { name: "自动与输出分辨率快捷档位" });
  const ratio = panel.getByRole("textbox", { name: "基因形象画面比例偏好", exact: true });
  const width = panel.getByLabel("图片宽度", { exact: true });
  const height = panel.getByLabel("图片高度", { exact: true });
  const saved = async () => (await (await request.get(`/api/canvas/${canvas.id}`)).json()).graph.nodes[0].data.parameters;
  await expect(panel.getByLabel("质量", { exact: true })).toHaveValue("max");
  await expect(tiers.getByRole("button")).toHaveText(["自动", "1K", "2K", "4K"]);
  await expect(ratio).toHaveCount(0);
  await expect.poll(saved).toMatchObject({ size: "4K", quality: "max", aspect_ratio: "16:9" });
  await expect(width).toHaveJSProperty("readOnly", false);
  await expect(height).toHaveJSProperty("readOnly", false);
  await expect(width).not.toHaveAttribute("max", /.+/);
  await expect(width).toHaveAttribute("step", "1");
  await width.fill("4096"); await height.fill("2304"); await height.press("Tab");
  await expect.poll(saved).toMatchObject({ size: "4096x2304", quality: "max" });
  await page.reload(); await open();
  await expect(width).toHaveValue("4096"); await expect(height).toHaveValue("2304");
  await expect(ratio).toHaveCount(0);
  await expect(panel.getByLabel("质量", { exact: true })).toHaveValue("max");
  await tiers.getByRole("button", { name: "2K", exact: true }).click();
  await expect.poll(saved).toMatchObject({ size: "4096x2304", size_tier: "2K", quality: "max" });
  await panel.getByLabel("输出分辨率预设", { exact: true }).selectOption("2720x1536");
  await expect.poll(saved).toMatchObject({ size: "2720x1536", size_tier: "2K", quality: "max" });
  await expect(ratio).toHaveCount(0);
  await width.fill("2048"); await height.fill("1152"); await height.press("Tab");
  await expect.poll(saved).toMatchObject({ size: "2048x1152", quality: "max" });
  await page.reload(); await open();
  await expect(width).toHaveValue("2048"); await expect(height).toHaveValue("1152");
  expect({ submissions, upstreamRequests, errors }).toEqual({ submissions: 0, upstreamRequests: 0, errors: [] });
  await page.screenshot({ path: testInfo.outputPath("genimage-parameters.png") });
});
