import { expect, test, type Page } from "@playwright/test";
import type { ModelDescriptor } from "@super-canvas/providers";
import type { ProviderConnectionView } from "../lib/client-api";
import type { SupplierRecord } from "../lib/client-suppliers";

async function fixture(page: Page, modelReadStatus: 200 | 401 = 200) {
  const models: ModelDescriptor[] = [
    {
      id: "gpt-image-2", name: "gpt-image-2", operations: ["image.generate", "image.edit"],
      metadata: { tk1688Catalog: true, tk1688BaseModel: "gpt-image-2", tk1688Routing: "smart", priceLabel: "各商家报价不同" },
    },
    {
      id: "gpt-image-2@s47c261", name: "gpt-image-2 · 商家 s47c261", operations: ["image.generate", "image.edit"],
      metadata: { tk1688Catalog: true, tk1688BaseModel: "gpt-image-2", tk1688Routing: "merchant", tk1688SupportedResolutions: ["1K", "2K"],
        // Keep a historical USD label to cover conversion when old catalogs are read.
        supplierChannelDescription: "支持 1K 和 2K，常规图片输出", priceLabel: "$0.03/次", tk1688FxRate: 6.8896, priceSource: "tk1688-marketplace" },
    },
    {
      id: "gpt-image-2@s48c262", name: "gpt-image-2 · 商家 s48c262", operations: ["image.generate", "image.edit"],
      metadata: { tk1688Catalog: true, tk1688BaseModel: "gpt-image-2", tk1688Routing: "merchant", tk1688SupportedResolutions: ["4K"],
        tk1688FixedSize: "3840x2160", tk1688OmitN: true, supplierChannelDescription: "支持 4K，适合大幅输出",
        priceLabel: "¥0.413376/次", priceSource: "tk1688-marketplace" },
    },
    {
      id: "gpt-5", name: "gpt-5", operations: [], outputKinds: ["text"],
      metadata: { tk1688Catalog: true, tk1688BaseModel: "gpt-5", tk1688Routing: "smart", protocol: "chat-completions", priceLabel: "各商家报价不同" },
    },
    {
      id: "gpt-5@s50c263", name: "gpt-5 · 商家 s50c263", operations: [], outputKinds: ["text"],
      pricing: { kind: "token", currency: "USD", inputPerMillion: 1, outputPerMillion: 2, confidence: "snapshot", checkedAt: "2026-10-04T03:00:00.000Z" },
      metadata: { tk1688Catalog: true, tk1688BaseModel: "gpt-5", tk1688Routing: "merchant", protocol: "chat-completions",
        supplierChannelDescription: "对话渠道", priceLabel: "输入 $1/1M · 输出 $2/1M", tk1688FxRate: 6.8896, priceSource: "tk1688-marketplace" },
    },
  ];
  const supplier: SupplierRecord = {
    id: "tk1688-groups-fixture", supplierKey: "tk1688", name: "词元", kind: "openai-compatible",
    siteUrl: "https://tk1688.com", apiUrl: "https://api.tk1688.com/v1",
    catalog: { groups: [{ id: "default", label: "创作组", source: "catalog", models: models.map(model => ({
      id: model.id, name: model.name, capability: model.id.startsWith("gpt-image") ? "image" : "chat",
      priceLabel: String(model.metadata?.priceLabel), metadata: model.metadata,
    })) }] },
    scanStatus: "live", scannedAt: "2026-10-04T03:00:00.000Z", scanLastSuccessAt: "2026-10-04T03:00:00.000Z",
    createdAt: "2026-10-04T03:00:00.000Z", updatedAt: "2026-10-04T03:00:00.000Z",
  };
  const connection: ProviderConnectionView = {
    id: "connection-tk1688-groups", name: "词元创作组", provider: "openai", apiKey: "", apiKeySet: true,
    config: { supplierId: supplier.id, supplierKey: supplier.supplierKey, baseUrl: supplier.apiUrl, modelGroup: "default",
      usage: "canvas", modelCatalogModels: models, scannedModelIds: models.map(model => model.id), modelScanStatus: "live",
      modelScanCheckedAt: "2026-10-04T03:00:00.000Z", modelScanLastSuccessAt: "2026-10-04T03:00:00.000Z" },
  };
  const writes: string[] = [];
  const modelReads: number[] = [];
  await page.route("**/api/suppliers**", async route => {
    if (route.request().method() !== "GET") writes.push(new URL(route.request().url()).pathname);
    await route.fulfill({ json: new URL(route.request().url()).pathname.endsWith("/verification") ? null : [supplier] });
  });
  await page.route("**/api/providers**", async route => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() !== "GET") writes.push(url.pathname);
    if (url.pathname.endsWith("/models")) {
      modelReads.push(modelReadStatus);
      if (modelReadStatus === 401) await route.fulfill({ status: 401, json: { error: "隔离目录读取失败", status: "unauthorized" }, headers: { "X-Model-Scan-Status": "unauthorized" } });
      else await route.fulfill({ json: models, headers: { "X-Model-Scan-Status": "live" } });
    }
    else await route.fulfill({ json: [connection] });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "供应商与模型", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "供应商与模型设置" });
  await expect(dialog.getByRole("heading", { name: "词元", exact: true })).toBeVisible();
  await expect(dialog.locator(".sm-model-family")).toHaveCount(2);
  return { dialog, writes, modelReads };
}

test("词元同型号折叠，展开后分别显示自动路由、商家渠道和参考报价", async ({ page }, testInfo) => {
  const { dialog, writes } = await fixture(page);
  const section = dialog.locator('.sm-model-section[data-source="actual"]');
  await expect(section.locator(".sm-model-section-title")).toContainText("2 个基础型号 · 3 条商家渠道");
  await expect(section.locator(".sm-model-item")).toHaveCount(0);
  await section.screenshot({ path: testInfo.outputPath("supplier-tk1688-model-overview.png") });
  await dialog.getByRole("button", { name: "展开 gpt-image-2 的商家渠道", exact: true }).click();
  const imageFamily = section.locator(".sm-model-family").filter({ has: page.getByRole("button", { name: "收起 gpt-image-2 的商家渠道", exact: true }) });
  await expect(imageFamily.locator(".sm-model-route")).toHaveCount(3);
  await expect(imageFamily.getByText("自动路由", { exact: true })).toBeVisible();
  const firstMerchant = imageFamily.locator(".sm-model-route").filter({ hasText: "gpt-image-2@s47c261" });
  await expect(firstMerchant).toContainText("商家 47 · 渠道 261");
  await expect(firstMerchant).toContainText("商家声明 1K / 2K");
  await expect(firstMerchant.locator(".sm-model-price")).toHaveText("¥0.206688/次");
  const largeMerchant = imageFamily.locator(".sm-model-route").filter({ hasText: "gpt-image-2@s48c262" });
  await expect(largeMerchant).toContainText("固定 3840×2160");
  await expect(largeMerchant).toContainText("一次 1 张");
  await expect(largeMerchant).toContainText("商家说明：支持 4K，适合大幅输出");
  await expect(largeMerchant.locator(".sm-model-price")).toHaveText("¥0.413376/次");
  await dialog.getByRole("button", { name: "展开 gpt-5 的商家渠道", exact: true }).click();
  const chatMerchant = section.locator(".sm-model-route").filter({ hasText: "gpt-5@s50c263" });
  await expect(chatMerchant.locator(".sm-model-facts")).toContainText("对话");
  await expect(chatMerchant).toContainText("商家说明：对话渠道");
  await expect(chatMerchant.locator(".sm-model-price")).toHaveText("输入 ¥6.8896/1M · 输出 ¥13.7792/1M");
  await expect(section).not.toContainText(/USD|\$/u);
  await page.screenshot({ path: testInfo.outputPath("supplier-tk1688-routes.png"), fullPage: true });
  expect(writes).toEqual([]);
});

test("搜索商家说明保留词元分组，并自动展开匹配的具体路线", async ({ page }) => {
  const { dialog, writes } = await fixture(page);
  await dialog.getByLabel("查找分组或模型", { exact: true }).fill("4K");
  await dialog.getByRole("button", { name: "查找", exact: true }).click();
  await expect(dialog.locator(".sm-group-card")).toHaveCount(1);
  await expect(dialog.locator(".sm-model-family")).toHaveCount(1);
  await expect(dialog.getByRole("button", { name: "收起 gpt-image-2 的商家渠道", exact: true })).toHaveAttribute("aria-expanded", "true");
  await expect(dialog.locator(".sm-model-route")).toHaveCount(1);
  await expect(dialog.locator(".sm-model-route")).toContainText("gpt-image-2@s48c262");
  await expect(dialog.locator(".sm-model-route-summary")).toContainText("商家说明：支持 4K，适合大幅输出");
  expect(writes).toEqual([]);
});

test("词元模型读取 401 时，已保存美元目录按官方汇率显示人民币报价", async ({ page }) => {
  const { dialog, writes, modelReads } = await fixture(page, 401);
  await expect.poll(() => modelReads.length).toBeGreaterThan(0);
  expect(modelReads.every(status => status === 401)).toBe(true);
  await dialog.getByRole("button", { name: "展开 gpt-5 的商家渠道", exact: true }).click();
  const section = dialog.locator('.sm-model-section[data-source="actual"]');
  const chatMerchant = section.locator(".sm-model-route").filter({ hasText: "gpt-5@s50c263" });
  await expect(chatMerchant.locator(".sm-model-price")).toHaveText("输入 ¥6.8896/1M · 输出 ¥13.7792/1M");
  await expect(section).not.toContainText(/USD|\$/u);
  expect(writes).toEqual([]);
});
