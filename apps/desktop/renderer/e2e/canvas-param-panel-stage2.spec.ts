import { expect, test, type Locator } from "./helpers/canvas-offline-test";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { ModelDescriptor } from "@super-canvas/providers";
import { fixture, labels, image } from "./helpers/param-panel-fixture";
import { chooseParameterOption, expectParameterValue, openParameterDetails } from "./helpers/parameter-controls";

const evidence = process.env.PARAM_PANEL_SCREENSHOT_DIR || "D:/project development/超级画布/.codex-logs/2026-10-18-param-panel/stage2";

async function capturePanel(panel: Locator, name: string) {
  await mkdir(evidence, { recursive: true });
  const clip = await panel.evaluate(element => {
    const rectangles = [element, ...element.querySelectorAll('[popover]:popover-open')].map(item => item.getBoundingClientRect());
    const x = Math.max(0, Math.min(...rectangles.map(rect => rect.left))), y = Math.max(0, Math.min(...rectangles.map(rect => rect.top)));
    return { x, y, width: Math.min(innerWidth, Math.max(...rectangles.map(rect => rect.right))) - x,
      height: Math.min(innerHeight, Math.max(...rectangles.map(rect => rect.bottom))) - y };
  });
  await panel.page().screenshot({ path: join(evidence, name), clip, animations: "disabled" });
}

// Deliberately manual schemas exercise existing contract branches. These are
// isolated UI fixtures, never claims about a supplier or generated pixel output.
const fixedContract: ModelDescriptor = {
  ...image, id: "stage2-manual-fixed", name: "离线固定尺寸合同", metadata: { source: "manual", canvasRunnable: true,
    imageSizeOptionsCompleteEnum: true, imageParameterContractNote: "离线固定尺寸合同示例：只允许列出的 4096 × 4096；不代表真实供应商验证。" },
  parameters: [
    { key: "size", label: "固定尺寸", control: "select", default: "4096x4096", options: [{ value: "4096x4096", label: "4K · 1:1 · 4096 × 4096" }] },
    { key: "quality", label: "质量", control: "select", default: "high", options: [{ value: "high", label: "高" }] },
  ],
};
const independentContract: ModelDescriptor = {
  ...image, id: "stage2-manual-independent", name: "离线独立尺寸偏好合同", metadata: { source: "manual", canvasRunnable: true,
    imageNativeParameterContract: true, imageOpenSizePreferences: true, imageResolutionTierParameter: "size_tier",
    imageParameterContractNote: "离线独立偏好合同：档位、比例与 W/H 分开保存；不代表真实供应商验证。" },
  parameters: [
    { key: "size_tier", label: "分辨率", control: "select", default: "2K", options: ["1K", "2K", "4K"].map(value => ({ value, label: value })) },
    { key: "aspect_ratio", label: "画面比例", control: "select", default: "auto", options: [{ value: "auto", label: "自动（供应商默认）" }, { value: "16:9", label: "16:9" }, { value: "4:3", label: "4:3" }] },
    { key: "size", label: "独立 W/H", control: "dimensions", allowCustomValue: true, default: "1600x900", options: [{ value: "auto", label: "自动（供应商默认）" }, { value: "1600x900", label: "16:9 · 1600 × 900" }] },
    { key: "quality", label: "质量", control: "select", default: "max", options: [{ value: "high", label: "高" }, { value: "max", label: "最高" }] },
  ],
};

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

test("stage2 step4 线路键盘所有权、收起明细与管理前草稿提交", async ({ page, request }) => {
  const f = await fixture(page, request); await f.open("a");
  const panel = f.panel("a"), trigger = panel.getByRole("button", { name: `${labels.a} 线路`, exact: true });
  const prices = panel.getByRole("button", { name: "价格明细", exact: true });
  await expect(prices).toHaveAttribute("aria-expanded", "false");
  await prices.focus(); await prices.press("Enter"); await expect(prices).toHaveAttribute("aria-expanded", "true");
  await expect(panel.getByLabel("当前参数价格", { exact: true })).toContainText("本次预计费用 0.125 CNY");
  await trigger.focus(); await trigger.press("Enter");
  const routes = panel.getByRole("dialog", { name: `${labels.a} 候选线路`, exact: true });
  await expect(routes).toBeVisible();
  const selectedRoute = routes.getByRole("button", { name: /^选择线路 /u, pressed: true });
  await expect(selectedRoute.getByLabel("同型号报价", { exact: true })).toHaveText("0.125 CNY / 张");
  await expect(selectedRoute.getByText("同型号", { exact: true })).toBeVisible();
  await expect(panel.locator('div[aria-label="当前线路"]')).not.toContainText("余额未读取");
  await capturePanel(panel, "stage3-route-picker-single.png");
  await page.keyboard.press("Control+Enter"); expect(f.submissions).toHaveLength(0);
  await page.keyboard.press("Escape"); await expect(routes).toHaveCount(0); await expect(trigger).toBeFocused();
  await expect(panel).toBeVisible();
  await openParameterDetails(panel, "自定义宽高");
  await panel.getByLabel("图片宽度", { exact: true }).fill("2816");
  await trigger.click(); await routes.getByRole("button", { name: "管理供应商与密钥", exact: true }).click();
  await expect(panel).toHaveCount(0);
  await expect.poll(async () => (await f.saved()).nodes.find(node => node.id === "a")?.data.parameters?.size).toBe("2816x4096");
  expect(f.submissions).toHaveLength(0); f.assertSafe();
});

test("stage2 step5 交互截图：比例、质量、宽高、线路与参数来源", async ({ page, request }) => {
  const f = await fixture(page, request); await f.open("a");
  const panel = f.panel("a");
  await page.locator(".canvas-parameter-deck").evaluate(element => { (element as HTMLElement).style.width = "360px"; });
  const ratio = panel.getByRole("combobox", { name: "输出分辨率预设", exact: true });
  await ratio.click();
  await expect(panel.getByRole("listbox").getByRole("option").first()).toContainText("自动 · 跟随提示词，其次参考图");
  await capturePanel(panel, "stage2-ratio-dropdown.png"); await page.keyboard.press("Escape");
  await panel.getByRole("combobox", { name: "质量", exact: true }).click();
  await capturePanel(panel, "stage2-quality-dropdown.png"); await page.keyboard.press("Escape");
  await openParameterDetails(panel, "自定义宽高");
  await expect(panel.getByLabel("图片宽度", { exact: true })).toBeVisible();
  await capturePanel(panel, "stage2-custom-dimensions.png");
  await panel.getByRole("button", { name: `${labels.a} 线路`, exact: true }).click();
  await expect(panel.getByRole("dialog", { name: `${labels.a} 候选线路`, exact: true })).toBeVisible();
  await capturePanel(panel, "stage2-route-picker.png"); await page.keyboard.press("Escape");
  await openParameterDetails(panel, "参数与来源");
  await expect(panel.getByRole("button", { name: "参数与来源", exact: true })).toHaveAttribute("aria-expanded", "true");
  await capturePanel(panel, "stage2-parameter-sources.png");
  expect(f.submissions).toHaveLength(0); f.assertSafe();
});

test("stage2 step5 固定合同的静态值、自动项限制、旧值修正与独立偏好保存截图", async ({ page, request }) => {
  let f = await fixture(page, request, { image: fixedContract, imageParameters: { size: "4096x4096", quality: "high" } });
  await f.open("a");
  let panel = f.panel("a");
  const fixed = panel.getByRole("textbox", { name: "输出分辨率预设", exact: true });
  await expectParameterValue(fixed, "4096x4096");
  await expect(fixed).toHaveAttribute("aria-readonly", "true");
  await expect(panel.getByRole("combobox", { name: "输出分辨率预设", exact: true })).toHaveCount(0);
  const restrictions = fixed.locator("..").locator("details");
  await restrictions.locator("summary").focus(); await page.keyboard.press("Enter");
  await expect(restrictions).toHaveAttribute("open", "");
  await expect(restrictions).toContainText("自动 · 跟随提示词，其次参考图");
  await expect(restrictions).toContainText("当前渠道使用固定尺寸，自动比例不可用");
  await expectParameterValue(panel.getByRole("textbox", { name: "质量", exact: true }), "high");
  await openParameterDetails(panel, "查看宽高");
  await expect(panel.getByLabel("图片宽度", { exact: true })).toHaveJSProperty("readOnly", true);
  expect((await f.saved()).nodes.find(node => node.id === "a")?.data.parameters?.size).toBe("4096x4096");
  await capturePanel(panel, "stage2-contract-fixed-no-auto.png");
  f.assertSafe();

  // An invalid saved value must retain the real dropdown and an explicit
  // correction path. The disabled automatic row still ignores pointer input.
  f = await fixture(page, request, { image: fixedContract, imageParameters: { size: "old-invalid-size", quality: "high" } });
  await f.open("a"); panel = f.panel("a");
  await panel.getByRole("combobox", { name: "输出分辨率预设", exact: true }).click();
  const automatic = panel.getByRole("listbox").getByRole("option").first();
  await expect(automatic).toContainText("自动 · 跟随提示词，其次参考图"); await expect(automatic).toHaveAttribute("aria-disabled", "true");
  await expect(automatic).toContainText("当前渠道使用固定尺寸，自动比例不可用");
  // Send a real pointer press to the disabled row. Locator.click correctly
  // refuses aria-disabled controls; the UI must also ignore a physical press.
  const disabledBounds = (await automatic.boundingBox())!;
  await page.mouse.click(disabledBounds.x + disabledBounds.width / 2, disabledBounds.y + disabledBounds.height / 2);
  expect((await f.saved()).nodes.find(node => node.id === "a")?.data.parameters?.size).toBe("old-invalid-size");
  await capturePanel(panel, "stage2-contract-fixed-saved-invalid.png"); await page.keyboard.press("Escape");
  await chooseParameterOption(panel.getByRole("combobox", { name: "输出分辨率预设", exact: true }), "4096x4096");
  await expect.poll(async () => (await f.saved()).nodes.find(node => node.id === "a")?.data.parameters?.size).toBe("4096x4096");
  await expectParameterValue(panel.getByRole("textbox", { name: "输出分辨率预设", exact: true }), "4096x4096");
  await openParameterDetails(panel, "查看宽高");
  await expect(panel.getByLabel("图片宽度", { exact: true })).toHaveJSProperty("readOnly", true);
  f.assertSafe();
  f = await fixture(page, request, { image: independentContract, imageParameters: { size: "1600x900", size_tier: "2K", aspect_ratio: "16:9", quality: "max" } });
  await f.open("a"); panel = f.panel("a");
  await panel.getByRole("group", { name: "自动与输出分辨率快捷档位", exact: true }).getByRole("button", { name: "4K", exact: true }).click();
  await chooseParameterOption(panel.getByRole("combobox", { name: "画面比例", exact: true }), "4:3");
  await expect.poll(async () => (await f.saved()).nodes.find(node => node.id === "a")?.data.parameters).toMatchObject({ size: "1600x900", size_tier: "4K", aspect_ratio: "4:3" });
  await openParameterDetails(panel, "自定义宽高");
  await expect(panel.getByLabel("图片宽度", { exact: true })).toHaveValue("1600");
  await capturePanel(panel, "stage2-contract-independent-size-preferences.png");
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
