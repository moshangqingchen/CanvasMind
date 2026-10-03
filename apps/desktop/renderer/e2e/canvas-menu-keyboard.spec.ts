import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

async function openCanvas(page: Page, request: APIRequestContext, grouped = false, empty = false) {
  const response = await request.post("/api/canvas", { data: {
    title: "画布菜单键盘回归",
    graph: { schemaVersion: 1, viewport: { x: 0, y: 0, zoom: 1 }, edges: [], nodes: (empty ? [] : [0, 1]).map((index) => ({
      id: `prompt-${index}`, type: "workflow", position: { x: 100 + index * 350, y: 130 },
      style: { width: 300, height: 200 },
      data: { nodeType: "prompt", label: `灵感 ${index + 1}`, parts: [{ type: "text", text: "可编辑的灵感" }], inputs: [], outputs: [{ id: "text", kind: "text", label: "提示词" }],
        ...(grouped ? { canvasGroupId: "test-group", canvasGroupLabel: "创作组" } : {}),
      },
    })) },
  } });
  expect(response.ok()).toBeTruthy();
  const canvas = await response.json();
  await page.goto(`/canvas/${canvas.id}`);
  if (empty) await expect(page.locator(".canvas-welcome-mark")).toBeVisible();
  else await expect(page.locator(".node-card").first()).toBeVisible();
  const inspector = page.getByRole("button", { name: "智能体面板", exact: true });
  if (await inspector.getAttribute("aria-expanded") === "true") await inspector.click();
  return canvas.id as string;
}

test("右键菜单可用方向键操作，Escape 回收焦点，外部点击关闭", async ({ page, request }) => {
  await openCanvas(page, request);
  const node = page.locator('.react-flow__node[data-id="prompt-0"]');
  await node.focus();
  await node.locator(".node-title").click({ button: "right" });
  const menu = page.getByRole("menu", { name: "灵感 1 的操作", exact: true });
  const copy = menu.getByRole("menuitem", { name: "复制", exact: false }).first();
  const duplicate = menu.getByRole("menuitem", { name: "紧邻复制", exact: false });
  const remove = menu.getByRole("menuitem", { name: "删除节点", exact: false });
  await expect(copy).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(duplicate).toBeFocused();
  await page.keyboard.press("End");
  await expect(remove).toBeFocused();
  await page.keyboard.press("Home");
  await expect(copy).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(menu).toBeHidden();
  await expect(node).toBeFocused();
  await node.locator(".node-title").click({ button: "right" });
  await page.keyboard.press("Enter");
  await expect(menu).toBeHidden();
  await expect(node).toBeFocused();
  await node.locator(".node-title").click({ button: "right" });
  await page.getByRole("button", { name: "小地图", exact: true }).click();
  await expect(menu).toBeHidden();
});

test("撤销后立即编辑提示词会建立新分支并清除旧重做", async ({ page, request }) => {
  await openCanvas(page, request);
  // Keep Date.now in the same editing window while allowing timers to run,
  // so a slow test machine cannot hide the immediate-edit regression.
  await page.clock.setFixedTime(new Date("2026-10-03T08:00:00Z"));
  const editor = page.getByRole("textbox", { name: "编辑 灵感 1 提示词", exact: true });
  const undo = page.getByRole("button", { name: "撤销", exact: true });
  const redo = page.getByRole("button", { name: "重做", exact: true });
  await editor.fill("第一版文案");
  await editor.press("Control+s");
  await expect(undo).toBeEnabled();
  await undo.click();
  await expect(editor).toHaveText("可编辑的灵感");
  await expect(redo).toBeEnabled();
  await editor.fill("撤销后的新文案");
  await editor.press("Control+s");
  await expect(redo).toBeDisabled();
  await undo.click();
  await expect(editor).toHaveText("可编辑的灵感");
});

test("分组内的解组按钮能用 Enter 激活，撤销重做保留正确状态", async ({ page, request }) => {
  const id = await openCanvas(page, request, true);
  const undo = page.getByRole("button", { name: "撤销", exact: true });
  const redo = page.getByRole("button", { name: "重做", exact: true });
  await expect(undo).toBeDisabled();
  await expect(redo).toBeDisabled();
  const ungroup = page.getByRole("button", { name: "解组创作组", exact: true });
  await ungroup.focus();
  await page.keyboard.press("Enter");
  await expect(page.locator(".canvas-node-group")).toHaveCount(0);
  await expect(undo).toBeEnabled();
  await undo.click();
  await expect(page.locator(".canvas-node-group")).toHaveCount(1);
  await expect(redo).toBeEnabled();
  await expect(undo).toBeDisabled();
  await redo.click();
  await expect(page.locator(".canvas-node-group")).toHaveCount(0);
  await expect(redo).toBeDisabled();
  await expect.poll(async () => (await (await request.get(`/api/canvas/${id}`)).json()).graph.nodes.every((node: { data: { canvasGroupId?: string } }) => !node.data.canvasGroupId)).toBe(true);
});

test("小窗口边缘弹出的新建菜单不会被顶栏遮住或裁切", async ({ page, request }) => {
  await page.setViewportSize({ width: 360, height: 320 });
  await openCanvas(page, request, false, true);
  const pane = page.locator(".react-flow__pane");
  const bounds = await pane.boundingBox();
  expect(bounds).toBeTruthy();
  await pane.click({ button: "right", position: { x: bounds!.width - 5, y: bounds!.height - 5 } });
  const menu = page.getByRole("menu", { name: "新建节点", exact: true });
  await expect(menu).toBeVisible();
  await expect.poll(async () => {
    const box = await menu.boundingBox();
    const topbar = await page.locator(".topbar").boundingBox();
    return Boolean(box && topbar && box.x >= 8 && box.x + box.width <= 352 && box.y >= topbar.y + topbar.height && box.y + box.height <= 312);
  }).toBe(true);
  await page.keyboard.press("End");
  await expect(menu.getByRole("menuitem", { name: "结果预览", exact: true })).toBeFocused();
});
