import { expect, test, type Page } from "@playwright/test";
import type { ModelDescriptor } from "@super-canvas/providers";
import type { ProviderConnectionView } from "../lib/client-api";
import type { SupplierRecord } from "../lib/client-suppliers";

async function fixture(page: Page, count = 3, options: { metadata?: boolean; groups?: number } = {}) {
  const models: ModelDescriptor[] = Array.from({ length: count }, (_, index) => ({
    id: `model-${index}`, name: `创作模型 ${index}`, operations: ["image.generate"],
    metadata: { priceLabel: "¥0.20 / 张", ...(index === 1 ? { imageCapabilitiesVerifiedAt: "2026-09-21T03:00:00.000Z" } : {}) },
  }));
  let suppliers: SupplierRecord[] = ["主供应商", "备用供应商"].map((name, index) => ({
    id: `usability-${index}`, supplierKey: `usability-${index}`, name, kind: "openai-compatible", siteUrl: "https://example.invalid", apiUrl: "https://example.invalid/v1",
    catalog: { groups: Array.from({ length: options.groups ?? 1 }, (_, groupIndex) => ({
      id: groupIndex ? `z-after-${groupIndex}` : "vip", label: groupIndex ? `后续分组 ${groupIndex}` : "创作组", source: "catalog", supplierGroupId: options.metadata === false ? undefined : groupIndex ? String(7 + groupIndex) : "007",
      details: options.metadata === false ? undefined : { source: "key-groups", rateMultiplier: 1.25 },
      models: [{ id: "public-only", name: "公开目录模型", capability: "image" }] })) },
    scanStatus: "live", scanComplete: true, scannedAt: "2026-09-22T03:00:00.000Z", scanLastSuccessAt: options.metadata === false ? undefined : "2026-09-21T03:00:00.000Z",
    createdAt: "2026-09-21T03:00:00.000Z", updatedAt: "2026-09-21T03:00:00.000Z",
  }));
  let connections: ProviderConnectionView[] = suppliers.map(supplier => ({
    id: `connection-${supplier.id}`, name: `${supplier.name}主账号`, provider: "openai", apiKey: "", apiKeySet: true,
    config: { supplierId: supplier.id, supplierKey: supplier.supplierKey, baseUrl: supplier.apiUrl, modelGroup: "vip", usage: "canvas", modelCatalogModels: models, scannedModelIds: models.map(model => model.id), modelScanStatus: "live", modelScanComplete: true, modelScanCheckedAt: "2026-09-22T03:00:00.000Z", modelScanLastSuccessAt: options.metadata === false ? undefined : "2026-09-21T03:00:00.000Z" },
  }));
  const calls: { method: string; path: string; cached: boolean }[] = [];
  const writes: Record<string, unknown>[] = [];
  await page.route("**/api/suppliers**", async route => {
    const request = route.request(); const url = new URL(request.url());
    if (url.pathname === "/api/suppliers/catalog-upgrade") return route.fallback();
    calls.push({ method: request.method(), path: url.pathname, cached: false });
    if (request.method() === "PATCH") {
      const patch = request.postDataJSON();
      suppliers = suppliers.map(supplier => url.pathname.endsWith(supplier.id) ? { ...supplier, ...patch } : supplier);
      await route.fulfill({ json: suppliers.find(supplier => url.pathname.endsWith(supplier.id)) });
    } else if (url.pathname.endsWith("/verification")) await route.fulfill({ json: null });
    else await route.fulfill({ json: suppliers });
  });
  await page.route("**/api/providers**", async route => {
    const request = route.request(); const url = new URL(request.url());
    calls.push({ method: request.method(), path: url.pathname, cached: url.searchParams.get("cached") === "1" });
    if (url.pathname.endsWith("/models")) {
      await route.fulfill({ json: models, headers: { "X-Model-Scan-Status": "live" } });
    } else if (url.pathname.endsWith("/test")) {
      await route.fulfill({ json: { message: "连接测试成功", status: "live", models } });
    } else if (request.method() === "POST") {
      const body = request.postDataJSON();
      writes.push(body);
      const current = connections.find(connection => connection.id === body.id)!;
      const saved = { ...current, ...body, apiKey: "", apiKeySet: true };
      connections = connections.map(connection => connection.id === saved.id ? saved : connection);
      await route.fulfill({ json: saved });
    } else await route.fulfill({ json: connections });
  });
  await page.goto("/");
  await page.getByTestId("workspace-settings").click();
  const dialog = page.getByRole("dialog", { name: "供应商与模型设置" });
  await expect(dialog.getByRole("heading", { name: "主供应商", exact: true })).toBeVisible();
  await expect(dialog.locator('.sm-model-item').first()).toBeVisible();
  return { dialog, calls, writes, connections: () => connections };
}

for (const viewport of [
  { width: 1024, height: 768 },
  { width: 1366, height: 768 },
  { width: 1920, height: 1080 },
]) {
  test(`供应商概览在 ${viewport.width} 像素下使用玻璃设置面板且没有遮挡`, async ({ page }, testInfo) => {
    await page.setViewportSize(viewport);
    await page.emulateMedia({ reducedMotion: "reduce" });
    const { dialog, writes } = await fixture(page, 125);
    await expect(dialog).toHaveCSS("border-top-left-radius", "14px");
    expect(await dialog.evaluate(element => {
      const color = getComputedStyle(element).backgroundColor;
      return color.startsWith("rgba") ? Number.parseFloat(color.slice(color.lastIndexOf(",") + 1)) : 1;
    })).toBeGreaterThan(0);
    await expect(dialog).toHaveCSS("backdrop-filter", "blur(14px) saturate(1.2)");
    const bounds = await dialog.boundingBox();
    expect(bounds).not.toBeNull();
    expect(bounds!.x).toBeGreaterThanOrEqual(8);
    expect(bounds!.y).toBeGreaterThanOrEqual(8);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(viewport.width);
    expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(viewport.height);
    const sidebar = await dialog.getByRole("complementary", { name: "供应商列表" }).boundingBox();
    const main = await dialog.locator(".sm-main").boundingBox();
    expect(sidebar).not.toBeNull();
    expect(main).not.toBeNull();
    expect(sidebar!.x + sidebar!.width).toBeLessThanOrEqual(main!.x);
    await expect(dialog.locator('[data-supplier-stat="groups"] strong')).toHaveText("1");
    await expect(dialog.locator('[data-supplier-stat="models"] strong')).toHaveText("1");
    await expect(dialog.locator('[data-supplier-stat="updated"] time')).toHaveAttribute("datetime", "2026-09-21T03:00:00.000Z");
    const cards = await dialog.locator(".sm-supplier-overview > div").all();
    let previousRight = 0;
    for (const card of cards) {
      const cardBounds = await card.boundingBox();
      expect(cardBounds).not.toBeNull();
      expect(cardBounds!.x).toBeGreaterThanOrEqual(previousRight);
      previousRight = cardBounds!.x + cardBounds!.width;
    }
    expect(await dialog.evaluate(element => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1);
    expect(await dialog.locator(".sm-main").evaluate(element => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1);
    await expect(dialog.getByRole("button", { name: "关闭设置", exact: true })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath(`supplier-bento-${viewport.width}.png`), fullPage: true });
    expect(writes).toEqual([]);
  });
}

test("供应商首字配色不受筛选影响，组头展示原编号、倍率、Key 与刷新时间", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const { dialog, writes } = await fixture(page);
  const entry = dialog.locator(".sm-supplier-row").filter({ has: page.locator(".sm-supplier-label strong", { hasText: /^主供应商$/u }) });
  const avatar = entry.locator(".sm-supplier-avatar");
  await expect(avatar).toHaveText("主");
  const style = await avatar.getAttribute("style");
  expect(style).toContain("--sm-identity-from");
  await expect(entry.locator(".sm-supplier-state")).toHaveAttribute("data-state", "updated");
  await expect(entry.locator(".sm-connection-count")).toHaveText("1");
  const search = dialog.getByRole("textbox", { name: "搜索供应商", exact: true });
  await search.fill("主供应商");
  await expect(avatar).toHaveAttribute("style", style!);
  await search.fill("");
  await expect(avatar).toHaveAttribute("style", style!);
  const group = dialog.locator(".sm-group-card").filter({ has: page.getByRole("button", { name: "vip", exact: true }) });
  const toggle = group.getByRole("button", { name: "vip", exact: true });
  await expect(group.locator(".sm-group-stable-id")).toHaveText("编号 007");
  await expect(group.locator(".sm-group-rate")).toHaveText("倍率 1.25×");
  await expect(group.locator(".sm-group-key-status")).toHaveText("Key 已保存");
  await expect(group.locator("time.sm-group-refreshed")).toHaveAttribute("datetime", "2026-09-21T03:00:00.000Z");
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(group.locator(":scope > div")).toBeHidden();
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await expect(group.locator(":scope > div")).toBeVisible();
  await expect(group.getByRole("button", { name: "刷新 vip 型号", exact: true })).toBeEnabled();
  expect(writes).toEqual([]);
});

test("供应商缺少编号、倍率或刷新时间时使用占位符，不补造目录数据", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const { dialog, writes } = await fixture(page, 3, { metadata: false });
  await expect(dialog.locator('[data-supplier-stat="updated"] strong')).toHaveText("—");
  await expect(dialog.locator(".sm-group-stable-id")).toHaveText("编号 —");
  await expect(dialog.locator(".sm-group-rate")).toHaveText("倍率 —");
  await expect(dialog.locator(".sm-group-refreshed")).toHaveText("刷新 —");
  await expect(dialog.locator('[data-supplier-stat="models"] strong')).toHaveText("1");
  expect(writes).toEqual([]);
});

test("供应商型号表保留虚拟化，滚动时表头可读且价格右对齐", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const { dialog, writes } = await fixture(page, 125, { groups: 8 });
  const list = dialog.getByRole("list", { name: "Key 实际读取型号列表", exact: true });
  await expect(list).toBeVisible();
  expect(await list.locator(".sm-model-item").count()).toBeLessThan(50);
  const header = dialog.locator(".sm-model-columns:visible").first();
  await header.scrollIntoViewIfNeeded();
  await expect(header).toHaveCSS("position", "sticky");
  const before = await header.boundingBox();
  await list.evaluate(element => { element.scrollTop = 200; });
  await expect.poll(async () => (await header.boundingBox())?.y).toBe(before?.y);
  await expect(header).toBeInViewport({ ratio: 1 });
  const price = list.locator(".sm-model-price").first();
  await expect(price).toHaveCSS("text-align", "right");
  await expect(price).toHaveCSS("font-variant-numeric", "tabular-nums");
  const main = dialog.locator(".sm-main");
  await main.evaluate(element => {
    const columns = element.querySelector<HTMLElement>(".sm-model-columns")!;
    element.scrollTop += columns.getBoundingClientRect().top - element.getBoundingClientRect().top + 24;
  });
  const relativeTop = async () => (await header.boundingBox())!.y - (await main.boundingBox())!.y;
  await expect.poll(relativeTop).toBeGreaterThanOrEqual(-1);
  await expect.poll(relativeTop).toBeLessThanOrEqual(32);
  await expect(header).toBeInViewport({ ratio: 1 });
  expect(writes).toEqual([]);
});

test("保存 Key 后自动读取目录，默认模型保存不扫描，测试和刷新各扫描一次", async ({ page }) => {
  const { dialog, calls, writes, connections } = await fixture(page);
  await dialog.getByRole("tab", { name: "连接配置", exact: true }).click();
  await dialog.getByLabel("vip API Key", { exact: true }).fill("isolated-replacement-key");
  await dialog.getByRole("tab", { name: "模型与分组", exact: true }).click();
  await dialog.getByPlaceholder("选择或填写准确模型 ID").fill("model-1");
  await dialog.getByRole("button", { name: "保存默认", exact: true }).click();
  await expect(dialog.getByText("默认模型已保存。", { exact: true })).toBeVisible();
  expect(connections()[0]!.config.defaultModel).toBe("model-1");
  expect(writes).toHaveLength(1);
  expect(writes[0]).not.toHaveProperty("apiKey");
  await dialog.getByRole("tab", { name: "连接配置", exact: true }).click();
  await expect(dialog.getByLabel("vip API Key", { exact: true })).toHaveValue("isolated-replacement-key");
  await dialog.getByRole("button", { name: "保存", exact: true }).click();
  await expect(dialog.getByLabel("vip API Key", { exact: true })).toHaveValue("");
  await expect.poll(() => calls.filter(call => call.path.endsWith("/test")).length).toBe(1);
  expect(calls.filter(call => call.path.endsWith("/models") && !call.cached)).toHaveLength(0);
  await dialog.getByRole("button", { name: "测试并读取", exact: true }).click();
  await expect(dialog.getByText(/已读取 3 个模型/)).toBeVisible();
  await dialog.getByRole("tab", { name: "模型与分组", exact: true }).click();
  await dialog.getByRole("button", { name: "刷新模型", exact: true }).click();
  await expect.poll(() => calls.filter(call => call.path.endsWith("/test")).length).toBe(3);
  expect(calls.filter(call => call.path.endsWith("/models") && !call.cached)).toHaveLength(0);
  expect(calls.filter(call => call.path.endsWith("/verification") && call.method === "POST")).toHaveLength(0);
  await expect(dialog.getByText("有未保存的配置")).toHaveCount(0);
});

test("单分组也能搜索Key模型名称，列表分页和窄屏显示保持可用", async ({ page }, testInfo) => {
  const { dialog } = await fixture(page, 125);
  await expect(dialog.getByLabel("查找分组或模型", { exact: true })).toBeVisible();
  const modelList = dialog.getByRole("list", { name: "Key 实际读取型号列表", exact: true });
  await expect(modelList).toBeVisible();
  expect(await modelList.locator(".sm-model-item").count()).toBeLessThan(50);
  await expect(dialog.getByText("第 1 / 3 页 · 每页最多 50 个", { exact: true })).toBeVisible();
  const firstPageIds = new Set<string>();
  for (let step = 0; step <= 100; step++) {
    await modelList.evaluate((element, index) => { element.scrollTop = index * element.clientHeight / 2; }, step);
    await modelList.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    for (const id of await modelList.locator(".sm-model-name code").allTextContents()) firstPageIds.add(id);
    if (await modelList.evaluate(element => element.scrollTop + element.clientHeight >= element.scrollHeight - 1)) break;
  }
  expect([...firstPageIds].sort()).toEqual(Array.from({ length: 50 }, (_, index) => `model-${index}`).sort());
  await dialog.getByRole("button", { name: "下一页", exact: true }).click();
  await expect(dialog.locator(".sm-model-item").first()).toContainText("model-50");
  await dialog.getByLabel("查找分组或模型", { exact: true }).fill("创作模型 124");
  await dialog.getByRole("button", { name: "查找", exact: true }).click();
  await expect(dialog.locator(".sm-model-item")).toHaveCount(1);
  await expect(dialog.locator(".sm-model-item")).toContainText("model-124");
  await dialog.getByRole("button", { name: "清除分组筛选", exact: true }).click();
  await dialog.getByLabel("vip 模型状态", { exact: true }).selectOption("verified");
  await expect(dialog.locator(".sm-model-item")).toHaveCount(1);
  await expect(dialog.locator(".sm-model-item")).toContainText("model-1");
  await page.screenshot({ path: testInfo.outputPath("supplier-desktop.png"), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(dialog.getByLabel("当前供应商", { exact: true })).toBeVisible();
  await expect(dialog.getByLabel("搜索供应商", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await dialog.getByLabel("当前供应商", { exact: true }).selectOption("usability-1");
  await expect(dialog.getByRole("heading", { name: "备用供应商", exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("supplier-mobile.png"), fullPage: true });
  await dialog.locator(".sm-model-item").first().scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath("supplier-mobile-models.png"), fullPage: true });
});

test("取消切换和关闭会保留未保存配置，确认放弃后清理内存密钥", async ({ page }) => {
  const { dialog } = await fixture(page);
  await dialog.getByRole("tab", { name: "连接配置", exact: true }).click();
  await dialog.getByLabel("供应商名称", { exact: true }).fill("未保存名称");
  const key = dialog.getByLabel("vip API Key", { exact: true });
  await key.fill("memory-only-draft-secret");
  const leave = async (action: () => Promise<unknown>, accept = false) => {
    const nextDialog = page.waitForEvent("dialog");
    const pending = action();
    const confirmation = await nextDialog;
    expect(confirmation.type()).toBe("confirm");
    expect(confirmation.message()).toContain("未保存");
    expect(confirmation.message()).not.toContain("memory-only-draft-secret");
    if (accept) await confirmation.accept(); else await confirmation.dismiss();
    await pending;
  };
  await leave(() => dialog.locator(".sm-supplier-item").filter({ hasText: "备用供应商" }).click());
  await expect(key).toHaveValue("memory-only-draft-secret");
  await expect(dialog.getByLabel("供应商名称", { exact: true })).toHaveValue("未保存名称");
  await leave(() => dialog.getByRole("tab", { name: "素材通道", exact: true }).click());
  await leave(() => page.keyboard.press("Escape"));
  expect(await page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage }))).not.toContain("memory-only-draft-secret");
  await leave(() => dialog.getByRole("button", { name: "关闭设置", exact: true }).click(), true);
  await expect(dialog).toBeHidden();
  await page.getByTestId("workspace-settings").click();
  await dialog.getByRole("tab", { name: "连接配置", exact: true }).click();
  await expect(dialog.getByLabel("供应商名称", { exact: true })).toHaveValue("主供应商");
  await expect(key).toHaveValue("");
});
