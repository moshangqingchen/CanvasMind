import {
  expect,
  test,
  type Page,
  type APIRequestContext,
} from "@playwright/test";
async function createFixture(request: APIRequestContext, name: string) {
  const created = await request.post("/api/suppliers", {
    data: {
      name,
      supplierKey: "openai",
      siteUrl: "https://fixture.example.com/gateway/dashboard",
      apiUrl: "https://fixture.example.com/gateway/v1",
      catalog: {
        groups: [
          {
            id: "manual-fixture",
            label: "手动测试组",
            source: "manual",
            models: [],
          },
        ],
      },
    },
  });
  expect(created.ok()).toBeTruthy();
  return created.json();
}
async function settings(page: Page, name: string) {
  await page.goto("/");
  await page.getByRole("button", { name: "供应商与模型", exact: true }).click();
  await page
    .getByRole("button", { name: new RegExp(name) })
    .filter({ has: page.locator(".sm-supplier-label") })
    .click();
  return page.getByRole("dialog", { name: "供应商与模型设置" });
}
test("供应商右键、键盘菜单、隐藏恢复及彻底删除不复活", async ({
  page,
  request,
}, testInfo) => {
  const name = `生命周期-${Date.now()}`;
  const supplier = await createFixture(request, name);
  const d = await settings(page, name);
  const item = d.locator(".sm-supplier-item").filter({ hasText: name });
  await item.click({ button: "right" });
  await expect(page.getByRole("menuitem", { name: "彻底删除" })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("supplier-context-menu.png") });
  await page.getByRole("menuitem", { name: "隐藏", exact: true }).click();
  await expect(item).toHaveCount(0);
  await d.getByRole("button", { name: /已隐藏供应商/ }).click();
  await expect(
    d.locator(".sm-supplier-item").filter({ hasText: name }),
  ).toBeVisible();
  await d.getByRole("button", { name: `${name} 的更多操作` }).click();
  await page.getByRole("menuitem", { name: "恢复显示" }).click();
  await d.getByRole("button", { name: "返回当前供应商" }).click();
  await item.focus();
  await item.press("Shift+F10");
  await expect(page.getByRole("menu", { name: `${name} 操作` })).toBeVisible();
  await page.getByRole("menuitem", { name: "重命名" }).press("End");
  await expect(page.getByRole("menuitem", { name: "彻底删除" })).toBeFocused();
  page.once("dialog", (dialog) => {
    expect(dialog.message()).toContain("画布节点、素材和生成历史保留");
    void dialog.accept();
  });
  await page.keyboard.press("Enter");
  await expect(item).toHaveCount(0);
  await page.reload();
  await page.getByRole("button", { name: "供应商与模型", exact: true }).click();
  await expect(
    page.locator(".sm-supplier-item").filter({ hasText: name }),
  ).toHaveCount(0);
  const all = await (await request.get("/api/suppliers")).json();
  expect(
    all.find((s: { id: string }) => s.id === supplier.id).state.visibility,
  ).toBe("deleted");
  await page.getByRole("button", { name: "添加供应商", exact: true }).click();
  await expect(page.getByLabel("供应商模板")).toBeVisible();
  await page.getByLabel("供应商模板").selectOption("openai");
  await expect(page.getByPlaceholder("https://ai.example.com")).not.toHaveValue(
    "",
  );
});
test("修改地址归档分组，历史恢复原地址与 Key，当前数量不混入历史", async ({
  page,
  request,
}, testInfo) => {
  const name = `地址隔离-${Date.now()}`;
  const supplier = await createFixture(request, name);
  const saved = await request.post("/api/providers", {
    data: {
      name: "模拟分组 Key",
      provider: "openai",
      apiKey: "mock-only-never-sent",
      config: {
        supplierId: supplier.id,
        supplierSourceId: supplier.state.sourceId,
        supplierKey: "openai",
        customGroup: true,
        baseUrl: supplier.apiUrl,
        modelGroup: "manual-fixture",
        usage: "canvas",
      },
    },
  });
  expect(saved.ok()).toBeTruthy();
  const connection = await saved.json();
  const d = await settings(page, name);
  await expect(d.locator(".sm-group-card")).toHaveCount(1);
  await d
    .getByLabel("站点地址", { exact: true })
    .fill("https://new.example.com");
  await d
    .getByLabel("API 地址", { exact: true })
    .fill("https://new.example.com/v1");
  await d.getByRole("button", { name: "仅保存", exact: true }).click();
  await expect(d.locator(".sm-group-card")).toHaveCount(0);
  await d.locator(".sm-history > summary").click();
  await expect(
    d.getByText(`API：${supplier.apiUrl}`, { exact: false }),
  ).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("supplier-source-history.png") });
  const current = await (await request.get("/api/providers")).json();
  expect(current.some((c: { id: string }) => c.id === connection.id)).toBe(
    false,
  );
  page.once("dialog", (dialog) => {
    expect(dialog.message()).toContain(supplier.apiUrl);
    void dialog.accept();
  });
  await d.getByRole("button", { name: "恢复此配置" }).click();
  await expect(d.getByLabel("API 地址", { exact: true })).toHaveValue(
    supplier.apiUrl,
  );
  await expect(d.locator(".sm-group-card")).toHaveCount(1);
  const restored = await (await request.get("/api/providers")).json();
  expect(
    restored.find((c: { id: string }) => c.id === connection.id).apiKeySet,
  ).toBe(true);
});
test("窄屏更多菜单可操作，未完成运行阻止删除", async ({ page, request }) => {
  const name = `保护-${Date.now()}`;
  const supplier = await createFixture(request, name);
  await page.setViewportSize({ width: 650, height: 850 });
  await page.route(`**/api/suppliers/${supplier.id}`, async (route) => {
    if (route.request().method() === "GET")
      await route.fulfill({
        json: {
          revision: 1,
          groups: 2,
          keys: 2,
          canvasReferences: 3,
          unfinishedRuns: 1,
        },
      });
    else await route.continue();
  });
  const d = await settings(page, name);
  await d.getByRole("button", { name: `${name} 的更多操作` }).click();
  await page.getByRole("menuitem", { name: "彻底删除" }).click();
  await expect(
    d.getByRole("alert").filter({ hasText: "未完成运行" }),
  ).toBeVisible();
  expect(
    (await (await request.get("/api/suppliers")).json()).find(
      (s: { id: string }) => s.id === supplier.id,
    ).state.visibility,
  ).toBe("visible");
});
