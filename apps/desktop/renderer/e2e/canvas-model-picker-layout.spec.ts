import { expect, test, type APIRequestContext, type Locator, type Page } from "@playwright/test";
import { parseTk1688Marketplace } from "@super-canvas/providers";
import { CANGYUAN_IMAGE_CONNECTOR } from "../lib/provider-presets";

const families = [
  "gpt-image-1", "gpt-image-1.5", "gpt-image-2", "gpt-image-2.5",
  "gpt-image-2.5-flare", "gpt-image-3", "gpt-image-2.5-sunburst",
];
const lastFamily = families[families.length - 1]!;
const items = families.map((base, index) => ({
  base_model: base, alias: `${base}@s${index + 1}c${index + 21}`,
  description: "支持1K、2K图像生成", input_price_usd: 0.01,
  charge_type: "per_request", status: "active", channel_alive: true,
}));
const models = parseTk1688Marketplace({ success: true, data: { total: items.length, items } }, undefined,
  { keyModelIds: families, accountModelIds: items.map(item => item.alias) }).models;

async function fixture(page: Page, request: APIRequestContext) {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  let submissions = 0;
  await page.route("**/api/runs**", async route => {
    if (route.request().method() === "POST") { submissions++; await route.abort(); }
    else await route.continue();
  });
  const supplierResponse = await request.post("/api/suppliers", { data: {
    name: "完整模型列表布局验收", siteUrl: "https://picker-layout.invalid", apiUrl: "https://picker-layout.invalid",
  } });
  expect(supplierResponse.ok()).toBeTruthy();
  const supplier = await supplierResponse.json();
  const providerResponse = await request.post("/api/providers", { data: {
    name: "完整模型列表隔离连接", provider: "rest", apiKey: "isolated-no-paid-generation",
    config: { supplierId: supplier.id, supplierKey: supplier.supplierKey,
      baseUrl: supplier.apiUrl, usage: "canvas", customGroup: true, modelGroup: "布局验收",
      defaultModel: lastFamily, connector: { ...structuredClone(CANGYUAN_IMAGE_CONNECTOR), models } },
  } });
  expect(providerResponse.ok()).toBeTruthy();
  const connection = await providerResponse.json();
  await page.route(`**/api/providers/${connection.id}/models*`, route => route.fulfill({
    json: models, headers: { "X-Model-Scan-Status": "live" },
  }));
  const canvasResponse = await request.post("/api/canvas", { data: { title: "完整模型列表布局回归", graph: {
    schemaVersion: 1, viewport: { x: 0, y: 0, zoom: 1 }, edges: [], nodes: [{
      id: "layout-image", type: "workflow", position: { x: 55, y: 40 }, style: { width: 420, height: 180 },
      data: { nodeType: "image-generation", label: "列表布局", provider: "rest", connectionId: connection.id,
        model: lastFamily, parameters: {}, parts: [], inputs: [{ id: "prompt", kind: "text", label: "提示词" }],
        outputs: [{ id: "images", kind: "image", label: "图片" }] },
    }],
  } } });
  expect(canvasResponse.ok()).toBeTruthy();
  const canvas = await canvasResponse.json();
  await page.goto(`/canvas/${canvas.id}`);
  const sidebar = page.getByRole("button", { name: "智能体面板", exact: true });
  if ((await sidebar.getAttribute("aria-expanded")) === "true") await sidebar.click();
  await page.getByRole("button", { name: "打开 列表布局 模型与参数", exact: true }).click();
  const panel = page.getByRole("dialog", { name: "列表布局 模型与参数", exact: true });
  const picker = panel.getByRole("combobox", { name: "列表布局 模型", exact: true });
  await expect(picker).toContainText(lastFamily);
  return {
    panel, picker,
    list: panel.getByRole("listbox"),
    menu: panel.locator(".node-model-select-options"),
    search: panel.getByRole("combobox", { name: "搜索模型名称或 ID", exact: true }),
    supplier: panel.getByRole("combobox", { name: "列表布局 供应商", exact: true }),
    readNode: async () => (await (await request.get(`/api/canvas/${canvas.id}`)).json()).graph.nodes[0].data,
    assertNoRuns: () => { expect(submissions).toBe(0); expect(errors).toEqual([]); },
  };
}

async function expectMenuInViewport(menu: Locator) {
  await expect.poll(() => menu.evaluate(element => {
    const bounds = element.getBoundingClientRect();
    return bounds.left >= 11 && bounds.top >= 11
      && bounds.right <= window.innerWidth - 11 && bounds.bottom <= window.innerHeight - 11;
  })).toBe(true);
}

async function expectAllOptionsVisible(list: Locator) {
  await expect(list.getByRole("option")).toHaveCount(8);
  await expect.poll(() => list.evaluate(element => {
    const bounds = element.getBoundingClientRect();
    const options = [...element.querySelectorAll('[role="option"]')];
    return element.scrollHeight - element.clientHeight <= 1 && element.scrollTop === 0
      && options.every(option => {
        const item = option.getBoundingClientRect();
        return item.top >= bounds.top - 1 && item.bottom <= bounds.bottom + 1
          && item.left >= bounds.left - 1 && item.right <= bounds.right + 1;
      });
  })).toBe(true);
}

async function clickUncoveredSupplier(page: Page, supplier: Locator, picker: Locator, menu: Locator) {
  const menuBounds = await menu.boundingBox();
  const supplierBounds = await supplier.boundingBox();
  expect(menuBounds).not.toBeNull();
  expect(supplierBounds).not.toBeNull();
  expect(menuBounds!.x + menuBounds!.width <= supplierBounds!.x
    || menuBounds!.x >= supplierBounds!.x + supplierBounds!.width
    || menuBounds!.y + menuBounds!.height <= supplierBounds!.y
    || menuBounds!.y >= supplierBounds!.y + supplierBounds!.height).toBe(true);
  await expect.poll(() => supplier.evaluate(element => {
    const bounds = element.getBoundingClientRect();
    return document.elementFromPoint(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2) === element;
  })).toBe(true);
  await supplier.click();
  await expect(picker).toHaveAttribute("aria-expanded", "false");
  await expect(supplier).toBeFocused();
  await expect.poll(() => supplier.evaluate(element => element.matches(":open"))).toBe(true);
  await page.keyboard.press("Escape");
}

for (const viewport of [{ width: 1440, height: 1080 }, { width: 1280, height: 720 }]) {
  test(`${viewport.width}×${viewport.height} 完整展示八个型号，供应商仍能直接打开`, async ({ page, request }, testInfo) => {
    await page.setViewportSize(viewport);
    const ui = await fixture(page, request);
    await ui.picker.click();
    await expect(ui.list.getByRole("option").last()).toHaveAccessibleName(lastFamily);
    await expect(ui.list.getByRole("option").last()).toHaveAttribute("aria-selected", "true");
    await expectAllOptionsVisible(ui.list);
    await expectMenuInViewport(ui.menu);
    await page.screenshot({ path: testInfo.outputPath(`all-models-${viewport.width}x${viewport.height}.png`) });
    await clickUncoveredSupplier(page, ui.supplier, ui.picker, ui.menu);
    expect((await ui.readNode()).model).toBe(lastFamily);
    ui.assertNoRuns();
  });
}

test("模型菜单打开后缩窄视口仍在屏幕内，键盘可访问末项并选择商家", async ({ page, request }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 1080 });
  const ui = await fixture(page, request);
  await ui.picker.click();
  await expectAllOptionsVisible(ui.list);
  await page.setViewportSize({ width: 620, height: 620 });
  await expect(ui.picker).toHaveAttribute("aria-expanded", "true");
  await expectMenuInViewport(ui.menu);
  await expect.poll(() => ui.list.evaluate(element => element.scrollHeight > element.clientHeight)).toBe(true);
  await ui.search.press("Home");
  await expect(ui.list.getByRole("option", { name: "自动模型", exact: true })).toHaveAttribute("data-active", "true");
  await ui.list.hover();
  await page.mouse.wheel(0, 200);
  await expect.poll(() => ui.list.evaluate(element => element.scrollTop)).toBeGreaterThan(0);
  await ui.search.press("End");
  const last = ui.list.getByRole("option", { name: lastFamily, exact: true });
  await expect(last).toHaveAttribute("data-active", "true");
  await expect.poll(() => last.evaluate(element => {
    const list = element.closest('[role="listbox"]')!.getBoundingClientRect();
    const item = element.getBoundingClientRect();
    return item.top >= list.top - 1 && item.bottom <= list.bottom + 1;
  })).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("narrow-model-menu-keyboard-last.png") });
  await ui.search.press("Enter");
  await expect(ui.list.getByRole("option")).toHaveCount(2);
  await expectMenuInViewport(ui.menu);
  await ui.search.press("End");
  await ui.search.press("Enter");
  await expect(ui.picker).toHaveAttribute("aria-expanded", "false");
  await expect(ui.picker).toBeFocused();
  await expect.poll(async () => (await ui.readNode()).model).toBe(items[items.length - 1]!.alias);
  ui.assertNoRuns();
});
