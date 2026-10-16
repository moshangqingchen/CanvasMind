import { expect, type Locator } from "@playwright/test";

/** Verify the visible line without depending on viewport scale or a CSS mask. */
export async function expectCompactPromptLine(text: Locator) {
  await expect(text).toBeVisible();
  await expect(text).toHaveCSS("clip-path", "none");
  await expect(text).toHaveCSS("overflow", "hidden");
  const size = await text.evaluate(element => {
    const style = getComputedStyle(element);
    return { height: (element as HTMLElement).offsetHeight, line: parseFloat(style.lineHeight),
      inset: parseFloat(style.paddingTop) + parseFloat(style.paddingBottom) +
        parseFloat(style.borderTopWidth) + parseFloat(style.borderBottomWidth) };
  });
  expect(size.height).toBeGreaterThan(0);
  expect(size.height).toBeLessThanOrEqual(size.line + size.inset + 1);
}
