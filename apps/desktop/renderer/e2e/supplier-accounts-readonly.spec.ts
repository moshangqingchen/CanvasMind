import { expect, test, type Page } from "@playwright/test";
import type { SupplierRecord } from "../lib/client-suppliers";
import type { SupplierReadOnlyCheckReport } from "../lib/supplier-readonly-check-contracts";
import type { ProviderConnectionView } from "../lib/client-api";

const checkedAt = "2026-10-22T12:00:00.000Z";
const source = { entryId: "key-models", sourceUrl: "https://supplier.invalid/v1/models", role: "key-membership", identity: "connection-key", status: "succeeded", complete: true, checkedAt, modelCount: 2 } as const;
function report(id: string): SupplierReadOnlyCheckReport {
  return {
    supplierId: id, supplierName: "同站点供应商", checkedAt, readOnly: true, status: "partial", sources: [source],
    connections: [{ connectionId: `${id}-key`, name: `${id} 创作组`, groupIdentity: "group:007", hasBaseline: true, baselineCheckedAt: "2026-10-21T12:00:00.000Z", membershipComplete: true, currentModelCount: 2, addedModelIds: ["image-new"], firstDiscoveredModelIds: [], missingModelIds: ["image-old"], sources: [source] }],
    catalogChanges: [{ groupIdentity: "group:007", groupName: "创作组", kind: "price", modelId: "image-current", before: "¥0.20 / 张", after: "¥0.25 / 张", sourceUrl: "https://supplier.invalid/pricing", checkedAt }],
    limitations: ["本次可读取接口不代表全量官网、文档与公告已阅读。"],
  };
}

async function fixture(page: Page) {
  let suppliers: SupplierRecord[] = ["alice", "bob"].map((id, index) => ({
    id, supplierKey: "same-provider", name: "同站点供应商", kind: "newapi", siteUrl: "https://supplier.invalid", apiUrl: "https://supplier.invalid/v1",
    siteLogin: { configured: true, authMode: "password", username: `${id}@example.invalid` },
    catalog: { groups: [{ id: "vip", label: "创作组", supplierGroupId: "007", source: "catalog", models: [{ id: "image-current", capability: "image" }] }] },
    scanStatus: index ? "unauthorized" : "live", createdAt: checkedAt, updatedAt: checkedAt,
  }));
  const connections: ProviderConnectionView[] = suppliers.map(item => ({ id: `${item.id}-key`, name: `${item.id} 创作组`, provider: "openai", apiKey: "", apiKeySet: true, credentialEpoch: "original-credential",
    config: { supplierId: item.id, supplierKey: item.supplierKey, baseUrl: item.apiUrl, modelGroup: "vip", usage: "canvas", modelScanStatus: "live", scannedModelIds: ["image-current"], modelCatalogModels: [{ id: "image-current", name: "image-current", operations: ["image.generate"] }] } }));
  const mutations: { path: string; body: Record<string, unknown> | null }[] = [];
  const checks: string[] = [];
  await page.route("**/api/suppliers**", async route => {
    const request = route.request(), path = new URL(request.url()).pathname;
    if (path.endsWith("/check")) { const id = path.split("/").at(-2)!; checks.push(id); return route.fulfill({ json: report(id) }); }
    if (path === "/api/suppliers/catalog-upgrade") return route.fallback();
    if (request.method() !== "GET") {
      const body = request.postData() ? request.postDataJSON() : null;
      mutations.push({ path, body });
      if (path === "/api/suppliers" && request.method() === "POST") {
        const created = { ...body, id: "independent-new", scanStatus: "unscanned", catalog: { groups: [] }, createdAt: checkedAt, updatedAt: checkedAt } as SupplierRecord;
        suppliers = [...suppliers, created];
        return route.fulfill({ json: created });
      }
      return route.fulfill({ status: 400, json: { error: "Test fixture forbids unrelated writes" } });
    }
    if (path.endsWith("/verification")) return route.fulfill({ json: null });
    return route.fulfill({ json: suppliers });
  });
  await page.route("**/api/providers**", async route => {
    const request = route.request(), path = new URL(request.url()).pathname;
    if (request.method() !== "GET") { mutations.push({ path, body: request.postData() ? request.postDataJSON() : null }); return route.fulfill({ status: 400, json: { error: "Test fixture forbids provider writes" } }); }
    if (path.endsWith("/models")) return route.fulfill({ json: [{ id: "image-current", name: "image-current", operations: ["image.generate"] }], headers: { "X-Model-Scan-Status": "live" } });
    return route.fulfill({ json: connections });
  });
  await page.goto("/");
  await page.getByTestId("workspace-settings").click();
  const dialog = page.getByRole("dialog", { name: "供应商与模型设置" });
  await expect(dialog.locator('.sm-supplier-row[data-supplier-id="alice"]')).toBeVisible();
  return { dialog, mutations, checks,
    rotateKey: (id: string) => { connections.find(connection => connection.id === id)!.credentialEpoch = "rotated-credential"; },
    moveGroup: (id: string) => { connections.find(connection => connection.id === id)!.config.modelGroup = "new-group"; },
  };
}

test("同站点账号可独立搜索筛选，添加账号只复制非凭据默认值", async ({ page }) => {
  const { dialog, mutations } = await fixture(page);
  const search = dialog.getByRole("textbox", { name: "搜索供应商", exact: true });
  await search.fill("alice 创作组");
  await expect(dialog.locator(".sm-supplier-row")).toHaveCount(1);
  await expect(dialog.locator(".sm-account-label")).toHaveText("账号 · alice@example.invalid");
  await dialog.getByRole("button", { name: "清除供应商搜索", exact: true }).click();
  await dialog.getByLabel("筛选供应商账号", { exact: true }).selectOption("attention");
  await expect(dialog.locator(".sm-supplier-row")).toHaveCount(1);
  await expect(dialog.locator(".sm-account-label")).toHaveText("账号 · bob@example.invalid");
  await dialog.getByLabel("筛选供应商账号", { exact: true }).selectOption("saved");
  await expect(dialog.locator(".sm-supplier-row")).toHaveCount(2);
  await dialog.locator('.sm-supplier-row[data-supplier-id="alice"]').getByRole("button", { name: "同站点供应商 的更多操作", exact: true }).click();
  await page.getByRole("menuitem", { name: "添加同站点账号", exact: true }).click();
  await expect(dialog.getByRole("heading", { name: "为这个站点添加独立账号", exact: true })).toBeVisible();
  await expect(dialog.getByRole("combobox", { name: "平台类型", exact: true })).toHaveValue("newapi");
  await dialog.getByPlaceholder("例如：我的模型供应商").fill("独立工作账号");
  await dialog.getByRole("button", { name: "仅添加", exact: true }).click();
  await expect(dialog.getByRole("heading", { name: "独立工作账号", exact: true })).toBeVisible();
  expect(mutations).toEqual([{ path: "/api/suppliers", body: { name: "独立工作账号", supplierKey: "same-provider", siteUrl: "https://supplier.invalid", apiUrl: "https://supplier.invalid/v1", kind: "newapi" } }]);
  await expect(dialog.locator(".sm-detail-account")).toContainText("未配置站点账号");
  expect(JSON.stringify(mutations)).not.toContain("alice");
});

test("只读检测展示基线差异、来源和覆盖范围，不调用刷新或配置保存", async ({ page }, testInfo) => {
  const { dialog, checks, mutations } = await fixture(page);
  const panel = dialog.getByRole("region", { name: "供应商更新只读检测", exact: true });
  await panel.getByRole("button", { name: "只读检测当前账号", exact: true }).click();
  await expect(panel.getByText("已取得部分检测结果", { exact: true })).toBeVisible();
  await expect(panel.getByText("本次可读取接口不代表全量官网、文档与公告已阅读。", { exact: true })).toBeVisible();
  await panel.getByText("新增型号（1）", { exact: true }).click();
  await expect(panel.getByText("image-new", { exact: true })).toBeVisible();
  await panel.getByText("本次未返回，不代表永久删除（1）", { exact: true }).click();
  await expect(panel.getByText("image-old", { exact: true })).toBeVisible();
  await expect(panel.getByText("¥0.20 / 张", { exact: true })).toBeVisible();
  await expect(panel.getByText("¥0.25 / 张", { exact: true })).toBeVisible();
  await expect(panel.getByRole("link", { name: "查看来源", exact: true })).toHaveAttribute("href", "https://supplier.invalid/pricing");
  await panel.getByText("全部读取来源与覆盖情况（1）", { exact: true }).click();
  await expect(panel.getByRole("link", { name: "查看来源", exact: true }).last()).toHaveAttribute("href", "https://supplier.invalid/v1/models");
  expect(checks).toEqual(["alice"]);
  expect(mutations).toEqual([]);
  await dialog.locator(".sm-main").evaluate(element => { element.scrollTop = 0; });
  await page.screenshot({ path: testInfo.outputPath("supplier-readonly-desktop.png"), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
  await dialog.locator(".sm-main").evaluate(element => { element.scrollTop = 0; });
  await page.screenshot({ path: testInfo.outputPath("supplier-readonly-mobile.png"), fullPage: true });
  await panel.getByRole("button", { name: "收起检测结果", exact: true }).click();
  await expect(panel.getByText("image-new", { exact: true })).toHaveCount(0);
  await panel.getByRole("button", { name: "展开检测结果", exact: true }).click();
  await expect(panel.getByText("本次可读取接口不代表全量官网、文档与公告已阅读。", { exact: true })).toBeVisible();
  expect(checks).toEqual(["alice"]);
  expect(mutations).toEqual([]);
});

test("切换账号取消检测，迟到结果不能显示在另一个账号下", async ({ page }) => {
  const { dialog, mutations } = await fixture(page);
  let release: () => void = () => undefined;
  const gate = new Promise<void>(resolve => { release = resolve; });
  let started = false;
  await page.route("**/api/suppliers/alice/check", async route => {
    started = true;
    await gate;
    await route.fulfill({ json: report("alice") }).catch(() => undefined);
  });
  await dialog.getByRole("button", { name: "只读检测当前账号", exact: true }).click();
  await expect.poll(() => started).toBe(true);
  await dialog.locator('.sm-supplier-row[data-supplier-id="bob"] .sm-supplier-item').click();
  release();
  await expect(dialog.locator(".sm-detail-account")).toContainText("bob@example.invalid");
  await dialog.getByRole("button", { name: "只读检测当前账号", exact: true }).click();
  await expect(dialog.getByRole("heading", { name: "bob 创作组", exact: true })).toBeVisible();
  await expect(dialog.getByRole("heading", { name: "alice 创作组", exact: true })).toHaveCount(0);
  expect(mutations).toEqual([]);
});

test("检测失败保留原采样结果，并明确显示账号配置已变化", async ({ page }) => {
  const { dialog, mutations } = await fixture(page);
  const panel = dialog.getByRole("region", { name: "供应商更新只读检测", exact: true });
  await panel.getByRole("button", { name: "只读检测当前账号", exact: true }).click();
  await expect(panel.getByText("已取得部分检测结果", { exact: true })).toBeVisible();
  await page.route("**/api/suppliers/alice/check", route => route.fulfill({ status: 409, json: { error: "检测期间账号配置已变化，请重新检测。" } }));
  await panel.getByRole("button", { name: "只读检测当前账号", exact: true }).click();
  await expect(panel.getByRole("alert")).toContainText("检测期间账号配置已变化");
  await expect(panel.getByRole("alert")).toContainText("下方保留上次结果与原采样时间");
  await expect(panel.locator(".sm-readonly-result time")).toHaveAttribute("datetime", checkedAt);
  expect(mutations).toEqual([]);
});

test("同账号更换 Key 或分组后清除旧检测结果，必须重新读取", async ({ page }) => {
  const { dialog, mutations, checks, rotateKey, moveGroup } = await fixture(page);
  const panel = dialog.getByRole("region", { name: "供应商更新只读检测", exact: true });
  await panel.getByRole("button", { name: "只读检测当前账号", exact: true }).click();
  await expect(panel.getByText("已取得部分检测结果", { exact: true })).toBeVisible();
  rotateKey("alice-key");
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("supplier-catalog-upgraded")));
  await expect(panel.getByText("已取得部分检测结果", { exact: true })).toHaveCount(0);
  await expect(dialog.locator(".sm-detail-account")).toContainText("alice@example.invalid");
  expect(checks).toEqual(["alice"]);
  await panel.getByRole("button", { name: "只读检测当前账号", exact: true }).click();
  await expect(panel.getByText("已取得部分检测结果", { exact: true })).toBeVisible();
  expect(checks).toEqual(["alice", "alice"]);
  moveGroup("alice-key");
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("supplier-catalog-upgraded")));
  await expect(panel.getByText("已取得部分检测结果", { exact: true })).toHaveCount(0);
  expect(checks).toEqual(["alice", "alice"]);
  expect(mutations).toEqual([]);
});
