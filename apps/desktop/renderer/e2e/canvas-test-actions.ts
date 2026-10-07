import { expect, type Page } from "@playwright/test";

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
