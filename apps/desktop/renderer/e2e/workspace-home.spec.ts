import { expect, test, type Page } from "@playwright/test";
import type { ProjectSummaryView } from "../lib/client-api";
import { installNeuralFixture } from "./helpers/neural-fixture";
import { clickWorkspaceModule } from "./helpers/workspace-navigation";

// Preserve the former homepage's project, preference and dialog contracts in
// the replacement's module/item layers. Bento and Aura no longer exist.
const older: ProjectSummaryView = {
  id: "home-older",
  title: "品牌视觉探索",
  nodeCount: 8,
  createdAt: "2026-09-01T08:00:00.000Z",
  updatedAt: "2026-09-02T08:00:00.000Z",
};
const newer: ProjectSummaryView = {
  id: "home-newer",
  title: "秋日视频分镜",
  nodeCount: 12,
  createdAt: "2026-09-03T08:00:00.000Z",
  updatedAt: "2026-09-04T08:00:00.000Z",
};
const home = (p: Page) => p.getByTestId("neural-workspace");
const rows = (p: Page) =>
  p.locator('article:has(>button[data-testid^="neural-item-"])');
const row = (p: Page, id: string) =>
  p.getByTestId(`neural-item-${id}`).locator("..");
const inspector = (p: Page) => p.getByTestId("neural-inspector");
const scene = (p: Page) => p.locator("[data-renderer]").first();
async function openHome(page: Page) {
  await page.goto("/");
  await expect(home(page)).toBeVisible();
}
async function canvases(page: Page) {
  await clickWorkspaceModule(page, "canvases");
}
async function selectProject(page: Page, id: string) {
  await row(page, id).click();
  await expect(inspector(page)).toBeVisible();
}
async function action(page: Page, id: string, name: string) {
  await selectProject(page, id);
  const button = inspector(page).getByRole("button", { name, exact: true });
  await button.click();
  return button;
}
async function readable(page: Page) {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  ).toBe(true);
  const bounds = (await page.getByRole("banner").boundingBox())!;
  expect(bounds.x).toBeGreaterThanOrEqual(0);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(
    page.viewportSize()!.width + 1,
  );
  // Micro-labels and suggestion chips are auxiliary, as in the original check.
  // Keep the >=12px requirement on navigation, primary controls, search and titles.
  const sizes = await page
    .locator(
      '[data-testid="new-project"],[data-testid="workspace-settings"],[aria-label="工作台导航"] button,input[aria-label="搜索画布"],select[aria-label="画布排序"],input[aria-label="搜索创作空间"],article strong',
    )
    .evaluateAll((elements) =>
      elements
        .filter(
          (e) =>
            e.getClientRects().length &&
            getComputedStyle(e).visibility !== "hidden",
        )
        .map((e) => Number.parseFloat(getComputedStyle(e).fontSize)),
    );
  expect(sizes.length).toBeGreaterThan(5);
  for (const size of sizes) expect(size).toBeGreaterThanOrEqual(12);
}

for (const viewport of [
  { width: 1024, height: 768 },
  { width: 1366, height: 768 },
  { width: 1920, height: 1080 },
]) {
  test(`神经工作台在 ${viewport.width} 像素下层级清晰且无横向溢出`, async ({
    page,
  }, info) => {
    await page.setViewportSize(viewport);
    await page.emulateMedia({ reducedMotion: "reduce" });
    const f = await installNeuralFixture(page, { projects: [older, newer] });
    await openHome(page);
    await expect(page.getByTestId("neural-module-canvases")).toContainText("2");
    await expect(
      page.locator('[data-workspace-stat="projects"]'),
    ).toContainText("2");
    await expect(page.locator('[data-workspace-stat="nodes"]')).toContainText(
      "20",
    );
    await expect(page.getByTestId("new-project")).toBeVisible();
    await readable(page);
    await canvases(page);
    await expect(rows(page)).toHaveCount(2);
    await readable(page);
    await page.screenshot({
      path: info.outputPath(`workspace-neural-${viewport.width}.png`),
    });
    expect(f.mutations).toEqual([]);
    expect(f.canvasReads).toEqual([]);
    f.assertSafe();
  });
}
test("已有结果封面优先，装饰封面排序筛选后保持稳定", async ({ page }) => {
  const f = await installNeuralFixture(page, {
    projects: [{ ...older, previewAssetId: "existing-cover" }, newer],
  });
  await page.route("**/api/assets/existing-cover/preview?size=640", (route) =>
    route.fulfill({
      contentType: "image/svg+xml",
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360"><rect width="640" height="360" fill="#91aaa0"/></svg>',
    }),
  );
  await openHome(page);
  await canvases(page);
  await selectProject(page, older.id);
  await expect
    .poll(() =>
      inspector(page)
        .locator('img[data-project-cover="result"]')
        .evaluate((e) => (e as HTMLImageElement).naturalWidth),
    )
    .toBe(640);
  await expect(
    inspector(page).locator('[data-project-cover="decoration"]'),
  ).toHaveCount(0);
  await selectProject(page, newer.id);
  const cover = inspector(page).locator('[data-project-cover="decoration"]'),
    palette = await cover.getAttribute("data-cover-palette");
  expect(palette).toBeTruthy();
  await page.getByLabel("画布排序").selectOption("name");
  await expect(cover).toHaveAttribute("data-cover-palette", palette!);
  await page.getByLabel("搜索画布", { exact: true }).fill("秋日");
  await expect(cover).toHaveAttribute("data-cover-palette", palette!);
  f.assertSafe();
});
test("没有完整节点统计时留空，不把缺字段显示成零", async ({ page }) => {
  const f = await installNeuralFixture(page, {
    projects: [{ ...older, nodeCount: undefined }, newer],
  });
  await openHome(page);
  const total = page.locator('[data-workspace-stat="nodes"]');
  if (await total.count()) await expect(total).toContainText("—");
  await canvases(page);
  await expect(rows(page)).toHaveCount(2);
  await expect(row(page, older.id)).not.toContainText("0 个节点");
  await expect(row(page, newer.id)).toContainText("12");
  expect(f.mutations).toEqual([]);
  expect(f.canvasReads).toEqual([]);
  f.assertSafe();
});
test("操作完成提示四秒后消失，操作按钮仍可用", async ({ page }) => {
  const f = await installNeuralFixture(page, { projects: [older] });
  await openHome(page);
  await canvases(page);
  await action(page, older.id, "重命名");
  const dialog = page.getByRole("dialog", { name: "重命名画布" });
  await dialog.getByLabel("画布名称").fill("新的创作名称");
  await dialog.getByRole("button", { name: "保存名称", exact: true }).click();
  const notice = page.getByRole("status").filter({ hasText: "画布已重命名" });
  await expect(notice).toBeVisible();
  await expect(notice).toHaveCount(0, { timeout: 6000 });
  await expect(
    inspector(page).getByRole("button", { name: "重命名", exact: true }),
  ).toBeEnabled();
  f.assertSafe();
});
test("斜杠、Ctrl+F 和 Ctrl+K 聚焦搜索，输入和弹窗保留自己的按键", async ({
  page,
}) => {
  const f = await installNeuralFixture(page, { projects: [older, newer] });
  await openHome(page);
  await canvases(page);
  const search = page.getByLabel("搜索画布", { exact: true });
  await page.getByTestId("workspace-settings").focus();
  await page.keyboard.press("/");
  await expect(search).toBeFocused();
  await search.fill("秋日");
  await page.keyboard.press("/");
  await expect(search).toHaveValue("秋日/");
  for (const shortcut of ["Control+f", "Control+k"]) {
    await page.getByTestId("workspace-settings").focus();
    await page.keyboard.press(shortcut);
    await expect(search).toBeFocused();
  }
  await page.getByTestId("new-project").click();
  const title = page
    .getByRole("dialog", { name: "创建新画布" })
    .getByLabel("画布名称");
  await expect(title).toBeFocused();
  await page.keyboard.press("Control+k");
  await expect(title).toBeFocused();
  expect(f.mutations).toEqual([]);
  f.assertSafe();
});
for (const title of ["做活动海报", "修改客户原图", "制作多尺寸物料"]) {
  test(`已有同名任务时仍可再次开始：${title}`, async ({ page }) => {
    const f = await installNeuralFixture(page, {
      projects: [
        { ...older, title },
        { ...newer, title: `${title} 2` },
      ],
    });
    await openHome(page);
    await clickWorkspaceModule(page, "starts");
    await page
      .getByTestId(
        `neural-item-${({ 做活动海报: "event-poster", 修改客户原图: "revise", 制作多尺寸物料: "event-material" } as Record<string, string>)[title]}`,
      )
      .click();
    await page.getByRole("button", { name: title, exact: true }).click();
    await expect(
      page.getByRole("dialog", { name: "平面设计", exact: true }),
    ).toBeVisible();
    expect(f.createdTitles).toEqual([`${title} 3`]);
    await expect(page).toHaveURL(/\/canvas\/neural-created-1$/u);
    f.assertSafe();
  });
}
test("设计任务入口创建项目后直接打开工作台", async ({ page }) => {
  const f = await installNeuralFixture(page, { projects: [] });
  await openHome(page);
  await clickWorkspaceModule(page, "starts");
  await page.getByTestId("neural-item-event-poster").click();
  await page.getByRole("button", { name: "做活动海报", exact: true }).click();
  await expect(
    page.getByRole("dialog", { name: "平面设计", exact: true }),
  ).toBeVisible();
  await expect(page).toHaveURL(/\/canvas\/neural-created-1$/u);
  f.assertSafe();
});
test("刷新后保留显示与排序偏好，已有作品优先展示", async ({ page }) => {
  const f = await installNeuralFixture(page, { projects: [older, newer] });
  await openHome(page);
  await canvases(page);
  await expect(rows(page)).toHaveCount(2);
  await page.getByRole("button", { name: "列表视图", exact: true }).click();
  await page.getByLabel("画布排序").selectOption("name");
  await page.reload();
  await expect(home(page)).toBeVisible();
  await canvases(page);
  await expect(
    page.getByRole("button", { name: "列表视图", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByLabel("画布排序")).toHaveValue("name");
  await expect(rows(page).first()).toHaveAccessibleName(older.title);
  f.assertSafe();
});
test("重命名后迟到的焦点刷新不会恢复旧名称", async ({ page }) => {
  const f = await installNeuralFixture(page, { projects: [older, newer] });
  await openHome(page);
  await canvases(page);
  await expect(rows(page)).toHaveCount(2);
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  let started = false;
  await page.route("**/api/projects", async (route) => {
    if (route.request().method() !== "GET") return route.fallback();
    started = true;
    await pending;
    return route.fulfill({ json: { projects: [older, newer] } });
  });
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect.poll(() => started).toBe(true);
  await action(page, older.id, "重命名");
  const dialog = page.getByRole("dialog", { name: "重命名画布" });
  await dialog.getByLabel("画布名称").fill("已保存的新名称");
  await dialog.getByRole("button", { name: "保存名称" }).click();
  await expect(row(page, older.id)).toHaveAccessibleName("已保存的新名称");
  const response = page.waitForResponse(
    (r) => new URL(r.url()).pathname === "/api/projects",
  );
  release();
  await response;
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
  await expect(row(page, older.id)).toHaveAccessibleName("已保存的新名称");
  f.assertSafe();
});
test("空库保持只读，主动创建后进入独立画布地址", async ({ page }) => {
  const f = await installNeuralFixture(page, { projects: [] });
  await openHome(page);
  await expect(page.getByTestId("neural-module-canvases")).toContainText("0");
  expect(f.mutations).toEqual([]);
  expect(f.canvasReads).toEqual([]);
  await expect(page.locator(".react-flow")).toHaveCount(0);
  await page.getByTestId("new-project").click();
  const dialog = page.getByRole("dialog", { name: "创建新画布" });
  await dialog.getByLabel("画布名称").fill("我的第一张灵感画布");
  await dialog.getByRole("button", { name: "创建并打开" }).click();
  await expect(page).toHaveURL(/\/canvas\/neural-created-1$/u);
  expect(f.mutations).toContain("POST /api/projects");
  f.assertSafe();
});
test("近期排序、搜索、重命名与重复名称错误可见", async ({ page }) => {
  const f = await installNeuralFixture(page, {
    projects: [older, { ...newer, previewAssetId: "missing-cover" }],
  });
  await openHome(page);
  await canvases(page);
  await expect(rows(page)).toHaveCount(2);
  await expect(rows(page).first()).toHaveAccessibleName(newer.title);
  expect(f.canvasReads).toEqual([]);
  await page.getByLabel("搜索画布", { exact: true }).fill("品牌");
  await expect(rows(page)).toHaveCount(1);
  await page.getByLabel("搜索画布", { exact: true }).fill("");
  await page.getByLabel("画布排序").selectOption("name");
  await expect(rows(page).first()).toHaveAccessibleName(older.title);
  await action(page, older.id, "重命名");
  const rename = page.getByRole("dialog", { name: "重命名画布" });
  await rename.getByLabel("画布名称").fill("品牌视觉定稿");
  await rename.getByRole("button", { name: "保存名称" }).click();
  await expect(row(page, older.id)).toHaveAccessibleName("品牌视觉定稿");
  await page.getByTestId("new-project").click();
  const create = page.getByRole("dialog", { name: "创建新画布" });
  await create.getByLabel("画布名称").fill(newer.title);
  await create.getByRole("button", { name: "创建并打开" }).click();
  await expect(create.getByRole("alert")).toContainText("项目名称已存在");
  await expect(page).toHaveURL(/\/$/u);
  await create.getByLabel("画布名称").fill("重试后成功创建");
  await create.getByRole("button", { name: "创建并打开" }).click();
  await expect(page).toHaveURL(/\/canvas\/neural-created-1$/u);
  f.assertSafe();
});
test("预览读取失败显示稳定装饰封面，重命名的中文候选确认不提交", async ({
  page,
}) => {
  const f = await installNeuralFixture(page, {
    projects: [{ ...older, previewAssetId: "missing-cover" }],
    motion: false,
  });
  await openHome(page);
  await canvases(page);
  await selectProject(page, older.id);
  const cover = inspector(page).locator('[data-project-cover="decoration"]');
  await expect(cover).toBeVisible();
  expect(await cover.getAttribute("data-cover-palette")).toBeTruthy();
  await inspector(page)
    .getByRole("button", { name: "重命名", exact: true })
    .click();
  const dialog = page.getByRole("dialog", { name: "重命名画布" }),
    input = dialog.getByLabel("画布名称");
  await input.fill("中文项目名称");
  await input.dispatchEvent("compositionstart");
  await input.dispatchEvent("keydown", {
    key: "Enter",
    code: "Enter",
    isComposing: true,
  });
  await expect(dialog).toBeVisible();
  expect(f.mutations).toEqual([]);
  await input.dispatchEvent("compositionend", { data: "中文项目名称" });
  await input.press("Enter");
  await expect(dialog).toHaveCount(0);
  expect(f.mutations).toEqual(["PATCH /api/projects/home-older"]);
  await expect(row(page, older.id)).toHaveAccessibleName("中文项目名称");
  f.assertSafe();
});
test("删除需确认，最后一张画布也能删除回到空态", async ({ page }) => {
  const f = await installNeuralFixture(page, { projects: [older] });
  await openHome(page);
  await canvases(page);
  await action(page, older.id, "删除画布");
  let dialog = page.getByRole("dialog", { name: "删除画布" });
  await expect(dialog).toContainText("此操作无法撤销");
  await dialog.getByRole("button", { name: "取消", exact: true }).click();
  expect(f.mutations).toEqual([]);
  await inspector(page)
    .getByRole("button", { name: "删除画布", exact: true })
    .click();
  dialog = page.getByRole("dialog", { name: "删除画布" });
  await dialog.getByRole("button", { name: "确认删除" }).click();
  await expect(rows(page)).toHaveCount(0);
  expect(f.mutations).toEqual(["DELETE /api/projects/home-older"]);
  f.assertSafe();
});
test("窄屏可创建查找画布，无横向溢出", async ({ page }, info) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const f = await installNeuralFixture(page, {
    projects: [older, newer],
    motion: false,
  });
  await openHome(page);
  await expect(page.getByTestId("new-project")).toBeVisible();
  await expect(page.getByTestId("workspace-settings")).toBeVisible();
  await canvases(page);
  await expect(rows(page)).toHaveCount(2);
  await readable(page);
  await page.screenshot({ path: info.outputPath("workspace-home-mobile.png") });
  await page.getByLabel("搜索画布", { exact: true }).fill("不存在的画布");
  await expect(rows(page)).toHaveCount(0);
  f.assertSafe();
});
test("条目键盘打开分析面板，取消或关闭弹窗恢复操作焦点", async ({ page }) => {
  const f = await installNeuralFixture(page, {
    projects: [older],
    motion: false,
  });
  await openHome(page);
  await canvases(page);
  const entry = row(page, older.id).getByRole("button").first();
  await entry.focus();
  await entry.press("Enter");
  const rename = inspector(page).getByRole("button", {
    name: "重命名",
    exact: true,
  });
  await rename.focus();
  await rename.press("Enter");
  const dialog = page.getByRole("dialog", { name: "重命名画布" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "关闭弹窗", exact: true }).click();
  await expect(rename).toBeFocused();
  const remove = inspector(page).getByRole("button", {
    name: "删除画布",
    exact: true,
  });
  await remove.click();
  await page
    .getByRole("dialog", { name: "删除画布" })
    .getByRole("button", { name: "取消", exact: true })
    .click();
  await expect(remove).toBeFocused();
  await rename.click();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(rename).toBeFocused();
  expect(f.mutations).toEqual([]);
  f.assertSafe();
});
test("底部条目滚动后分析操作保持在窗口内，调整窗口后仍可用", async ({
  page,
}) => {
  const f = await installNeuralFixture(page, {
    projects: Array.from({ length: 24 }, (_, i) => ({
      ...older,
      id: `boundary-${i}`,
      title: `边界画布 ${i}`,
    })),
    motion: false,
  });
  await page.setViewportSize({ width: 1280, height: 720 });
  await openHome(page);
  await canvases(page);
  const entry = row(page, "boundary-23");
  await entry.scrollIntoViewIfNeeded();
  await entry.click();
  const rename = inspector(page).getByRole("button", {
    name: "重命名",
    exact: true,
  });
  await expect(rename).toBeInViewport({ ratio: 1 });
  await page.setViewportSize({ width: 1280, height: 1040 });
  await expect(rename).toBeInViewport({ ratio: 1 });
  await page.keyboard.press("Escape");
  await expect(inspector(page)).toHaveCount(0);
  expect(f.mutations).toEqual([]);
  f.assertSafe();
});
test("焦点可见，减少动态效果时仍能用键盘打开画布", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const f = await installNeuralFixture(page, { projects: [older] });
  await openHome(page);
  await canvases(page);
  const entry = row(page, older.id).getByRole("button").first();
  await page.keyboard.press("Tab");
  await entry.focus();
  await expect(entry).toBeFocused();
  expect(
    await entry.evaluate((e) => getComputedStyle(e).outlineStyle),
  ).not.toBe("none");
  await entry.press("Enter");
  const open = inspector(page).getByRole("button", {
    name: "打开画布",
    exact: true,
  });
  await open.focus();
  await open.press("Enter");
  await expect(page).toHaveURL(/\/canvas\/home-older$/u);
  f.assertSafe();
});
test("设置分类方向键探索与 Enter 激活保留未保存草稿", async ({ page }) => {
  const f = await installNeuralFixture(page, { projects: [] });
  await openHome(page);
  await page.getByTestId("workspace-settings").click();
  const settings = page.getByRole("dialog", {
    name: "供应商与模型设置",
    exact: true,
  });
  const suppliers = settings.getByRole("tab", {
      name: "供应商与模型",
      exact: true,
    }),
    personal = settings.getByRole("tab", { name: "个人 AI 网站", exact: true }),
    cloud = settings.getByRole("tab", { name: "云端生图", exact: true }),
    appearance = settings.getByRole("tab", { name: "外观", exact: true });
  await expect(suppliers).toBeFocused();
  await expect(settings.locator('[role="tab"][tabindex="0"]')).toHaveCount(1);
  await suppliers.press("ArrowRight");
  await expect(personal).toBeFocused();
  await expect(suppliers).toHaveAttribute("aria-selected", "true");
  await personal.press("Enter");
  await expect(personal).toHaveAttribute("aria-selected", "true");
  const name = settings.getByLabel("连接名称", { exact: true });
  await expect(name).toBeEnabled();
  await name.fill("未保存的个人网站");
  await personal.focus();
  await personal.press("End");
  await expect(appearance).toBeFocused();
  await appearance.press("ArrowLeft");
  await expect(cloud).toBeFocused();
  await expect(name).toHaveValue("未保存的个人网站");
  page.once("dialog", (dialog) => dialog.dismiss());
  await cloud.press("Enter");
  await expect(personal).toHaveAttribute("aria-selected", "true");
  await expect(name).toHaveValue("未保存的个人网站");
  await cloud.press("Home");
  await expect(suppliers).toBeFocused();
  await suppliers.press("ArrowLeft");
  await expect(appearance).toBeFocused();
  expect(f.mutations).toEqual([]);
  f.assertSafe();
});
test("普通窗口最大化还原保持文字、控件与排序", async ({ page }, info) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const f = await installNeuralFixture(page, { projects: [older, newer] });
  await openHome(page);
  await canvases(page);
  await page.getByLabel("画布排序").selectOption("name");
  for (const viewport of [
    { width: 1280, height: 800 },
    { width: 1920, height: 1080 },
    { width: 2539, height: 1329 },
    { width: 1280, height: 800 },
  ]) {
    await page.setViewportSize(viewport);
    await readable(page);
    await expect(page.getByLabel("画布排序")).toHaveValue("name");
    await expect(rows(page).first()).toHaveAccessibleName(older.title);
    await page.screenshot({
      path: info.outputPath(`workspace-neural-${viewport.width}.png`),
    });
  }
  expect(f.mutations).toEqual([]);
  expect(f.canvasReads).toEqual([]);
  f.assertSafe();
});
test("切换显示偏好保留搜索、排序与进入画布行为", async ({ page }) => {
  const f = await installNeuralFixture(page, { projects: [older, newer] });
  await openHome(page);
  await canvases(page);
  const grid = page.getByRole("button", { name: "网格视图", exact: true }),
    list = page.getByRole("button", { name: "列表视图", exact: true });
  await expect(grid).toHaveAttribute("aria-pressed", "true");
  await expect(list).toHaveAttribute("aria-pressed", "false");
  await list.click();
  await expect(list).toHaveAttribute("aria-pressed", "true");
  await expect(grid).toHaveAttribute("aria-pressed", "false");
  await page.getByLabel("画布排序").selectOption("name");
  await page.getByLabel("搜索画布", { exact: true }).fill("秋日");
  await expect(rows(page)).toHaveCount(1);
  await expect(rows(page).first()).toHaveAccessibleName(newer.title);
  await expect(rows(page).first()).toContainText("12");
  await grid.click();
  await expect(grid).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByLabel("搜索画布", { exact: true })).toHaveValue(
    "秋日",
  );
  await expect(page.getByLabel("画布排序")).toHaveValue("name");
  await page.getByLabel("搜索画布", { exact: true }).fill("");
  await expect(rows(page)).toHaveCount(2);
  await expect(rows(page).first()).toHaveAccessibleName(older.title);
  expect(f.mutations).toEqual([]);
  expect(f.canvasReads).toEqual([]);
  await action(page, older.id, "打开画布");
  await expect(page).toHaveURL(/\/canvas\/home-older$/u);
  await expect.poll(() => f.canvasReads).toContain("/api/canvas/home-older");
  f.assertSafe();
});
test("轨迹复用场景，搜索焦点不受鼠标影响，隐藏时暂停", async ({
  page,
}) => {
  const f = await installNeuralFixture(page, { projects: [older, newer] });
  await openHome(page);
  await expect(page.locator('canvas[class*="pointerTrail"]')).toHaveCount(0);
  await expect(scene(page)).toHaveAttribute("data-animating", "true");
  const search = page.getByTestId("graph-search");
  await search.focus();
  for (const x of [330, 400, 495]) await page.mouse.move(x, 202);
  await expect(search).toBeFocused();
  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", {
      configurable: true,
      value: true,
    });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect(scene(page)).toHaveAttribute("data-animating", "false");
  await page.evaluate(() => {
    Reflect.deleteProperty(document, "hidden");
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect(scene(page)).toHaveAttribute("data-animating", "true");
  expect(f.mutations).toEqual([]);
  f.assertSafe();
});
test("动效暂停刷新后保留，并遵循系统减少动态效果", async ({ page }) => {
  const f = await installNeuralFixture(page, { projects: [], motion: true });
  await openHome(page);
  await expect(scene(page)).toHaveAttribute("data-animating", "true");
  await page.getByRole("button", { name: "暂停动效" }).click();
  await expect(scene(page)).toHaveAttribute("data-animating", "false");
  expect(
    await page.evaluate(() =>
      localStorage.getItem("super-canvas:gentle-motion"),
    ),
  ).toBe("off");
  await page.reload();
  await expect(scene(page)).toHaveAttribute("data-animating", "false");
  await page.getByRole("button", { name: "开启动效" }).click();
  await expect(scene(page)).toHaveAttribute("data-animating", "true");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(scene(page)).toHaveAttribute("data-animating", "false");
  expect(
    await page.evaluate(() =>
      localStorage.getItem("super-canvas:gentle-motion"),
    ),
  ).toBe("on");
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await expect(scene(page)).toHaveAttribute("data-animating", "true");
  f.assertSafe();
});
