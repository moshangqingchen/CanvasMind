import { expect, test, type Page } from "@playwright/test";

async function openHelp(page: Page) {
  await page.addInitScript(() => localStorage.setItem("super-canvas:inspector-open", "false"));
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.route("**/api/**", route => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/projects") return route.fulfill({ json: { projects: [{ id: "shortcuts-search", title: "快捷键隔离回归", nodeCount: 0, createdAt: "2026-10-15T00:00:00Z", updatedAt: "2026-10-15T00:00:00Z" }] } });
    if (path === "/api/canvas/shortcuts-search") return route.fulfill({ json: { id: "shortcuts-search", title: "快捷键隔离回归", revision: 1, graph: { schemaVersion: 1, nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 } } } });
    if (["/api/providers", "/api/suppliers", "/api/assets", "/api/runs", "/api/agent/models", "/api/agent/sessions", "/api/integrations/material-drops"].includes(path)) return route.fulfill({ json: [] });
    return route.fulfill({ json: { items: [], groups: [], messages: [], sessions: [], drops: [] } });
  });
  await page.goto("/canvas/shortcuts-search");
  await expect(page.getByRole("button", { name: "添加节点", exact: true })).toBeEnabled();
  await page.keyboard.press("Shift+/");
  const dialog = page.getByRole("dialog", { name: "键盘快捷键", exact: true });
  await expect(dialog).toBeVisible();
  return { dialog, errors };
}

test("快捷键可按中文分组与按键搜索、清除后保留搜索焦点，Esc说明符合逐层关闭", async ({ page }) => {
  const { dialog, errors } = await openHelp(page);
  const search = dialog.getByRole("textbox", { name: "搜索快捷键", exact: true });
  await search.fill("菜单");
  await expect(dialog.locator(".shortcuts-group")).toHaveCount(1);
  await expect(dialog.locator(".shortcuts-label")).toHaveText("逐层关闭菜单、面板或返回抓手模式");
  await expect(dialog.getByRole("status")).toHaveText("1 项操作");
  await dialog.getByRole("button", { name: "清除快捷键搜索", exact: true }).click();
  await expect(search).toHaveValue("");
  await expect(search).toBeFocused();
  expect(await search.evaluate(element => {
    const input = getComputedStyle(element), capsule = getComputedStyle(element.parentElement!);
    return { fieldBackground: input.backgroundColor, fieldBorder: input.borderTopWidth, capsuleFocus: capsule.outlineWidth };
  })).toEqual({ fieldBackground: "rgba(0, 0, 0, 0)", fieldBorder: "0px", capsuleFocus: "2px" });
  await expect(dialog.locator(".shortcuts-group")).toHaveCount(5);
  await search.fill("Ctrl+Shift");
  await expect(dialog.locator(".shortcuts-label")).toContainText(["从当前节点运行下游", "解组"]);
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  expect(errors).toEqual([]);
});

test("快捷键搜索不抢已处理或输入法CtrlF，普通CtrlF可定位，输入斜杠不被吞", async ({ page }) => {
  const { dialog, errors } = await openHelp(page);
  const search = dialog.getByRole("textbox", { name: "搜索快捷键", exact: true });
  const close = dialog.getByRole("button", { name: "关闭", exact: true });
  await close.focus();
  for (const inputMethod of [{ isComposing: true }, { keyCode: 229 }]) {
    await close.dispatchEvent("keydown", { key: "f", ctrlKey: true, bubbles: true, cancelable: true, ...inputMethod });
    await expect(close).toBeFocused();
  }
  await close.evaluate(element => {
    const event = new KeyboardEvent("keydown", { key: "f", ctrlKey: true, bubbles: true, cancelable: true });
    event.preventDefault(); element.dispatchEvent(event);
  });
  await expect(close).toBeFocused();
  await page.keyboard.press("Control+f");
  await expect(search).toBeFocused();
  await page.keyboard.type("/设计");
  await expect(search).toHaveValue("/设计");
  await expect(dialog.getByRole("status")).toHaveText("0 项操作");
  await expect(dialog.getByText("没有匹配的快捷键，请换个关键词。", { exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  expect(errors).toEqual([]);
});
