import { expect, test } from "./helpers/canvas-offline-test";
import { bindScannedModelProtocols } from "../lib/scanned-model-protocols";
import { floatingPanelGeometry } from "./floating-panel-geometry";
import { expectParameterValue } from "./helpers/parameter-controls";

test("参数浮卡不随画布缩放，后台扫描保持参数及滚动位置", async ({ page, request }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 960 });
  const descriptor = bindScannedModelProtocols({ provider: "openai", config: {
    baseUrl: "https://genimage.pro/v1", modelGroup: "gptResponseBase64", usage: "canvas",
  } }, [{ id: "gpt-image-2.5-sunburst", name: "GPT Image 2.5 Sunburst",
    operations: ["image.generate"], metadata: { canvasRunnable: true } }]).models[0]!;
  const response = await request.post("/api/providers", { data: {
    name: "隔离面板缩放验收", provider: "openai", apiKey: "isolated-no-generation",
    config: { baseUrl: "https://panel-zoom.invalid", preset: "cyberafei-api",
      modelGroup: "隔离缩放验收", defaultModel: descriptor.id, usage: "canvas" },
  } });
  expect(response.ok()).toBeTruthy();
  const connection = await response.json();
  let scans = 0;
  let resumeScan: (() => void) | undefined;
  let holdScan = false;
  let emptyScan = false;
  await page.route(`**/api/providers/${connection.id}/models*`, async route => {
    scans++;
    if (holdScan) await new Promise<void>(resolve => { resumeScan = resolve; });
    await route.fulfill({ json: emptyScan ? [] : [descriptor],
      headers: { "X-Model-Scan-Status": emptyScan ? "empty" : "live" } });
  });
  let submissions = 0;
  await page.route("**/api/runs", async route => {
    if (route.request().method() === "POST") { submissions++; await route.abort(); }
    else await route.continue();
  });
  const created = await request.post("/api/canvas", { data: {
    title: "面板缩放验收", graph: { schemaVersion: 1, viewport: { x: 0, y: 0, zoom: 1 }, edges: [], nodes: [{
      id: "image", type: "workflow", position: { x: 200, y: 40 }, style: { width: 420, height: 180 },
      data: { nodeType: "image-generation", label: "缩放验收", provider: "openai", connectionId: connection.id,
        model: descriptor.id, qualityMode: "custom", parameters: { size: "auto", size_tier: "4K", quality: "max" },
        parts: [], inputs: [{ id: "prompt", kind: "text", label: "提示词" }],
        outputs: [{ id: "images", kind: "image", label: "图片" }] },
    }] },
  } });
  expect(created.ok()).toBeTruthy();
  const canvas = await created.json();
  await page.goto(`/canvas/${canvas.id}`);
  const sidebar = page.getByRole("button", { name: "智能体面板", exact: true });
  await page.getByRole("button", { name: "打开 缩放验收 模型与参数", exact: true }).click();
  const panel = page.getByRole("dialog", { name: "缩放验收 模型与参数", exact: true });
  const tiers = panel.getByRole("group", { name: "自动与输出分辨率快捷档位" });
  const quality = panel.getByLabel("质量", { exact: true });
  const body = panel.locator(".node-config-popover-body");
  await expect(tiers).toBeAttached();
  await expectParameterValue(quality, "max");
  // The desktop drawer initializes on the first animation frame. Close it
  // after model controls are ready, before measuring layout or scroll position.
  if (await sidebar.getAttribute("aria-expanded") === "true") await sidebar.click();
  await expect(sidebar).toHaveAttribute("aria-expanded", "false");
  await expect(panel).toHaveCSS("width", "380px");
  await expect.poll(() => panel.evaluate(element => element.getAnimations()
    .some(animation => animation.playState === "running"))).toBe(false);
  const initialBounds = (await panel.boundingBox())!;
  await quality.scrollIntoViewIfNeeded();
  const scrollTop = await body.evaluate(element => element.scrollTop);
  const assertStable = async () => {
    // The floating card and its text retain screen dimensions at every zoom.
    await expect.poll(async () => {
      const bounds = (await panel.boundingBox())!;
      return Math.max(...(["x", "y", "width", "height"] as const)
        .map(key => Math.abs(bounds[key] - initialBounds[key])));
    }).toBeLessThanOrEqual(1);
    await expect(panel).toHaveCSS("font-size", "13px");
    await expect.poll(async () => (await floatingPanelGeometry(panel)).floatingError).toBeLessThanOrEqual(1);
    await panel.getByRole("button", { name: "关闭模型与参数面板", exact: true }).click({ trial: true });
    await expect(tiers.getByRole("button", { name: "4K", exact: true })).toHaveAttribute("aria-pressed", "true");
    await expectParameterValue(panel.getByLabel("输出分辨率预设", { exact: true }), "auto");
    await expectParameterValue(quality, "max");
    await expect(panel.getByRole("combobox", { name: "精确尺寸", exact: true })).toHaveCount(0);
    await expect.poll(() => body.evaluate(element => element.scrollTop)).toBe(scrollTop);
  };
  await assertStable();
  const initialScans = scans;
  for (const direction of ["zoomout", "zoomout", "zoomout", "zoomin", "zoomin", "zoomin"]) {
    const previousZoom = await page.locator(".canvas-zoom-value").textContent();
    await page.getByRole("button", { name: direction === "zoomout" ? "Zoom Out" : "Zoom In", exact: true }).click();
    await expect(page.locator(".canvas-zoom-value")).not.toHaveText(previousZoom!);
    await assertStable();
  }
  expect(scans).toBe(initialScans);
  await page.screenshot({ path: testInfo.outputPath("stable-panel-after-zoom.png") });
  // A delayed automatic refresh used to replace the dimension controls with
  // generic ratio/size/quantity fields, even though the model never changed.
  holdScan = true;
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  try {
    await expect.poll(() => scans).toBeGreaterThan(initialScans);
    await assertStable();
    await page.getByRole("button", { name: "Zoom Out", exact: true }).click();
    await assertStable();
    await page.screenshot({ path: testInfo.outputPath("stable-panel-during-scan.png") });
  } finally {
    holdScan = false;
    resumeScan?.();
  }
  await expect.poll(async () => (await (await request.get(`/api/canvas/${canvas.id}`)).json()).graph.nodes[0].data.parameters)
    .toMatchObject({ size: "auto", size_tier: "4K", quality: "max" });
  // A confirmed empty catalog must still remove the old model's controls.
  await expect(panel.getByText(/正在扫描模型/)).toHaveCount(0);
  const beforeEmpty = scans;
  emptyScan = true;
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect.poll(() => scans).toBeGreaterThan(beforeEmpty);
  await expect(tiers).toHaveCount(0);
  expect(submissions).toBe(0);
});
