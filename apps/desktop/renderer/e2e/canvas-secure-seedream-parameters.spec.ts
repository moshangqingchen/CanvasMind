import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { secureSeedreamImageContract } from "../lib/secure-seedream-image-contract";

for (const scenario of [
  { name: "旧显式 W/H", parameters: { size: "1024x1024", aspect_ratio: "16:9", width: 1111, height: 777 }, width: "1111", height: "777" },
  { name: "旧比例快捷值", parameters: { size: "1024x1024", aspect_ratio: "16:9" }, width: "1920", height: "1080" },
]) test(`Secure Seedream ${scenario.name} 只有一对宽高且新尺寸真正覆盖旧值`, async ({ page, request }, testInfo) => {
  await page.setViewportSize({ width: 1600, height: 1100 });
  const config = { baseUrl: "https://token.secure-skill.com/v1", defaultModel: "seedream-5.0-pro", usage: "canvas" };
  const descriptor = secureSeedreamImageContract({ provider: "openai", config }, { id: "seedream-5.0-pro", name: "Seedream", operations: ["image.generate"], metadata: { canvasRunnable: true } });
  const connectionResponse = await request.post("/api/providers", { data: { name: `Seedream 隔离参数 ${scenario.name}`, provider: "openai", apiKey: "isolated-no-paid-generation",
    config: { ...config, modelCatalogModels: [descriptor], scannedModelIds: [descriptor.id], modelScanStatus: "live" } } });
  expect(connectionResponse.ok()).toBeTruthy(); const connection = await connectionResponse.json();
  await page.route(`**/api/providers/${connection.id}/models*`, route => route.fulfill({ json: [descriptor], headers: { "X-Model-Scan-Status": "live", "X-Model-Scan-Complete": "true" } }));
  const upload = await request.post("/api/assets/upload", { multipart: { file: { name: "隔离参考图.png", mimeType: "image/png", buffer: await readFile(new URL("../../assets/icon.png", import.meta.url)) } } });
  expect(upload.ok()).toBeTruthy(); const reference = await upload.json();
  const created = await request.post("/api/canvas", { data: { title: `Seedream 尺寸 ${scenario.name}`, graph: { schemaVersion: 1, viewport: { x: 0, y: 0, zoom: 1 },
    edges: [{ id: "reference-image", source: "reference", sourceHandle: "asset", target: "image", targetHandle: "references" }], nodes: [
    { id: "image", type: "workflow", position: { x: 90, y: 350 }, style: { width: 420, height: 180 }, data: {
      nodeType: "image-generation", label: "Seedream验收", provider: "openai", connectionId: connection.id, model: descriptor.id, qualityMode: "custom", parameters: scenario.parameters, parts: [],
      inputs: [{ id: "prompt", kind: "text", label: "提示词" }, { id: "references", kind: "image[]", label: "参考图" }], outputs: [{ id: "images", kind: "image", label: "图片" }],
    } },
    { id: "reference", type: "workflow", position: { x: 650, y: 350 }, style: { width: 240, height: 230 },
      data: { nodeType: "asset-input", label: "隔离参考图", assetId: reference.id, assetKind: "image", outputs: [{ id: "asset", kind: "image", label: "图片" }] } },
  ] } } });
  expect(created.ok()).toBeTruthy(); const canvas = await created.json(); let submissions = 0;
  await page.route("**/api/runs", async route => { if (route.request().method() === "POST") { submissions++; await route.abort(); } else await route.continue(); });
  await page.goto(`/canvas/${canvas.id}`);
  const open = () => page.getByRole("button", { name: "打开 Seedream验收 模型与参数", exact: true }).click();
  await open(); const panel = page.getByRole("dialog", { name: "Seedream验收 模型与参数", exact: true });
  const insideViewport = async () => {
    const bounds = await panel.boundingBox(); const viewport = page.viewportSize()!;
    if (!bounds || bounds.y < 64 || bounds.y + bounds.height > viewport.height || bounds.x < 0 || bounds.x + bounds.width > viewport.width) return false;
    return panel.evaluate(element => {
      const panelBounds = element.getBoundingClientRect();
      return [...document.querySelectorAll(".canvas-toolbar, .react-flow__controls, .react-flow__minimap")].every(tool => {
        const bounds = tool.getBoundingClientRect();
        return !bounds.width || !bounds.height || bounds.right <= panelBounds.left || bounds.left >= panelBounds.right || bounds.bottom <= panelBounds.top || bounds.top >= panelBounds.bottom;
      });
    });
  };
  await expect.poll(insideViewport).toBe(true);
  await page.setViewportSize({ width: 1200, height: 800 }); await expect.poll(insideViewport).toBe(true);
  await page.setViewportSize({ width: 1600, height: 1100 }); await expect.poll(insideViewport).toBe(true);
  const width = panel.getByLabel("图片宽度", { exact: true }), height = panel.getByLabel("图片高度", { exact: true });
  await expect(width).toHaveCount(1); await expect(height).toHaveCount(1);
  await expect(panel.getByLabel("指定 W", { exact: true })).toHaveCount(0); await expect(panel.getByLabel("指定 H", { exact: true })).toHaveCount(0);
  await expect(width).toHaveValue(scenario.width); await expect(height).toHaveValue(scenario.height);
  await expect(width).toHaveAttribute("min", "768"); await expect(width).toHaveAttribute("max", "2048"); await expect(width).toHaveAttribute("step", "1");
  await expect(panel.getByRole("checkbox", { name: /16 倍数/u })).toHaveCount(0);
  for (const name of ["图片宽度", "图片高度", "生成张数", "参考图强度"]) {
    const control = panel.getByLabel(name, { exact: true });
    await control.scrollIntoViewIfNeeded();
    await expect.poll(() => control.evaluate(element => {
      const bounds = element.getBoundingClientRect(), target = document.elementFromPoint(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
      return target === element || element.contains(target);
    }), { message: `${name} 在滚动后必须能接收实际指针输入` }).toBe(true);
    await control.click(); await expect(control).toBeFocused();
    if (name === "参考图强度") await control.press("Escape");
    if (name === "图片高度") await panel.screenshot({ path: testInfo.outputPath("secure-seedream-width-height-visible.png") });
    if (name === "参考图强度") await page.screenshot({ path: testInfo.outputPath("secure-seedream-lower-controls.png") });
  }
  const saved = async () => (await (await request.get(`/api/canvas/${canvas.id}`)).json()).graph.nodes[0].data.parameters;
  await panel.getByLabel("输出分辨率预设", { exact: true }).selectOption("1536x1920");
  await expect(width).toHaveValue("1536"); await expect(height).toHaveValue("1920");
  await expect.poll(saved).toMatchObject({ size: "1536x1920" });
  for (const key of ["width", "height", "aspect_ratio"]) await expect.poll(async () => (await saved())[key]).toBeUndefined();
  const tiers = panel.getByRole("group", { name: "自动与输出分辨率快捷档位", exact: true });
  await tiers.getByRole("button", { name: "1K", exact: true }).click();
  await expect(width).toHaveValue("928"); await expect(height).toHaveValue("1152");
  await tiers.getByRole("button", { name: "2K", exact: true }).click();
  await expect(width).toHaveValue("1536"); await expect(height).toHaveValue("1920");
  await width.fill("1113"); await height.fill("779"); await height.press("Enter");
  await expect.poll(saved).toMatchObject({ size: "1113x779" });
  await page.reload(); await open(); await expect(width).toHaveValue("1113"); await expect(height).toHaveValue("779");
  await expect(width).toHaveCount(1); await expect(height).toHaveCount(1); expect(submissions).toBe(0);
  await panel.screenshot({ path: testInfo.outputPath("secure-seedream-single-dimensions.png") });
});
