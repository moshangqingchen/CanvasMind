import { expect, test } from "@playwright/test";
import { effectiveImageCapabilities } from "../lib/supplier-capabilities";
import { CANGYUAN_IMAGE_CONNECTOR } from "../lib/provider-presets";
import { bindScannedModelProtocols } from "../lib/scanned-model-protocols";

for (const [id, values] of [
  ["gpt-image-2.5-flare-yf", ["auto", "low", "medium", "high", "xhigh", "max"]],
  ["gpt-image-2-cf", ["low", "medium", "high"]],
] as const) test(`highest quality unlocks all options and persists each choice: ${id}`, async ({ page, request }) => {
  const config = { baseUrl: "https://vapi.chuangxiangai.asia", modelGroup: "生图", usage: "canvas" };
  const bound = bindScannedModelProtocols({ provider: "openai", config }, [{ id, name: "质量验收", operations: ["image.generate"] }]).models[0]!;
  const descriptor = effectiveImageCapabilities({
    supplier: { id: "cx", name: "创想", supplierKey: "cx", kind: "newapi", apiUrl: config.baseUrl, siteUrl: config.baseUrl, catalog: { groups: [] }, scanStatus: "live", createdAt: "now", updatedAt: "now" },
    connection: { id: "cx", provider: "openai", config }, model: bound, fingerprint: "f",
  }).model;
  const response = await request.post("/api/providers", { data: { name: "质量隔离验收", provider: "rest", apiKey: "no-paid-generation", config: { baseUrl: "https://isolated.invalid", connector: { ...structuredClone(CANGYUAN_IMAGE_CONNECTOR), models: [descriptor] } } } });
  expect(response.ok()).toBeTruthy(); const connection = await response.json();
  const canvas = await (await request.post("/api/canvas", { data: { title: "最高质量解锁", graph: { schemaVersion: 1, viewport: { x: 0, y: 0, zoom: 1 }, edges: [], nodes: [{ id: "image", type: "workflow", position: { x: 80, y: 30 }, style: { width: 420, height: 180 }, data: { nodeType: "image-generation", label: "质量验收", provider: "rest", connectionId: connection.id, model: descriptor.id, parameters: { size: "1024x1024", quality: values.at(-1) }, parts: [], inputs: [], outputs: [] } }] } } })).json();
  await page.setViewportSize({ width: 1280, height: 1000 });
  await page.goto(`/canvas/${canvas.id}`);
  const open = () => page.getByRole("button", { name: "打开 质量验收 模型与参数", exact: true }).click();
  await open();
  const panel = page.getByRole("dialog", { name: "质量验收 模型与参数" });
  const quality = panel.getByLabel("质量", { exact: true });
  expect(await quality.locator("option").evaluateAll(options => options.map(o => (o as HTMLOptionElement).value).filter(Boolean))).toEqual(values);
  for (const value of values) {
    await quality.selectOption(value);
    await expect.poll(async () => (await (await request.get(`/api/canvas/${canvas.id}`)).json()).graph.nodes[0].data.parameters.quality).toBe(value);
  }
  await quality.selectOption("low");
  await expect.poll(async () => (await (await request.get(`/api/canvas/${canvas.id}`)).json()).graph.nodes[0].data.parameters.quality).toBe("low");
  await page.reload(); await open(); await expect(quality).toHaveValue("low");
});

test("Chuangxiang historical small response keeps 2K and 4K plus every ratio visible", async ({ page, request }) => {
  const config = { baseUrl: "https://vapi.chuangxiangai.asia", modelGroup: "生图", usage: "canvas" };
  const bound = bindScannedModelProtocols({ provider: "openai", config }, [{ id: "gpt-image-2.5-yf", name: "创想历史尺寸验收", operations: ["image.generate"] }]).models[0]!;
  const descriptor = effectiveImageCapabilities({
    supplier: { id: "cx", name: "创想", supplierKey: "cx", kind: "newapi", apiUrl: config.baseUrl, siteUrl: config.baseUrl, catalog: { groups: [] }, scanStatus: "live", createdAt: "now", updatedAt: "now" },
    connection: { id: "cx", provider: "openai", config }, model: bound, fingerprint: "f",
    tests: [{ id: "test", requestId: "request", supplierId: "cx", sourceId: "cx", connectionId: "cx", group: "生图", modelId: bound.id, provider: "openai", fingerprint: "f", dedupeKey: "d", resolution: "2K", ratio: "16:9", expectedWidth: 2720, expectedHeight: 1536, actualWidth: 1672, actualHeight: 941, parameters: { size: "2720x1536" }, status: "unsupported", rejectedParameter: "resolution", createdAt: "now", updatedAt: "now" }],
  }).model;
  const response = await request.post("/api/providers", { data: { name: "创想隔离界面验收", provider: "rest", apiKey: "no-paid-generation", config: { baseUrl: "https://isolated.invalid", connector: { ...structuredClone(CANGYUAN_IMAGE_CONNECTOR), models: [descriptor] } } } });
  expect(response.ok()).toBeTruthy(); const connection = await response.json();
  const canvas = await (await request.post("/api/canvas", { data: { title: "创想尺寸验收", graph: { schemaVersion: 1, viewport: { x: 0, y: 0, zoom: 1 }, edges: [], nodes: [{ id: "image", type: "workflow", position: { x: 80, y: 30 }, style: { width: 420, height: 180 }, data: { nodeType: "image-generation", label: "创想验收", provider: "rest", connectionId: connection.id, model: descriptor.id, parameters: { size: "auto" }, parts: [], inputs: [], outputs: [] } }] } } })).json();
  await page.setViewportSize({ width: 1280, height: 1000 });
  await page.goto(`/canvas/${canvas.id}`);
  await page.getByRole("button", { name: "打开 创想验收 模型与参数", exact: true }).click();
  const panel = page.getByRole("dialog", { name: "创想验收 模型与参数" });
  for (const tier of ["1K", "2K", "4K"]) {
    await panel.getByRole("button", { name: tier, exact: true }).click();
    const options = await panel.getByLabel("输出分辨率预设", { exact: true }).locator("option").allTextContents();
    expect(options.filter(label => label.startsWith(`${tier} ·`))).toHaveLength(11);
    expect(options.some(label => /自动.*提示词.*参考图/u.test(label))).toBe(true);
  }
});

test("one passed 4K probe exposes every ratio, preserves auto, and keeps the panel attached to its node", async ({ page, request }, testInfo) => {
  const descriptor = effectiveImageCapabilities({
    supplier: { id: "isolated", name: "隔离", supplierKey: "isolated", kind: "newapi", apiUrl: "https://isolated.invalid", siteUrl: "https://isolated.invalid", catalog: { groups: [] }, scanStatus: "live", createdAt: "now", updatedAt: "now" },
    connection: { id: "fixture", provider: "openai", config: {} },
    model: { id: "gpt-image-2", name: "比例验收", operations: ["image.generate"] }, fingerprint: "f",
    tests: [{ id: "test", requestId: "request", supplierId: "isolated", sourceId: "source", connectionId: "fixture", group: "默认群组", modelId: "gpt-image-2", provider: "openai", fingerprint: "f", dedupeKey: "d", resolution: "4K", ratio: "16:9", expectedWidth: 3840, expectedHeight: 2160, actualWidth: 3840, actualHeight: 2160, parameters: { size: "3840x2160" }, status: "succeeded", createdAt: "now", updatedAt: "now" }],
  }).model;
  const connectionResponse = await request.post("/api/providers", { data: {
    name: "隔离比例验收", provider: "rest", apiKey: "no-paid-generation",
    config: { baseUrl: "https://isolated.invalid", connector: { ...structuredClone(CANGYUAN_IMAGE_CONNECTOR), models: [descriptor, { id: "sparse-image", name: "简单型号", operations: ["image.generate"], parameters: [] }] } },
  } });
  expect(connectionResponse.ok()).toBeTruthy();
  const connection = await connectionResponse.json();
  const canvas = await (await request.post("/api/canvas", { data: { title: "固定面板与比例", graph: { schemaVersion: 1, viewport: { x: 0, y: 0, zoom: 1 }, edges: [], nodes: [{ id: "image", type: "workflow", position: { x: 80, y: 30 }, style: { width: 420, height: 180 }, data: { nodeType: "image-generation", label: "比例验收", provider: "rest", connectionId: connection.id, model: descriptor.id, parameters: { size: "3840x2160", size_tier: "4K" }, parts: [], inputs: [], outputs: [{ id: "images", kind: "image", label: "图片" }] } }] } } })).json();
  let submissions = 0;
  await page.route("**/api/runs", async route => { if (route.request().method() === "POST") { submissions++; await route.abort(); } else await route.continue(); });
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(`/canvas/${canvas.id}`);
  const open = () => page.getByRole("button", { name: "打开 比例验收 模型与参数", exact: true }).click();
  await open();
  const panel = page.getByRole("dialog", { name: "比例验收 模型与参数" });
  await expect(panel).toHaveCSS("width", "420px");
  const assertAttached = () => expect.poll(() => panel.evaluate(element => {
    const card = element.closest(".react-flow__node")!.querySelector(".node-card")!.getBoundingClientRect();
    const bounds = element.getBoundingClientRect();
    const viewport = document.querySelector(".react-flow__viewport")!;
    const zoom = new DOMMatrixReadOnly(getComputedStyle(viewport).transform).a;
    return Math.max(
      Math.abs(bounds.x - card.x),
      Math.abs(bounds.width - card.width),
      Math.abs(bounds.y - card.bottom - 10 * zoom),
      Math.abs(bounds.height - 560 * zoom),
    );
  })).toBeLessThanOrEqual(1);
  await assertAttached();
  const size = panel.getByLabel("输出分辨率预设", { exact: true });
  const options = await size.locator("option").allTextContents();
  expect(options.filter(label => /4K · \d+:\d+/u.test(label))).toHaveLength(11);
  expect(options.some(label => /自动.*提示词.*参考图/u.test(label))).toBe(true);
  await size.selectOption("2160x3840");
  await size.selectOption("auto");
  await expect.poll(async () => (await (await request.get(`/api/canvas/${canvas.id}`)).json()).graph.nodes[0].data.parameters).toMatchObject({ size: "auto", size_tier: "4K" });
  await panel.locator("summary").last().click();
  await expect(panel).toHaveCSS("height", "560px");
  const body = panel.locator(".node-config-popover-body");
  await expect(body).toHaveCSS("overflow-y", "auto");
  await body.evaluate(el => { el.scrollTop = el.scrollHeight; });
  await expect.poll(() => body.evaluate(el => el.scrollTop)).toBeGreaterThan(0);
  await assertAttached();
  // Connection controls scroll with the rest of the panel. Return to the top
  // before using them, as a user would after inspecting the lower parameters.
  await body.hover({ position: { x: 16, y: 16 } });
  await page.mouse.wheel(0, -5000);
  await expect(body).toHaveJSProperty("scrollTop", 0);
  const modelSelect = panel.getByRole("combobox", { name: "比例验收 模型", exact: true });
  await expect(modelSelect).toBeInViewport({ ratio: 1 });
  await expect(panel.getByLabel("比例验收 供应商", { exact: true })).toBeInViewport({ ratio: 1 });
  await expect(panel.getByLabel("比例验收 模型群组", { exact: true })).toBeInViewport({ ratio: 1 });
  await page.screenshot({ path: testInfo.outputPath("panel-scrolled-back-to-model.png") });
  const modelBox = await modelSelect.boundingBox();
  const bodyBox = await body.boundingBox();
  expect(modelBox!.y).toBeGreaterThanOrEqual(bodyBox!.y);
  expect(modelBox!.y + modelBox!.height).toBeLessThanOrEqual(bodyBox!.y + bodyBox!.height);
  await modelSelect.click();
  const menu = panel.getByRole("listbox");
  await expect(menu).toBeInViewport({ ratio: 1 });
  const menuBox = await menu.boundingBox();
  const panelBox = await panel.boundingBox();
  expect(menuBox!.y + menuBox!.height).toBeLessThan(panelBox!.y + panelBox!.height);
  await expect(panel).toHaveCSS("height", "560px");
  await panel.getByRole("option", { name: "简单型号", exact: true }).click();
  await expect(panel).toHaveCSS("height", "560px");
  await expect(body).toHaveJSProperty("scrollTop", 0);
  await panel.getByRole("combobox", { name: "比例验收 模型", exact: true }).click();
  await panel.getByRole("option", { name: "比例验收", exact: true }).click();
  await panel.getByRole("group", { name: "自动与输出分辨率快捷档位" }).getByRole("button", { name: "4K", exact: true }).click();
  await size.selectOption("auto");
  await page.reload();
  await open();
  await expect(size).toHaveValue("auto");
  await expect(panel.getByRole("button", { name: "4K", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(panel).toHaveCSS("height", "560px");
  await page.screenshot({ path: testInfo.outputPath("attached-panel-ratios.png") });
  await assertAttached();
  await page.setViewportSize({ width: 1280, height: 720 });
  await assertAttached();
  await page.screenshot({ path: testInfo.outputPath("panel-below-node.png") });
  await page.setViewportSize({ width: 760, height: 580 });
  await assertAttached();
  expect(submissions).toBe(0);
});
