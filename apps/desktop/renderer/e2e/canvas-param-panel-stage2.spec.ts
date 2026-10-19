import { expect, test, type Locator } from "./helpers/canvas-offline-test";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fixture, labels } from "./helpers/param-panel-fixture";
import { chooseParameterOption, expectParameterValue, openParameterDetails } from "./helpers/parameter-controls";

const evidence = "D:/project development/超级画布/.codex-logs/2026-10-18-param-panel/stage2";

async function noHorizontalOverflow(panel: Locator) {
  expect(await panel.evaluate(element => {
    const outer = element.getBoundingClientRect();
    return [...element.querySelectorAll<HTMLElement>(".node-config-header, .node-config-popover-body, input, select, textarea, button, [data-testid^='param-panel-']")]
      .filter(item => item.getClientRects().length && !item.closest('[popover], .node-model-select-options, [hidden]'))
      .flatMap(item => {
        const rect = item.getBoundingClientRect();
        return item.scrollWidth > item.clientWidth + 2 || rect.left < outer.left - 1 || rect.right > outer.right + 1
          ? [{ tag: item.tagName, label: item.getAttribute("aria-label"), className: item.className, width: item.clientWidth, scroll: item.scrollWidth }] : [];
      });
  })).toEqual([]);
}

test("stage2 step3 Dropdown 保留原值、键盘让权、中文质量与 W/H 草稿提交", async ({ page, request }) => {
  const f = await fixture(page, request); await f.open("a");
  const panel = f.panel("a"), quality = panel.getByRole("combobox", { name: "质量", exact: true });
  await quality.focus(); await quality.press("Enter");
  await expect(quality).toHaveAttribute("aria-expanded", "true");
  await page.keyboard.press("Control+Enter"); expect(f.submissions).toHaveLength(0);
  await page.keyboard.press("Escape");
  await expect(quality).toHaveAttribute("aria-expanded", "false"); await expect(quality).toBeFocused(); await expect(panel).toBeVisible();
  await chooseParameterOption(quality, "high"); await expectParameterValue(quality, "high");
  await expect(panel.locator(".node-config-footer")).toContainText("高");
  await expect(panel.locator(".node-config-footer")).not.toContainText("high");
  await openParameterDetails(panel, "自定义宽高");
  await f.owner("b").getByText(labels.b, { exact: true }).click();
  const width = panel.getByLabel("图片宽度", { exact: true });
  await width.fill("3072"); await width.press("Control+Enter");
  await expect.poll(() => f.submissions.length).toBe(1);
  expect(f.submissions[0]).toMatchObject({ nodeId: "a", scope: "node" });
  expect(f.submissions[0]!.graph.nodes.find(node => node.id === "a")?.data.parameters).toMatchObject({ size: "3072x4096", quality: "high" });
  f.assertSafe();
});

test("stage2 step3 比例完整选项、切卡关闭、刷新保存与单价总额独立", async ({ page, request }) => {
  const f = await fixture(page, request); await f.open("a");
  const panel = f.panel("a"), ratio = panel.getByRole("combobox", { name: "输出分辨率预设", exact: true });
  await ratio.click();
  const options = panel.getByRole("listbox").getByRole("option");
  await expect(options.first()).toContainText("自动 · 跟随提示词，其次参考图");
  await expect(options).toHaveCount(13); // Existing application presets: automatic, eleven 4K shapes and custom W/H.
  await page.keyboard.press("Escape");
  await chooseParameterOption(ratio, "3840x2160");
  await panel.getByRole("spinbutton", { name: "数量", exact: true }).fill("3");
  await expect(panel.getByTestId("param-panel-unit-price")).toHaveText("0.125 CNY / 张");
  await expect(panel.getByTestId("param-panel-total-price")).toHaveText("0.375 CNY");
  await expect.poll(async () => (await f.saved()).nodes.find(node => node.id === "a")?.data.parameters).toMatchObject({ size: "3840x2160", n: 3 });
  await f.open("b"); await ratio.click();
  await f.panel("b").locator(".node-config-header").click({ position: { x: 20, y: 18 } });
  await expect(ratio).toHaveAttribute("aria-expanded", "false");
  await page.reload(); await f.open("a"); await expectParameterValue(ratio, "3840x2160");
  await f.closeAll(); await f.open("unknown");
  await expect(f.panel("unknown").getByTestId("param-panel-unit-price")).toHaveText("—");
  await expect(f.panel("unknown").getByTestId("param-panel-total-price")).toHaveText("—");
  expect(f.submissions).toHaveLength(0); f.assertSafe();
});

test("stage2 矩阵：两主题三宽度三媒体、纯色激活、双卡和低高度", async ({ page, request }) => {
  test.setTimeout(150_000);
  const f = await fixture(page, request); await mkdir(evidence, { recursive: true });
  const screenshots: string[] = [], computed: unknown[] = [];
  for (const theme of ["light", "dark"] as const) for (const width of [320, 360, 420]) for (const id of ["a", "video", "music"] as const) {
    await f.closeAll();
    await page.evaluate(value => { localStorage.setItem("supercanvas:appearance", value); window.dispatchEvent(new StorageEvent("storage", { key: "supercanvas:appearance", newValue: value })); }, theme);
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
    await f.open(id);
    await page.locator(".canvas-parameter-deck").evaluate((element, pixels) => { (element as HTMLElement).style.width = `${pixels}px`; }, width);
    await noHorizontalOverflow(f.panel(id)); await expect(f.run(id)).toBeInViewport();
    if (id === "a") {
      const styles = await f.panel(id).getByRole("button", { name: "4K", exact: true }).evaluate(element => {
        const s = getComputedStyle(element); return { background: s.background, backgroundImage: s.backgroundImage, boxShadow: s.boxShadow, color: s.color };
      });
      expect(styles.backgroundImage).toBe("none"); expect(styles.boxShadow).toBe("none"); computed.push({ theme, width, ...styles });
    }
    const name = `stage2-${theme}-${width}-${id === "a" ? "image" : id}.png`;
    await f.panel(id).screenshot({ path: join(evidence, name), animations: "disabled" }); screenshots.push(name);
  }
  await f.closeAll(); await page.setViewportSize({ width: 1920, height: 1080 });
  await page.locator(".canvas-parameter-deck").evaluate(element => { (element as HTMLElement).style.removeProperty("width"); });
  await f.open("a"); await f.open("b");
  await noHorizontalOverflow(f.panel("a")); await noHorizontalOverflow(f.panel("b"));
  await page.locator(".canvas-parameter-deck").screenshot({ path: join(evidence, "stage2-two-cards.png"), animations: "disabled" }); screenshots.push("stage2-two-cards.png");
  await f.closeAll(); await page.setViewportSize({ width: 1280, height: 560 }); await f.open("a");
  await page.locator(".canvas-parameter-deck").evaluate(element => { (element as HTMLElement).style.width = "320px"; });
  await noHorizontalOverflow(f.panel("a")); await expect(f.run("a")).toBeInViewport();
  await f.panel("a").locator(".node-config-popover-body").evaluate(element => { element.scrollTop = element.scrollHeight; });
  await expect(f.run("a")).toBeInViewport();
  await f.panel("a").screenshot({ path: join(evidence, "stage2-low-height.png"), animations: "disabled" }); screenshots.push("stage2-low-height.png");
  expect(screenshots).toHaveLength(20);
  await writeFile(join(evidence, "matrix-screenshots.json"), `${JSON.stringify(screenshots, null, 2)}\n`, "utf8");
  await writeFile(join(evidence, "segmented-computed-styles.json"), `${JSON.stringify(computed, null, 2)}\n`, "utf8");
  expect(f.submissions).toHaveLength(0); f.assertSafe();
});
