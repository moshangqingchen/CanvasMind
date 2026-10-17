import { expect, test, type Page } from "@playwright/test";
import type { CatalogCheckMode, CatalogUpgradeStatus } from "../lib/supplier-catalog-contracts";
import { installNeuralFixture, neuralSuppliers } from "./helpers/neural-fixture";

const now = "2026-10-17T09:00:00.000Z";
const day = 24 * 60 * 60 * 1000;
const connectionId = "connection-neural-supplier-1";
const unchanged = (mode: CatalogCheckMode = "daily"): CatalogUpgradeStatus => ({
  revision: "catalog-fixture-v4", mode, phase: "complete", total: 1,
  refreshed: 0, unavailable: 0, failed: 0, updatedConnectionIds: [],
  manualConnectionIds: [], changedConnectionIds: [], priceChangedSupplierIds: [],
  nextCheckAt: mode === "daily" ? new Date(Date.parse(now) + day).toISOString() : null,
  connections: [{ connectionId, supplierId: "neural-supplier-1", supplierName: "纸月模型",
    name: "纸月模型连接", manualRequired: false, paused: false,
    lastAttemptAt: now, nextCheckAt: null }],
  history: [], noticeId: null,
});
function changed(): CatalogUpgradeStatus {
  return { ...unchanged(), refreshed: 1, failed: 1,
    updatedConnectionIds: ["connection-neural-supplier-0"],
    manualConnectionIds: [connectionId], changedConnectionIds: ["connection-neural-supplier-0"],
    priceChangedSupplierIds: ["neural-supplier-0"], noticeId: "catalog-notice-fixture",
    connections: [{ connectionId, supplierId: "neural-supplier-1", supplierName: "纸月模型",
      name: "纸月模型连接", manualRequired: true, paused: true,
      pauseReason: "authentication", lastAttemptAt: now, nextCheckAt: null }],
    history: [{ id: "fixture-price-diff", checkedAt: now,
      supplierId: "neural-supplier-0", supplierName: "晨星创作",
      connectionId: "connection-neural-supplier-0", connectionName: "晨星创作连接",
      changes: [
        { kind: "price", modelId: "fixture-image-2.5-4k", groupId: "studio",
          before: "¥0.40 / 张 · 4K · max", after: "¥0.50 / 张 · 4K · max" },
        { kind: "model-added", modelId: "fixture-video-new-2.5-full-id", groupId: "studio" },
        { kind: "model-removed", modelId: "fixture-video-old-2.0-full-id", groupId: "studio" },
        { kind: "model-changed", modelId: "fixture-image-2.5-4k", groupId: "studio", before: "分辨率：2K；默认值：2K", after: "分辨率：2K / 4K；默认值：4K" },
        { kind: "group-added", groupId: "studio-plus-008", after: "创作增强组" },
      ] }],
  };
}

async function desktop(page: Page) {
  await page.addInitScript(() => {
    const cleanup = () => () => {};
    Object.assign(window, {
      catalogUpgradeNotifications: 0,
      superCanvasDesktop: {
        getUpdate: async () => ({ desktop: true, phase: "idle", currentVersion: "0.2.106", enabled: true }),
        onUpdate: cleanup, onOpenUpdate: cleanup, onPrepareExit: cleanup, onDraining: cleanup,
        completePrepareExit: () => {}, cancelExit: async () => {},
      },
    });
    window.addEventListener("supplier-catalog-upgraded", () => {
      const state = window as unknown as { catalogUpgradeNotifications: number };
      state.catalogUpgradeNotifications++;
    });
  });
}

async function fixture(page: Page, initial: CatalogUpgradeStatus) {
  const base = await installNeuralFixture(page, { motion: false });
  await desktop(page);
  let status = structuredClone(initial);
  const calls: Array<{ method: string; summary: boolean; at: string }> = [];
  const modes: CatalogCheckMode[] = [];
  let onStart: (() => void) | undefined;
  await page.route("**/api/suppliers/catalog-upgrade*", async route => {
    const method = route.request().method();
    const summary = new URL(route.request().url()).searchParams.get("summary") === "1";
    calls.push({ method, summary, at: await page.evaluate(() => new Date().toISOString()) });
    if (method === "PATCH") {
      const body = route.request().postDataJSON() as { mode: CatalogCheckMode };
      modes.push(body.mode);
      status = { ...status, mode: body.mode, nextCheckAt: body.mode === "daily" ? new Date(Date.parse(now) + day).toISOString() : null };
    } else if (method === "POST") {
      onStart?.();
    } else if (method !== "GET") {
      throw new Error(`Unexpected catalog method ${method}`);
    }
    return route.fulfill({ json: summary ? { ...status, history: [] } : status });
  });
  return { ...base, calls, modes, status: () => status,
    setStatus: (next: CatalogUpgradeStatus) => { status = structuredClone(next); },
    onStart: (callback: () => void) => { onStart = callback; } };
}

async function openHome(page: Page) {
  await page.goto("/");
  await expect(page.getByTestId("neural-workspace")).toBeVisible();
}
async function freezeAtStart(page: Page) {
  await page.clock.install({ time: new Date(Date.parse(now) - 60_000) });
  await page.clock.pauseAt(new Date(now));
}
async function settings(page: Page) {
  await page.getByTestId("workspace-settings").click();
  const dialog = page.getByRole("dialog", { name: "供应商与模型设置" });
  await expect(dialog.getByLabel("自动检查供应商目录与价格", { exact: true })).toBeVisible();
  return dialog;
}

test("启动读取真实差异提示，查看定位待手动连接，历史保留完整型号、单位和条件", async ({ page }, info) => {
  const data = await fixture(page, changed());
  await openHome(page);
  const notice = page.getByRole("status", { name: "供应商目录自动检查" });
  await expect(notice).toBeVisible();
  await expect(notice).toContainText("价格");
  await expect(notice).toContainText("手动刷新");
  expect(data.calls.filter(call => call.method === "POST")).toHaveLength(0);
  await page.screenshot({ path: info.outputPath("catalog-startup-notice-dark.png"), animations: "disabled" });
  await notice.getByRole("button", { name: "查看目录变化", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "供应商与模型设置" });
  await expect(dialog.getByRole("tab", { name: /供应商与模型/u })).toHaveAttribute("aria-selected", "true");
  await expect(dialog.getByRole("heading", { name: "纸月模型", exact: true })).toBeVisible();
  const manual = dialog.getByLabel("待手动刷新连接", { exact: true });
  await expect(manual).toContainText("纸月模型连接");
  await expect(manual).toContainText("鉴权");
  await expect(manual).toContainText("待手动刷新");
  const history = dialog.getByLabel("供应商目录变更记录", { exact: true });
  const folded = history.locator("details:not([open]) > summary");
  while (await folded.count()) await folded.first().click();
  // Review contains all changed suppliers even when the failing supplier is selected.
  await expect(history).toContainText("fixture-image-2.5-4k");
  await expect(history).toContainText("¥0.40 / 张 · 4K · max");
  await expect(history).toContainText("¥0.50 / 张 · 4K · max");
  await expect(history).toContainText("fixture-video-new-2.5-full-id");
  await expect(history).toContainText("fixture-video-old-2.0-full-id");
  await expect(history).toContainText("studio-plus-008");
  await expect(history).toContainText("型号规格变动");
  await expect(history).toContainText("分辨率：2K / 4K；默认值：4K");
  expect(data.calls.some(call => call.method === "GET" && !call.summary)).toBe(true);
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.screenshot({ path: info.outputPath("catalog-change-review-dark.png"), animations: "disabled" });
  await dialog.getByRole("tab", { name: /外观/u }).click();
  await dialog.getByLabel("外观主题", { exact: true }).selectOption("light");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await dialog.getByRole("tab", { name: /供应商与模型/u }).click();
  await expect(dialog.getByRole("heading", { name: "纸月模型", exact: true })).toBeVisible();
  await expect(dialog.getByLabel("待手动刷新连接", { exact: true })).toContainText("纸月模型连接");
  await expect(dialog.getByLabel("供应商目录变更记录", { exact: true })).toContainText("¥0.50 / 张 · 4K · max");
  await page.screenshot({ path: info.outputPath("catalog-change-review-light.png"), animations: "disabled" });
  data.assertSafe();
});

test("关闭自动检查时启动和运行24小时均零检查提交，设置仍可手动刷新", async ({ page }) => {
  await freezeAtStart(page);
  const initial = unchanged("off");
  initial.nextCheckAt = now; // Stale due metadata must not bypass Off.
  const data = await fixture(page, initial);
  await openHome(page);
  await page.clock.runFor(1_000);
  await expect.poll(() => data.calls.length).toBeGreaterThan(0);
  await page.clock.fastForward(day + 10_000);
  expect(data.calls.filter(call => call.method === "POST")).toHaveLength(0);
  await expect(page.getByRole("status", { name: "供应商目录自动检查" })).toHaveCount(0);
  await page.clock.resume();
  const dialog = await settings(page);
  await expect(dialog.getByLabel("自动检查供应商目录与价格", { exact: true })).toHaveValue("off");
  await expect(dialog.getByRole("button", { name: "刷新全部供应商", exact: true })).toBeEnabled();
  data.assertSafe();
});

test("每天一次在运行期间满24小时才低优先启动，后台轮询只发布一次且不生成", async ({ page }) => {
  await freezeAtStart(page);
  const data = await fixture(page, unchanged());
  data.onStart(() => data.setStatus({ ...unchanged(), phase: "running", nextCheckAt: null }));
  await openHome(page);
  await page.clock.runFor(1_000);
  await expect.poll(() => data.calls.length).toBeGreaterThan(0);
  await page.clock.fastForward(day - 1_001);
  expect(data.calls.filter(call => call.method === "POST")).toHaveLength(0);
  await page.clock.runFor(1);
  await expect.poll(() => data.calls.filter(call => call.method === "GET" && call.summary).length).toBe(2);
  await page.clock.runFor(4_999);
  expect(data.calls.filter(call => call.method === "POST")).toHaveLength(0);
  await page.clock.runFor(1);
  await expect.poll(() => data.calls.filter(call => call.method === "POST").length).toBe(1);
  data.setStatus({ ...unchanged(), refreshed: 1, updatedConnectionIds: [connectionId],
    nextCheckAt: new Date(Date.parse(now) + 2 * day).toISOString() });
  await page.clock.runFor(3_000);
  await expect.poll(() => page.evaluate(() => (window as unknown as { catalogUpgradeNotifications: number }).catalogUpgradeNotifications)).toBe(1);
  await page.clock.fastForward(60_000);
  expect(data.calls.filter(call => call.method === "POST")).toHaveLength(1);
  await expect(page.getByRole("status", { name: "供应商目录自动检查" })).toHaveCount(0);
  data.assertSafe();
});

test("三种自动检查模式显式保存，重新打开页面从服务端读取持久选择", async ({ page }) => {
  const data = await fixture(page, unchanged());
  await openHome(page);
  const dialog = await settings(page);
  const select = dialog.getByLabel("自动检查供应商目录与价格", { exact: true });
  await expect(select).toHaveValue("daily");
  await expect(select.locator("option")).toHaveText(["关闭", "仅软件升级后", "每天一次（默认）"]);
  for (const mode of ["off", "upgrade", "daily", "off"] as const) {
    await select.selectOption(mode);
    await expect.poll(() => data.status().mode).toBe(mode);
    await expect(select).toHaveValue(mode);
  }
  expect(data.modes).toEqual(["off", "upgrade", "daily", "off"]);
  await page.reload();
  await expect(page.getByTestId("neural-workspace")).toBeVisible();
  const reopened = await settings(page);
  await expect(reopened.getByLabel("自动检查供应商目录与价格", { exact: true })).toHaveValue("off");
  expect(data.calls.filter(call => call.method === "POST")).toHaveLength(0);
  data.assertSafe();
});

test("用户明确刷新成功后清除暂停和待手动标记，不自动复跑", async ({ page }) => {
  const data = await fixture(page, changed());
  let scans = 0;
  await page.route("**/api/suppliers/neural-supplier-1/scan", async route => {
    expect(route.request().method()).toBe("POST");
    scans++;
    data.setStatus({ ...unchanged(), mode: "upgrade", nextCheckAt: null });
    const updated = { ...neuralSuppliers[1]!, scannedAt: "2026-10-17T09:01:00.000Z",
      scanLastSuccessAt: "2026-10-17T09:01:00.000Z", scanComplete: true };
    Object.assign(data.suppliers[1]!, updated);
    return route.fulfill({ json: updated });
  });
  await openHome(page);
  await page.getByRole("button", { name: "查看目录变化", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "供应商与模型设置" });
  const manual = dialog.getByLabel("待手动刷新连接", { exact: true });
  const disclosure = dialog.getByRole("button", { name: /^目录变更与待处理连接/u });
  await expect(manual).toContainText("纸月模型连接");
  await manual.getByRole("button", { name: "查看供应商", exact: true }).click();
  await expect(disclosure).toHaveAttribute("aria-expanded", "false");
  await expect(dialog.getByRole("heading", { name: "纸月模型", exact: true })).toBeInViewport();
  expect(scans).toBe(0);
  await dialog.getByRole("complementary", { name: "供应商列表" }).getByRole("button", { name: "刷新 纸月模型", exact: true }).click();
  await expect.poll(() => scans).toBe(1);
  await disclosure.click();
  await expect(disclosure).toHaveAttribute("aria-expanded", "true");
  await expect(manual).not.toContainText("纸月模型连接");
  expect(data.status().connections[0]?.paused).toBe(false);
  expect(data.calls.filter(call => call.method === "POST")).toHaveLength(0);
  data.assertSafe();
});

test("仅采样时间变化不弹提示，提示关闭后本次会话不重复打扰", async ({ page }) => {
  const sampled = { ...unchanged(), refreshed: 1, updatedConnectionIds: [connectionId] };
  const data = await fixture(page, sampled);
  await openHome(page);
  await expect.poll(() => data.calls.length).toBeGreaterThan(0);
  await expect(page.getByRole("status", { name: "供应商目录自动检查" })).toHaveCount(0);
  data.setStatus(changed());
  await page.reload();
  const notice = page.getByRole("status", { name: "供应商目录自动检查" });
  await expect(notice).toBeVisible();
  await notice.getByRole("button", { name: "关闭目录提示", exact: true }).click();
  await expect(notice).toHaveCount(0);
  await page.getByTestId("workspace-settings").click();
  await page.getByRole("button", { name: "关闭设置", exact: true }).click();
  await expect(notice).toHaveCount(0);
  data.assertSafe();
});

test("启动发布完整目录时提示部分价格沿用，历史只列真实变化", async ({ page }, info) => {
  await freezeAtStart(page);
  const published: CatalogUpgradeStatus = { ...unchanged(), refreshed: 1,
    retainedPriceModelCount: 32,
    updatedConnectionIds: ["connection-neural-supplier-0"],
    changedConnectionIds: ["connection-neural-supplier-0"],
    priceChangedSupplierIds: ["neural-supplier-0"], noticeId: "catalog-retained-price-fixture",
    history: [{ id: "retained-price-real-changes", checkedAt: now,
      supplierId: "neural-supplier-0", supplierName: "晨星创作",
      connectionId: "connection-neural-supplier-0", connectionName: "晨星创作连接",
      changes: [
        { kind: "model-added", modelId: "new-unpriced-model-full-id", groupId: "studio" },
        { kind: "model-removed", modelId: "retired-model-full-id", groupId: "studio" },
        { kind: "price", modelId: "freshly-priced-model-full-id", groupId: "studio",
          before: "¥0.40 / 张 · 4K · high", after: "¥0.50 / 张 · 4K · high" },
      ] }],
  };
  const data = await fixture(page, { ...unchanged(), phase: "idle", nextCheckAt: now });
  data.onStart(() => data.setStatus(published));
  await openHome(page);
  await page.clock.runFor(1_000);
  await expect.poll(() => data.calls.length).toBeGreaterThan(0);
  await page.clock.runFor(5_000);
  await expect.poll(() => data.calls.filter(call => call.method === "POST").length).toBe(1);
  await page.clock.resume();
  const notice = page.getByRole("status", { name: "供应商目录自动检查" });
  await expect(notice).toContainText("部分型号沿用上次价格（32 个）");
  await expect(notice).not.toContainText("手动刷新");
  await page.screenshot({ path: info.outputPath("retained-price-startup-notice.png"), animations: "disabled" });
  await notice.getByRole("button", { name: "查看目录变化", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "供应商与模型设置" });
  const history = dialog.getByLabel("供应商目录变更记录", { exact: true });
  const folded = history.locator("details:not([open]) > summary");
  while (await folded.count()) await folded.first().click();
  await expect(history).toContainText("new-unpriced-model-full-id");
  await expect(history).toContainText("retired-model-full-id");
  await expect(history).toContainText("freshly-priced-model-full-id");
  await expect(history).toContainText("¥0.40 / 张 · 4K · high");
  await expect(history).toContainText("¥0.50 / 张 · 4K · high");
  await expect(history).not.toContainText("retained-unchanged-model-full-id");
  await expect(history).not.toContainText("上次价格");
  await page.screenshot({ path: info.outputPath("retained-price-real-history.png"), animations: "disabled" });
  data.assertSafe();
});
