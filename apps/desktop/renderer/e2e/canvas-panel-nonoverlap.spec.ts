import { expect, test } from "@playwright/test";
import type { ModelDescriptor } from "@super-canvas/providers";
import type { CanvasResponse, ProviderConnectionView } from "../lib/client-api";
import { CANGYUAN_IMAGE_CONNECTOR } from "../lib/provider-presets";
import { attachedPanelGeometry } from "./attached-panel-geometry";

const label = "视频面板避让验收";
const origin = "https://panel-nonoverlap.invalid";
const model: ModelDescriptor = {
  id: "isolated-panel-video", name: "隔离视频布局模型",
  operations: ["video.generate"], inputKinds: ["text"], outputKinds: ["video"],
  metadata: { canvasRunnable: true, source: "manual" },
  parameters: [
    { key: "duration", label: "视频时长", control: "select", valueType: "integer", default: 5,
      options: [{ value: 5, label: "5 秒" }, { value: 10, label: "10 秒" }] },
    ...Array.from({ length: 12 }, (_, index) => ({
      key: `layout_field_${index}`, label: `布局参数 ${index + 1}`,
      control: "text" as const, default: `原值 ${index + 1}`,
    })),
  ],
};

test.beforeAll(() => {
  expect(process.env.PLAYWRIGHT_BASE_URL, "布局验收必须使用隔离数据库与 profile").toBeFalsy();
});

for (const scenario of [
  { name: "200% 缩放", viewport: { width: 1280, height: 900 }, zoom: 2, x: 55, y: 40 },
  { name: "200% 右侧节点与动态小地图", viewport: { width: 1440, height: 900 }, zoom: 2, x: 400, y: 40 },
  { name: "画布中部节点", viewport: { width: 1440, height: 900 }, zoom: 1, x: 160, y: 230 },
  { name: "窄窗口下部节点", viewport: { width: 620, height: 820 }, zoom: 1, x: 75, y: 350 },
]) {
  test(`${scenario.name} 参数框不覆盖视频节点，滚动后仍可编辑和关闭`, async ({ page, request }, testInfo) => {
    await page.setViewportSize(scenario.viewport);
    const errors: string[] = [];
    let submissions = 0;
    page.on("pageerror", error => errors.push(error.message));
    await page.route("**/*", route => {
      const url = new URL(route.request().url());
      if (url.pathname.startsWith("/api/runs") && route.request().method() === "POST") {
        submissions++;
        return route.abort();
      }
      if (["http:", "https:"].includes(url.protocol) && !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))
        return route.abort();
      return route.continue();
    });
    const created = await request.post("/api/providers", { data: {
      name: `避让布局 ${scenario.name}`, provider: "rest", apiKey: "isolated-no-paid-generation",
      config: { baseUrl: origin, defaultModel: model.id, usage: "canvas",
        connector: { ...structuredClone(CANGYUAN_IMAGE_CONNECTOR), models: [model], restrictModels: true } },
    } });
    expect(created.ok()).toBeTruthy();
    const stored: ProviderConnectionView = await created.json();
    const connection: ProviderConnectionView = {
      ...stored, apiKey: "", apiKeySet: true, apiKeyUsable: true,
      config: { ...stored.config, supplierKey: "custom-panel-nonoverlap", supplierName: "隔离布局供应商",
        modelGroup: "视频布局", accountKeyGroup: "视频布局", modelScanStatus: "live",
        modelCatalogModels: [model], scannedModelIds: [model.id] },
    };
    await page.route(/\/api\/suppliers(?:\?.*)?$/u, route => route.fulfill({ json: [] }));
    await page.route(/\/api\/providers(?:\?.*)?$/u, route => route.request().method() === "GET"
      ? route.fulfill({ json: [connection] }) : route.continue());
    await page.route(`**/api/providers/${connection.id}/models*`, route => route.fulfill({
      json: [model], headers: { "X-Model-Scan-Status": "live", "X-Model-Scan-Complete": "true" },
    }));
    const initialPosition = { x: scenario.x / scenario.zoom, y: scenario.y / scenario.zoom };
    const createdCanvas = await request.post("/api/canvas", { data: {
      title: `视频面板避让 ${scenario.name}`, graph: {
        schemaVersion: 1, viewport: { x: 0, y: 0, zoom: scenario.zoom }, edges: [], nodes: [{
          id: "layout-video", type: "workflow", position: initialPosition, style: { width: 420, height: 180 },
          data: { nodeType: "video-generation", label, provider: "rest", connectionId: connection.id,
            model: model.id, qualityMode: "custom",
            parameters: Object.fromEntries(model.parameters!.map(parameter => [parameter.key, parameter.default])),
            parts: [{ type: "text", text: "这段视频提示词和节点按钮必须保持可见，参数框不能盖在上面。" }],
            inputs: [{ id: "prompt", kind: "text", label: "提示词" }],
            outputs: [{ id: "video", kind: "video", label: "视频" }] },
        }],
      },
    } });
    expect(createdCanvas.ok()).toBeTruthy();
    const canvas: CanvasResponse = await createdCanvas.json();
    const savedNode = async () => {
      const response = await request.get(`/api/canvas/${canvas.id}`);
      expect(response.ok()).toBeTruthy();
      const saved: CanvasResponse = await response.json();
      return saved.graph.nodes[0]!;
    };
    await page.goto(`/canvas/${canvas.id}`);
    await expect(page.locator(".canvas-zoom-value")).toHaveText(`${scenario.zoom * 100}%`);
    await page.getByRole("button", { name: `打开 ${label} 模型与参数`, exact: true }).click();
    const panel = page.getByRole("dialog", { name: `${label} 模型与参数`, exact: true });
    await expect(panel.getByRole("combobox", { name: `${label} 模型`, exact: true })).toContainText(model.name);
    const sidebar = page.getByRole("button", { name: "智能体面板", exact: true });
    if (await sidebar.getAttribute("aria-expanded") === "true") await sidebar.click();
    await expect(sidebar).toHaveAttribute("aria-expanded", "false");

    // Include the whole canvas in the evidence, even on the old failing build.
    await page.screenshot({ path: testInfo.outputPath("opened-panel-and-node.png") });
    const assertClear = () => expect.poll(async () => (await attachedPanelGeometry(panel)).attachmentError).toBeLessThanOrEqual(1);
    await assertClear();
    if (scenario.name.includes("小地图")) {
      await page.getByRole("button", { name: "小地图", exact: true }).click();
      await expect(page.locator(".react-flow__minimap")).toBeVisible();
      await assertClear();
    }
    const card = page.locator('.react-flow__node[data-id="layout-video"] .node-card');
    await card.locator(".node-head").click({ trial: true });
    await panel.getByRole("button", { name: "关闭模型与参数面板", exact: true }).click({ trial: true });
    const body = panel.locator(".node-config-popover-body");
    await expect.poll(() => body.evaluate(element => element.scrollHeight - element.clientHeight)).toBeGreaterThan(0);
    const bodyBounds = await body.boundingBox();
    expect(bodyBounds!.height).toBeGreaterThan(30);
    await page.mouse.move(bodyBounds!.x + bodyBounds!.width / 2, bodyBounds!.y + bodyBounds!.height / 2);
    await page.mouse.wheel(0, 700);
    await expect.poll(() => body.evaluate(element => element.scrollTop)).toBeGreaterThan(0);
    const finalField = panel.getByLabel("布局参数 12", { exact: true });
    await finalField.scrollIntoViewIfNeeded();
    await finalField.click();
    await expect(finalField).toBeFocused();
    await finalField.fill("滚动后已编辑");
    await expect(finalField).toHaveValue("滚动后已编辑");
    await assertClear();
    await expect.poll(async () => (await savedNode()).data.parameters?.layout_field_11).toBe("滚动后已编辑");
    expect((await savedNode()).position).toEqual(initialPosition);
    await page.screenshot({ path: testInfo.outputPath("scrolled-panel-and-uncovered-node.png") });
    await panel.getByRole("button", { name: "关闭模型与参数面板", exact: true }).click();
    await expect(panel).toBeHidden();
    await page.getByRole("button", { name: `打开 ${label} 模型与参数`, exact: true }).click();
    await expect(finalField).toHaveValue("滚动后已编辑");
    await assertClear();
    expect((await savedNode()).position).toEqual(initialPosition);
    expect(submissions).toBe(0);
    expect(errors).toEqual([]);
  });
}
