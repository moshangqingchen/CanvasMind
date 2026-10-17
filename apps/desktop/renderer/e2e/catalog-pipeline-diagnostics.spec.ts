import { expect, test, type Page } from "@playwright/test";
import type { ModelDescriptor } from "@super-canvas/providers";
import { installNeuralFixture } from "./helpers/neural-fixture";
import type { CatalogUpgradeStatus } from "../lib/supplier-catalog-contracts";

const checkedAt = "2026-10-17T08:00:00.000Z", oldSample = "2026-10-10T03:04:05.000Z";
const connectionId = "connection-neural-supplier-0", version = "candidate-version-committed-001";
function status(): CatalogUpgradeStatus {
  return { revision: "fixture", mode: "daily", phase: "complete", total: 1, refreshed: 1, failed: 0, unavailable: 0,
    updatedConnectionIds: [], manualConnectionIds: [], changedConnectionIds: [], priceChangedSupplierIds: [], retainedPriceModelCount: 1,
    nextCheckAt: "2099-01-01T00:00:00.000Z", noticeId: null, history: [],
    connections: [{ connectionId, name: "晨星创作连接", supplierId: "neural-supplier-0", supplierName: "晨星创作", manualRequired: false, paused: false, nextCheckAt: "2099-01-01T00:00:00.000Z" }],
    pipeline: { noticeCursors: {}, acknowledgedCursors: {}, candidates: [{ connectionId, sourceKey: "fixture-key-source", candidateVersion: version,
      baselineCount: 36, candidateCount: 12, missingCount: 24, countedCycles: 1, requiredCycles: 3, checkedAt }], diagnostics: [
      { sourceKey: "fixture-key-source", supplierId: "neural-supplier-0", connectionIds: [connectionId], entryId: "key-models", role: "key-membership",
        identity: "connection-key", sourceUrl: "https://fixture.invalid/v1/models", status: "succeeded", complete: true, modelCount: 12,
        checkedAt, requiredForMembership: true, paused: false, nextCheckAt: "2099-01-01T00:00:00.000Z" },
      { sourceKey: "fixture-price-source", supplierId: "neural-supplier-0", connectionIds: [connectionId], entryId: "public-prices", role: "price",
        identity: "anonymous", status: "failed", complete: false, reason: "network", checkedAt, requiredForMembership: false, paused: false, nextCheckAt: "2099-01-01T00:00:00.000Z" },
    ], contracts: [{ connectionId, modelId: "fixture-image-new-api", operation: "image.generate", status: "pending", reason: "incomplete", checkedAt }],
    historyDescriptors: [{ connectionId, modelId: "fixture-retired-full-model-id", unavailableAt: checkedAt, sourceKeys: ["fixture-key-source"], descriptor: {
      id: "fixture-retired-full-model-id", name: "历史图片型号", operations: ["image.generate"], parameters: [
        { key: "quality", label: "质量", control: "select", default: "high", options: [{ label: "High", value: "high" }] },
      ], limits: { maxInputImages: 2 }, metadata: { protocol: "openai-images", priceCheckedAt: oldSample },
    } }] } };
}
const model = (): ModelDescriptor => ({ id: "fixture-image-2.5-4k", name: "测试图片模型", operations: ["image.generate"], pricing: {
  kind: "per-image", currency: "CNY", billingUnit: "image", checkedAt, confidence: "exact", tiers: [
    { id: "2k", label: "2K", dimension: "resolution", value: "2K", price: .4, evidence: { sourceKey: "price", status: "retained", checkedAt: oldSample, sourceUrl: "https://fixture.invalid/pricing" } },
    { id: "4k", label: "4K", dimension: "resolution", value: "4K", price: .8, evidence: { sourceKey: "price", status: "published", checkedAt, sourceUrl: "https://fixture.invalid/pricing" } },
  ],
}, metadata: { measuredPrice: { amount: .6, currency: "CNY", unit: "image", checkedAt: oldSample, parameterScope: "exact", requestId: "fixture-request",
  actualCharge: { amount: .6, currency: "CNY", unit: "image", requestId: "fixture-request" }, parameters: { quality: "max", resolution: "4K" } } } });

async function openSettings(page: Page) {
  await page.goto("/"); await expect(page.getByTestId("neural-workspace")).toBeVisible();
  await page.getByTestId("workspace-settings").click();
  const dialog = page.getByRole("dialog", { name: "供应商与模型设置" });
  await expect(dialog.getByRole("heading", { name: "晨星创作", exact: true })).toBeVisible();
  await dialog.getByRole("button", { name: /目录变更与待处理连接/u }).click();
  return dialog;
}
for (const theme of ["dark", "light"] as const) test(`${theme} 分来源诊断、版本绑定确认、完整历史参数与条件价格`, async ({ page }, info) => {
  const data = await installNeuralFixture(page, { motion: false, theme });
  data.connections[0]!.config.modelCatalogModels = [model()];
  let value = status(); const postBodies: unknown[] = [];
  await page.route("**/api/suppliers/catalog-upgrade*", async route => {
    if (route.request().method() === "POST") {
      postBodies.push(route.request().postDataJSON()); value = { ...value, pipeline: { ...value.pipeline!, candidates: [] } };
    } else expect(route.request().method()).toBe("GET");
    await route.fulfill({ json: value });
  });
  const dialog = await openSettings(page);
  await expect(dialog.getByLabel("待确认的目录骤降")).toContainText("36 个 → 本次 12 个");
  await expect(dialog.getByLabel("分来源读取诊断")).toContainText("公布价格");
  await expect(dialog.getByLabel("分来源读取诊断")).toContainText("读取失败");
  await expect(dialog.getByLabel("调用契约诊断")).toContainText("待完整读取");
  expect(postBodies).toEqual([]);
  await dialog.getByLabel("待确认的目录骤降").scrollIntoViewIfNeeded();
  await page.screenshot({ path: info.outputPath(`pipeline-candidate-${theme}.png`), animations: "disabled" });
  await dialog.getByRole("button", { name: /^确认 晨星创作连接 的候选目录/u }).click();
  await expect(dialog.getByLabel("待确认的目录骤降")).toContainText("没有待确认");
  expect(postBodies).toEqual([{ action: "confirm-candidate", connectionId, sourceKey: "fixture-key-source", candidateVersion: version }]);
  const history = dialog.getByLabel("不再可见的历史型号");
  await history.getByText("fixture-retired-full-model-id", { exact: true }).click();
  await history.getByText("查看完整历史参数与契约记录").click();
  await expect(history.locator("pre")).toContainText('"maxInputImages": 2');
  await expect(history.locator("pre")).toContainText('"default": "high"');
  await history.scrollIntoViewIfNeeded();
  await page.screenshot({ path: info.outputPath(`pipeline-history-${theme}.png`), animations: "disabled" });
  const price = dialog.locator(".sm-model-item").filter({ has: page.locator(".sm-model-name code", { hasText: "fixture-image-2.5-4k" }) }).first();
  await price.getByText("公布价、条件与实测记录", { exact: true }).click();
  await expect(price).toContainText("上次价格"); await expect(price).toContainText(oldSample);
  await expect(price).toContainText("账单实测 · 仅对应请求"); await expect(price).toContainText("0.6 CNY / 张");
  await price.scrollIntoViewIfNeeded();
  await page.screenshot({ path: info.outputPath(`pipeline-prices-${theme}.png`), animations: "disabled" });
  expect(postBodies).toHaveLength(1); data.assertSafe();
});

test("过期候选不会自动换版本确认，重新查看仅读取本地状态", async ({ page }) => {
  const data = await installNeuralFixture(page, { motion: false });
  let reads = 0, confirmations = 0;
  await page.route("**/api/suppliers/catalog-upgrade*", async route => {
    if (route.request().method() === "POST") { confirmations++; return route.fulfill({ status: 409, json: { error: "candidate-stale" } }); }
    reads++; return route.fulfill({ json: status() });
  });
  const dialog = await openSettings(page);
  await dialog.getByRole("button", { name: /^确认 晨星创作连接 的候选目录/u }).click();
  await expect(dialog.getByLabel("待确认的目录骤降")).toContainText("候选目录已变化");
  const before = reads;
  await dialog.getByRole("button", { name: "重新读取候选目录" }).click();
  await expect.poll(() => reads).toBeGreaterThan(before); expect(confirmations).toBe(1); data.assertSafe();
});

test("已提交变更提示使用持久的分来源游标，确认已读不会启动采集", async ({ page }) => {
  const data = await installNeuralFixture(page, { motion: false });
  await page.addInitScript(() => {
    const cleanup = () => () => {};
    Object.assign(window, { superCanvasDesktop: {
      getUpdate: async () => ({ desktop: true, phase: "idle", currentVersion: "0.2.107", enabled: true }),
      onUpdate: cleanup, onOpenUpdate: cleanup, onPrepareExit: cleanup, onDraining: cleanup, completePrepareExit: () => {}, cancelExit: async () => {},
    } });
  });
  const key = "neural-supplier-0/changes:" + connectionId;
  let saved = false, starts = 0, reads = 0; const patches: unknown[] = [];
  await page.route("**/api/suppliers/catalog-upgrade*", async route => {
    if (route.request().method() === "POST") starts++;
    if (route.request().method() === "GET") reads++;
    if (route.request().method() === "PATCH") { patches.push(route.request().postDataJSON()); saved = true; }
    const value = status();
    value.noticeId = saved ? null : "fixture-scoped-cursor-5";
    value.changedConnectionIds = saved ? [] : [connectionId];
    value.priceChangedSupplierIds = saved ? [] : ["neural-supplier-0"];
    value.pipeline!.noticeCursors = { [key]: 5 }; value.pipeline!.acknowledgedCursors = { [key]: saved ? 5 : 0 };
    await route.fulfill({ json: value });
  });
  await page.goto("/");
  await expect(page.getByRole("status", { name: "供应商目录自动检查" })).toContainText("价格有变动");
  await expect.poll(() => patches.length).toBe(1);
  expect(patches).toEqual([{ noticeCursors: { [key]: 5 } }]);
  await page.evaluate(() => localStorage.removeItem("super-canvas:catalog-check-notice"));
  const before = reads;
  await page.reload(); await expect(page.getByTestId("neural-workspace")).toBeVisible();
  await expect.poll(() => reads).toBeGreaterThan(before);
  await expect(page.getByRole("status", { name: "供应商目录自动检查" })).toHaveCount(0);
  expect(starts).toBe(0); data.assertSafe();
});
