import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import type { ModelDescriptor } from "@super-canvas/providers";

const model: ModelDescriptor = {
  id: "fake-parameter-dock-image", name: "隔离图片参数模型", operations: ["image.generate"],
  inputKinds: ["text"], outputKinds: ["image"], metadata: { canvasRunnable: true },
  parameters: [
    { key: "size", label: "精确尺寸", control: "dimensions", valueType: "string", default: "2048x2048",
      min: 256, max: 4096, step: 1, allowCustomValue: true, options: [
        { label: "自动", value: "auto" }, { label: "1K · 1:1 · 1024 × 1024", value: "1024x1024" },
        { label: "2K · 1:1 · 2048 × 2048", value: "2048x2048" }, { label: "4K · 1:1 · 4096 × 4096", value: "4096x4096" },
      ] },
    { key: "quality", label: "质量", control: "select", valueType: "string", default: "max",
      options: [{ label: "高", value: "high" }, { label: "最高", value: "max" }] },
    { key: "n", label: "数量", control: "number", valueType: "integer", default: 1, min: 1, max: 10, step: 1 },
    ...Array.from({ length: 12 }, (_, index) => ({ key: `dock_option_${index}`, label: `隔离参数 ${index + 1}`,
      control: "select" as const, valueType: "string" as const, default: "first",
      options: [{ label: "第一档", value: "first" }, { label: "第二档", value: "second" }] })),
  ],
};

async function fixture(page: Page, request: APIRequestContext, farNodeCount = 220) {
  expect(process.env.PLAYWRIGHT_BASE_URL).toBeFalsy();
  await page.setViewportSize({ width: 1920, height: 1080 });
  const connectionResponse = await request.post("/api/providers", { data: {
    provider: "fake", name: "隔离浮动参数卡",
    config: { usage: "canvas", defaultModel: model.id, connector: { auth: { type: "none" }, models: [model] } },
  } });
  expect(connectionResponse.ok()).toBeTruthy();
  const connection = await connectionResponse.json();
  let submissions = 0, external = 0;
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.route("**/*", route => {
    const url = new URL(route.request().url());
    if (!["http:", "data:", "blob:", "about:"].includes(url.protocol) || url.protocol === "http:" && !["localhost", "127.0.0.1"].includes(url.hostname)) {
      external++; return route.abort();
    }
    return route.fallback();
  });
  await page.route(`**/api/providers/${connection.id}/models*`, route => route.fulfill({
    json: [model], headers: { "X-Model-Scan-Status": "live", "X-Model-Scan-Complete": "true" },
  }));
  await page.route("**/api/runs**", route => {
    if (!["GET", "HEAD"].includes(route.request().method())) { submissions++; return route.abort(); }
    return route.fallback();
  });
  const generators = ["甲", "乙"].map((name, index) => ({
    id: `dock-${index}`, type: "workflow", position: { x: 120 + index * 460, y: 160 },
    style: { width: 360, height: 260 }, data: {
      nodeType: "image-generation", label: `图像${name}`, provider: "fake", connectionId: connection.id,
      model: model.id, qualityMode: "custom", parameters: { size: "2048x2048", quality: "max", n: 1 },
      parts: [{ type: "text", text: "未选中时直接打开参数。\n保留原始提示词，不因点击参数而切换编辑器。" }],
      inputs: [{ id: "prompt", kind: "text", label: "提示词" }], outputs: [{ id: "images", kind: "image", label: "图片" }],
    },
  }));
  const farNodes = Array.from({ length: farNodeCount }, (_, index) => ({
    id: `far-${index}`, type: "workflow", position: { x: 10000 + index * 500, y: 4000 },
    data: { nodeType: "prompt", label: `离屏提示词 ${index}`, parts: [{ type: "text", text: "离屏裁剪回归" }], inputs: [], outputs: [{ id: "text", kind: "text", label: "文本" }] },
  }));
  const created = await request.post("/api/canvas", { data: { title: "根级参数浮卡回归", graph: {
    schemaVersion: 1, viewport: { x: 0, y: 0, zoom: 1 }, nodes: [...generators, ...farNodes], edges: [],
  } } });
  expect(created.ok()).toBeTruthy();
  const canvas = await created.json();
  await page.goto(`/canvas/${canvas.id}`);
  const agent = page.getByRole("button", { name: "智能体面板", exact: true });
  await expect(agent).toBeVisible();
  if (await agent.getAttribute("aria-expanded") === "true") await agent.click();
  const panel = (index: number) => page.locator(`.node-config-docked[data-config-node-id="dock-${index}"]`);
  const open = async (index: number) => {
    await page.getByRole("button", { name: `打开 图像${index ? "乙" : "甲"} 模型与参数`, exact: true }).click();
    await expect(panel(index)).toBeVisible();
    await expect(panel(index).getByLabel("图片宽度", { exact: true })).toBeEditable();
  };
  const saved = async () => {
    const response = await request.get(`/api/canvas/${canvas.id}`);
    expect(response.ok()).toBeTruthy();
    return (await response.json()).graph as { nodes: Array<{ id: string; position: { x: number; y: number }; data: { parameters?: Record<string, unknown>; [key: string]: unknown } }> };
  };
  return { panel, open, saved, assertSafe: () => expect({ submissions, external, errors }).toEqual({ submissions: 0, external: 0, errors: [] }) };
}

test("未选中节点首次真实鼠标点击即打开参数，owner离屏裁剪后仍保存原节点", async ({ page, request }) => {
  // The shipping policy keeps up to 500 nodes mounted. Exercise its real >500 culling branch.
  const f = await fixture(page, request, 500);
  await expect.poll(() => page.locator(".react-flow__node").count()).toBeLessThan(20);
  const owner = page.locator('.react-flow__node[data-id="dock-0"]');
  await expect(owner).not.toHaveClass(/\bselected\b/u);
  await expect(owner.locator(".tiptap-prompt")).toHaveCount(0);
  const panel = f.panel(0);
  const trigger = owner.getByRole("button", { name: "打开 图像甲 模型与参数", exact: true });
  // Exercise the complete native pointer sequence. Selection belongs to click,
  // after delivery, so pointerdown cannot reconcile away its intended target.
  await trigger.hover();
  const triggerBounds = (await trigger.boundingBox())!;
  await page.mouse.move(triggerBounds.x + triggerBounds.width / 2, triggerBounds.y + triggerBounds.height / 2);
  await page.mouse.down();
  try {
    await expect(owner).not.toHaveClass(/\bselected\b/u);
    await expect(panel).toHaveCount(0);
  } finally { await page.mouse.up(); }
  await expect(panel).toBeVisible();
  await expect(panel.getByLabel("图片宽度", { exact: true })).toBeEditable();
  await expect(owner).toHaveClass(/\bselected\b/u);
  await expect(owner.locator(".tiptap-prompt")).toHaveCount(0);
  expect(await panel.evaluate(element => element.closest(".react-flow__node") === null)).toBe(true);
  await expect.poll(() => page.locator(".react-flow__node").count()).toBeLessThan(20);
  await expect.poll(() => panel.evaluate(element => element.getAnimations().some(animation => animation.playState === "running"))).toBe(false);
  const before = await panel.boundingBox();
  expect(before).not.toBeNull();
  const panelElement = await panel.elementHandle();
  expect(panelElement).not.toBeNull();
  await page.mouse.move(1200, 820); await page.mouse.down({ button: "middle" });
  await page.mouse.move(80, 820, { steps: 20 }); await page.mouse.up({ button: "middle" });
  await expect(page.locator('.react-flow__node[data-id="dock-0"]')).toHaveCount(0);
  await expect(panel).toBeVisible();
  expect(await panel.evaluate((element, previous) => element === previous, panelElement!)).toBe(true);
  await panelElement!.dispose();
  const after = await panel.boundingBox();
  expect(after).not.toBeNull();
  expect(Math.abs(after!.x - before!.x)).toBeLessThanOrEqual(1);
  expect(Math.abs(after!.y - before!.y)).toBeLessThanOrEqual(1);
  await panel.getByRole("spinbutton", { name: "数量", exact: true }).fill("3");
  await panel.getByRole("spinbutton", { name: "数量", exact: true }).press("Tab");
  await expect.poll(async () => (await f.saved()).nodes.find(node => node.id === "dock-0")?.data.parameters?.n).toBe(3);
  const graph = await f.saved();
  expect(graph.nodes.find(node => node.id === "dock-0")?.position).toEqual({ x: 120, y: 160 });
  expect(graph.nodes.find(node => node.id === "dock-1")?.data.parameters?.n).toBe(1);
  expect(JSON.stringify(graph)).not.toMatch(/onRequestConfiguration|registerPanelElement|openNodeIds|settingsHost/);
  f.assertSafe();
});

test("两个参数实例保留独立滚动，Esc提交活动卡W/H草稿且仅关闭该卡", async ({ page, request }) => {
  const f = await fixture(page, request);
  await f.open(0);
  const first = f.panel(0), body = first.locator(".node-config-popover-body");
  await body.evaluate(element => { element.scrollTop = 180; });
  const scrollTop = await body.evaluate(element => element.scrollTop);
  expect(scrollTop).toBeGreaterThan(0);
  await f.open(1);
  const second = f.panel(1);
  await expect(first).toBeVisible();
  await second.getByLabel("图片宽度", { exact: true }).fill("2304");
  await second.getByLabel("图片宽度", { exact: true }).press("Escape");
  await expect(second).toHaveCount(0);
  await expect(first).toBeVisible();
  await expect.poll(() => body.evaluate(element => element.scrollTop)).toBe(scrollTop);
  await expect.poll(async () => (await f.saved()).nodes.find(node => node.id === "dock-1")?.data.parameters?.size).toBe("2304x2048");
  expect((await f.saved()).nodes.find(node => node.id === "dock-0")?.data.parameters?.size).toBe("2048x2048");
  await first.getByLabel("图片宽度", { exact: true }).fill("3072");
  await first.getByLabel("图片宽度", { exact: true }).press("Enter");
  await expect(first).toBeVisible();
  await expect.poll(async () => (await f.saved()).nodes.find(node => node.id === "dock-0")?.data.parameters?.size).toBe("3072x2048");
  await first.getByRole("button", { name: "关闭模型与参数面板", exact: true }).click();
  await page.reload(); await f.open(0);
  await expect(f.panel(0).getByLabel("图片宽度", { exact: true })).toHaveValue("3072");
  await expect(f.panel(0).getByLabel("图片高度", { exact: true })).toHaveValue("2048");
  f.assertSafe();
});

test("窄屏参数标签保留未完成宽度、可选对齐和每卡滚动", async ({ page, request }) => {
  const f = await fixture(page, request);
  await f.open(0); await f.open(1);
  await page.setViewportSize({ width: 1024, height: 768 });
  const first = f.panel(0), second = f.panel(1);
  const tabs = page.getByRole("tablist", { name: "已打开的节点参数", exact: true });
  const firstTab = tabs.getByRole("tab", { name: "图像甲", exact: true });
  const secondTab = tabs.getByRole("tab", { name: "图像乙", exact: true });
  await expect(firstTab).toHaveAttribute("aria-controls", "canvas-parameters-dock-0");
  await expect(secondTab).toHaveAttribute("aria-controls", "canvas-parameters-dock-1");
  await expect(first).toHaveAttribute("id", "canvas-parameters-dock-0");
  await expect(second).toHaveAttribute("id", "canvas-parameters-dock-1");
  await secondTab.focus(); await secondTab.press("Home");
  await expect(firstTab).toBeFocused();
  await expect(firstTab).toHaveAttribute("tabindex", "0");
  await expect(secondTab).toHaveAttribute("tabindex", "-1");
  await firstTab.press("End");
  await expect(secondTab).toBeFocused();
  await secondTab.press("Home");
  await expect(first).toBeVisible(); await expect(second).toBeHidden();
  const alignment = first.getByRole("checkbox", { name: "16 倍数对齐", exact: true });
  await alignment.check();
  await first.getByLabel("图片宽度", { exact: true }).fill("");
  const body = first.locator(".node-config-popover-body");
  await body.evaluate(element => { element.scrollTop = 160; });
  const top = await body.evaluate(element => element.scrollTop);
  expect(top).toBeGreaterThan(0);
  await firstTab.focus(); await firstTab.press("ArrowRight");
  await expect(secondTab).toBeFocused();
  // Hidden, keyed instances stay mounted. An incomplete field must not turn
  // into a different valid size merely because another card becomes active.
  await expect(first).toHaveCount(1); await expect(first).toBeHidden();
  await expect(second).toBeVisible();
  await second.getByRole("spinbutton", { name: "数量", exact: true }).fill("2");
  await second.getByRole("spinbutton", { name: "数量", exact: true }).press("Tab");
  await secondTab.focus(); await secondTab.press("ArrowLeft");
  await expect(firstTab).toBeFocused();
  await expect(first.getByLabel("图片宽度", { exact: true })).toHaveValue("");
  await expect(alignment).toBeChecked();
  await expect.poll(() => body.evaluate(element => element.scrollTop)).toBe(top);
  expect((await f.saved()).nodes.find(node => node.id === "dock-0")?.data.parameters?.size).toBe("2048x2048");
  await first.getByLabel("图片宽度", { exact: true }).fill("2304");
  await first.getByLabel("图片宽度", { exact: true }).press("Enter");
  await expect.poll(async () => (await f.saved()).nodes.find(node => node.id === "dock-0")?.data.parameters?.size).toBe("2304x2048");
  await expect.poll(async () => (await f.saved()).nodes.find(node => node.id === "dock-1")?.data.parameters?.n).toBe(2);
  f.assertSafe();
});

test("原生参数下拉首Esc关闭菜单，次Esc仅关闭活动参数卡", async ({ page, request }) => {
  const f = await fixture(page, request);
  await f.open(0); await f.open(1);
  const first = f.panel(0), second = f.panel(1);
  const quality = second.getByRole("combobox", { name: "质量", exact: true });
  await quality.click();
  await expect.poll(() => quality.evaluate(element => element.matches(":open"))).toBe(true);
  await page.keyboard.press("Escape");
  await expect.poll(() => quality.evaluate(element => element.matches(":open"))).toBe(false);
  await expect(quality).toBeFocused();
  await expect(first).toBeVisible(); await expect(second).toBeVisible();
  await expect(quality).toHaveValue("max");
  await page.keyboard.press("Escape");
  await expect(second).toHaveCount(0);
  await expect(first).toBeVisible();
  f.assertSafe();
});

for (const focusScope of ["card", "field"] as const) {
  test(`非模态参数${focusScope === "card" ? "卡片" : "字段"}内Ctrl+K打开命令，Esc逐层恢复焦点和宽度草稿`, async ({ page, request }) => {
    const f = await fixture(page, request);
    await f.open(0); await f.open(1);
    const first = f.panel(0), second = f.panel(1);
    const width = second.getByLabel("图片宽度", { exact: true });
    await expect(second).toHaveAttribute("role", "dialog");
    await expect(second).not.toHaveAttribute("aria-modal", "true");
    // An incomplete draft cannot be committed. Opening a command modal must
    // keep this keyed nonmodal card and its input state instead of rebuilding it.
    await width.fill("");
    const origin = focusScope === "card" ? second : width;
    await origin.focus();
    await expect(origin).toBeFocused();
    await origin.press("Control+k");

    const commands = page.getByRole("dialog", { name: "快捷操作", exact: true });
    const search = commands.getByRole("combobox", { name: "搜索画布操作", exact: true });
    await expect(commands).toBeVisible();
    await expect(search).toBeFocused();
    await expect(first).toBeVisible(); await expect(second).toBeVisible();
    await expect(width).toHaveValue("");
    await search.fill("图片");
    await search.press("Escape");

    await expect(commands).toHaveCount(0);
    await expect(first).toBeVisible(); await expect(second).toBeVisible();
    await expect(origin).toBeFocused();
    await expect(width).toHaveValue("");
    expect((await f.saved()).nodes.find(node => node.id === "dock-1")?.data.parameters?.size).toBe("2048x2048");
    // Only the next physical Escape reaches the active parameter card; its
    // sibling remains open and the incomplete size has not replaced saved data.
    await page.keyboard.press("Escape");
    await expect(second).toHaveCount(0);
    await expect(first).toBeVisible();
    expect((await f.saved()).nodes.find(node => node.id === "dock-1")?.data.parameters?.size).toBe("2048x2048");
    f.assertSafe();
  });
}
