import { expect, test, type Page } from "@playwright/test";

async function openProject(page: Page) {
  const project = {
    id: "project-dialog-fixture", title: "弹窗测试项目", nodeCount: 0,
    createdAt: "2026-09-26T00:00:00.000Z", updatedAt: "2026-09-26T00:00:00.000Z",
  };
  const renames: string[] = [];
  // Mock every API, including mutations: this suite never changes user projects.
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path === "/api/projects") return route.fulfill({ json: { projects: [project] } });
    if (path === `/api/projects/${project.id}` && request.method() === "PATCH") {
      const { title } = request.postDataJSON() as { title: string };
      renames.push(title);
      project.title = title;
      return route.fulfill({ json: { project, revision: 2, folderRenamed: true } });
    }
    if (path.startsWith("/api/canvas/")) return route.fulfill({ json: {
      id: project.id, title: project.title, revision: 1,
      graph: { schemaVersion: 1, nodes: [], edges: [], drawings: [], viewport: { x: 0, y: 0, zoom: 1 } },
    } });
    if (["/api/assets", "/api/providers", "/api/runs", "/api/agent/models", "/api/agent/sessions"].includes(path))
      return route.fulfill({ json: [] });
    return route.fulfill({ json: { messages: [], sessions: [], groups: [], items: [], runs: [], drops: [] } });
  });
  await page.goto(`/canvas/${project.id}`);
  await page.getByRole("button", { name: "打开画布列表", exact: true }).click();
  await page.getByRole("tab", { name: /^项目/u }).click();
  const projectButton = page.locator(".project-row-main").filter({ hasText: project.title });
  await expect(projectButton).toBeVisible();
  return { projectButton, renames };
}

test("项目弹窗约束 Tab 焦点，Escape 关闭后返回项目入口", async ({ page }) => {
  const { projectButton } = await openProject(page);
  await projectButton.click({ button: "right" });
  await page.getByRole("menuitem", { name: "重命名项目" }).click();
  const dialog = page.getByRole("dialog", { name: "重命名项目", exact: true });
  await expect(dialog.getByRole("textbox")).toBeFocused();
  await dialog.getByRole("textbox").fill("新的项目名");
  const first = dialog.getByRole("button", { name: "关闭重命名项目窗口" });
  const last = dialog.getByRole("button", { name: "保存名称" });
  await last.focus();
  await page.keyboard.press("Tab");
  await expect(first).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(last).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(projectButton).toBeFocused();
});

test("重命名的中文候选确认不会提交，普通 Enter 仍保存", async ({ page }) => {
  const { projectButton, renames } = await openProject(page);
  await projectButton.click({ button: "right" });
  await page.getByRole("menuitem", { name: "重命名项目" }).click();
  const dialog = page.getByRole("dialog", { name: "重命名项目", exact: true });
  const input = dialog.getByRole("textbox");
  await input.fill("中文项目名称");
  await input.dispatchEvent("compositionstart");
  await input.dispatchEvent("keydown", { key: "Enter", code: "Enter", isComposing: true });
  await expect(input).toBeVisible();
  expect(renames).toEqual([]);
  await input.dispatchEvent("compositionend", { data: "中文项目名称" });
  await input.press("Enter");
  await expect(dialog).toHaveCount(0);
  expect(renames).toEqual(["中文项目名称"]);
});
