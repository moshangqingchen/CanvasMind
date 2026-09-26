import { expect, test, type Page, type APIRequestContext } from "@playwright/test";
import type { ModelDescriptor } from "@super-canvas/providers";
import type { SupplierRecord } from "../lib/client-suppliers";
import type { ProviderConnectionView } from "../lib/client-api";

async function fixture(page: Page, request: APIRequestContext) {
  const suppliers: SupplierRecord[] = [], connections: ProviderConnectionView[] = [];
  for (const [index, name] of ["报价甲", "报价乙"].entries()) {
    const created = await request.post("/api/suppliers", { data: { name, siteUrl: `https://billing-${index}.invalid` } });
    expect(created.ok()).toBeTruthy();
    const supplier: SupplierRecord = await created.json();
    supplier.siteLogin = { configured: true, username: "test" };
    supplier.state!.billing = { sourceId: supplier.state!.sourceId, status: "live", balance: index ? 22 : 10, used: index ? 8 : 3,
      unit: index ? "USD" : "CNY", checkedAt: "2026-09-25T00:00:00Z", lastSuccessAt: "2026-09-25T00:00:00Z", sourceUrl: supplier.siteUrl };
    const models: ModelDescriptor[] = [{ id: "gpt-image-2.5", name: "计价模型", operations: ["image.generate"], inputKinds: ["text"], outputKinds: ["image"],
      metadata: { canvasRunnable: true }, parameters: [{ key: "quality", label: "质量", control: "select", default: "max", options: [{ value: "high", label: "高" }, { value: "max", label: "最高" }] }],
      pricing: { kind: "per-image", currency: index ? "USD" : "CNY", unitAmount: index ? .8 : .4, confidence: "exact", checkedAt: "2026-09-25T00:00:00Z" } }];
    const response = await request.post("/api/providers", { data: { name: `${name} 主连接`, provider: "openai", apiKey: "isolated-test-key", config: {
      supplierId: supplier.id, supplierKey: supplier.supplierKey, baseUrl: supplier.apiUrl, usage: "canvas", modelGroup: "创作组", customGroup: true, defaultModel: "gpt-image-2.5" } } });
    expect(response.ok()).toBeTruthy();
    const connection = await response.json();
    connection.config = { ...connection.config, modelCatalogModels: models, scannedModelIds: models.map(m => m.id), modelScanStatus: "live" };
    connections.push(connection); suppliers.push(supplier);
    await page.route(`**/api/providers/${connection.id}/models*`, route => route.fulfill({ json: models, headers: { "X-Model-Scan-Status": "live" } }));
  }
  await page.route(/\/api\/providers(?:\?.*)?$/, route => route.fulfill({ json: connections }));
  let failed = false; const refreshes: string[] = [], forbidden: string[] = [];
  await page.route("**/api/suppliers**", async route => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith("/billing")) {
      const supplier = suppliers.find(item => url.pathname === `/api/suppliers/${item.id}/billing`)!;
      refreshes.push(supplier.id);
      supplier.state!.billing = { ...supplier.state!.billing!, status: failed ? "failed" : "live",
        balance: failed ? supplier.state!.billing!.balance : 9.6, used: failed ? supplier.state!.billing!.used : 3.4,
        error: failed ? "读取失败；上次成功数据已保留" : undefined };
      await route.fulfill({ json: supplier.state!.billing });
    } else if (url.pathname.endsWith("/verification")) {
      if (route.request().method() === "POST") forbidden.push("verification");
      await route.fulfill({ json: null });
    } else await route.fulfill({ json: suppliers });
  });
  await page.route("**/api/runs", async route => {
    if (route.request().method() === "POST") { forbidden.push("generation"); await route.abort(); }
    else await route.continue();
  });
  return { suppliers, connections, refreshes, forbidden, fail: () => { failed = true; } };
}

test("供应商管理独立刷新、失败保留数值、批量刷新且不触发生成", async ({ page, request }, info) => {
  const data = await fixture(page, request);
  await page.goto("/");
  await page.getByRole("button", { name: "供应商与模型", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "供应商与模型设置" });
  const billing = dialog.getByRole("region", { name: "供应商余额与消耗" });
  await expect(billing).toContainText("10 CNY"); await expect(billing).toContainText("3 CNY");
  await billing.getByRole("button", { name: "重新读取消耗" }).click();
  await expect(billing).toContainText("9.6 CNY"); await expect(billing).toContainText("3.4 CNY");
  data.fail();
  await billing.getByRole("button", { name: "重新读取消耗" }).click();
  await expect(billing).toContainText("上次成功"); await expect(billing).toContainText("9.6 CNY");
  await dialog.getByRole("button", { name: "刷新全部余额与消耗", exact: true }).click();
  await expect.poll(() => data.refreshes.length).toBe(4);
  await dialog.locator(".sm-supplier-item").filter({ hasText: "报价乙" }).click();
  await expect(billing).toContainText("22 USD"); await expect(billing).not.toContainText("CNY");
  await page.screenshot({ path: info.outputPath("supplier-billing-desktop.png"), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await billing.scrollIntoViewIfNeeded();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath("supplier-billing-mobile.png"), fullPage: true });
  expect(data.forbidden).toEqual([]);
});

test("画布供应商选择显示对应报价余额，切换后刷新对应账号", async ({ page, request }, info) => {
  const data = await fixture(page, request);
  const response = await request.post("/api/canvas", { data: { title: "供应商账务回归", graph: { schemaVersion: 1, viewport: { x: 0, y: 0, zoom: 1 }, edges: [], nodes: [
    { id: "billing-node", type: "workflow", position: { x: 55, y: 70 }, style: { width: 420, height: 180 }, data: {
      nodeType: "image-generation", label: "账务测试", provider: "openai", connectionId: data.connections[0]!.id, model: "gpt-image-2.5", parameters: { quality: "max" }, parts: [],
      inputs: [{ id: "prompt", kind: "text", label: "提示词" }], outputs: [{ id: "images", kind: "image", label: "图片" }] } },
  ] } } });
  expect(response.ok()).toBeTruthy(); const canvas = await response.json();
  await page.goto(`/canvas/${canvas.id}`);
  const agent = page.getByRole("button", { name: "智能体面板", exact: true });
  if (await agent.getAttribute("aria-expanded") === "true") await agent.click();
  await page.getByRole("button", { name: "打开 账务测试 模型与参数", exact: true }).click();
  const panel = page.getByRole("dialog", { name: "账务测试 模型与参数" });
  const select = panel.getByRole("combobox", { name: "账务测试 供应商", exact: true });
  await expect(select.locator(`option[value="${data.suppliers[0]!.supplierKey}"]`)).toContainText("0.4 CNY");
  await expect(select.locator(`option[value="${data.suppliers[1]!.supplierKey}"]`)).toContainText("0.8 USD");
  await expect(select.locator(`option[value="${data.suppliers[1]!.supplierKey}"]`)).toContainText("22 USD");
  await expect(panel.getByLabel("当前供应商报价")).toContainText("0.4 CNY");
  await select.selectOption(data.suppliers[1]!.supplierKey);
  await expect(panel.getByLabel("当前供应商报价")).toContainText("0.8 USD");
  const billing = panel.getByRole("region", { name: "供应商余额与消耗" });
  await expect(billing).toContainText("22 USD");
  await billing.getByRole("button", { name: "重新读取消耗" }).click();
  await expect(billing).toContainText("9.6 USD");
  expect(data.refreshes).toEqual([data.suppliers[1]!.id]); expect(data.forbidden).toEqual([]);
  await page.screenshot({ path: info.outputPath("canvas-supplier-billing.png"), fullPage: true });
});
