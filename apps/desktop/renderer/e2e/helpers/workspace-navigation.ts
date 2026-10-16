import { expect, type Page } from "@playwright/test";

/** Open the same saved project through the replacement's module/analysis layers. */
export async function openWorkspaceProject(page: Page, projectId: string) {
  await page.getByTestId("neural-module-canvases").click();
  await page.getByTestId(`neural-item-${projectId}`).click();
  const analysis = page.getByTestId("neural-inspector");
  await expect(analysis).toBeVisible();
  await analysis.getByRole("button", { name: "打开画布", exact: true }).click();
}
