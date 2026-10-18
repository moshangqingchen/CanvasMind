import { expect, type Page } from "@playwright/test";

/** Hub hit areas intentionally float with the scene, so wait for a real hit, not a stationary animation frame. */
export async function clickWorkspaceModule(
  page: Page,
  module: "canvases" | "suppliers" | "accounts" | "starts",
  options: { timeout?: number } = {},
) {
  const button = page.getByTestId(`neural-module-${module}`);
  await expect(button).toBeVisible(options);
  await expect(button).toBeEnabled(options);
  await expect(button).toBeInViewport(options);
  const hitPoint = () => button.evaluate(element => {
    if (!(element instanceof HTMLButtonElement) || element.disabled ||
        element.getAttribute("aria-disabled") === "true" || element.closest("[inert]")) return null;
    const bounds = element.getBoundingClientRect();
    const x = bounds.left + bounds.width / 2, y = bounds.top + bounds.height / 2;
    if (bounds.width <= 0 || bounds.height <= 0 || x < 0 || y < 0 || x >= innerWidth || y >= innerHeight) return null;
    const hit = document.elementFromPoint(x, y);
    return hit === element || hit && element.contains(hit) ? { x, y } : null;
  }, undefined, options);
  const waitForHit = async () => {
    await expect.poll(hitPoint, { ...options, message: "浮动模块的当前中心须在视口内并真实命中目标按钮" }).not.toBeNull();
    const point = await hitPoint();
    expect(point, "鼠标操作前仍须真实命中目标按钮").not.toBeNull();
    return point!;
  };
  const initial = await waitForHit();
  await page.mouse.move(initial.x, initial.y);
  // Hover may change overlays or the scene position. Check again immediately
  // before the physical click instead of dispatching or forcing a DOM action.
  const point = await waitForHit();
  await page.mouse.click(point.x, point.y);
  await expect(page.getByTestId("neural-workspace")).toHaveAttribute("data-module", module, options);
}

/** Open the same saved project through the replacement's module/analysis layers. */
export async function openWorkspaceProject(page: Page, projectId: string) {
  await clickWorkspaceModule(page, "canvases");
  await page.getByTestId(`neural-item-${projectId}`).click();
  const analysis = page.getByTestId("neural-inspector");
  await expect(analysis).toBeVisible();
  await analysis.getByRole("button", { name: "打开画布", exact: true }).click();
}
