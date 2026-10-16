import { expect, type Locator, type Page } from "@playwright/test";

/** Wait for the real transform to stop changing, including rAF FitView. */
export async function waitForCanvasViewportStable(page: Page) {
  let previous = "", stableSince = Date.now();
  await expect.poll(async () => {
    const transform = await page.locator(".react-flow__viewport").evaluate(element => getComputedStyle(element).transform);
    if (transform !== previous) { previous = transform; stableSince = Date.now(); }
    return Date.now() - stableSince;
  }, { timeout: 2_000, intervals: [50], message: "画布实际transform须连续200ms稳定" }).toBeGreaterThanOrEqual(200);
}

/** Check a genuine port hit; never force a drag through an overlay. */
export async function canvasHandlePoint(handle: Locator) {
  await expect(handle).toBeVisible();
  await handle.hover({ timeout: 10_000 });
  await expect.poll(() => handle.evaluate(element => {
    const box = element.getBoundingClientRect(), hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
    return hit === element || Boolean(hit && element.contains(hit));
  }), { timeout: 10_000, message: "端口圆心必须真实命中handle" }).toBe(true);
  const box = await handle.boundingBox(); expect(box).not.toBeNull();
  return { x: box!.x + box!.width / 2, y: box!.y + box!.height / 2 };
}

/** Click exposed canvas space, excluding nodes, panels and floating toolbars. */
export async function clickBlankCanvas(page: Page) {
  const pane = page.locator(".react-flow__pane");
  await expect(pane).toBeVisible();
  const blankPosition = () => pane.evaluate(element => {
    const bounds = element.getBoundingClientRect();
    const left = Math.max(bounds.left + 16, 16);
    const right = Math.min(bounds.right - 16, window.innerWidth - 16);
    const top = Math.max(bounds.top + 16, 16);
    const bottom = Math.min(bounds.bottom - 16, window.innerHeight - 16);
    if (left > right || top > bottom) return null;
    const columns = [0.5, 0.25, 0.75, 0.125, 0.875];
    for (let y = top; y <= bottom; y += 48) {
      for (const fraction of columns) {
        const x = left + (right - left) * fraction;
        if (document.elementFromPoint(x, y) === element)
          return { x: x - bounds.left, y: y - bounds.top };
      }
    }
    return null;
  });
  await expect.poll(blankPosition, { message: "画布应有可点击的可见空白区域" }).not.toBeNull();
  const position = await blankPosition();
  expect(position).not.toBeNull();
  await pane.click({ position: position! });
}

/** Real wheel zoom, including with a root-owned parameter card open. */
export async function setCanvasZoomWithWheel(page: Page, target: number) {
  await waitForCanvasViewportStable(page);
  const viewport = page.locator(".react-flow__viewport");
  const currentZoom = () => viewport.evaluate(element => element.getBoundingClientRect().width / (element as HTMLElement).offsetWidth);
  const point = await page.locator(".react-flow__pane").evaluate(element => {
    const bounds = element.getBoundingClientRect();
    const points: { x: number; y: number; distance: number }[] = [];
    for (let y = Math.max(88, bounds.top + 16); y < Math.min(innerHeight - 88, bounds.bottom - 16); y += 36)
      for (let x = Math.max(96, bounds.left + 16); x < Math.min(innerWidth - 32, bounds.right - 16); x += 36)
        if (document.elementFromPoint(x, y) === element) points.push({ x, y, distance: Math.hypot(x - innerWidth / 2, y - innerHeight / 2) });
    return points.sort((a, b) => a.distance - b.distance)[0] ?? null;
  });
  expect(point, "缩放必须命中真实画布空白，不是面板或悬浮工具").not.toBeNull();
  await page.mouse.move(point!.x, point!.y);
  for (let attempt = 0; attempt < 3; attempt++) {
    const zoom = await currentZoom();
    if (Math.abs(zoom - target) < .001) break;
    await page.mouse.wheel(0, Math.log(zoom / target) / (Math.LN2 * .002));
    await page.waitForTimeout(220);
  }
  await expect.poll(currentZoom).toBeCloseTo(target, 2);
  await waitForCanvasViewportStable(page);
}
