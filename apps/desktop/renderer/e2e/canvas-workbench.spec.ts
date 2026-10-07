import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

interface CanvasGraph {
  nodes: Array<{
    id: string;
    position: { x: number; y: number };
    data: { nodeType: string; label: string; parts?: Array<{ type: string; text?: string }> };
  }>;
  edges: Array<{ id: string }>;
}

async function readGraph(request: APIRequestContext, id: string): Promise<CanvasGraph> {
  const response = await request.get(`/api/canvas/${id}`);
  expect(response.ok()).toBeTruthy();
  return (await response.json()).graph;
}

async function openWorkbench(page: Page, request: APIRequestContext) {
  let submissions = 0;
  await page.route("**/api/runs", async route => {
    if (route.request().method() === "POST") {
      submissions++;
      await route.abort();
    } else await route.continue();
  });
  const created = await request.post("/api/canvas", { data: {
    title: "工作台验收 · 很长的项目名称也应保持创作工具可用",
    graph: {
      schemaVersion: 1,
      viewport: { x: 0, y: 0, zoom: 1 },
      nodes: [
        { id: "near", type: "workflow", position: { x: 130, y: 120 }, style: { width: 360, height: 220 },
          data: { nodeType: "prompt", label: "起点灵感", parts: [{ type: "text", text: "镜头从城市街道开始" }],
            inputs: [], outputs: [{ id: "prompt", kind: "text", label: "提示词" }] } },
        { id: "far-one", type: "workflow", position: { x: 4200, y: 2200 }, style: { width: 360, height: 220 },
          data: { nodeType: "prompt", label: "分镜场景一", parts: [{ type: "text", text: "琥珀色森林里的光影，慢慢推进" }],
            inputs: [{ id: "prompt", kind: "text", label: "提示词" }], outputs: [{ id: "prompt", kind: "text", label: "提示词" }] } },
        { id: "far-two", type: "workflow", position: { x: 6000, y: 2200 }, style: { width: 360, height: 220 },
          data: { nodeType: "prompt", label: "分镜场景二", parts: [{ type: "text", text: "蓝色海面的远景，镜头向上升起" }],
            inputs: [], outputs: [{ id: "prompt", kind: "text", label: "提示词" }] } },
      ],
      edges: [{ id: "near-far", source: "near", sourceHandle: "prompt", target: "far-one", targetHandle: "prompt", type: "smoothstep" }],
    },
  } });
  expect(created.ok()).toBeTruthy();
  const { id } = await created.json() as { id: string };
  await page.goto(`/canvas/${id}`);
  await expect(page.locator('.react-flow__node[data-id="near"] .node-card')).toBeVisible();
  await expect(page.getByRole("button", { name: "搜索操作与节点", exact: true })).toBeEnabled();
  return { id, assertNoRuns: () => expect(submissions).toBe(0) };
}

async function openCommands(page: Page, keyboard = false) {
  const trigger = page.getByRole("button", { name: "搜索操作与节点", exact: true });
  if (keyboard) {
    await trigger.focus();
    await page.keyboard.press("Control+k");
  } else await trigger.click();
  const panel = page.getByRole("dialog", { name: "快捷操作", exact: true });
  const input = panel.getByRole("combobox", { name: "搜索画布操作", exact: true });
  await expect(panel).toBeVisible();
  await expect(input).toBeFocused();
  return { trigger, panel, input };
}

test("Ctrl+K 可以按提示词内容找到远处节点，单选定位后可再次返回所选节点", async ({ page, request }) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  const canvas = await openWorkbench(page, request);
  const original = await readGraph(request, canvas.id);
  await page.locator('.react-flow__node[data-id="near"] .node-title').click();
  const ui = await openCommands(page, true);
  await ui.input.fill("琥珀色森林");
  const options = ui.panel.getByRole("group", { name: "画布节点", exact: true }).getByRole("option");
  await expect(options).toHaveCount(1);
  await expect(options.first()).toContainText("分镜场景一");
  await ui.input.press("Enter");
  await expect(ui.panel).toBeHidden();
  const target = page.locator('.react-flow__node[data-id="far-one"] .node-card');
  await expect(target).toHaveClass(/selected/);
  await expect(page.locator(".react-flow__node.selected")).toHaveCount(1);
  await expect(target).toBeInViewport({ ratio: 1 });
  await expect.poll(async () => Number.parseFloat((await page.locator(".canvas-zoom-value").textContent()) ?? "")).toBeLessThanOrEqual(100);

  const fit = await openCommands(page);
  await fit.input.fill("适应全部节点");
  await expect(fit.panel.getByRole("option")).toHaveCount(1);
  await fit.input.press("Enter");
  await expect(fit.panel).toBeHidden();
  await expect.poll(async () => Number.parseFloat((await page.locator(".canvas-zoom-value").textContent()) ?? "")).toBeLessThan(50);
  await page.getByRole("button", { name: "定位所选节点", exact: true }).click();
  await expect(target).toBeInViewport({ ratio: 1 });
  await expect.poll(async () => Number.parseFloat((await page.locator(".canvas-zoom-value").textContent()) ?? "")).toBeGreaterThan(50);
  const current = await readGraph(request, canvas.id);
  expect(current.nodes.map(node => ({ id: node.id, position: node.position, data: node.data })))
    .toEqual(original.nodes.map(node => ({ id: node.id, position: node.position, data: node.data })));
  expect(current.edges).toEqual(original.edges);
  canvas.assertNoRuns();
});

test("快捷操作支持方向键选择，空结果不执行操作，Escape 恢复入口焦点", async ({ page, request }) => {
  await page.setViewportSize({ width: 1280, height: 820 });
  const canvas = await openWorkbench(page, request);
  const ui = await openCommands(page, true);
  await ui.input.fill("分镜场景");
  const options = ui.panel.getByRole("group", { name: "画布节点", exact: true }).getByRole("option");
  await expect(options).toHaveCount(2);
  await expect(options.first()).toHaveAttribute("aria-selected", "true");
  await ui.input.press("ArrowDown");
  await expect(options.nth(1)).toHaveAttribute("aria-selected", "true");
  await ui.input.press("Enter");
  await expect(ui.panel).toBeHidden();
  await expect(page.locator('.react-flow__node[data-id="far-two"] .node-card')).toHaveClass(/selected/);
  await expect(page.locator(".react-flow__node.selected")).toHaveCount(1);

  const empty = await openCommands(page, true);
  await empty.input.fill("不存在的工作台命令 q9z8x7");
  await expect(empty.panel.getByRole("option")).toHaveCount(0);
  await expect(empty.panel.getByText("没有找到匹配操作", { exact: true })).toBeVisible();
  await empty.input.press("ArrowDown");
  await empty.input.press("Enter");
  await expect(empty.panel).toBeVisible();
  await expect(empty.input).toBeFocused();
  await empty.input.press("Escape");
  await expect(empty.panel).toBeHidden();
  await expect(empty.trigger).toBeFocused();
  expect((await readGraph(request, canvas.id)).nodes).toHaveLength(3);
  canvas.assertNoRuns();
});

test("搜索新建提示词并按 Enter 只添加一次，输入不触发画布模式和付费任务", async ({ page, request }) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  const canvas = await openWorkbench(page, request);
  const ui = await openCommands(page, true);
  // The dialog must own letter and digit keys that the canvas uses as mode shortcuts.
  await ui.input.pressSequentially("f123");
  await expect(page.getByRole("button", { name: "抓手模式", exact: true })).toHaveAttribute("aria-pressed", "true");
  await ui.input.fill("新建提示词节点");
  await expect(ui.panel.getByRole("option")).toHaveCount(1);
  await ui.input.press("Enter");
  await expect(ui.panel).toBeHidden();
  await expect.poll(async () => (await readGraph(request, canvas.id)).nodes.length).toBe(4);
  const graph = await readGraph(request, canvas.id);
  expect(graph.nodes.filter(node => !["near", "far-one", "far-two"].includes(node.id))).toHaveLength(1);
  expect(graph.nodes.every(node => node.data.nodeType === "prompt")).toBe(true);
  expect(graph.edges).toHaveLength(1);
  canvas.assertNoRuns();
});

test("正在编辑的提示词立即进入搜索，定位后编辑内容仍已保存", async ({ page, request }) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  const canvas = await openWorkbench(page, request);
  await page.locator('.react-flow__node[data-id="near"] .node-title').click();
  const editor = page.locator('.react-flow__node[data-id="near"] .tiptap-prompt');
  await editor.fill("刚刚输入的雨夜霓虹街景");
  await editor.press("Control+k");
  const panel = page.getByRole("dialog", { name: "快捷操作", exact: true });
  const input = panel.getByRole("combobox", { name: "搜索画布操作", exact: true });
  await expect(input).toBeFocused();
  await input.fill("雨夜霓虹");
  await expect(panel.getByRole("option")).toHaveCount(1);
  await input.press("Enter");
  await expect(panel).toBeHidden();
  await expect.poll(async () => JSON.stringify((await readGraph(request, canvas.id)).nodes.find(node => node.id === "near")?.data.parts)).toContain("刚刚输入的雨夜霓虹街景");
  canvas.assertNoRuns();
});

for (const width of [390, 980, 1280, 1600]) {
  test(`工作台快捷操作在 ${width}px 窗口可见，工具文字可读且没有横向溢出`, async ({ page, request }, testInfo) => {
    await page.setViewportSize({ width, height: 820 });
    const canvas = await openWorkbench(page, request);
    const rail = page.getByRole("navigation", { name: "创作工具", exact: true });
    for (const name of ["新建图片节点", "新建提示词节点", "历史生成"]) {
      const label = rail.getByRole("button", { name, exact: true }).locator("span");
      await expect(label).toBeInViewport({ ratio: 1 });
      await expect.poll(() => label.evaluate(element => {
        const style = getComputedStyle(element);
        return style.display !== "none" && style.visibility !== "hidden" && Number.parseFloat(style.opacity) > 0;
      })).toBe(true);
    }
    const ui = await openCommands(page);
    await expect(ui.panel).toBeInViewport({ ratio: 1 });
    await expect(ui.input).toBeInViewport({ ratio: 1 });
    await expect(ui.panel.getByRole("button", { name: "关闭快捷操作", exact: true })).toBeInViewport({ ratio: 1 });
    await ui.input.fill("供应商与模型设置");
    const settings = ui.panel.getByRole("option");
    await expect(settings).toHaveCount(1);
    await expect(settings).toBeInViewport({ ratio: 1 });
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1);
    await expect.poll(() => ui.panel.evaluate(element => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1);
    await page.screenshot({ path: testInfo.outputPath(`workbench-${width}.png`), animations: "disabled" });
    await ui.input.press("Escape");
    await expect(ui.panel).toBeHidden();
    await expect(ui.trigger).toBeFocused();
    canvas.assertNoRuns();
  });
}

test("工作台展示：创作流程、可读工具与智能体保持在同一画面", async ({ page, request }, testInfo) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  let submissions = 0;
  await page.route("**/api/runs", async route => {
    if (route.request().method() === "POST") {
      submissions++;
      await route.abort();
    } else await route.continue();
  });
  const providerResponse = await request.post("/api/providers", { data: {
    name: "离线视觉展示", provider: "fake", apiKey: "isolated-ui-preview-only",
    config: { connector: { auth: { type: "none" }, models: [{
      id: "fake-image-v1", name: "离线图片模型", operations: ["image.generate"],
    }] } },
  } });
  expect(providerResponse.ok()).toBeTruthy();
  const provider = await providerResponse.json() as { id: string };
  const created = await request.post("/api/canvas", { data: {
    title: "星野品牌 · 秋日视觉企划",
    graph: {
      schemaVersion: 1,
      viewport: { x: 35, y: 35, zoom: 0.85 },
      nodes: [
        { id: "direction", type: "workflow", position: { x: 140, y: 180 }, style: { width: 350, height: 270 },
          data: { nodeType: "prompt", label: "视觉方向", parts: [{ type: "text", text: "用自然与科技交织的视觉语言，呈现秋日清晨的森林。\n琥珀色阳光穿过树叶，柔和的薄雾与通透的材质，让品牌感受更温暖、更有生命力。" }],
            inputs: [], outputs: [{ id: "prompt", kind: "text", label: "提示词" }] } },
        { id: "visual", type: "workflow", position: { x: 620, y: 140 }, style: { width: 420, height: 300 },
          data: { nodeType: "image-generation", label: "主视觉设计", provider: "fake", connectionId: provider.id, model: "fake-image-v1",
            parts: [{ type: "text", text: "以晨光森林为主景，透明玻璃装置融入自然。\n画面清爽、层次丰富，保留充足的标题与品牌信息空间，适合秋季活动主视觉。" }],
            parameters: { size: "1536x1024", quality: "high", n: 1 },
            inputs: [{ id: "prompt", kind: "text", label: "提示词" }, { id: "references", kind: "image[]", label: "参考图", multiple: true }],
            outputs: [{ id: "images", kind: "image", label: "图片" }] } },
        { id: "story", type: "workflow", position: { x: 640, y: 550 }, style: { width: 380, height: 240 },
          data: { nodeType: "prompt", label: "镜头叙事", parts: [{ type: "text", text: "01 · 穿过薄雾，进入森林。\n02 · 阳光落在透明装置上，品牌标识浮现。\n03 · 镜头缓慢拉远，呈现自然与科技共生的场景。" }],
            inputs: [{ id: "prompt", kind: "text", label: "提示词" }], outputs: [{ id: "prompt", kind: "text", label: "提示词" }] } },
      ],
      edges: [
        { id: "direction-visual", source: "direction", sourceHandle: "prompt", target: "visual", targetHandle: "prompt", type: "smoothstep" },
        { id: "direction-story", source: "direction", sourceHandle: "prompt", target: "story", targetHandle: "prompt", type: "smoothstep" },
      ],
    },
  } });
  expect(created.ok()).toBeTruthy();
  const { id } = await created.json() as { id: string };
  await page.goto(`/canvas/${id}`);
  await expect(page.locator(".node-card")).toHaveCount(3);
  await expect(page.locator("aside.inspector .agent-panel")).toBeVisible();
  await expect(page.getByRole("button", { name: "智能体面板", exact: true })).toHaveAttribute("aria-expanded", "true");
  await page.locator('.react-flow__node[data-id="direction"] .node-title').click();
  await expect(page.locator('.react-flow__node[data-id="visual"] .node-card')).toBeInViewport({ ratio: 1 });
  await expect(page.locator('.react-flow__node[data-id="story"] .node-card')).toBeInViewport({ ratio: 1 });
  await page.mouse.move(1100, 800);
  await expect(page.locator(".canvas-name-tooltip")).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath("workbench-canvas.png"), animations: "disabled" });
  const ui = await openCommands(page, true);
  await ui.input.fill("主视觉");
  await expect(ui.panel.getByRole("group", { name: "画布节点", exact: true }).getByRole("option")).toHaveCount(1);
  await page.screenshot({ path: testInfo.outputPath("workbench-search.png"), animations: "disabled" });
  await ui.input.press("Escape");
  expect(submissions).toBe(0);
});
