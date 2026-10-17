import { expect, test, type Page } from "./helpers/canvas-offline-test";

type DrawingProbe = { draftWrites: number; pointerId: number; wheels: Array<{ trusted: boolean; prevented: boolean; ctrl: boolean }> };
declare global { interface Window { __drawingUiProbe: DrawingProbe } }

/** Pure UI/API mocks, with no real profile or supplier/paid network request. */
async function fixture(page: Page, emptyInitial = false) {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.addInitScript(() => {
    localStorage.setItem("super-canvas:inspector-open", "false");
    window.__drawingUiProbe = { draftWrites: 0, pointerId: 0, wheels: [] };
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function(value: unknown, key?: IDBValidKey) {
      if (this.name === "drafts") window.__drawingUiProbe.draftWrites++;
      return key === undefined ? put.call(this, value) : put.call(this, value, key);
    };
  });
  const id = "drawing-history-wheel-isolated";
  const canvas = { id, title: "绘制历史与缩放回归", revision: 1, graph: {
    schemaVersion: 1, viewport: { x: 0, y: 0, zoom: 1 }, edges: [], drawings: [],
    nodes: [{ id: "drawing-prompt", type: "workflow", position: { x: 140, y: 150 },
      data: { nodeType: "prompt", label: "绘制回归提示词", parts: [{ type: "text", text: "不提交生成" }], inputs: [],
        outputs: [{ id: "text", kind: "text", label: "文本" }] } }],
  } };
  const other = { ...canvas, id: `${id}-next`, title: "下一张隔离画布", graph: { ...canvas.graph,
    viewport: { x: 40, y: 70, zoom: .75 }, nodes: [{ ...canvas.graph.nodes[0]!, id: "drawing-other-prompt",
      data: { ...canvas.graph.nodes[0]!.data, label: "下一张画布的提示词" } }] } };
  if (emptyInitial) {
    canvas.graph.nodes = [];
    canvas.graph.viewport = { x: -123.25, y: 87.5, zoom: .63 };
  }
  const errors: string[] = [];
  let external = 0, submissions = 0, saves = 0;
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (["error", "warning"].includes(message.type())) errors.push(message.text()); });
  await page.route("**/*", route => {
    const request = route.request(), url = new URL(request.url());
    if (!/^(localhost|127\.0\.0\.1)$/.test(url.hostname) && !["data:", "blob:", "about:"].includes(url.protocol)) {
      external++; return route.abort("blockedbyclient");
    }
    if (!url.pathname.startsWith("/api/")) return route.continue();
    if (request.method() === "POST" && ["/api/runs", "/api/agent/turn"].includes(url.pathname)) {
      submissions++; return route.fulfill({ status: 400, json: { error: "This UI fixture never submits" } });
    }
    if (url.pathname === "/api/projects") return route.fulfill({ json: { projects: [canvas, other].map(project => ({
      id: project.id, title: project.title, nodeCount: project.graph.nodes.length, createdAt: "2026-10-15T00:00:00Z", updatedAt: "2026-10-15T00:00:00Z" })) } });
    const target = [canvas, other].find(project => url.pathname === `/api/canvas/${project.id}`);
    if (target) {
      if (request.method() === "PUT") { target.graph = request.postDataJSON().graph; target.revision++; saves++; }
      return route.fulfill({ json: target });
    }
    if (["/api/providers", "/api/suppliers", "/api/assets", "/api/runs", "/api/agent/models", "/api/agent/sessions", "/api/integrations/material-drops"].includes(url.pathname)) return route.fulfill({ json: [] });
    return route.fulfill({ json: { items: [], messages: [], sessions: [], groups: [], runs: [], drops: [] } });
  });
  await page.goto(`/canvas/${id}`);
  if (emptyInitial) await expect(page.getByRole("heading", { name: "让灵感，在这里发生", exact: true })).toBeVisible();
  else await expect(page.locator('.react-flow__node[data-id="drawing-prompt"]')).toBeVisible();
  await expect(page.getByRole("button", { name: "画布自动保存状态", exact: true })).toContainText("已保存");
  const history = page.locator('[data-canvas-island="actions"]');
  return { id, graph: () => canvas.graph, saves: () => saves, nextGraph: () => other.graph, nextId: other.id,
    undo: history.getByRole("button", { name: "撤销", exact: true }), redo: history.getByRole("button", { name: "重做", exact: true }),
    check: () => expect({ external, submissions, errors }).toEqual({ external: 0, submissions: 0, errors: [] }) };
}

async function drawingLayer(page: Page) {
  await page.getByRole("button", { name: "画笔模式", exact: true }).click();
  const layer = page.locator(".canvas-drawing-input-layer");
  await expect(layer).toBeVisible();
  await layer.evaluate(element => {
    element.addEventListener("pointerdown", event => { window.__drawingUiProbe.pointerId = (event as PointerEvent).pointerId; });
    element.addEventListener("wheel", event => {
      const wheel = event as WheelEvent;
      window.__drawingUiProbe.wheels.push({ trusted: wheel.isTrusted, prevented: wheel.defaultPrevented, ctrl: wheel.ctrlKey });
    }, { passive: true });
  });
  const bounds = (await layer.boundingBox())!;
  const point = { x: bounds.x + bounds.width * .55, y: bounds.y + bounds.height * .55 };
  return { layer, point };
}

async function viewport(page: Page) {
  return page.locator(".react-flow__viewport").evaluate(element => {
    const matrix = new DOMMatrixReadOnly(getComputedStyle(element).transform);
    return { x: matrix.m41, y: matrix.m42, zoom: matrix.a };
  });
}

test("空画布的非默认视口在首次加载、项目切换与刷新后恢复，初始化不额外保存", async ({ page }) => {
  await page.clock.install();
  const f = await fixture(page, true);
  const emptyViewport = { ...f.graph().viewport };
  const nextViewport = { ...f.nextGraph().viewport };
  const assertRestored = async (expected: typeof emptyViewport, expectedSaves: number) => {
    await expect.poll(async () => (await viewport(page)).zoom).toBeCloseTo(expected.zoom, 5);
    await expect.poll(async () => Math.max(
      Math.abs((await viewport(page)).x - expected.x),
      Math.abs((await viewport(page)).y - expected.y),
    )).toBeLessThan(.01);
    // Drain onInit and the autosave debounce before proving that a late
    // placeholder moveEnd cannot enqueue an extra PUT.
    await page.clock.runFor(1200);
    const actual = await viewport(page);
    expect(actual.zoom).toBeCloseTo(expected.zoom, 5);
    expect(Math.abs(actual.x - expected.x)).toBeLessThan(.01);
    expect(Math.abs(actual.y - expected.y)).toBeLessThan(.01);
    expect(f.saves()).toBe(expectedSaves);
    expect(f.graph().viewport).toEqual(emptyViewport);
    expect(f.nextGraph().viewport).toEqual(nextViewport);
    f.check();
  };
  await expect(page.locator(".react-flow__node")).toHaveCount(0);
  await assertRestored(emptyViewport, 0);

  const switchProject = async (title: string, id: string) => {
    await page.getByRole("button", { name: "打开画布列表", exact: true }).click();
    const target = page.locator(".project-row-main").filter({ hasText: title });
    await expect(target).toBeVisible();
    await target.focus();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(new RegExp(`/canvas/${id}$`));
    await expect(page.getByRole("button", { name: "重命名当前画布", exact: true })).toHaveText(title);
    await expect(page.getByRole("button", { name: "画布自动保存状态", exact: true })).toContainText("已保存");
  };
  await switchProject("下一张隔离画布", f.nextId);
  await expect(page.locator('.react-flow__node[data-id="drawing-other-prompt"]')).toBeVisible();
  // Existing project navigation explicitly flushes the canvas once. Count
  // that required save, while rejecting any new initialization-only write.
  await assertRestored(nextViewport, 1);
  await switchProject("绘制历史与缩放回归", f.id);
  await expect(page.locator(".react-flow__node")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "让灵感，在这里发生", exact: true })).toBeVisible();
  await assertRestored(emptyViewport, 2);

  await page.reload();
  await expect(page.getByRole("heading", { name: "让灵感，在这里发生", exact: true })).toBeVisible();
  await expect(page.locator(".react-flow__node")).toHaveCount(0);
  await assertRestored(emptyViewport, 2);
});

test("太小和取消的绘制不创建空历史、不清重做；有效绘制仍可撤销重做并保存", async ({ page }) => {
  const f = await fixture(page);
  await page.getByRole("button", { name: "添加节点", exact: true }).click();
  await page.getByRole("menu", { name: "添加创作节点", exact: true }).getByRole("menuitem", { name: /^Prompt/ }).click();
  const added = page.locator('.react-flow__node[data-id^="prompt-"]');
  await expect(added).toHaveCount(1);
  const addedId = await added.getAttribute("data-id");
  await f.undo.click();
  await expect(added).toHaveCount(0);
  await expect(f.redo).toBeEnabled();
  const { layer, point } = await drawingLayer(page);
  await page.getByRole("button", { name: "矩形工具", exact: true }).click();
  await page.mouse.move(point.x, point.y); await page.mouse.down();
  await page.mouse.move(point.x + 1, point.y + 1); await page.mouse.up();
  await expect(page.locator(".canvas-drawing-stroke")).toHaveCount(0);
  await expect(f.redo).toBeEnabled();
  await expect(f.undo).toBeDisabled();
  await page.mouse.move(point.x, point.y); await page.mouse.down();
  await page.mouse.move(point.x + 80, point.y + 60, { steps: 4 });
  await expect(page.locator(".canvas-drawing-stroke.active")).toHaveCount(1);
  const pointerId = await page.evaluate(() => window.__drawingUiProbe.pointerId);
  expect(pointerId).toBeGreaterThan(0);
  await layer.dispatchEvent("pointercancel", { pointerId, pointerType: "mouse", bubbles: true,
    clientX: point.x + 80, clientY: point.y + 60 });
  // Assert before normal mouse-up, so it cannot hide a failed cancel cleanup.
  await expect(page.locator(".canvas-drawing-stroke")).toHaveCount(0);
  await expect(f.redo).toBeEnabled();
  await expect(f.undo).toBeDisabled();
  await page.mouse.up();
  await f.redo.click();
  await expect(added).toHaveAttribute("data-id", addedId!);
  await expect(f.redo).toBeDisabled();
  await page.mouse.move(point.x, point.y); await page.mouse.down();
  await page.mouse.move(point.x + 90, point.y + 60, { steps: 4 }); await page.mouse.up();
  const stroke = page.locator(".canvas-drawing-stroke:not(.active)");
  await expect(stroke).toHaveCount(1);
  await f.undo.click(); await expect(stroke).toHaveCount(0);
  await f.redo.click(); await expect(stroke).toHaveCount(1);
  await expect.poll(() => f.graph().drawings.length).toBe(1);
  expect(f.graph().nodes.map(node => node.id)).toEqual(["drawing-prompt", addedId]);
  f.check();
});

test("绘制真实滚轮正确阻止浏览器缩放，批量更新后仅持久化一次且CtrlS和切模式可flush", async ({ page }) => {
  await page.clock.install();
  const f = await fixture(page);
  const { layer, point } = await drawingLayer(page);
  await page.clock.pauseAt(await page.evaluate(() => Date.now() + 1000));
  await page.evaluate(() => { window.__drawingUiProbe.draftWrites = 0; });
  const before = await viewport(page);
  const width = await page.evaluate(() => innerWidth);
  await page.mouse.move(point.x, point.y);
  await page.keyboard.down("Control");
  await page.mouse.wheel(0, -80);
  await page.keyboard.up("Control");
  await expect.poll(() => page.evaluate(() => window.__drawingUiProbe.wheels.filter(event => event.trusted).length)).toBe(1);
  expect(await page.evaluate(() => window.__drawingUiProbe.wheels[0])).toEqual({ trusted: true, prevented: true, ctrl: true });
  await page.clock.runFor(17);
  await expect.poll(async () => (await viewport(page)).zoom).toBeGreaterThan(before.zoom);
  expect(await page.evaluate(() => window.__drawingUiProbe.draftWrites)).toBe(0);
  // More wheel events in the same frame exercise actual native event binding
  // and batching without relying on machine-dependent input timing.
  await layer.evaluate((element, position) => {
    for (let index = 0; index < 8; index++) element.dispatchEvent(new WheelEvent("wheel", {
      deltaY: -4, clientX: position.x, clientY: position.y, bubbles: true, cancelable: true,
    }));
  }, point);
  await page.clock.runFor(17);
  expect(await page.evaluate(() => window.__drawingUiProbe.draftWrites)).toBe(0);
  await page.clock.runFor(160);
  await expect.poll(() => page.evaluate(() => window.__drawingUiProbe.draftWrites)).toBe(1);
  await page.clock.runFor(700);
  await expect.poll(() => f.graph().viewport.zoom).toBeGreaterThan(before.zoom);
  const saved = await viewport(page);
  expect(f.graph().viewport.zoom).toBeCloseTo(saved.zoom, 5);
  // CSS matrix serialization rounds translations. Compare rendered CSS pixels,
  // retaining a strict sub-pixel bound without changing persisted coordinates.
  expect(Math.abs(f.graph().viewport.x - saved.x)).toBeLessThan(.01);
  expect(Math.abs(f.graph().viewport.y - saved.y)).toBeLessThan(.01);
  expect(await page.evaluate(() => innerWidth)).toBe(width);
  const saves = f.saves();
  const previousZoom = saved.zoom;
  await page.keyboard.down("Control");
  await page.mouse.wheel(0, -60);
  await expect.poll(() => page.evaluate(() => window.__drawingUiProbe.wheels.filter(event => event.trusted).length)).toBe(2);
  // No animation frame has run: Ctrl+S must flush the pending viewport first.
  await page.keyboard.press("s"); await page.keyboard.up("Control");
  await expect.poll(() => f.graph().viewport.zoom).toBeGreaterThan(previousZoom);
  await expect.poll(() => f.saves()).toBe(saves + 1);
  await page.clock.runFor(900);
  expect(f.saves()).toBe(saves + 1);
  const beforeHideZoom = f.graph().viewport.zoom;
  const beforeHideSaves = f.saves();
  await page.mouse.wheel(0, -45);
  await expect.poll(() => page.evaluate(() => window.__drawingUiProbe.wheels.filter(event => event.trusted).length)).toBe(3);
  // pagehide must materialize the still-pending frame before the shared
  // keepalive save reads pendingSave, not wait for its 160ms/650ms deadlines.
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent("pagehide")));
  await expect.poll(() => f.graph().viewport.zoom).toBeGreaterThan(beforeHideZoom);
  await expect.poll(() => f.saves()).toBe(beforeHideSaves + 1);
  await page.clock.runFor(900);
  expect(f.saves()).toBe(beforeHideSaves + 1);
  const priorModeZoom = f.graph().viewport.zoom;
  await page.mouse.wheel(0, -40);
  await expect.poll(() => page.evaluate(() => window.__drawingUiProbe.wheels.filter(event => event.trusted).length)).toBe(4);
  await page.getByRole("button", { name: "抓手模式", exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(layer).toHaveCount(0);
  await page.clock.runFor(700);
  await expect.poll(() => f.graph().viewport.zoom).toBeGreaterThan(priorModeZoom);
  expect(f.graph().drawings).toEqual([]);
  f.check();
});

test("绘制缩放首帧前切换项目先保存旧画布，旧cleanup不修改新画布", async ({ page }) => {
  await page.clock.install();
  const f = await fixture(page);
  const { point } = await drawingLayer(page);
  const next = page.locator(".project-row-main[title='下一张隔离画布']");
  const nextViewport = { ...f.nextGraph().viewport };
  await page.clock.pauseAt(await page.evaluate(() => Date.now() + 1000));
  await page.mouse.move(point.x, point.y);
  await page.mouse.wheel(0, -90);
  await expect.poll(() => page.evaluate(() => window.__drawingUiProbe.wheels.filter(event => event.trusted).length)).toBe(1);
  // The floating project list now owns a backdrop. Queue the wheel on the
  // actual drawing layer first, then open the existing project switch without
  // advancing the clock: its pending first frame must still flush on leaving.
  await page.getByRole("button", { name: "打开画布列表", exact: true }).click();
  await expect(next).toBeVisible();
  // Use the existing keyboard-operable project switch, not an injected router.
  await next.focus(); await page.keyboard.press("Enter");
  await expect(page).toHaveURL(new RegExp(`/canvas/${f.nextId}$`));
  await expect(page.locator('.react-flow__node[data-id="drawing-other-prompt"]')).toHaveCount(1);
  await page.clock.runFor(50);
  await expect(page.locator('.react-flow__node[data-id="drawing-other-prompt"]')).toBeVisible();
  await expect.poll(() => f.graph().viewport.zoom).toBeGreaterThan(1);
  await page.clock.runFor(1200);
  expect(f.graph().nodes.map(node => node.id)).toEqual(["drawing-prompt"]);
  expect(f.nextGraph().nodes.map(node => node.id)).toEqual(["drawing-other-prompt"]);
  expect(f.nextGraph().viewport).toEqual(nextViewport);
  const current = await viewport(page);
  expect(current.zoom).toBeCloseTo(nextViewport.zoom, 5);
  expect(Math.abs(current.x - nextViewport.x)).toBeLessThan(.01);
  expect(Math.abs(current.y - nextViewport.y)).toBeLessThan(.01);
  f.check();
});
