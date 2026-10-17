import { expect, test } from "./helpers/canvas-offline-test";
import { installPhase5StateFixture } from "./helpers/phase5-state-fixture";

test.use({ viewport: { width: 1366, height: 768 } });

test("灵动岛可键盘展开、手动保持、Esc 归还焦点与外部点击收起，计时不重挂节点", async ({ page, request }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const f = await installPhase5StateFixture(page, request);
  await page.goto(`/canvas/${f.canvas.id}`);
  await expect(page.locator(".react-flow__node")).toHaveCount(14);
  const island = page.locator("[data-dynamic-island]");
  const trigger = island.getByRole("button", { name: /^任务与保存状态/ });
  await expect(trigger).toContainText("2 个任务生成中");
  await expect(trigger).toHaveAttribute("aria-expanded", "false");
  await trigger.focus();
  await page.keyboard.press("Enter");
  await expect(trigger).toHaveAttribute("aria-expanded", "true");
  await expect(island.getByRole("list", { name: "画布任务" })).toBeVisible();
  await expect(island.getByRole("progressbar")).toHaveCount(2);
  for (const progress of await island.getByRole("progressbar").all()) await expect(progress).not.toHaveAttribute("aria-valuenow", /.+/);
  const before = await trigger.textContent();
  await page.evaluate(() => {
    const windowWithNodes = window as Window & { __islandNodeElements?: Element[] };
    windowWithNodes.__islandNodeElements = [...document.querySelectorAll(".node-card")];
  });
  await page.waitForTimeout(2100);
  await expect(trigger).toHaveAttribute("aria-expanded", "true");
  expect(await trigger.textContent()).not.toBe(before);
  expect(await page.evaluate(() => {
    const beforeNodes = (window as Window & { __islandNodeElements?: Element[] }).__islandNodeElements ?? [];
    const afterNodes = [...document.querySelectorAll(".node-card")];
    return beforeNodes.length === afterNodes.length && beforeNodes.every((node, index) => node === afterNodes[index]);
  })).toBeTruthy();
  await page.keyboard.press("Escape");
  await expect(trigger).toHaveAttribute("aria-expanded", "false");
  await expect(trigger).toBeFocused();
  await trigger.click();
  await expect(trigger).toHaveAttribute("aria-expanded", "true");
  await page.mouse.click(1362, 380);
  await expect(trigger).toHaveAttribute("aria-expanded", "false");
  f.check();
});

test("失败任务沿用任务中心诊断，点击条目定位对应结果卡而不提交任务", async ({ page, request }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const f = await installPhase5StateFixture(page, request);
  await page.goto(`/canvas/${f.canvas.id}`);
  const island = page.locator("[data-dynamic-island]");
  const trigger = island.getByRole("button", { name: /^任务与保存状态/ });
  await expect(trigger).toContainText("2 个任务生成中");
  await expect(trigger).toHaveAttribute("aria-expanded", "false");
  await trigger.click();
  const failed = island.locator('button[data-task-status="failed"]');
  await expect(failed).toBeVisible();
  await failed.click();
  await expect(trigger).toHaveAttribute("aria-expanded", "false");
  await expect(page.locator('.react-flow__node[data-id="result-failed"]')).toHaveClass(/selected/);
  await expect(page.getByRole("dialog", { name: "运行历史", exact: true })).toBeVisible();
  await expect(page.getByText("隔离示例：模拟生成失败，可查看原因").first()).toBeVisible();
  f.check();
});

test("运行结束自动轻展后收起，完成提示两秒后回到保存状态", async ({ page, request }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const f = await installPhase5StateFixture(page, request);
  // This case has no historical failure competing with the completion feedback.
  for (const node of f.graph.nodes) if (node.data.generatedStatus === "failed") {
    node.data.generatedStatus = "succeeded";
    node.data.assetId = f.asset.id;
    delete node.data.generatedError;
  }
  for (const node of f.snapshot.nodes) if (node.status === "failed") {
    node.status = "succeeded";
    node.outputAssetIds = [f.asset.id];
    delete node.errorJson;
  }
  const saved = await request.put(`/api/canvas/${f.canvas.id}`, { data: { graph: f.graph } });
  expect(saved.ok()).toBeTruthy();
  await page.goto(`/canvas/${f.canvas.id}`);
  const island = page.locator("[data-dynamic-island]");
  const trigger = island.getByRole("button", { name: /^任务与保存状态/ });
  await expect(trigger).toContainText("2 个任务生成中");
  await expect(trigger).toHaveAttribute("aria-expanded", "false");
  f.snapshot.run.status = "succeeded";
  for (const node of f.snapshot.nodes) { node.status = "succeeded"; node.outputAssetIds = [f.asset.id]; delete node.errorJson; }
  await page.evaluate(() => window.dispatchEvent(new Event("canvas-reconcile-tasks")));
  await expect(trigger).toContainText("已完成");
  await expect(trigger).toHaveAttribute("aria-expanded", "true");
  await expect(trigger).toHaveAttribute("aria-expanded", "false");
  await expect(trigger).toContainText("已保存");
  f.check();
});

test("首次任务恢复保持折叠，手动展开不改变适应画布的边距", async ({ page, request }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const f = await installPhase5StateFixture(page, request);
  await page.goto(`/canvas/${f.canvas.id}`);
  const island = page.locator("[data-dynamic-island]");
  const trigger = island.getByRole("button", { name: /^任务与保存状态/ });
  await expect(trigger).toContainText("2 个任务生成中");
  await expect(trigger).toHaveAttribute("aria-expanded", "false");
  await trigger.focus();
  await page.keyboard.press("f");
  const viewport = page.locator(".react-flow__viewport");
  await expect.poll(() => page.getByRole("button", { name: "缩放比例，点击适应画布" }).textContent()).not.toBe("80%");
  const before = await viewport.getAttribute("style");
  await trigger.press("Enter");
  await expect(trigger).toHaveAttribute("aria-expanded", "true");
  await page.keyboard.press("f");
  await expect(viewport).toHaveAttribute("style", before!);
  await expect(trigger).toHaveAttribute("aria-expanded", "true");
  await page.keyboard.press("Escape");
  await expect(trigger).toHaveAttribute("aria-expanded", "false");
  f.check();
});

test("键盘进入自动展开内容后保持打开，Esc收起并归还焦点", async ({ page, request }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const f = await installPhase5StateFixture(page, request);
  for (const node of f.graph.nodes) if (node.data.generatedStatus === "failed") {
    node.data.generatedStatus = "succeeded";
    node.data.assetId = f.asset.id;
    delete node.data.generatedError;
  }
  for (const node of f.snapshot.nodes) if (node.status === "failed") {
    node.status = "succeeded";
    node.outputAssetIds = [f.asset.id];
    delete node.errorJson;
  }
  const saved = await request.put(`/api/canvas/${f.canvas.id}`, { data: { graph: f.graph } });
  expect(saved.ok()).toBeTruthy();
  await page.goto(`/canvas/${f.canvas.id}`);
  const island = page.locator("[data-dynamic-island]");
  const trigger = island.getByRole("button", { name: /^任务与保存状态/ });
  await expect(trigger).toContainText("2 个任务生成中");
  await expect(trigger).toHaveAttribute("aria-expanded", "false");
  f.snapshot.run.status = "succeeded";
  for (const node of f.snapshot.nodes) { node.status = "succeeded"; node.outputAssetIds = [f.asset.id]; delete node.errorJson; }
  await page.evaluate(() => window.dispatchEvent(new Event("canvas-reconcile-tasks")));
  await expect(trigger).toContainText("已完成");
  await expect(trigger).toHaveAttribute("aria-expanded", "true");
  // The search button follows the island in DOM order. A real backward Tab
  // enters its visible content without invoking the manual expansion button.
  await page.getByRole("button", { name: "搜索操作与节点", exact: true }).focus();
  await page.keyboard.press("Shift+Tab");
  const taskCenter = island.getByRole("button", { name: "打开任务中心", exact: true });
  await expect(taskCenter).toBeFocused();
  await page.waitForTimeout(1700);
  await expect(trigger).toHaveAttribute("aria-expanded", "true");
  await expect(taskCenter).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(trigger).toHaveAttribute("aria-expanded", "false");
  await expect(trigger).toBeFocused();
  f.check();
});
