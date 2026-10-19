import { expect, test, type APIRequestContext, type Page } from "./helpers/canvas-offline-test";

async function openCanvas(page: Page, request: APIRequestContext) {
  await page.setViewportSize({ width: 1600, height: 1000 });
  let submissions = 0;
  await page.route("**/api/runs", async (route) => {
    if (route.request().method() === "POST") {
      submissions++;
      await route.abort();
    } else await route.continue();
  });
  const response = await request.post("/api/canvas", { data: {
    title: `隔离动效生命周期回归 ${crypto.randomUUID()}`,
    graph: {
      schemaVersion: 1,
      viewport: { x: 0, y: 0, zoom: 1 },
      edges: [],
      nodes: [{
        id: "motion-node", type: "workflow", position: { x: 180, y: 150 },
        data: { nodeType: "prompt", label: "拖动回归节点",
          parts: [{ type: "text", text: "离线界面回归，不提交生成" }],
          inputs: [], outputs: [{ id: "prompt", kind: "text", label: "提示词" }] },
      }],
    },
  } });
  expect(response.ok()).toBeTruthy();
  await page.goto(`/canvas/${(await response.json()).id}`);
  const card = page.locator('.react-flow__node[data-id="motion-node"] .node-card');
  await expect(card).toBeVisible();
  return { card, wrap: page.locator(".canvas-wrap"), assertNoRuns: () => expect(submissions).toBe(0) };
}

for (const preference of ["system", "application"] as const) {
  test(`${preference} 减少动态效果仍在拖动时降级阴影，结束后恢复`, async ({ page, request }, testInfo) => {
    if (preference === "system") await page.emulateMedia({ reducedMotion: "reduce" });
    else await page.addInitScript(() => localStorage.setItem("super-canvas:gentle-motion", "off"));
    const { card, wrap, assertNoRuns } = await openCanvas(page, request);
    await expect(page.getByRole("button", { name: "画布动效", exact: true })).toHaveAttribute("aria-pressed", "false");
    const before = await card.evaluate(element => getComputedStyle(element).boxShadow);
    expect(before).not.toBe("none");
    const header = await card.locator(".node-head").boundingBox();
    expect(header).not.toBeNull();
    await page.mouse.move(header!.x + header!.width - 60, header!.y + header!.height / 2);
    await page.mouse.down();
    await expect(wrap).toHaveClass(/is-interacting/);
    await expect(card).toHaveCSS("box-shadow", "none");
    await page.mouse.move(header!.x + header!.width - 20, header!.y + header!.height / 2 + 30, { steps: 4 });
    await page.mouse.up();
    await expect(wrap).not.toHaveClass(/is-interacting/);
    await expect.poll(() => card.evaluate(element => getComputedStyle(element).boxShadow)).not.toBe("none");
    await expect(page.locator(".canvas-toolbar")).toHaveCSS("backdrop-filter", /^blur\((?:12|22)px\) saturate\(1\.6\)$/u);
    await expect(page.locator(".react-flow__controls")).toHaveCSS("backdrop-filter", /^blur\((?:12|22)px\) saturate\(1\.6\)$/u);
    await page.getByRole("button", { name: "API 设置", exact: true }).click();
    const settings = page.getByRole("dialog", { name: "供应商与模型设置", exact: true });
    // Neural settings deliberately replace the 600ms translated entrance with
    // one short opacity-only fade for both reduced-motion preferences.
    await expect(settings).toHaveCSS("animation-name", "neural-settings-fade");
    const reducedEntrance = await settings.evaluate(element => {
      const style = getComputedStyle(element);
      return {
        durationsMs: style.animationDuration.split(",").map(value => Number.parseFloat(value) * (value.trim().endsWith("ms") ? 1 : 1000)),
        iterations: style.animationIterationCount.split(",").map(Number),
        transform: style.transform,
        keyframes: element.getAnimations().flatMap(animation => animation.effect instanceof KeyframeEffect ? animation.effect.getKeyframes() : []),
      };
    });
    await testInfo.attach("reduced-settings-entrance", { body: JSON.stringify(reducedEntrance, null, 2), contentType: "application/json" });
    expect(reducedEntrance.durationsMs.every(duration => Number.isFinite(duration) && duration <= 150)).toBe(true);
    expect(reducedEntrance.iterations.every(iterations => Number.isFinite(iterations) && iterations <= 1)).toBe(true);
    expect(reducedEntrance.transform).toBe("none");
    expect(reducedEntrance.keyframes.length).toBeGreaterThan(0);
    expect(reducedEntrance.keyframes.every(frame => !frame.transform || frame.transform === "none")).toBe(true);
    // The redesigned drawer retains a static 9px glass backdrop in either mode.
    await expect(page.locator(".sm-settings-backdrop")).toHaveCSS("backdrop-filter", "blur(9px) saturate(0.85)");
    assertNoRuns();
  });
}

test("窗口失焦和指针取消清理交互状态，返回后可继续下一次手势", async ({ page, request }) => {
  const { wrap, assertNoRuns } = await openCanvas(page, request);
  await expect(page.getByRole("button", { name: "画布动效", exact: true })).toHaveAttribute("aria-pressed", "true");
  const pane = page.locator(".react-flow__pane");
  for (const event of ["blur", "pointercancel"] as const) {
    await pane.dispatchEvent("pointerdown", { pointerType: "mouse", button: 0, buttons: 1 });
    await expect(wrap).toHaveClass(/is-interacting/);
    await page.evaluate(name => window.dispatchEvent(new Event(name)), event);
    await expect(wrap).not.toHaveClass(/is-interacting/);
    await pane.dispatchEvent("pointerdown", { pointerType: "mouse", buttons: 1 });
    await expect(wrap).toHaveClass(/is-interacting/);
    await page.evaluate(() => window.dispatchEvent(new PointerEvent("pointerup", { pointerType: "mouse" })));
    await expect(wrap).not.toHaveClass(/is-interacting/);
  }
  // Decoration now has an event-driven surface. Cancelled gestures must leave
  // it asleep, with no stale trail or spotlight, before the next interaction.
  await expect(page.getByTestId("canvas-ambient-effects")).toHaveAttribute("data-frame-active", "false");
  await expect(page.getByTestId("canvas-ambient-effects")).toHaveAttribute("data-pointer", "false");
  assertNoRuns();
});

test("滚轮的结束定时器不提前结束仍按住的拖动", async ({ page, request }) => {
  const { wrap, assertNoRuns } = await openCanvas(page, request);
  const pane = page.locator(".react-flow__pane");
  await expect(page.getByRole("button", { name: "画布动效", exact: true })).toHaveAttribute("aria-pressed", "true");
  await pane.dispatchEvent("pointerdown", { pointerType: "mouse", buttons: 1 });
  await expect(wrap).toHaveClass(/is-interacting/);
  await page.evaluate(() => window.dispatchEvent(new PointerEvent("pointerup", { pointerType: "mouse" })));
  await pane.dispatchEvent("wheel", { deltaY: 10 });
  await pane.dispatchEvent("pointerdown", { pointerType: "mouse", button: 0, buttons: 1 });
  await expect(wrap).toHaveClass(/is-interacting/);
  // Cross the wheel debounce while the pointer is still pressed.
  await page.waitForTimeout(210);
  await expect(wrap).toHaveClass(/is-interacting/);
  await page.evaluate(() => window.dispatchEvent(new PointerEvent("pointerup", { pointerType: "mouse" })));
  await expect(wrap).not.toHaveClass(/is-interacting/);
  assertNoRuns();
});

async function gridSnapshot(page: Page) {
  return page.evaluate(() => {
    const viewport = document.querySelector<HTMLElement>(".react-flow__viewport")!;
    // CSSOM serializes transform components to six significant figures. At a
    // small zoom, using that rounded scale as a modulo period accumulates an
    // artificial error across hundreds of tiles. Read the actual painted
    // viewport rectangle against its untransformed parent instead.
    const viewportBounds = viewport.getBoundingClientRect();
    const parentBounds = viewport.parentElement!.getBoundingClientRect();
    const zoom = viewportBounds.width / viewport.offsetWidth;
    const surface = document.querySelector<HTMLElement>(".canvas-dot-grid")!;
    const style = getComputedStyle(surface);
    const offset = new DOMMatrixReadOnly(style.transform);
    const [width, height] = style.backgroundSize.split(/\s+/u).map(Number.parseFloat);
    const radius = Number.parseFloat(style.getPropertyValue("--canvas-dot-radius"));
    const center = Number.parseFloat(style.getPropertyValue("--canvas-dot-center"));
    return {
      x: viewportBounds.x - parentBounds.x, y: viewportBounds.y - parentBounds.y, zoom,
      zoomY: viewportBounds.height / viewport.offsetHeight,
      // The compositor layer includes one tile of negative overscan. Removing
      // that offset exposes the same modulo phase as the former SVG pattern.
      phaseX: offset.m41 + 20 * zoom, phaseY: offset.m42 + 20 * zoom,
      width, height, radius, cx: center, cy: center,
      offsetX: offset.m41, offsetY: offset.m42,
      opacity: Number(style.opacity), backgroundImage: style.backgroundImage,
    };
  });
}

async function expectGridSynced(page: Page) {
  await expect.poll(async () => {
    const grid = await gridSnapshot(page), gap = 20 * grid.zoom;
    // CSS transform serialization may round across a tile boundary. Equivalent
    // phases separated by one complete tile must still paint identically.
    const phaseError = (offset: number, translation: number, period: number) => {
      const delta = Math.abs((offset - translation) % period);
      return Math.min(delta, Math.abs(delta - period));
    };
    const errors = [
      Math.abs(grid.width - gap), Math.abs(grid.height - gap),
      Math.abs(grid.zoomY - grid.zoom),
      phaseError(grid.phaseX, grid.x, gap), phaseError(grid.phaseY, grid.y, gap),
      Math.abs(grid.radius - grid.zoom * .4),
      Math.abs(grid.cx - (gap / 2 - 1 + grid.radius)), Math.abs(grid.cy - (gap / 2 - 1 + grid.radius)),
      // Check the actual painted dot phase, not only internal CSS variables.
      phaseError(grid.offsetX + grid.cx, grid.x - 1 - gap / 2 + grid.radius, gap),
      phaseError(grid.offsetY + grid.cy, grid.y - 1 - gap / 2 + grid.radius, gap),
      Math.abs(grid.opacity - Math.max(0, Math.min(1, (grid.zoom - .15) / .55))),
    ];
    return errors.every(Number.isFinite) ? Math.max(...errors) : Infinity;
  }, { message: "网格相位、间距、点半径和淡出应与真实视口矩阵同步" }).toBeLessThan(.002);
  return gridSnapshot(page);
}

for (const reduced of [false, true]) {
  test(`${reduced ? "系统减少动态效果" : "普通动效"}下点阵网格随真实平移缩放同步，低缩放淡出且没有独立循环`, async ({ page, request }) => {
    if (reduced) await page.emulateMedia({ reducedMotion: "reduce" });
    const { assertNoRuns } = await openCanvas(page, request);
    const surface = page.locator(".canvas-dot-grid");
    const initial = await expectGridSynced(page);
    expect(initial.zoom).toBeCloseTo(1);
    expect(initial.opacity).toBe(1);
    expect(initial.backgroundImage).toContain("radial-gradient(");
    const start = await page.locator(".react-flow__pane").evaluate(element => {
      const bounds = element.getBoundingClientRect();
      for (const x of [.75, .6, .85]) for (const y of [.7, .55, .8]) {
        const point = { x: bounds.x + bounds.width * x, y: bounds.y + bounds.height * y };
        if (document.elementFromPoint(point.x, point.y) === element) return point;
      }
      return null;
    });
    expect(start, "应有真实可拖动的空白画布").not.toBeNull();
    await page.mouse.move(start!.x, start!.y);
    await page.mouse.down();
    await page.mouse.move(start!.x - 237, start!.y - 163, { steps: 8 });
    await page.mouse.up();
    const panned = await expectGridSynced(page);
    expect(panned.x).toBeLessThan(-100);
    expect(panned.y).toBeLessThan(-100);
    expect(panned.phaseX).toBeLessThan(0);
    expect(panned.phaseY).toBeLessThan(0);

    await page.mouse.move(start!.x, start!.y);
    await page.mouse.wheel(0, 600);
    await expect.poll(async () => (await gridSnapshot(page)).zoom).toBeLessThan(.7);
    const faded = await expectGridSynced(page);
    expect(faded.zoom).toBeGreaterThan(.15);
    expect(faded.opacity).toBeGreaterThan(0);
    expect(faded.opacity).toBeLessThan(1);

    for (let step = 0; step < 6 && (await gridSnapshot(page)).zoom > .15; step++) {
      const previousZoom = (await gridSnapshot(page)).zoom;
      await page.mouse.wheel(0, 600);
      await expect.poll(async () => (await gridSnapshot(page)).zoom).toBeLessThan(previousZoom - .0001);
      await expectGridSynced(page);
    }
    const low = await expectGridSynced(page);
    expect(low.zoom).toBeLessThanOrEqual(.15);
    expect(low.opacity).toBe(0);
    await page.getByRole("button", { name: "Zoom In", exact: true }).click();
    await expect.poll(async () => (await gridSnapshot(page)).zoom).toBeGreaterThan(low.zoom);
    await expectGridSynced(page);
    await expect(surface).toHaveCSS("animation-name", "none");
    await expect(surface.locator("animate, animateTransform, animateMotion")).toHaveCount(0);
    expect(await surface.evaluate(element => element.getAnimations({ subtree: true }).filter(animation => animation.effect?.getTiming().iterations === Infinity).length)).toBe(0);
    // Once the real zoom gesture settles, the background must not keep writing
    // attributes through an autonomous frame loop.
    await page.waitForTimeout(250);
    const idleMutations = await surface.evaluate(async element => {
      let count = 0;
      const observer = new MutationObserver(records => { count += records.length; });
      observer.observe(element, { attributes: true, subtree: true });
      await new Promise(resolve => setTimeout(resolve, 150));
      observer.disconnect();
      return count;
    });
    expect(idleMutations).toBe(0);
    assertNoRuns();
  });
}
