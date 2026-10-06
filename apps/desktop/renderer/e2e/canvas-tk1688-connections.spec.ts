import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { parseTk1688Marketplace } from "@super-canvas/providers";
import type { ProviderConnectionView } from "../lib/client-api";
import type { SupplierRecord } from "../lib/client-suppliers";

const label = "词元连接验收";
const baseModel = "gpt-image-2.5-sunburst";
const merchant47 = `${baseModel}@s47c261`;
const merchant48 = `${baseModel}@s48c262`;
const checkedAt = "2026-10-06T03:00:00.000Z";
const rows = [
  { base_model: baseModel, alias: merchant47, description: "Adobe支持原生4K(3840*2160)，不支持N。", input_price_usd: 0.03 },
  { base_model: baseModel, alias: merchant48, description: "支持 1K / 2K / 4K", input_price_usd: 0.05 },
].map(row => ({ ...row, charge_type: "per_request", status: "active", channel_alive: true }));
const models = parseTk1688Marketplace(
  { success: true, data: { total: rows.length, items: rows } },
  { success: true, data: { payment_fx_rate_cny_per_usd: 6.8896, platform_markup_percent: 20 } },
  { checkedAt, keyModelIds: [baseModel], accountModelIds: rows.map(row => row.alias) },
).models;

/** Only the isolated canvas is saved on the test server; every provider call is mocked. */
async function fixture(page: Page, request: APIRequestContext, selectedUsage: "canvas" | "agent", withBackup = false) {
  const supplier: SupplierRecord = {
    id: "tk1688-connection-fixture", supplierKey: "tk1688", name: "词元", kind: "openai-compatible",
    siteUrl: "https://tk1688.com", apiUrl: "https://api.tk1688.com/v1",
    state: { version: 1, revision: 1, visibility: "visible", sourceId: "tk1688-source-fixture", fingerprint: "isolated", history: [] },
    catalog: { groups: [{ id: "default", label: "default", source: "catalog", models: models.map(model => ({
      id: model.id, name: model.name, capability: "image", metadata: model.metadata,
    })) }] },
    scanStatus: "live", scannedAt: checkedAt, scanLastSuccessAt: checkedAt,
    createdAt: checkedAt, updatedAt: checkedAt,
  };
  const connection = (id: string, name: string, usage: "canvas" | "agent", accountKeyId: string): ProviderConnectionView => ({
    id, name, provider: usage === "canvas" ? "openai" : "rest", apiKey: "", apiKeySet: true, apiKeyUsable: true,
    config: {
      supplierId: supplier.id, supplierSourceId: supplier.state!.sourceId, supplierKey: supplier.supplierKey,
      supplierName: supplier.name, baseUrl: supplier.apiUrl, accountKeyId, accountKeyGroup: "default", modelGroup: "default", usage,
      defaultModel: merchant47, protocol: usage === "canvas" ? "openai-images" : "openai-chat-completions",
      modelCatalogModels: models, scannedModelIds: models.map(model => model.id), modelScanStatus: "live",
      modelScanCheckedAt: checkedAt, modelScanLastSuccessAt: checkedAt,
    },
  });
  const canvasConnection = connection("06d26131-e080-43bd-8250-95c71aa705a0", "词元 · default · 图片", "canvas", "same-account-key");
  const agentConnection = connection("3540c8b9-50a0-4b0f-a2a7-fd94d32d555b", "词元 · default · 文本", "agent", "same-account-key");
  const backup = connection("backup-account-connection-2", "词元备用账号", "canvas", "different-account-key");
  let connections = [canvasConnection, agentConnection, ...(withBackup ? [backup] : [])];
  const selected = selectedUsage === "canvas" ? canvasConnection : agentConnection;
  const created = await request.post("/api/canvas", { data: { title: label, graph: {
    schemaVersion: 1, viewport: { x: 0, y: 0, zoom: 1 }, edges: [], nodes: [{
      id: "image", type: "workflow", position: { x: 80, y: 60 }, style: { width: 420, height: 180 },
      data: { nodeType: "image-generation", label, provider: selected.provider, connectionId: selected.id, model: merchant47,
        parameters: {}, parts: [], inputs: [{ id: "prompt", kind: "text", label: "提示词" }], outputs: [{ id: "images", kind: "image", label: "图片" }] },
    }],
  } } });
  expect(created.ok()).toBeTruthy();
  const canvas = await created.json();
  const state = { paidCalls: 0, providerWrites: 0 };
  await page.route("**/api/providers**", async route => {
    const apiRequest = route.request();
    const path = new URL(apiRequest.url()).pathname;
    if (apiRequest.method() !== "GET") { state.providerWrites++; return route.abort(); }
    if (path.endsWith("/models")) return route.fulfill({ json: models, headers: { "X-Model-Scan-Status": "live" } });
    return route.fulfill({ json: connections });
  });
  await page.route("**/api/suppliers**", async route => {
    if (route.request().method() !== "GET") { state.providerWrites++; return route.abort(); }
    const path = new URL(route.request().url()).pathname;
    return route.fulfill({ json: path.endsWith("/verification") ? null : [supplier] });
  });
  await page.route("**/api/agent/models**", route => route.fulfill({ json: [] }));
  for (const endpoint of ["runs", "agent/turn"]) {
    await page.route(`**/api/${endpoint}`, async route => {
      if (route.request().method() === "POST") { state.paidCalls++; return route.abort(); }
      return route.continue();
    });
  }
  await page.setViewportSize({ width: 1440, height: 1080 });
  const reopen = async () => {
    await page.goto(`/canvas/${canvas.id}`);
    await page.getByRole("button", { name: `打开 ${label} 模型与参数`, exact: true }).click();
  };
  await reopen();
  const panel = page.getByRole("dialog", { name: `${label} 模型与参数`, exact: true });
  const group = panel.getByRole("combobox", { name: `${label} 模型群组`, exact: true });
  const apiConnection = panel.getByRole("combobox", { name: `${label} API 连接`, exact: true });
  const picker = panel.getByRole("combobox", { name: `${label} 模型`, exact: true });
  const readNode = async () => (await (await request.get(`/api/canvas/${canvas.id}`)).json()).graph.nodes[0].data;
  const chooseMerchant48 = async () => {
    await picker.click();
    const list = panel.getByRole("listbox");
    await list.getByRole("option", { name: baseModel, exact: true }).click();
    await list.getByRole("option", { name: "商家 48 · 渠道 262", exact: true }).click();
  };
  return { panel, group, apiConnection, picker, selected, backup, state, readNode, chooseMerchant48, reopen,
    reverseConnections: () => { connections = [...connections].reverse(); } };
}

for (const selectedUsage of ["canvas", "agent"] as const) {
  test(`词元同 Key 图片与文本用途副本折叠，已保存的 ${selectedUsage} 连接和商家型号保持不变`, async ({ page, request }, testInfo) => {
    const scene = await fixture(page, request, selectedUsage);
    const { panel, group, apiConnection, picker, selected, readNode } = scene;
    await expect(group).toHaveValue("default");
    await expect(group.locator('option[value="default"]')).not.toContainText(/\d+\s*个连接/u);
    await expect(apiConnection).toHaveCount(0);
    await expect(picker).toContainText("商家 47 · 渠道 261");
    await expect(panel.getByLabel("当前供应商报价", { exact: true })).toContainText("¥");
    await expect(panel.getByLabel("当前供应商报价", { exact: true })).not.toContainText(/USD|\$/u);
    expect(await readNode()).toMatchObject({ connectionId: selected.id, model: merchant47 });
    await scene.chooseMerchant48();
    await expect.poll(readNode).toMatchObject({ connectionId: selected.id, model: merchant48 });
    scene.reverseConnections();
    await page.reload();
    await page.getByRole("button", { name: `打开 ${label} 模型与参数`, exact: true }).click();
    await expect(apiConnection).toHaveCount(0);
    await expect(picker).toContainText("商家 48 · 渠道 262");
    expect(await readNode()).toMatchObject({ connectionId: selected.id, model: merchant48 });
    await page.goto("/");
    await scene.reopen();
    await expect(apiConnection).toHaveCount(0);
    await expect(picker).toContainText("商家 48 · 渠道 262");
    expect(await readNode()).toMatchObject({ connectionId: selected.id, model: merchant48 });
    expect(scene.state).toEqual({ paidCalls: 0, providerWrites: 0 });
    await panel.screenshot({ path: testInfo.outputPath(`tk1688-${selectedUsage}-shared-key.png`) });
  });
}

test("词元不同 Key 保留独立连接选择，显示账号名称并保存准确连接与商家", async ({ page, request }, testInfo) => {
  const scene = await fixture(page, request, "agent", true);
  const { panel, group, apiConnection, picker, selected, backup, readNode } = scene;
  await expect(group.locator('option[value="default"]')).toContainText("2 个连接");
  await expect(apiConnection).toHaveValue(selected.id);
  await expect(apiConnection.locator("option")).toHaveCount(2);
  await expect(apiConnection.locator(`option[value="${selected.id}"]`)).toHaveText(selected.name);
  await expect(apiConnection.locator(`option[value="${backup.id}"]`)).toHaveText(backup.name);
  await apiConnection.selectOption(backup.id);
  await expect.poll(readNode).toMatchObject({ connectionId: backup.id, model: merchant47 });
  await scene.chooseMerchant48();
  await expect.poll(readNode).toMatchObject({ connectionId: backup.id, model: merchant48 });
  scene.reverseConnections();
  await page.reload();
  await page.getByRole("button", { name: `打开 ${label} 模型与参数`, exact: true }).click();
  await expect(apiConnection).toHaveValue(backup.id);
  await expect(apiConnection.locator("option")).toHaveCount(2);
  await expect(picker).toContainText("商家 48 · 渠道 262");
  expect(await readNode()).toMatchObject({ connectionId: backup.id, model: merchant48 });
  expect(scene.state).toEqual({ paidCalls: 0, providerWrites: 0 });
  await panel.screenshot({ path: testInfo.outputPath("tk1688-distinct-account-keys.png") });
});
