import { expect, test } from "./helpers/canvas-offline-test";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { installPhase5StateFixture } from "./helpers/phase5-state-fixture";

const output = process.env.UI_PHASE5_OUTPUT_DIR;
const theme = process.env.UI_PHASE5_THEME ?? "light";
if (theme !== "light" && theme !== "dark") throw new Error("Invalid UI_PHASE5_THEME");
const [width, height] = (process.env.UI_PHASE5_VIEWPORT ?? "1366x768").split("x").map(Number);
if (!width || !height) throw new Error("Invalid UI_PHASE5_VIEWPORT");
test.use({ viewport: { width, height }, video: "off" });

test("第五阶段灵动岛折叠、展开、失败及减少动态效果视觉证据", async ({ page, request }) => {
  test.skip(!output, "Set UI_PHASE5_OUTPUT_DIR for isolated screenshot evidence");
  test.setTimeout(90_000);
  await mkdir(output!, { recursive: true });
  await page.emulateMedia({ colorScheme: theme });
  await page.addInitScript(value => localStorage.setItem("supercanvas:appearance", value), theme);
  const f = await installPhase5StateFixture(page, request);
  await page.goto(`/canvas/${f.canvas.id}`);
  await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
  await expect(page.locator(".node-card")).toHaveCount(14);
  await page.getByRole("button", { name: "Fit View", exact: true }).click();
  const island = page.locator("[data-dynamic-island]");
  const toggle = island.getByRole("button", { name: /^任务与保存状态：/u });
  await expect(island).toHaveAttribute("data-status", "running");
  const files: string[] = [];
  const shot = async (name: string) => {
    await page.mouse.move(4, 4); await page.waitForTimeout(420);
    const file = `${name}.png`; await page.screenshot({ path: join(output!, file) }); files.push(file);
  };
  if (await toggle.getAttribute("aria-expanded") === "true") await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await shot("island-collapsed");
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await expect(island.getByRole("list", { name: "画布任务", exact: true })).toBeVisible();
  await shot("island-expanded");
  await page.keyboard.press("Escape");

  // Replay existing task states through the same graph/run contracts. No task
  // is submitted and no fake progress percentage is invented for the image.
  f.snapshot.run.status = "failed";
  for (const item of f.snapshot.nodes) if (item.status !== "failed") {
    item.status = "succeeded";
    item.outputAssetIds = [f.asset.id];
  }
  const graph = { ...f.graph, nodes: f.graph.nodes.map(node => !node.data.generatedResult || node.data.generatedStatus === "failed" ? node : {
    ...node, data: { ...node.data, generatedStatus: "succeeded", assetId: f.asset.id },
  }) };
  const response = await request.put(`/api/canvas/${f.canvas.id}`, { data: { graph } });
  expect(response.ok()).toBeTruthy();
  await page.reload();
  await expect(island).toHaveAttribute("data-status", "failed");
  await expect(toggle).toHaveAccessibleName("任务与保存状态：1 个任务失败 · 查看");
  await shot("island-failed");
  await toggle.press("Enter");
  await expect(island.locator('[data-task-status="failed"]')).toBeVisible();
  await shot("island-failed-expanded");
  await page.keyboard.press("Escape");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await toggle.click();
  expect(await island.evaluate(element => element.getAnimations({ subtree: true }).filter(animation => animation.playState === "running").length)).toBe(0);
  await shot("island-reduced-motion");
  f.check();
  await writeFile(join(output!, "island-screenshots.json"), JSON.stringify({ theme, viewport: { width, height },
    buildId: process.env.UI_PHASE5_EXPECTED_BUILD_ID, files, errors: f.errors, warnings: f.warnings, ...f.counters() }, null, 2));
});
