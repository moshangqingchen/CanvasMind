import { expect, test, type Locator, type Page } from "@playwright/test";

type FixtureNode = {
  id: string; type: string; position: { x: number; y: number }; style?: { width: number; height: number };
  data: { nodeType: string; label: string; parts?: Array<{ type: string; text: string }>; inputs?: unknown[]; outputs?: Array<{ id: string; kind: string; label: string }> };
};
type FixtureGraph = { schemaVersion: number; nodes: FixtureNode[]; edges: unknown[]; viewport: { x: number; y: number; zoom: number } };
type Bounds = { x: number; y: number; width: number; height: number };
const sizes = [{ width: 1024, height: 768 }, { width: 1366, height: 768 }, { width: 1920, height: 1080 }];
const NODE_CARD_DRAG_TYPE = "application/x-supercanvas-node-type";

function prompt(id: string, x: number, y: number): FixtureNode {
  return { id, type: "workflow", position: { x, y }, style: { width: 280, height: 180 },
    data: { nodeType: "prompt", label: id, parts: [{ type: "text", text: "隔离的极光工作台布局夹具" }], inputs: [], outputs: [{ id: "text", kind: "text", label: "提示词" }] } };
}

/** All API calls are mocked; no formal profile, supplier or paid request is used. */
async function fixture(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem("super-canvas:inspector-open", "false");
    localStorage.setItem("super-canvas:gentle-motion", "on");
  });
  const id = "aurora-chrome-isolated";
  const canvas = { id, title: "极光工作室 · 这是完整保留的中文项目名称", revision: 1, graph: {
    schemaVersion: 1, viewport: { x: 20, y: 20, zoom: .8 }, edges: [],
    nodes: [prompt("Aurora A", 180, 150), prompt("Aurora B", 800, 450), prompt("Aurora C", 1900, 100)],
  } as FixtureGraph };
  const errors: string[] = [];
  let outbound = 0, submissions = 0;
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (["error", "warning"].includes(message.type())) errors.push(message.text()); });
  await page.route("**/*", route => {
    const request = route.request(), url = new URL(request.url());
    if (!/^(localhost|127\.0\.0\.1)$/.test(url.hostname) && !["data:", "blob:", "about:"].includes(url.protocol)) { outbound++; return route.abort("blockedbyclient"); }
    if (!url.pathname.startsWith("/api/")) return route.continue();
    if (request.method() === "POST" && ["/api/runs", "/api/agent/turn"].includes(url.pathname)) { submissions++; return route.fulfill({ status: 400, json: { error: "This UI fixture never submits" } }); }
    if (url.pathname === "/api/projects") return route.fulfill({ json: { projects: [{ id, title: canvas.title, nodeCount: canvas.graph.nodes.length, createdAt: "2026-10-15T00:00:00Z", updatedAt: "2026-10-15T00:00:00Z" }] } });
    if (url.pathname === `/api/canvas/${id}`) {
      if (request.method() === "PUT") { canvas.graph = request.postDataJSON().graph; canvas.revision++; }
      return route.fulfill({ json: canvas });
    }
    if (["/api/providers", "/api/suppliers", "/api/assets", "/api/runs", "/api/agent/models", "/api/agent/sessions", "/api/integrations/material-drops"].includes(url.pathname)) return route.fulfill({ json: [] });
    return route.fulfill({ json: { items: [], messages: [], sessions: [], groups: [], runs: [], drops: [] } });
  });
  await page.goto(`/canvas/${id}`);
  await expect(page.locator('[data-canvas-island="project"]')).toBeVisible();
  await expect(page.locator('.react-flow__node[data-id="Aurora A"]')).toBeVisible();
  return {
    canvas,
    graph: () => canvas.graph,
    check: () => { expect(errors).toEqual([]); expect(outbound).toBe(0); expect(submissions).toBe(0); },
  };
}

async function bounds(locator: Locator): Promise<Bounds> {
  const box = await locator.boundingBox();
  expect(box).not.toBeNull();
  return box!;
}
function overlap(a: Bounds, b: Bounds) {
  return Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)) *
    Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
}

for (const size of sizes) {
  test(`${size.width} 顶栏三岛不重叠，岛间空白直接平移画布`, async ({ page }) => {
    await page.setViewportSize(size);
    await page.emulateMedia({ reducedMotion: "reduce" });
    const f = await fixture(page);
    const islands = await page.locator("[data-canvas-island]").evaluateAll(elements => elements.map(element => {
      const box = element.getBoundingClientRect(), style = getComputedStyle(element);
      return { x: box.x, y: box.y, width: box.width, height: box.height, name: element.getAttribute("data-canvas-island"), background: style.backgroundColor, blur: style.backdropFilter };
    }));
    expect(islands).toHaveLength(3);
    for (const island of islands) {
      expect(island.x).toBeGreaterThanOrEqual(0);
      expect(island.y).toBeGreaterThanOrEqual(0);
      expect(island.x + island.width).toBeLessThanOrEqual(size.width);
      if (island.name === "command") {
        expect(island.blur).toBe("none");
        expect(island.background).toBe("rgb(10, 10, 12)");
      } else {
        expect(island.blur).toMatch(/^blur\((?:12|22)px\) saturate\(1\.6\)$/u);
        expect(island.background).toMatch(/^rgba\(/u);
      }
    }
    for (let i = 0; i < islands.length; i++) for (let j = i + 1; j < islands.length; j++) expect(overlap(islands[i]!, islands[j]!)).toBe(0);
    const gap = await page.evaluate(() => {
      const boxes = [...document.querySelectorAll<HTMLElement>("[data-canvas-island]")].map(element => element.getBoundingClientRect()).sort((a, b) => a.left - b.left);
      for (let index = 0; index < boxes.length - 1; index++) {
        const left = boxes[index]!, right = boxes[index + 1]!;
        if (right.left - left.right < 4) continue;
        const x = (left.right + right.left) / 2, y = Math.max(left.top, right.top) + Math.min(left.height, right.height) / 2;
        if (document.elementFromPoint(x, y)?.classList.contains("react-flow__pane")) return { x, y };
      }
      return null;
    });
    expect(gap, "岛间空白必须穿透到画布，而不是顶栏遮罩").not.toBeNull();
    await page.getByRole("button", { name: "抓手模式", exact: true }).click();
    const before = await page.locator(".react-flow__viewport").getAttribute("style");
    await page.mouse.move(gap!.x, gap!.y);
    await page.mouse.down();
    await page.mouse.move(gap!.x + 48, gap!.y + 42, { steps: 8 });
    await page.mouse.up();
    await expect.poll(() => page.locator(".react-flow__viewport").getAttribute("style")).not.toBe(before);
    expect(f.graph().nodes.map(node => node.id)).toEqual(["Aurora A", "Aurora B", "Aurora C"]);
    f.check();
  });
}

test("项目标题打开已有重命名弹窗，Escape 保留名称并归还焦点", async ({ page }) => {
  const f = await fixture(page);
  const title = page.locator(".editor-project-title");
  await expect(title).toHaveAttribute("aria-label", /重命名/);
  await expect(title).toHaveAttribute("title", new RegExp(f.canvas.title));
  await title.click();
  const dialog = page.getByRole("dialog", { name: "重命名项目", exact: true });
  await expect(dialog).toBeVisible();
  const name = dialog.getByRole("textbox", { name: /项目名称/ });
  await expect(name).toBeFocused();
  await name.fill("尚未保存的新名称");
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(title).toBeFocused();
  await expect(title).toHaveText(f.canvas.title);
  f.check();
});

test("360×320加号菜单避让顶栏并滚动到键盘末项，调整窗口后仍完整可用", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 320 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  const f = await fixture(page);
  const trigger = page.getByRole("button", { name: "添加节点", exact: true });
  await trigger.click();
  const menu = page.getByRole("menu", { name: "添加创作节点", exact: true });
  const promptItem = menu.getByRole("menuitem", { name: /^Prompt/ });
  const imageItem = menu.getByRole("menuitem", { name: /^图片生成/ });
  const lastItem = menu.getByRole("menuitem", { name: /^添加素材/ });
  const expectMenuFits = async () => {
    await expect.poll(async () => {
      const box = await menu.boundingBox(), viewport = page.viewportSize()!;
      const islandBottom = await page.locator("[data-canvas-island]").evaluateAll(elements =>
        Math.max(0, ...elements.map(element => element.getBoundingClientRect())
          .filter(rect => rect.width > 0 && rect.height > 0).map(rect => rect.bottom)));
      return Boolean(box && box.x >= 8 && box.y >= islandBottom + 8 &&
        box.x + box.width <= viewport.width - 8 && box.y + box.height <= viewport.height - 8);
    }).toBe(true);
  };
  await expectMenuFits();
  await expect(menu.getByRole("menuitem")).toHaveCount(6);
  await expect(promptItem).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(imageItem).toBeFocused();
  await page.keyboard.press("End");
  await expect(lastItem).toBeFocused();
  await expect(lastItem).toBeInViewport({ ratio: 1 });
  expect(await lastItem.evaluate(element => {
    const box = element.getBoundingClientRect();
    const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
    return hit === element || Boolean(hit && element.contains(hit));
  })).toBe(true);
  await page.setViewportSize({ width: 640, height: 480 });
  await expectMenuFits();
  await page.keyboard.press("Home");
  await expect(promptItem).toBeFocused();
  await expect(promptItem).toBeInViewport({ ratio: 1 });
  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);
  await expect(trigger).toBeFocused();
  f.check();
});

test("加号菜单方向键操作，Enter新增复用历史，Escape与输入法保留局部焦点", async ({ page }) => {
  const f = await fixture(page);
  const selection = page.getByRole("button", { name: "选择节点模式", exact: true });
  await selection.click();
  const trigger = page.getByRole("button", { name: "添加节点", exact: true });
  await trigger.click();
  const menu = page.getByRole("menu", { name: "添加创作节点", exact: true });
  const promptItem = menu.getByRole("menuitem", { name: /^Prompt/ });
  const imageItem = menu.getByRole("menuitem", { name: /^图片生成/ });
  await expect(promptItem).toBeFocused();
  await expect(imageItem).toBeEnabled();
  await page.keyboard.press("ArrowRight");
  await expect(imageItem).toBeFocused();
  await page.keyboard.press("ArrowLeft");
  await expect(promptItem).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(menu.getByRole("menuitem", { name: /^视频生成/ })).toBeFocused();
  await page.keyboard.press("ArrowUp");
  await expect(promptItem).toBeFocused();
  await page.keyboard.press("End");
  await expect(menu.getByRole("menuitem", { name: /^添加素材/ })).toBeFocused();
  await page.keyboard.press("Home");
  await expect(promptItem).toBeFocused();
  for (const inputMethod of [{ isComposing: true }, { keyCode: 229 }]) {
    await promptItem.dispatchEvent("keydown", { key: "Escape", bubbles: true, cancelable: true, ...inputMethod });
    await expect(menu).toBeVisible();
  }
  await promptItem.evaluate(element => {
    const event = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
    event.preventDefault(); element.dispatchEvent(event);
  });
  await expect(menu).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(menu).toBeHidden();
  await expect(trigger).toBeFocused();
  await expect(selection).toHaveAttribute("aria-pressed", "true");
  await trigger.click();
  await expect(promptItem).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(menu).toBeHidden();
  await expect(trigger).toBeFocused();
  const added = page.locator('.react-flow__node[data-id^="prompt-"]');
  await expect(added).toHaveCount(1);
  const id = await added.getAttribute("data-id");
  await expect.poll(() => f.graph().nodes.length).toBe(4);
  const undo = page.locator('[data-canvas-island="actions"]').getByRole("button", { name: "撤销", exact: true });
  await undo.focus();
  await page.keyboard.press("Control+z");
  await expect(added).toHaveCount(0);
  await page.locator('[data-canvas-island="actions"]').getByRole("button", { name: "重做", exact: true }).focus();
  await page.keyboard.press("Control+y");
  await expect(added).toHaveAttribute("data-id", id!);
  expect(f.graph().edges).toEqual([]);
  f.check();
});

test("加号菜单Tab离开后仍由Esc关闭，尊重输入法和已消费事件并恢复触发焦点", async ({ page }) => {
  const f = await fixture(page);
  const selection = page.getByRole("button", { name: "选择节点模式", exact: true });
  await selection.click();
  const trigger = page.getByRole("button", { name: "添加节点", exact: true });
  await trigger.click();
  const menu = page.getByRole("menu", { name: "添加创作节点", exact: true });
  await expect(menu.getByRole("menuitem", { name: /^Prompt/ })).toBeFocused();
  await page.keyboard.press("End");
  await expect(menu.getByRole("menuitem", { name: /^添加素材/ })).toBeFocused();
  await page.keyboard.press("Tab");
  expect(await menu.evaluate(element => !element.contains(document.activeElement))).toBe(true);
  await expect(menu).toBeVisible();
  for (const inputMethod of [{ isComposing: true }, { keyCode: 229 }]) {
    await page.evaluate(init => document.activeElement?.dispatchEvent(new KeyboardEvent("keydown", {
      key: "Escape", bubbles: true, cancelable: true, ...init,
    })), inputMethod);
    await expect(menu).toBeVisible();
    await expect(selection).toHaveAttribute("aria-pressed", "true");
  }
  await page.evaluate(() => {
    const event = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
    event.preventDefault(); document.activeElement?.dispatchEvent(event);
  });
  await expect(menu).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(menu).toBeHidden();
  await expect(trigger).toBeFocused();
  await expect(selection).toHaveAttribute("aria-pressed", "true");
  // Reopening exercises listener cleanup as well as the original local path.
  await trigger.press("Enter");
  await expect(menu.getByRole("menuitem", { name: /^Prompt/ })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(menu).toBeHidden();
  await expect(trigger).toBeFocused();
  await expect(selection).toHaveAttribute("aria-pressed", "true");
  f.check();
});

test("加号菜单上方的真实快捷操作模态先处理Esc，下一次才关闭菜单", async ({ page }) => {
  const f = await fixture(page);
  const selection = page.getByRole("button", { name: "选择节点模式", exact: true });
  await selection.click();
  const trigger = page.getByRole("button", { name: "添加节点", exact: true });
  await trigger.click();
  const menu = page.getByRole("menu", { name: "添加创作节点", exact: true });
  const promptItem = menu.getByRole("menuitem", { name: /^Prompt/ });
  await expect(promptItem).toBeFocused();
  await page.keyboard.press("Control+k");
  const dialog = page.getByRole("dialog", { name: "快捷操作", exact: true });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("combobox", { name: "搜索画布操作", exact: true })).toBeFocused();
  await expect(menu).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(menu).toBeVisible();
  await expect(promptItem).toBeFocused();
  await expect(selection).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("Escape");
  await expect(menu).toBeHidden();
  await expect(trigger).toBeFocused();
  await expect(selection).toHaveAttribute("aria-pressed", "true");
  f.check();
});

test("从加号菜单拖拽已有 Prompt 类型到指定画布位置，不进入收费路径", async ({ page }) => {
  const f = await fixture(page);
  await page.getByRole("button", { name: "添加节点", exact: true }).click();
  const menu = page.getByRole("menu", { name: "添加创作节点", exact: true });
  const item = menu.getByRole("menuitem", { name: /^Prompt/ });
  const transfer = await page.evaluateHandle(() => new DataTransfer());
  await item.dispatchEvent("dragstart", { dataTransfer: transfer });
  expect(await transfer.evaluate((data, type) => data.getData(type), NODE_CARD_DRAG_TYPE)).toBe("prompt");
  const canvas = page.locator(".canvas-wrap");
  const box = await bounds(canvas);
  const point = { clientX: box.x + Math.min(600, box.width / 2), clientY: box.y + box.height * .6 };
  await canvas.dispatchEvent("dragover", { dataTransfer: transfer, ...point });
  await canvas.dispatchEvent("drop", { dataTransfer: transfer, ...point });
  await item.dispatchEvent("dragend", { dataTransfer: transfer });
  await transfer.dispose();
  await expect(menu).toBeHidden();
  const added = page.locator('.react-flow__node[data-id^="prompt-"]');
  await expect(added).toHaveCount(1);
  const placed = await bounds(added);
  expect(Math.abs(placed.x - point.clientX)).toBeLessThan(10);
  expect(Math.abs(placed.y - point.clientY)).toBeLessThan(10);
  await expect.poll(() => f.graph().nodes.length).toBe(4);
  // Read the persisted payload by ID, rather than inferring a type from color.
  const id = await added.getAttribute("data-id");
  expect(f.graph().nodes.find(node => node.id === id)?.data.nodeType).toBe("prompt");
  f.check();
});

for (const size of sizes) {
  test(`${size.width} 智能体悬浮时适应全部与定位避开面板和工具岛`, async ({ page }) => {
    await page.setViewportSize(size);
    await page.emulateMedia({ reducedMotion: "reduce" });
    const f = await fixture(page);
    await page.getByRole("button", { name: "智能体面板", exact: true }).click();
    await expect(page.getByRole("region", { name: "通用创作智能体", exact: true }).getByLabel("创作任务要求")).toBeVisible();
    await page.getByRole("button", { name: "Fit View", exact: true }).click();
    await expect(page.locator(".react-flow__node")).toHaveCount(3);
    const checkUnobscured = async (selector: string) => page.locator(selector).evaluateAll(nodes => {
      const obstacles = [...document.querySelectorAll<HTMLElement>('[data-canvas-island],.editor-rail,.canvas-toolbar,.react-flow__controls,.workspace > .inspector.mobile-open')].map(element => element.getBoundingClientRect()).filter(rect => rect.width && rect.height);
      return nodes.every(node => {
        const box = node.getBoundingClientRect();
        return box.left >= -1 && box.top >= -1 && box.right <= innerWidth + 1 && box.bottom <= innerHeight + 1 && obstacles.every(other =>
          Math.min(box.right, other.right) - Math.max(box.left, other.left) <= 1 || Math.min(box.bottom, other.bottom) - Math.max(box.top, other.top) <= 1);
      });
    });
    await expect.poll(() => checkUnobscured(".react-flow__node")).toBe(true);
    const node = page.locator('.react-flow__node[data-id="Aurora A"]');
    await node.locator(".node-head").click();
    await page.getByRole("button", { name: "定位所选节点", exact: true }).click();
    await expect.poll(() => checkUnobscured('.react-flow__node[data-id="Aurora A"]')).toBe(true);
    const card = page.locator(".workspace > .inspector.mobile-open");
    const panel = await bounds(card);
    expect(panel.x + panel.width).toBeLessThanOrEqual(size.width);
    expect(panel.y + panel.height).toBeLessThanOrEqual(size.height);
    f.check();
  });
}

test("减少动态效果保留主题类型静态颜色，新增菜单即时显示且焦点可见", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const f = await fixture(page);
  await expect(page.locator("html")).toHaveAttribute("data-motion", "off");
  await page.getByRole("button", { name: "添加节点", exact: true }).focus();
  await page.keyboard.press("Enter");
  const menu = page.getByRole("menu", { name: "添加创作节点", exact: true });
  await expect(menu).toBeVisible();
  await expect(menu).toHaveCSS("animation-name", "none");
  const item = menu.getByRole("menuitem", { name: /^Prompt/ });
  await expect(item).toBeFocused();
  await expect(item).toHaveCSS("outline-style", "solid");
  const iconPaint = await item.locator("svg").evaluate(element => {
    const style = getComputedStyle(element.parentElement!);
    return { background: style.backgroundColor, image: style.backgroundImage, color: style.color };
  });
  expect(iconPaint.image).toBe("none");
  expect(iconPaint.background).not.toBe("rgba(0, 0, 0, 0)");
  expect(iconPaint.color).not.toBe(iconPaint.background);
  await page.keyboard.press("Escape");
  await expect(menu).toBeHidden();
  f.check();
});
