import { expect, test } from "@playwright/test";
import sharp from "sharp";

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

test("核验缩略图在应用内打开受保护原图，关闭后保留核验记录且不提交生成", async ({ page, request }, testInfo) => {
  const errors: string[] = [];
  let popups = 0, writes = 0, submissions = 0;
  page.on("pageerror", error => errors.push(error.message));
  page.on("popup", () => popups++);
  const uploaded = await request.post("/api/assets/upload", { multipart: { file: {
    name: "verification-preview-fixture.png", mimeType: "image/png",
    buffer: await sharp({ create: { width: 96, height: 64, channels: 3, background: "#a89ce7" } }).png().toBuffer(),
  } } });
  expect(uploaded.ok()).toBeTruthy();
  const asset = await uploaded.json();
  const anonymous = await request.get(`/api/assets/${asset.id}/content`, { headers: { "x-supercanvas-desktop-token": "" } });
  expect(anonymous.status(), "核验原图继续受桌面鉴权保护").toBe(401);
  const name = `核验原图预览-${Date.now()}`;
  const created = await request.post("/api/suppliers", { data: {
    name, supplierKey: "openai", siteUrl: "https://fixture.example.com", apiUrl: "https://fixture.example.com/v1", catalog: { groups: [] },
  } });
  expect(created.ok()).toBeTruthy();
  const supplier = await created.json();
  await page.route(`**/api/suppliers/${supplier.id}/verification`, async route => {
    if (route.request().method() !== "GET") writes++;
    await route.fulfill({ json: {
      id: supplier.id, policyVersion: 2, used: 1, limit: 2, paused: true,
      cases: [{ id: "preview-case", requestId: "preview-request", group: "图片组", modelId: "fixture-image-model",
        resolution: "2K", status: "succeeded", quality: "high", ratio: "3:2", parameters: {}, assetId: asset.id,
        createdAt: "2026-10-07T00:00:00Z", expectedWidth: 96, expectedHeight: 64, actualWidth: 96, actualHeight: 64 }],
      coverage: [{ group: "图片组", modelId: "fixture-image-model", connectionId: "fixture" }], evidence: [], skipped: [],
    } });
  });
  await page.route("**/api/runs", route => {
    if (route.request().method() === "POST") { submissions++; return route.abort(); }
    return route.continue();
  });
  try {
    await page.goto("/");
    await page.getByRole("button", { name: "供应商与模型", exact: true }).click();
    await page.locator(".sm-supplier-item").filter({ hasText: name }).click();
    await page.getByRole("tab", { name: "核验记录", exact: true }).click();
    const panel = page.getByRole("region", { name: "供应商自动核验" });
    const thumbnail = panel.getByRole("img", { name: "2K 核验结果", exact: true });
    await thumbnail.click();
    const preview = page.getByRole("dialog", { name: "素材预览", exact: true });
    await expect(preview).toBeVisible();
    await expect(preview.getByRole("button", { name: "关闭", exact: true })).toBeInViewport({ ratio: 1 });
    await expect.poll(() => preview.locator(".asset-stage img").evaluate(element => {
      const image = element as HTMLImageElement;
      return image.complete && image.naturalWidth;
    })).toBe(96);
    expect(popups).toBe(0);
    const stage = preview.locator(".asset-stage");
    await stage.evaluate(element => element.addEventListener("wheel", event => {
      element.setAttribute("data-test-wheel-prevented", String(event.defaultPrevented));
    }, { once: true, passive: true }));
    const bounds = await stage.boundingBox();
    expect(bounds).not.toBeNull();
    await page.mouse.move(bounds!.x + bounds!.width / 2, bounds!.y + bounds!.height / 2);
    await page.mouse.wheel(0, -100);
    await expect(stage).toHaveAttribute("data-test-wheel-prevented", "true");
    await expect(preview.locator(".asset-zoom-level")).toHaveText("115%");
    await page.screenshot({ path: testInfo.outputPath("verification-preview-in-app.png"), animations: "disabled" });
    await preview.getByRole("button", { name: "关闭", exact: true }).click();
    await expect(preview).toBeHidden();
    await expect(panel.locator(".sm-verification-case")).toHaveCount(1);
    await page.setViewportSize({ width: 390, height: 820 });
    await thumbnail.click();
    await expect(preview).toBeVisible();
    await expect(preview).toBeInViewport({ ratio: 1 });
    await expect(preview.getByRole("button", { name: "关闭", exact: true })).toBeInViewport({ ratio: 1 });
    await page.screenshot({ path: testInfo.outputPath("verification-preview-narrow-window.png"), animations: "disabled" });
    await page.keyboard.press("Escape");
    await expect(preview).toBeHidden();
    await expect(panel).toBeVisible();
    await expect(thumbnail.locator("..")).toBeFocused();
    expect({ popups, writes, submissions, errors }).toEqual({ popups: 0, writes: 0, submissions: 0, errors: [] });
  } finally {
    await testInfo.attach("preview-navigation-observation", { body: JSON.stringify({ popups, writes, submissions, errors }), contentType: "application/json" });
  }
});
