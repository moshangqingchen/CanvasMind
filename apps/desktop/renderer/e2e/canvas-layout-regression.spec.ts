import { expect, test, type APIRequestContext, type Locator } from "@playwright/test";
import { CANGYUAN_IMAGE_CONNECTOR } from "../lib/provider-presets";

const NODE_LABEL = "布局验收：长名称模型与参数";
const MODEL_NAME = "用于检验长模型名称截断和完整提示的高质量图像生成模型";
const QUALITY_LABEL = "用于检验长标签自动换行的输出画质设置";

async function createLayoutCanvas(request: APIRequestContext, connectionId: string, zoom: number, nodeWidth: number) {
  const response = await request.post("/api/canvas", {
    data: {
      title: `布局回归 ${zoom}`,
      graph: {
        schemaVersion: 1,
        viewport: { x: 0, y: 0, zoom },
        edges: [],
        nodes: [{
          id: "layout-image",
          type: "workflow",
          position: { x: 24 / zoom, y: 40 / zoom },
          style: { width: nodeWidth, height: 180 },
          data: {
            nodeType: "image-generation", label: NODE_LABEL, provider: "rest",
            connectionId, model: "layout-image-model", parameters: { quality: "high" },
            parts: [], inputs: [], outputs: [{ id: "images", kind: "image", label: "图片" }],
          },
        }],
      },
    },
  });
  expect(response.ok()).toBeTruthy();
  return (await response.json()).id as string;
}

async function expectSeparated(first: Locator, second: Locator) {
  await expect.poll(async () => {
    const [a, b] = await Promise.all([first.boundingBox(), second.boundingBox()]);
    return Boolean(a && b && (
      a.x + a.width <= b.x || b.x + b.width <= a.x ||
      a.y + a.height <= b.y || b.y + b.height <= a.y
    ));
  }).toBe(true);
}

for (const width of [980, 1280, 1366, 1440, 1920]) {
  test(`参数面板在 ${width}px 窗口随节点缩放，画布工具保持避让`, async ({ page, request }, testInfo) => {
    test.setTimeout(90_000);
    await page.setViewportSize({ width, height: 820 });
    const response = await request.post("/api/providers", {
      data: {
        name: `布局验收 ${width}`, provider: "rest", apiKey: "isolated-layout-no-generation",
        config: {
          baseUrl: "https://layout.invalid",
          modelGroup: "用于检验长群组名称可读性的高质量图像群组",
          connector: {
            ...structuredClone(CANGYUAN_IMAGE_CONNECTOR),
            models: [{
              id: "layout-image-model", name: MODEL_NAME, operations: ["image.generate"],
              metadata: { canvasRunnable: true },
              parameters: [{
                key: "quality", label: QUALITY_LABEL, control: "select", default: "high",
                options: [{ value: "high", label: "高质量" }, { value: "low", label: "标准" }],
              }],
            }],
          },
        },
      },
    });
    expect(response.ok()).toBeTruthy();
    const connection = await response.json();
    let submissions = 0;
    await page.route("**/api/runs", async route => {
      if (route.request().method() === "POST") {
        submissions++;
        await route.abort();
      } else await route.continue();
    });

    for (const zoom of [0.25, 0.5, 1, 2]) {
      const nodeWidth = zoom === 0.5 ? 560 : 420;
      const canvasId = await createLayoutCanvas(request, connection.id, zoom, nodeWidth);
      await page.goto(`/canvas/${canvasId}`);
      await expect(page.locator(".canvas-zoom-value")).toHaveText(`${zoom * 100}%`);
      const inspectorToggle = page.getByRole("button", { name: "智能体面板", exact: true });
      if (await inspectorToggle.getAttribute("aria-expanded") === "true") await inspectorToggle.click();
      await page.getByRole("button", { name: `打开 ${NODE_LABEL} 模型与参数`, exact: true }).click();
      const panel = page.getByRole("dialog", { name: `${NODE_LABEL} 模型与参数`, exact: true });
      await expect(panel).toHaveCSS("width", `${nodeWidth}px`);
      await expect(panel).toHaveCSS("font-size", "13px");
      // At 2x the panel may extend below the screen. Keeping it attached to the
      // node takes priority over the old screen-space clipping/clamping rule.
      await expect.poll(() => panel.evaluate((element, expected) => {
        const card = document.querySelector('.react-flow__node[data-id="layout-image"] .node-card')!.getBoundingClientRect();
        const bounds = element.getBoundingClientRect();
        return Math.max(
          Math.abs(bounds.x - card.x),
          Math.abs(bounds.width - card.width),
          Math.abs(bounds.width - expected.nodeWidth * expected.zoom),
          Math.abs(bounds.y - card.bottom - 10 * expected.zoom),
          Math.abs(bounds.height - 560 * expected.zoom),
        );
      }, { zoom, nodeWidth })).toBeLessThanOrEqual(1);
      await expect(panel.getByRole("button", { name: "关闭模型与参数面板" })).toBeInViewport({ ratio: 1 });
      await expect(panel.getByRole("button", { name: "管理供应商与密钥" })).toBeInViewport({ ratio: 1 });
      const model = panel.getByRole("combobox", { name: `${NODE_LABEL} 模型`, exact: true });
      await expect(model).toHaveAttribute("title", `${MODEL_NAME} · layout-image-model`);
      await expect(panel.locator(".node-config-provider-header > span").first()).toHaveCSS("font-size", "12px");
      const body = panel.locator(".node-config-popover-body");
      await expect(body).toHaveCSS("overflow-y", "auto");
      await expect.poll(() => body.evaluate(element => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1);
      const quality = panel.getByLabel(QUALITY_LABEL, { exact: true });
      await expect(quality).toHaveCSS("font-size", "13px");
      const label = panel.locator(".parameter-field label").filter({ hasText: QUALITY_LABEL });
      await expect(label).toHaveCSS("font-size", "12px");
      await expect.poll(() => label.evaluate(element => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1);
      await page.screenshot({ path: testInfo.outputPath(`panel-${zoom * 100}.png`) });
      await panel.getByRole("button", { name: "关闭模型与参数面板" }).click();
    }

    const toolbar = page.locator(".canvas-toolbar");
    const controls = page.locator(".react-flow__controls");
    const minimap = page.locator(".react-flow__minimap");
    const inspectorToggle = page.getByRole("button", { name: "智能体面板", exact: true });
    await page.getByRole("button", { name: "画笔模式", exact: true }).click();
    await page.getByRole("button", { name: "小地图", exact: true }).click();
    if (await inspectorToggle.getAttribute("aria-expanded") !== "true") await inspectorToggle.click();
    await expect(page.locator("aside.inspector")).toBeVisible();
    await expectSeparated(toolbar, controls);
    await expectSeparated(toolbar, minimap);
    await expect(toolbar).toBeInViewport({ ratio: 1 });
    if (width > 1100) {
      const handle = page.getByRole("separator", { name: "调整右侧面板宽度" });
      await handle.focus();
      for (let step = 0; step < 17; step++) await page.keyboard.press("ArrowLeft");
      await expectSeparated(toolbar, controls);
      await expectSeparated(toolbar, minimap);
    }
    await page.screenshot({ path: testInfo.outputPath("drawing-with-inspector.png") });
    await page.getByRole("button", { name: "关闭智能体", exact: true }).click();
    await expect(page.locator("aside.inspector")).toBeHidden();
    await expectSeparated(toolbar, controls);
    await expectSeparated(toolbar, minimap);
    await page.getByRole("button", { name: "抓手模式", exact: true }).click();
    await page.getByRole("button", { name: "小地图", exact: true }).click();

    // Measuring the canvas must not change fixed menu coordinates.
    await page.mouse.click(width - 50, 650, { button: "right" });
    const menu = page.getByRole("menu", { name: "新建节点", exact: true });
    await expect(menu).toBeInViewport({ ratio: 1 });
    const menuBounds = await menu.boundingBox();
    expect(menuBounds!.y).toBeGreaterThanOrEqual(500);
    expect(menuBounds!.y).toBeLessThanOrEqual(650);
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1);
    expect(submissions).toBe(0);
  });
}
