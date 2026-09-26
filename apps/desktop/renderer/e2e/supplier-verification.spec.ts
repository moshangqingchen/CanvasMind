import { expect, test } from "@playwright/test";

test("核验记录按分组显示不同型号，切换筛选不会提交付费请求", async ({ page, request }, testInfo) => {
  const name = `全分组核验-${Date.now()}`;
  const response = await request.post("/api/suppliers", { data: {
    name, supplierKey: "openai", siteUrl: "https://fixture.example.com", apiUrl: "https://fixture.example.com/v1", catalog: { groups: [] },
  } });
  expect(response.ok()).toBeTruthy();
  const supplier = await response.json();
  let writes = 0;
  const cases = [
    { id: "first", requestId: "first-request", group: "普通图片组", modelId: "gpt-image-2-a", resolution: "2K", status: "queued", quality: "high" },
    { id: "second", requestId: "second-request", group: "1K 图片组", modelId: "gpt-image-2-b", resolution: "1K", status: "succeeded", quality: "high" },
  ].map(item => ({ ...item, createdAt: "2026-09-21T00:00:00Z", ratio: "16:9", parameters: {}, expectedWidth: 1536, expectedHeight: 864 }));
  await page.route(`**/api/suppliers/${supplier.id}/verification`, async route => {
    if (route.request().method() !== "GET") writes++;
    await route.fulfill({ json: {
      id: supplier.id, policyVersion: 2, used: 1, limit: 2, paused: true, cases,
      coverage: cases.map(item => ({ group: item.group, modelId: item.modelId, connectionId: "fixture" })),
      evidence: [], skipped: [{ connectionId: "", group: "尚无 Key 的图片组", modelId: "gpt-image-2-c", reason: "该分组尚无可用连接或 Key" }],
    } });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "供应商与模型", exact: true }).click();
  await page.locator(".sm-supplier-item").filter({ hasText: name }).click();
  await page.getByRole("tab", { name: "核验记录", exact: true }).click();
  const panel = page.getByRole("region", { name: "供应商自动核验" });
  await expect(panel.locator(".sm-verification-case")).toHaveCount(2);
  await expect(panel.getByText("已提交 1 次 · 待测 1 项")).toBeVisible();
  await panel.getByLabel("核验分组").selectOption("1K 图片组");
  await expect(panel.locator(".sm-verification-case")).toHaveCount(1);
  await expect(panel.locator(".sm-verification-case")).toContainText("gpt-image-2-b");
  await expect(panel.getByRole("button", { name: "追加一轮核验" })).toHaveCount(0);
  await panel.getByLabel("核验分组").selectOption("尚无 Key 的图片组");
  await expect(panel.locator(".sm-verification-case")).toHaveCount(0);
  await panel.getByText("未测试项目 · 1").click();
  await expect(panel.getByText("该分组尚无可用连接或 Key", { exact: false })).toBeVisible();
  await panel.getByLabel("核验分组").selectOption("");
  await page.screenshot({ path: testInfo.outputPath("group-verification.png") });
  expect(writes).toBe(0);
});
