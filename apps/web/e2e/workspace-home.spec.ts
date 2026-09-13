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
    if (pathname === "/api/assets" || pathname === "/api/providers")
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
    await page.getByLabel("搜索画布", { exact: true }).fill("不存在的画布");
    await expect(
      page.getByRole("heading", { name: "没有找到匹配的画布" }),
    ).toBeVisible();
  });
});
