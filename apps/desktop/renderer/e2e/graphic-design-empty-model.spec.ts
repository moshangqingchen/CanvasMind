import { expect, test } from "@playwright/test";
import { installPhase3LargeFixture } from "./helpers/phase3-large-fixtures";

test("平面设计未选模型时引导选择，不误报尺寸不支持或提供删除预设操作", async ({ page }) => {
  const fixture = await installPhase3LargeFixture(page);
  await page.goto(`/canvas/${fixture.canvasId}`);
  await page.getByRole("button", { name: "打开平面设计", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "平面设计", exact: true });
  await expect(dialog.getByText("先选择图片模型，再设置输出尺寸。", { exact: true })).toBeVisible();
  await expect(dialog.getByText(/种已选尺寸不受当前模型支持/u)).toHaveCount(0);
  await expect(dialog.getByRole("button", { name: "移除不支持的尺寸", exact: true })).toHaveCount(0);
  await expect(dialog.getByRole("button", { name: "生成设计", exact: true })).toBeDisabled();
  expect(fixture.prohibited).toEqual([]); expect(fixture.unexpected).toEqual([]);
  expect(fixture.errors).toEqual([]); expect(fixture.warnings).toEqual([]);
});
