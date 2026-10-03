import { expect, test, type Page } from "@playwright/test";

interface HomeProject {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  nodeCount: number;
  previewAssetId?: string;
}

const older: HomeProject = {
  id: "home-older",
  title: "品牌视觉探索",
  nodeCount: 8,
  createdAt: "2026-09-01T08:00:00.000Z",
  updatedAt: "2026-09-02T08:00:00.000Z",
};

test("首页设计任务入口创建项目后直接打开工作台", async ({ page }) => {
  await mockWorkspace(page, []);
  await page.goto("/");
  await page.getByRole("button", { name: "做活动海报", exact: true }).click();
  await expect(
    page.getByRole("dialog", { name: "平面设计", exact: true }),
  ).toBeVisible();
  await expect(page).toHaveURL(/\/canvas\/home-created$/u);
});
const newer: HomeProject = {
  id: "home-newer",
  title: "秋日视频分镜",
  nodeCount: 12,
  createdAt: "2026-09-03T08:00:00.000Z",
  updatedAt: "2026-09-04T08:00:00.000Z",
};

/** Every application API is mocked: these tests cannot access user data or run models. */
async function mockWorkspace(page: Page, initial: HomeProject[]) {
  let projects = structuredClone(initial);
  const mutations: string[] = [];
  const canvasReads: string[] = [];
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;
    const method = request.method();
    if (method !== "GET") mutations.push(`${method} ${pathname}`);
    if (pathname === "/api/projects") {
      if (method === "GET") return route.fulfill({ json: { projects } });
      const { title } = request.postDataJSON() as { title: string };
      if (projects.some((project) => project.title === title))
        return route.fulfill({
          status: 409,
          json: { error: "项目名称已存在，请换一个名称" },
        });
      const project: HomeProject = {
        ...newer,
        id: "home-created",
        title,
        nodeCount: 0,
      };
      projects.push(project);
      return route.fulfill({ status: 201, json: { project } });
    }
    if (pathname.startsWith("/api/projects/")) {
      const id = pathname.split("/")[3];
      if (method === "PATCH") {
        const { title } = request.postDataJSON() as { title: string };
        projects = projects.map((project) =>
          project.id === id ? { ...project, title } : project,
        );
        return route.fulfill({
          json: {
            project: projects.find((project) => project.id === id),
            revision: 2,
            folderRenamed: true,
          },
        });
      }
      if (method === "DELETE") {
        projects = projects.filter((project) => project.id !== id);
        return route.fulfill({
          json: {
            deleted: true,
            nextProjectId: projects[0]?.id ?? null,
            folderDeleted: true,
          },
        });
      }
      return route.fulfill({ json: { messages: [], opened: true } });
    }
    if (pathname.startsWith("/api/canvas/")) {
      const id = pathname.split("/").pop();
      if (method === "GET") canvasReads.push(pathname);
      const project = projects.find((item) => item.id === id);
      if (!project)
        return route.fulfill({ status: 404, json: { error: "画布不存在" } });
      return route.fulfill({
        json: {
          id,
          title: project.title,
          revision: 1,
          graph: {
            schemaVersion: 1,
            nodes: [],
            edges: [],
            viewport: { x: 0, y: 0, zoom: 0.85 },
          },
        },
      });
    }
    if (
      pathname === "/api/assets" ||
      pathname === "/api/providers" ||
      pathname === "/api/agent/models" ||
      pathname === "/api/agent/sessions"
    )
      return route.fulfill({ json: [] });
    if (pathname.includes("/preview"))
      return route.fulfill({
        status: 404,
        json: { error: "Missing fixture preview" },
      });
    return route.fulfill({
      json: { groups: [], items: [], runs: [], drops: [] },
    });
  });
  return { mutations, canvasReads };
}

async function expectReadableWorkspace(page: Page, viewportWidth: number) {
  const main = page.getByRole("main");
  const projects = page.getByRole("region", { name: "我的画布", exact: true });
  for (const [label, area] of [
    ["首页主体", main],
    ["画布列表", projects],
  ] as const) {
    const bounds = await area.boundingBox();
    expect(bounds, `${label}应有可见布局`).not.toBeNull();
    expect(bounds!.x, `${label}左侧不应越界`).toBeGreaterThanOrEqual(0);
    expect(bounds!.x, `${label}左侧不应保留固定宽度空白`).toBeLessThanOrEqual(
      100,
    );
    const rightMargin = viewportWidth - bounds!.x - bounds!.width;
    expect(rightMargin, `${label}右侧不应越界`).toBeGreaterThanOrEqual(-1);
    expect(rightMargin, `${label}右侧不应保留固定宽度空白`).toBeLessThanOrEqual(
      100,
    );
    expect(
      await area.evaluate(
        (element) => element.scrollWidth - element.clientWidth,
      ),
      `${label}不应横向溢出`,
    ).toBeLessThanOrEqual(1);
  }

  const header = page.getByRole("banner");
  const brand = header.getByRole("link", { name: /首页$/u });
  const brandText = brand.locator('[class*="brandText"]');
  const headerActions = header.locator('[class*="headerActions"]');
  const capabilities = page.locator('[aria-label="按设计任务开始"]');
  // These checks catch markup shipped without its matching CSS module rules.
  await expect(brandText).toHaveCSS("display", "grid");
  await expect(headerActions).toHaveCSS("display", "flex");
  await expect(capabilities).toHaveCSS("display", "flex");
  const brandBounds = await brand.boundingBox();
  const actionsBounds = await headerActions.boundingBox();
  expect(brandBounds).not.toBeNull();
  expect(actionsBounds).not.toBeNull();
  expect(
    brandBounds!.x + brandBounds!.width <= actionsBounds!.x ||
      brandBounds!.y + brandBounds!.height <= actionsBounds!.y,
    "品牌与右侧操作区不应重叠",
  ).toBe(true);
  expect(actionsBounds!.x + actionsBounds!.width).toBeLessThanOrEqual(
    viewportWidth,
  );

  const eyebrow = main.locator('[class*="eyebrow"]').filter({
    has: page.getByText("灵感无界 · 创作不止", { exact: true }),
  });
  const eyebrowText = eyebrow.getByText("灵感无界 · 创作不止", { exact: true });
  const lineCount = await eyebrowText.evaluate((element) => {
    const range = document.createRange();
    range.selectNodeContents(element);
    return range.getClientRects().length;
  });
  expect(lineCount, "标题上方文字应保持单行，不应被挤成竖排").toBe(1);
  const eyebrowBounds = await eyebrow.boundingBox();
  const headingBounds = await page
    .getByRole("heading", { level: 1 })
    .boundingBox();
  expect(eyebrowBounds).not.toBeNull();
  expect(headingBounds).not.toBeNull();
  expect(eyebrowBounds!.y + eyebrowBounds!.height).toBeLessThanOrEqual(
    headingBounds!.y,
  );

  const readableText = page.locator(
    [
      'main [class*="heroDescription"]',
      'main [class*="capabilities"] > span',
      'header [class*="settingsButton"]',
      'main [class*="primaryButton"]',
      'main [class*="continueLink"]',
      'main [class*="sectionHeadingCopy"] > p',
      'input[aria-label="搜索画布"]',
      'select[aria-label="画布排序"]',
      "article h3",
      'article [class*="cardMeta"] > span',
    ].join(", "),
  );
  const sizes = await readableText.evaluateAll((elements) =>
    elements
      .filter((element) => element.getClientRects().length > 0)
      .map((element) => ({
        text: element.textContent?.trim() || element.getAttribute("aria-label"),
        size: Number.parseFloat(getComputedStyle(element).fontSize),
      })),
  );
  expect(sizes.length).toBeGreaterThan(10);
  for (const { text, size } of sizes) {
    expect(size, `“${text}”的正文或控件字号不应过小`).toBeGreaterThanOrEqual(
      12,
    );
  }
}

test.describe("画布工作台", () => {
  test("首页保持空库，主动创建后进入独立画布地址", async ({ page }) => {
    const state = await mockWorkspace(page, []);
    await page.goto("/");
    await expect(
      page.getByRole("heading", { name: "你的创作空间，已准备就绪" }),
    ).toBeVisible();
    expect(state.mutations).toEqual([]);
    expect(state.canvasReads).toEqual([]);
    await expect(page.locator(".react-flow")).toHaveCount(0);
    await page.getByRole("button", { name: "创建画布", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "创建新画布" });
    await dialog.getByLabel("画布名称").fill("我的第一张灵感画布");
    await dialog.getByRole("button", { name: "创建并打开" }).click();
    await expect(page).toHaveURL(/\/canvas\/home-created$/u);
    expect(state.mutations).toContain("POST /api/projects");
  });

  test("近期排序、搜索、重命名与重复名称错误可见", async ({
    page,
  }, testInfo) => {
    const state = await mockWorkspace(page, [
      older,
      { ...newer, previewAssetId: "missing-cover" },
    ]);
    await page.goto("/");
    await expect(page.getByRole("article")).toHaveCount(2);
    await expect(page.getByRole("article").first()).toHaveAccessibleName(
      newer.title,
    );
    const firstCard = await page.getByRole("article").first().boundingBox();
    expect(firstCard).not.toBeNull();
    expect(firstCard!.y + firstCard!.height).toBeLessThanOrEqual(720);
    expect(state.canvasReads).toEqual([]);
    await page.screenshot({
      path: testInfo.outputPath("workspace-home-desktop.png"),
      fullPage: true,
    });
    await page.getByLabel("搜索画布", { exact: true }).fill("品牌");
    await expect(page.getByRole("article")).toHaveCount(1);
    await page.getByRole("button", { name: "清空搜索" }).click();
    await page.getByLabel("画布排序").selectOption("name");
    await expect(page.getByRole("article").first()).toHaveAccessibleName(
      older.title,
    );
    await page
      .getByRole("button", { name: `${older.title} 的画布操作` })
      .click();
    await page.getByRole("menuitem", { name: "重命名", exact: true }).click();
    const rename = page.getByRole("dialog", { name: "重命名画布" });
    await rename.getByLabel("画布名称").fill("品牌视觉定稿");
    await rename.getByRole("button", { name: "保存名称" }).click();
    await expect(
      page.getByRole("article", { name: "品牌视觉定稿", exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "创建画布", exact: true }).click();
    const create = page.getByRole("dialog", { name: "创建新画布" });
    await create.getByLabel("画布名称").fill(newer.title);
    await create.getByRole("button", { name: "创建并打开" }).click();
    await expect(create.getByRole("alert")).toContainText("项目名称已存在");
    await expect(page).toHaveURL(/\/$/u);
  });

  test("删除需确认，最后一张画布也能删除回到空态", async ({ page }) => {
    const state = await mockWorkspace(page, [older]);
    await page.goto("/");
    await page
      .getByRole("button", { name: `${older.title} 的画布操作` })
      .click();
    await page.getByRole("menuitem", { name: "删除画布", exact: true }).click();
    let dialog = page.getByRole("dialog", { name: "删除画布" });
    await expect(dialog).toContainText("此操作无法撤销");
    await dialog.getByRole("button", { name: "取消", exact: true }).click();
    expect(state.mutations).toEqual([]);
    await page
      .getByRole("button", { name: `${older.title} 的画布操作` })
      .click();
    await page.getByRole("menuitem", { name: "删除画布", exact: true }).click();
    dialog = page.getByRole("dialog", { name: "删除画布" });
    await dialog.getByRole("button", { name: "确认删除" }).click();
    await expect(page.getByRole("article")).toHaveCount(0);
    await expect(
      page.getByRole("heading", { name: "你的创作空间，已准备就绪" }),
    ).toBeVisible();
    expect(state.mutations).toEqual(["DELETE /api/projects/home-older"]);
  });

  test("窄屏可创建和查找画布，页面没有横向溢出", async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await mockWorkspace(page, [older, newer]);
    await page.goto("/");
    await expect(page.getByRole("article")).toHaveCount(2);
    await expect(
      page.getByRole("button", { name: "创建画布", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "供应商与模型" }),
    ).toBeVisible();
    expect(
      await page.locator("main").evaluate((element) => element.scrollWidth),
    ).toBeLessThanOrEqual(390);
    await page.screenshot({
      path: testInfo.outputPath("workspace-home-mobile.png"),
      fullPage: true,
    });
    await expectReadableWorkspace(page, 390);
    await page.getByLabel("搜索画布", { exact: true }).fill("不存在的画布");
    await expect(
      page.getByRole("heading", { name: "没有找到匹配的画布" }),
    ).toBeVisible();
  });

  test("菜单键盘打开弹窗后，取消和关闭恢复画布操作按钮焦点", async ({
    page,
  }) => {
    const state = await mockWorkspace(page, [older]);
    await page.goto("/");
    const trigger = page.getByRole("button", {
      name: `${older.title} 的画布操作`,
    });
    await trigger.focus();
    await trigger.press("ArrowDown");
    const renameAction = page.getByRole("menuitem", {
      name: "重命名",
      exact: true,
    });
    await expect(renameAction).toBeFocused();
    await renameAction.press("Enter");
    const renameDialog = page.getByRole("dialog", { name: "重命名画布" });
    await expect(renameDialog).toBeVisible();
    await renameDialog
      .getByRole("button", { name: "关闭弹窗", exact: true })
      .click();
    await expect(renameDialog).toHaveCount(0);
    await expect(trigger).toBeFocused();

    await trigger.press("ArrowUp");
    const deleteAction = page.getByRole("menuitem", {
      name: "删除画布",
      exact: true,
    });
    await expect(deleteAction).toBeFocused();
    await deleteAction.press("Enter");
    const deleteDialog = page.getByRole("dialog", { name: "删除画布" });
    await expect(deleteDialog).toBeVisible();
    await deleteDialog
      .getByRole("button", { name: "取消", exact: true })
      .click();
    await expect(deleteDialog).toHaveCount(0);
    await expect(trigger).toBeFocused();

    await trigger.press("ArrowDown");
    await renameAction.press("Enter");
    await expect(renameDialog).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(renameDialog).toHaveCount(0);
    await expect(trigger).toBeFocused();
    expect(state.mutations).toEqual([]);
  });

  test("首页从普通窗口最大化再还原时展开布局，文字与控件保持清晰", async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    const state = await mockWorkspace(page, [older, newer]);
    await page.goto("/");
    await expect(page.getByRole("article")).toHaveCount(2);
    await page.getByLabel("画布排序").selectOption("name");

    for (const viewport of [
      { width: 1280, height: 800, name: "window" },
      { width: 1920, height: 1080, name: "maximized" },
      { width: 2539, height: 1329, name: "large-maximized" },
      { width: 1280, height: 800, name: "restored" },
    ]) {
      await test.step(`${viewport.name}: ${viewport.width}×${viewport.height}`, async () => {
        await page.setViewportSize({
          width: viewport.width,
          height: viewport.height,
        });
        await page.screenshot({
          path: testInfo.outputPath(
            `workspace-home-${viewport.width}-${viewport.name}.png`,
          ),
          fullPage: true,
        });
        await expectReadableWorkspace(page, viewport.width);
        await expect(page.getByLabel("画布排序")).toHaveValue("name");
        await expect(page.getByRole("article").first()).toHaveAccessibleName(
          older.title,
        );
      });
    }
    expect(state.mutations).toEqual([]);
    expect(state.canvasReads).toEqual([]);
  });

  test("切换列表与网格保留搜索、排序及画布链接", async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const state = await mockWorkspace(page, [older, newer]);
    await page.goto("/");
    const articles = page.getByRole("article");
    const gridView = page.getByRole("button", { name: "网格视图" });
    const listView = page.getByRole("button", { name: "列表视图" });
    await expect(articles).toHaveCount(2);
    await expect(gridView).toHaveAttribute("aria-pressed", "true");
    await expect(listView).toHaveAttribute("aria-pressed", "false");

    await listView.click();
    await expect(listView).toHaveAttribute("aria-pressed", "true");
    await expect(gridView).toHaveAttribute("aria-pressed", "false");
    await expect(articles.first()).toHaveAccessibleName(newer.title);
    const firstRow = await articles.nth(0).boundingBox();
    const secondRow = await articles.nth(1).boundingBox();
    expect(firstRow).not.toBeNull();
    expect(secondRow).not.toBeNull();
    expect(secondRow!.x).toBeCloseTo(firstRow!.x, 0);
    expect(secondRow!.width).toBeCloseTo(firstRow!.width, 0);
    expect(secondRow!.y).toBeGreaterThanOrEqual(firstRow!.y + firstRow!.height);
    await page.screenshot({
      path: testInfo.outputPath("workspace-home-list.png"),
      fullPage: true,
    });

    await page.getByLabel("画布排序").selectOption("name");
    await expect(articles.first()).toHaveAccessibleName(older.title);
    await page.getByLabel("搜索画布", { exact: true }).fill("秋日");
    await expect(articles).toHaveCount(1);
    await expect(articles.first()).toHaveAccessibleName(newer.title);
    await expect(articles.first()).toContainText("12 个节点");
    await expect(
      page.getByRole("link", { name: `打开画布 ${newer.title}`, exact: true }),
    ).toHaveAttribute("href", `/canvas/${newer.id}`);

    await gridView.click();
    await expect(gridView).toHaveAttribute("aria-pressed", "true");
    await expect(listView).toHaveAttribute("aria-pressed", "false");
    await expect(page.getByLabel("搜索画布", { exact: true })).toHaveValue(
      "秋日",
    );
    await expect(page.getByLabel("画布排序")).toHaveValue("name");
    await expect(articles).toHaveCount(1);
    await page.getByRole("button", { name: "清空搜索" }).click();
    await expect(articles).toHaveCount(2);
    await expect(articles.first()).toHaveAccessibleName(older.title);
    const firstTile = await articles.nth(0).boundingBox();
    const secondTile = await articles.nth(1).boundingBox();
    expect(firstTile).not.toBeNull();
    expect(secondTile).not.toBeNull();
    expect(secondTile!.y).toBeCloseTo(firstTile!.y, 0);
    expect(secondTile!.x).toBeGreaterThanOrEqual(
      firstTile!.x + firstTile!.width,
    );
    await page.screenshot({
      path: testInfo.outputPath("workspace-home-wide.png"),
      fullPage: true,
    });

    await listView.click();
    await expect(articles).toHaveCount(2);
    await expect(articles.first()).toContainText("8 个节点");
    const olderLink = page.getByRole("link", {
      name: `打开画布 ${older.title}`,
      exact: true,
    });
    await expect(olderLink).toHaveAttribute("href", `/canvas/${older.id}`);
    expect(state.mutations).toEqual([]);
    expect(state.canvasReads).toEqual([]);
    await olderLink.click();
    await expect(page).toHaveURL(/\/canvas\/home-older$/u);
    await expect
      .poll(() => state.canvasReads)
      .toContain("/api/canvas/home-older");
  });

  test("鼠标流光可见，滚动后仍跟随指针，并在停留、输入和弹窗时收起", async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width: 1280, height: 680 });
    await page.emulateMedia({ reducedMotion: "no-preference" });
    const state = await mockWorkspace(page, [older, newer]);
    await page.goto("/");
    await expect(page.getByRole("article")).toHaveCount(2);
    const trail = page.locator('canvas[class*="pointerTrail"]');
    const hasInkAtPointer = () =>
      trail.evaluate((element) => {
        const canvas = element as HTMLCanvasElement;
        const scale =
          canvas.width / (canvas.getBoundingClientRect().width || innerWidth);
        const pixels = canvas
          .getContext("2d")!
          .getImageData(
            Math.round(480 * scale),
            Math.round(190 * scale),
            Math.round(24 * scale),
            Math.round(24 * scale),
          ).data;
        return pixels.some((value, index) => index % 4 === 3 && value > 12);
      });
    const movePointer = async () => {
      await page.mouse.move(330, 202);
      // Distinct animation frames catch a trail that erases its first point too early.
      await page.waitForTimeout(35);
      await page.mouse.move(400, 202);
      await page.waitForTimeout(35);
      await page.mouse.move(495, 202);
    };
    await movePointer();
    await expect.poll(hasInkAtPointer).toBe(true);
    await page.screenshot({
      path: testInfo.outputPath("workspace-home-pointer.png"),
    });
    await expect.poll(hasInkAtPointer).toBe(false);

    const home = page.locator("div[data-motion]");
    await home.evaluate((element) => {
      element.scrollTop = 70;
    });
    await expect
      .poll(() => home.evaluate((element) => element.scrollTop))
      .toBeGreaterThan(0);
    await movePointer();
    await expect.poll(hasInkAtPointer).toBe(true);
    await page.getByLabel("搜索画布", { exact: true }).focus();
    await movePointer();
    expect(await hasInkAtPointer()).toBe(false);

    await page.getByRole("button", { name: "创建画布", exact: true }).click();
    await expect(
      page.getByRole("dialog", { name: "创建新画布" }),
    ).toBeVisible();
    await movePointer();
    expect(await hasInkAtPointer()).toBe(false);
    await page.getByRole("button", { name: "关闭弹窗" }).click();
    await page.getByRole("button", { name: "暂停动效" }).click();
    await movePointer();
    expect(await hasInkAtPointer()).toBe(false);
    await expect(trail).toBeHidden();
    expect(state.mutations).toEqual([]);
  });

  test("动效暂停在刷新后保留，并遵循系统减少动态效果设置", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.emulateMedia({ reducedMotion: "no-preference" });
    const state = await mockWorkspace(page, []);
    await page.goto("/");
    const home = page.locator("div[data-motion]");
    const aura = page.locator('[aria-hidden="true"][data-animating]');
    await expect(aura.locator("canvas")).toHaveCount(1);
    await expect(home).toHaveAttribute("data-motion", "on");
    await expect(aura).toHaveAttribute("data-animating", "true");
    await page.getByRole("button", { name: "暂停动效" }).click();
    await expect(home).toHaveAttribute("data-motion", "off");
    await expect(aura).toHaveAttribute("data-animating", "false");
    expect(
      await page.evaluate(() =>
        localStorage.getItem("super-canvas:gentle-motion"),
      ),
    ).toBe("off");

    await page.reload();
    await expect(home).toHaveAttribute("data-motion", "off");
    await expect(aura).toHaveAttribute("data-animating", "false");
    const enableMotion = page.getByRole("button", { name: "开启动效" });
    await expect(enableMotion).toHaveAttribute("aria-pressed", "false");
    await enableMotion.click();
    await expect(home).toHaveAttribute("data-motion", "on");
    await expect(aura).toHaveAttribute("data-animating", "true");
    await expect(
      page.getByRole("button", { name: "暂停动效" }),
    ).toHaveAttribute("aria-pressed", "true");

    await page.emulateMedia({ reducedMotion: "reduce" });
    await expect(home).toHaveAttribute("data-motion", "off");
    await expect(aura).toHaveAttribute("data-animating", "false");
    expect(
      await page.evaluate(() =>
        localStorage.getItem("super-canvas:gentle-motion"),
      ),
    ).toBe("on");
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await expect(home).toHaveAttribute("data-motion", "on");
    await expect(aura).toHaveAttribute("data-animating", "true");
    expect(state.mutations).toEqual([]);
    expect(state.canvasReads).toEqual([]);
  });
});
