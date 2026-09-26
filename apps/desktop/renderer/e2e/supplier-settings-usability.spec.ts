import { expect, test, type Page } from "@playwright/test";
import type { ModelDescriptor } from "@super-canvas/providers";
import type { ProviderConnectionView } from "../lib/client-api";
import type { SupplierRecord } from "../lib/client-suppliers";

async function fixture(page: Page, count = 3) {
  const models: ModelDescriptor[] = Array.from({ length: count }, (_, index) => ({
    id: `model-${index}`, name: `创作模型 ${index}`, operations: ["image.generate"],
    metadata: { priceLabel: "¥0.20 / 张", ...(index === 1 ? { imageCapabilitiesVerifiedAt: "2026-09-21T03:00:00.000Z" } : {}) },
  }));
  let suppliers: SupplierRecord[] = ["主供应商", "备用供应商"].map((name, index) => ({
    id: `usability-${index}`, supplierKey: `usability-${index}`, name, kind: "openai-compatible", siteUrl: "https://example.invalid", apiUrl: "https://example.invalid/v1",
    catalog: { groups: [{ id: "vip", label: "创作组", source: "catalog", models: [{ id: "public-only", name: "公开目录模型", capability: "image" }] }] },
    scanStatus: "live", scannedAt: "2026-09-22T03:00:00.000Z", scanLastSuccessAt: "2026-09-21T03:00:00.000Z",
    createdAt: "2026-09-21T03:00:00.000Z", updatedAt: "2026-09-21T03:00:00.000Z",
  }));
  let connections: ProviderConnectionView[] = suppliers.map(supplier => ({
    id: `connection-${supplier.id}`, name: `${supplier.name}主账号`, provider: "openai", apiKey: "", apiKeySet: true,
    config: { supplierId: supplier.id, supplierKey: supplier.supplierKey, baseUrl: supplier.apiUrl, modelGroup: "vip", usage: "canvas", modelCatalogModels: models, scannedModelIds: models.map(model => model.id), modelScanStatus: "live", modelScanCheckedAt: "2026-09-22T03:00:00.000Z", modelScanLastSuccessAt: "2026-09-21T03:00:00.000Z" },
  }));
  const calls: { method: string; path: string; cached: boolean }[] = [];
  const writes: Record<string, unknown>[] = [];
  await page.route("**/api/suppliers**", async route => {
    const request = route.request(); const url = new URL(request.url());
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
  await page.getByRole("button", { name: "供应商与模型", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "供应商与模型设置" });
  await expect(dialog.getByRole("heading", { name: "主供应商", exact: true })).toBeVisible();
  await expect(dialog.locator('.sm-model-item').first()).toBeVisible();
  return { dialog, calls, writes, connections: () => connections };
}

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
  await expect(dialog.locator(".sm-model-item")).toHaveCount(50);
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
  await page.getByRole("button", { name: "供应商与模型", exact: true }).click();
  await dialog.getByRole("tab", { name: "连接配置", exact: true }).click();
  await expect(dialog.getByLabel("供应商名称", { exact: true })).toHaveValue("主供应商");
  await expect(key).toHaveValue("");
});
