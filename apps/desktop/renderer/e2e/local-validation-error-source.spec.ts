import { expect, test } from "@playwright/test";

for (const source of ["local_validation", "legacy_local", "provider_response"] as const) {
  test(`${source}: result details retain the reason and identify its origin`, async ({ page, request }) => {
    await page.setViewportSize({ width: 1440, height: 1080 });
    const local = source !== "provider_response";
    const reason = "分辨率参数诊断测试原文";
    const error = source === "local_validation"
      ? { message: `请求未提交：${reason}`, source, localMessage: reason, failureCategory: "invalid_request" }
      : source === "legacy_local"
        ? { message: `请求未提交：${reason}`, providerMessage: reason, failureCategory: "invalid_request" }
        : { message: `供应商拒绝了请求：${reason}`, source, providerMessage: reason, statusCode: 400, failureCategory: "invalid_request" };
    const response = await request.post("/api/canvas", { data: { title: "错误来源验收", graph: {
      schemaVersion: 1, viewport: { x: 0, y: 0, zoom: 1 }, edges: [], nodes: [{ id: "result", type: "workflow",
        position: { x: 160, y: 110 }, style: { width: 340, height: 340 }, data: {
          nodeType: "asset-input", label: "错误来源验收", assetKind: "video", generatedResult: true,
          generatedStatus: "failed", generatedError: error, generatedProvider: "rest", generatedSupplier: "jiasu",
          generatedModel: "dola-sd-2.5", inputs: [], outputs: [],
        } }],
    } } });
    expect(response.ok()).toBe(true);
    const canvas = await response.json();
    await page.goto(`/canvas/${canvas.id}`);
    const state = page.locator('.react-flow__node[data-id="result"] .generated-result-state.failed');
    const title = local ? "技术详情与本地校验" : "技术详情与供应商原文";
    await state.getByText(title, { exact: true }).click();
    await expect(state.locator(".generated-result-error-upstream")).toHaveText(
      local ? `本地校验：${reason}` : `HTTP 400 · 供应商原文：${reason}`,
    );
    await expect(state.locator(".generated-result-error-upstream")).not.toContainText("上游：");
    await state.getByRole("button", { name: "查看 错误来源验收 来源", exact: true }).focus();
    await page.keyboard.press("Enter");
    const dialog = page.getByRole("dialog", { name: "结果来源与参数" });
    await expect(dialog).toBeVisible();
    const errorDetails = dialog.getByRole("region", { name: "完整错误详情", exact: true });
    await errorDetails.getByText(title, { exact: true }).click();
    await expect(errorDetails.locator("pre")).toContainText(local ? '"source": "local_validation"' : '"source": "provider_response"');
    if (local) await expect(errorDetails.locator("pre")).not.toContainText("providerMessage");
    await dialog.getByRole("button", { name: "关闭来源详情" }).click();
    await page.reload();
    await expect(state.getByText(title, { exact: true })).toBeVisible();
  });
}
