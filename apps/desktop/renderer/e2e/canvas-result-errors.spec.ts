import { expect, test } from "@playwright/test";

for (const status of ["cancelled", "failed", "needs_attention"]) test(`${status}: result remains draggable with scrollable errors and working controls`, async ({ page, request }, testInfo) => {
  const message = status === "cancelled" ? "运行已取消" : "参考图片传输未完成，需要核对接口。".repeat(15) + "最后一行必须完整显示";
  const canvas = await (await request.post("/api/canvas", { data: { title: "结果文字验收", graph: {
    schemaVersion: 1, viewport: { x: 0, y: 0, zoom: 1 }, edges: [], nodes: [{ id: "result", type: "workflow", position: { x: 160, y: 110 }, style: { width: 340, height: 190 }, data: {
      nodeType: "asset-input", label: "结果验收", assetKind: "image", generatedResult: true, generatedStatus: status,
      generatedError: { message, providerMessage: "上游完整原文：" + "详细原因。".repeat(70) + "原文结尾" }, generatedProvider: "rest", generatedModel: "gpt-image-2", inputs: [], outputs: [],
    } }],
  } } })).json();
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(`/canvas/${canvas.id}`);
  const state = page.locator(`.generated-result-state.${status === "needs_attention" ? "needs-attention" : status}`);
  await expect(state).toHaveCSS("overflow-y", "auto");
  await expect(status === "cancelled" ? state.locator(".result-error-summary") : state.getByLabel("失败诊断").locator("dd p")).toHaveText(message);
  const title = state.locator("strong").first();
  await expect(title).toBeInViewport({ ratio: 1 });
  const node = page.locator('.react-flow__node[data-id="result"]');
  const initialBounds = await node.boundingBox();
  const titleBounds = await title.boundingBox();
  await page.mouse.move(titleBounds!.x + titleBounds!.width / 2, titleBounds!.y + titleBounds!.height / 2);
  await page.mouse.down();
  await page.mouse.move(titleBounds!.x + titleBounds!.width / 2 + 80, titleBounds!.y + titleBounds!.height / 2 + 40, { steps: 10 });
  await page.mouse.up();
  await expect.poll(async () => (await node.boundingBox())!.x - initialBounds!.x).toBeGreaterThan(60);
  await expect.poll(async () => (await node.boundingBox())!.y - initialBounds!.y).toBeGreaterThan(20);
  const savedPosition = async () => (await (await request.get(`/api/canvas/${canvas.id}`)).json()).graph.nodes[0].position;
  await expect.poll(savedPosition).not.toEqual({ x: 160, y: 110 });
  const position = await savedPosition();
  const movedStyle = await node.getAttribute("style");
  await page.screenshot({ path: testInfo.outputPath(`${status}-dragged.png`) });
  await state.locator("summary").click();
  await expect(node).toHaveAttribute("style", movedStyle!);
  await expect(state.locator("details")).not.toHaveCSS("overflow-y", "auto");
  await expect(state.locator(".generated-result-error-upstream")).toContainText("原文结尾");
  const before = await page.locator(".react-flow__viewport").getAttribute("style");
  await state.hover();
  await page.mouse.wheel(0, 1200);
  await expect.poll(() => state.evaluate(el => el.scrollTop)).toBeGreaterThan(0);
  await expect(page.locator(".react-flow__viewport")).toHaveAttribute("style", before!);
  await state.locator(".result-info-button").filter({ hasText: "复制错误详情" }).scrollIntoViewIfNeeded();
  await state.getByRole("button", { name: "复制错误详情", exact: true }).click();
  await expect(state.locator(".result-info-button").filter({ hasText: /已复制|复制失败/ })).toBeVisible();
  await expect(node).toHaveAttribute("style", movedStyle!);
  await page.screenshot({ path: testInfo.outputPath(`${status}-scroll.png`) });
  await state.evaluate(el => { el.scrollTop = 0; });
  await state.getByRole("button", { name: "查看 结果验收 来源" }).click();
  const dialog = page.getByRole("dialog", { name: "结果来源与参数" });
  await expect(dialog.getByLabel("完整错误详情").locator(".result-info-error")).toHaveText(message);
  await expect(dialog.getByLabel("完整错误详情").locator("pre")).toContainText("原文结尾");
  await expect(dialog.getByRole("button", { name: "复制错误详情", exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath(`${status}-full-details.png`) });
  await page.reload();
  await expect(title).toBeVisible();
  expect(await savedPosition()).toEqual(position);
});
