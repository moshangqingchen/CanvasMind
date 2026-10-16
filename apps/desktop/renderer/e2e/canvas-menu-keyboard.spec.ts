import { expect, test, type APIRequestContext, type Locator, type Page } from "@playwright/test";

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
  const selectionMode = page.getByRole("button", { name: "选择节点模式", exact: true });
  await selectionMode.click();
  await expect(selectionMode).toHaveAttribute("aria-pressed", "true");
  const node = page.locator('.react-flow__node[data-id="prompt-0"]');
  await node.focus();
  await node.locator(".node-title").click({ button: "right" });
  const menu = page.getByRole("menu", { name: "灵感 1 的操作", exact: true });
  const copy = menu.getByRole("menuitem", { name: "复制", exact: false }).first();
  const copyWithMaterials = menu.getByRole("menuitem", { name: "复制（包含素材）", exact: true });
  const duplicate = menu.getByRole("menuitem", { name: "紧邻复制", exact: false });
  const remove = menu.getByRole("menuitem", { name: "删除节点", exact: false });
  await expect(copy).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(copyWithMaterials).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(duplicate).toBeFocused();
  await page.keyboard.press("End");
  await expect(remove).toBeFocused();
  await page.keyboard.press("Home");
  await expect(copy).toBeFocused();
  for (const inputMethod of [{ isComposing: true }, { keyCode: 229 }]) {
    await copy.dispatchEvent("keydown", { key: "Escape", bubbles: true, cancelable: true, ...inputMethod });
    await expect(menu).toBeVisible();
    await expect(selectionMode).toHaveAttribute("aria-pressed", "true");
  }
  await copy.evaluate(element => {
    const event = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
    event.preventDefault();
    element.dispatchEvent(event);
  });
  await expect(menu).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(menu).toBeHidden();
  await expect(node).toBeFocused();
  await expect(selectionMode).toHaveAttribute("aria-pressed", "true");
  await node.locator(".node-title").click({ button: "right" });
  await page.keyboard.press("Enter");
  await expect(menu).toBeHidden();
  await expect(node).toBeFocused();
  await node.locator(".node-title").click({ button: "right" });
  await page.getByRole("button", { name: "小地图", exact: true }).click();
  await expect(menu).toBeHidden();
});

test("画布工具按钮获焦后可撤销重做，输入框、菜单和输入法仍持有局部快捷键", async ({ page, request }) => {
  test.setTimeout(45_000);
  const errors: string[] = [];
  let submissions = 0;
  page.on("pageerror", error => errors.push(error.message));
  for (const endpoint of ["**/api/runs", "**/api/agent/turn"]) await page.route(endpoint, route => {
    if (route.request().method() === "POST") { submissions++; return route.abort(); }
    return route.continue();
  });
  await openCanvas(page, request);
  const node0 = page.locator('.react-flow__node[data-id="prompt-0"]');
  const node1 = page.locator('.react-flow__node[data-id="prompt-1"]');
  const pan = page.getByRole("button", { name: "抓手模式", exact: true });
  const removePrompt = async (node: Locator, label: string) => {
    await node.locator(".node-title").click({ button: "right" });
    await page.getByRole("menu", { name: `${label} 的操作`, exact: true })
      .getByRole("menuitem", { name: /^删除节点/u }).click();
  };
  await removePrompt(node0, "灵感 1");
  await expect(node0).toHaveCount(0);
  await pan.focus();
  await expect(pan).toBeFocused();
  await page.keyboard.press("Control+z");
  await expect(node0).toBeVisible();
  // Prompt cards expose deletion through their context menu. Exercise the
  // second ordinary-button scope using the real zoom control, without clicking
  // it or replacing it with a synthetic button that the product does not have.
  const zoomButton = page.getByRole("button", { name: "Zoom Out", exact: true });
  await zoomButton.focus();
  await expect(zoomButton).toBeFocused();
  await page.keyboard.press("Control+y");
  await expect(node0).toHaveCount(0);
  await pan.focus();
  await page.keyboard.press("Control+z");
  await expect(node0).toBeVisible();

  // A nonempty canvas history makes every negative scope meaningful.
  await removePrompt(node1, "灵感 2");
  await expect(node1).toHaveCount(0);
  await expect(page.locator('[data-canvas-island="actions"]').getByRole("button", { name: "撤销", exact: true })).toBeEnabled();
  // A native textarea has its own undo stack. A real focus and trusted
  // keyboard shortcut must edit its draft without replaying canvas history.
  await page.getByRole("button", { name: "打开智能体", exact: true }).click();
  const panel = page.getByRole("region", { name: "通用创作智能体" });
  const draft = panel.getByRole("textbox", { name: "创作任务要求", exact: true });
  await draft.fill("first draft");
  await draft.press("Control+a");
  await draft.pressSequentially("second draft");
  await expect(draft).toHaveValue("second draft");
  await draft.press("Control+z");
  await expect(draft).not.toHaveValue("second draft");
  await expect(page.locator(".react-flow__node")).toHaveCount(1);
  await expect(node0).toBeVisible();
  await expect(node1).toHaveCount(0);
  await panel.getByRole("button", { name: "关闭智能体", exact: true }).click();

  // Keep the same undo step pending across IME events and both menu scopes.
  await pan.focus();
  for (const inputMethod of [{ isComposing: true }, { keyCode: 229 }]) {
    await pan.dispatchEvent("keydown", { key: "z", ctrlKey: true, bubbles: true, cancelable: true, ...inputMethod });
    await expect(node1).toHaveCount(0);
  }
  await page.getByRole("button", { name: "打开项目菜单", exact: true }).click();
  const projectMenu = page.getByRole("menu", { name: "项目操作", exact: true });
  await projectMenu.getByRole("menuitem").first().focus();
  await page.keyboard.press("Control+z");
  await expect(projectMenu).toBeVisible();
  await expect(node1).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(projectMenu).toHaveCount(0);
  await node0.locator(".node-title").click({ button: "right" });
  const nodeMenu = page.getByRole("menu", { name: "灵感 1 的操作", exact: true });
  await expect(nodeMenu.getByRole("menuitem").first()).toBeFocused();
  await page.keyboard.press("Control+z");
  await expect(nodeMenu).toBeVisible();
  await expect(node1).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(nodeMenu).toHaveCount(0);
  // The same history step remains available after both menus dismiss.
  await pan.focus();
  await page.keyboard.press("Control+z");
  await expect(node1).toBeVisible();
  expect(errors).toEqual([]);
  expect(submissions).toBe(0);
});

test("撤销后立即编辑提示词会建立新分支并清除旧重做", async ({ page, request }) => {
  await openCanvas(page, request);
  // Keep Date.now in the same editing window while allowing timers to run,
  // so a slow test machine cannot hide the immediate-edit regression.
  await page.clock.setFixedTime(new Date("2026-10-03T08:00:00Z"));
  await page.locator('.react-flow__node[data-id="prompt-0"] .prompt-overview').click();
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
    const islandBottom = await page.locator("[data-canvas-island]").evaluateAll(elements =>
      Math.max(0, ...elements.map(element => element.getBoundingClientRect())
        .filter(bounds => bounds.width > 0 && bounds.height > 0).map(bounds => bounds.bottom)));
    return Boolean(box && islandBottom > 0 && box.x >= 8 && box.x + box.width <= 352 && box.y >= islandBottom && box.y + box.height <= 312);
  }).toBe(true);
  await page.keyboard.press("End");
  const preview = menu.getByRole("menuitem", { name: "结果预览", exact: true });
  await expect(preview).toBeFocused();
  await expect(preview).toBeInViewport({ ratio: 1 });
  expect(await preview.evaluate(element => {
    const box = element.getBoundingClientRect();
    const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
    return hit === element || Boolean(hit && element.contains(hit));
  })).toBe(true);
});
