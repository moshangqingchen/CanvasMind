import { expect, test } from "@playwright/test";
import type { ModelDescriptor } from "@super-canvas/providers";
import { installNeuralFixture } from "./helpers/neural-fixture";

const sampledAt = "2026-10-10T03:04:05.000Z";
const historicalId = "retained-unchanged-model-full-id";
const unpricedId = "new-unpriced-model-full-id";

test("型号菜单、参数面板和供应商详情显示旧价格原采样时间，无价仍为横线", async ({ page }, info) => {
  const data = await installNeuralFixture(page, { motion: false });
  await page.addInitScript(() => localStorage.setItem("super-canvas:inspector-open", "false"));
  const models: ModelDescriptor[] = [
    { id: historicalId, name: "保留报价型号", operations: ["image.generate"], inputKinds: ["text"], outputKinds: ["image"],
      pricing: { kind: "per-image", currency: "CNY", billingUnit: "image", unitAmount: .4, confidence: "exact", checkedAt: sampledAt },
      metadata: { canvasRunnable: true, protocol: "openai-images", priceStatus: "partial", priceLabel: "¥0.40/张（上次价格）",
        priceCheckedAt: sampledAt, priceLastAttemptAt: "2026-10-17T09:00:00.000Z", priceLastAttemptStatus: "partial" } },
    { id: unpricedId, name: "供应商未公布报价", operations: ["image.generate"], inputKinds: ["text"], outputKinds: ["image"],
      metadata: { canvasRunnable: true, protocol: "openai-images" } },
  ];
  const connection = data.connections[0]!;
  connection.config = { ...connection.config, modelScanComplete: true, modelCatalogModels: models,
    scannedModelIds: models.map(model => model.id), defaultModel: historicalId };
  data.suppliers[0]!.catalog.groups[0]!.models = models.map(model => ({ id: model.id, name: model.name, capability: "image",
    protocol: "openai-images", priceLabel: model.metadata?.priceLabel as string | undefined,
    metadata: { ...model.metadata, ...(model.pricing ? { officialCatalogPricing: model.pricing } : {}) } }));
  const graph = { schemaVersion: 1, viewport: { x: 0, y: 0, zoom: 1 }, edges: [], drawings: [], nodes: [{
    id: "historical-price-node", type: "workflow", position: { x: 55, y: 100 }, style: { width: 420, height: 180 },
    data: { nodeType: "image-generation", label: "历史报价", provider: "openai", connectionId: connection.id,
      model: historicalId, parameters: {}, parts: [], inputs: [{ id: "prompt", kind: "text", label: "提示词" }],
      outputs: [{ id: "image", kind: "image", label: "图片" }] },
  }] };
  await page.route("**/api/canvas/neural-autumn", route => route.fulfill({ json: {
    id: "neural-autumn", title: "秋日品牌视觉", revision: 1, graph,
  } }));
  await page.route(`**/api/providers/${connection.id}/models*`, route => route.fulfill({ json: models,
    headers: { "X-Model-Scan-Status": "live", "X-Model-Scan-Complete": "true" } }));
  await page.goto("/canvas/neural-autumn");
  await expect(page.locator(".react-flow__node")).toHaveCount(1);
  await page.getByRole("button", { name: "打开 历史报价 模型与参数", exact: true }).click();
  const panel = page.getByRole("dialog", { name: "历史报价 模型与参数", exact: true });
  const quote = panel.getByLabel("当前参数价格", { exact: true });
  await expect(quote).toContainText("上次价格");
  await expect(quote).toContainText(`采样时间 ${sampledAt}`);
  await panel.getByRole("combobox", { name: "历史报价 模型", exact: false }).click();
  const historical = panel.getByRole("option").filter({ hasText: historicalId });
  await expect(historical).toContainText("上次价格");
  await expect(historical).toContainText(sampledAt);
  await expect(historical).not.toContainText("2026-10-17T09:00:00.000Z");
  const unpriced = panel.getByRole("option").filter({ hasText: unpricedId });
  await expect(unpriced.getByText("—", { exact: true })).toBeVisible();
  await expect(unpriced).not.toContainText("上次价格");
  await page.screenshot({ path: info.outputPath("historical-price-model-menu.png"), animations: "disabled" });
  await page.keyboard.press("Escape");
  await quote.scrollIntoViewIfNeeded();
  await expect(quote).toBeVisible();
  await expect(quote).toContainText(sampledAt);
  await page.screenshot({ path: info.outputPath("historical-price-parameters.png"), animations: "disabled" });
  await page.goto("/");
  await page.getByTestId("workspace-settings").click();
  const dialog = page.getByRole("dialog", { name: "供应商与模型设置" });
  await expect(dialog.getByRole("heading", { name: "晨星创作", exact: true })).toBeVisible();
  const row = dialog.locator(".sm-model-item").filter({ hasText: historicalId });
  await expect(row).toContainText("上次价格");
  await expect(row).toContainText(sampledAt);
  await row.scrollIntoViewIfNeeded();
  await expect(row).toBeVisible();
  await page.screenshot({ path: info.outputPath("historical-price-supplier.png"), animations: "disabled" });
  data.assertSafe();
});
