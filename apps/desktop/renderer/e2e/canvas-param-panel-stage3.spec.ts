import { expect, test, type Locator } from "./helpers/canvas-offline-test";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fixture, labels, image, video } from "./helpers/param-panel-fixture";
import { openParameterDetails } from "./helpers/parameter-controls";

const evidence = process.env.PARAM_PANEL_SCREENSHOT_DIR || "D:/project development/超级画布/.codex-logs/2026-10-18-param-panel/stage3";

async function capture(panel: Locator, name: string) {
  await mkdir(evidence, { recursive: true });
  const clip = await panel.evaluate(element => {
    const rectangles = [element, ...element.querySelectorAll('[popover]:popover-open')].map(item => item.getBoundingClientRect());
    const x = Math.max(0, Math.min(...rectangles.map(rect => rect.left))), y = Math.max(0, Math.min(...rectangles.map(rect => rect.top)));
    return { x, y, width: Math.min(innerWidth, Math.max(...rectangles.map(rect => rect.right))) - x,
      height: Math.min(innerHeight, Math.max(...rectangles.map(rect => rect.bottom))) - y };
  });
  await panel.page().screenshot({ path: join(evidence, name), clip, animations: "disabled" });
}

async function bounded(panel: Locator) {
  expect(await panel.evaluate(element => {
    const outer = element.getBoundingClientRect();
    return [...element.querySelectorAll<HTMLElement>(".node-config-header, .node-config-popover-body, input, select, textarea, button, [data-testid^='param-panel-']")]
      .filter(item => item.getClientRects().length && !item.closest('[popover], .node-model-select-options, [hidden]'))
      .flatMap(item => {
        const rect = item.getBoundingClientRect();
        return rect.left < outer.left - 1 || rect.right > outer.right + 1 || item.scrollWidth > item.clientWidth + 2
          ? [{ tag: item.tagName, label: item.getAttribute("aria-label"), width: item.clientWidth, scroll: item.scrollWidth }] : [];
      });
  })).toEqual([]);
}

test("stage3 矩阵：两主题三宽度图片视频、单价不拆行、静态模式与滑条无卡片", async ({ page, request }) => {
  test.setTimeout(120_000);
  const f = await fixture(page, request), screenshots: string[] = [], computed: unknown[] = [];
  await mkdir(evidence, { recursive: true });
  for (const theme of ["light", "dark"] as const) for (const width of [320, 360, 420]) for (const id of ["a", "video"] as const) {
    await f.closeAll();
    await page.evaluate(value => { localStorage.setItem("supercanvas:appearance", value); window.dispatchEvent(new StorageEvent("storage", { key: "supercanvas:appearance", newValue: value })); }, theme);
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
    await f.open(id);
    const panel = f.panel(id);
    await page.locator(".canvas-parameter-deck").evaluate((element, pixels) => { (element as HTMLElement).style.width = `${pixels}px`; }, width);
    await bounded(panel); await expect(f.run(id)).toBeInViewport();
    const picker = panel.locator(".node-model-select-trigger");
    await expect(picker).toHaveAccessibleName(`${labels[id]} 模型 · ${(id === "a" ? image : video).name}`);
    await expect(picker).toHaveAttribute("title", new RegExp((id === "a" ? image : video).name));
    const rate = await panel.getByTestId("param-panel-unit-price").evaluate(element => {
      const chunk = element.firstElementChild!, unit = chunk.firstElementChild!;
      const priceStyle = getComputedStyle(element), unitStyle = getComputedStyle(unit), chunkStyle = getComputedStyle(chunk);
      return { height: chunk.getBoundingClientRect().height, lineHeight: parseFloat(priceStyle.lineHeight), unitFont: parseFloat(unitStyle.fontSize), amountFont: parseFloat(priceStyle.fontSize), whiteSpace: chunkStyle.whiteSpace, text: element.textContent };
    });
    expect(rate.height).toBeLessThanOrEqual(rate.lineHeight + 1); expect(rate.whiteSpace).toBe("nowrap"); expect(rate.unitFont).toBeLessThan(rate.amountFont);
    computed.push({ theme, width, media: id, ...rate });
    await expect(panel.locator(".node-config-parameter-section select")).toHaveCount(0);
    if (id === "a") {
      await expect(panel.getByLabel("生成模式", { exact: true })).toContainText("普通");
      await expect(panel.getByRole("button", { name: "普通模式", exact: true })).toHaveCount(0);
      await expect(panel.getByText("此型号只提供普通模式", { exact: true })).toBeVisible();
    } else {
      const duration = panel.getByRole("slider", { name: /时长/ });
      const container = duration.locator("../..");
      expect(await container.evaluate(element => ({ border: getComputedStyle(element).borderTopWidth, background: getComputedStyle(element).backgroundImage })))
        .toEqual({ border: "0px", background: "none" });
    }
    const name = `stage3-${theme}-${width}-${id === "a" ? "image" : "video"}.png`;
    await capture(panel, name); screenshots.push(name);
  }
  await writeFile(join(evidence, "matrix-screenshots.json"), JSON.stringify(screenshots, null, 2) + "\n", "utf8");
  await writeFile(join(evidence, "rate-computed-styles.json"), JSON.stringify(computed, null, 2) + "\n", "utf8");
  expect(screenshots).toHaveLength(12); expect(f.submissions).toHaveLength(0); f.assertSafe();
});

test("stage3 单选项模式截图与线路详情键盘让权", async ({ page, request }) => {
  const f = await fixture(page, request); await f.open("a");
  const panel = f.panel("a");
  await page.locator(".canvas-parameter-deck").evaluate(element => { (element as HTMLElement).style.width = "360px"; });
  await capture(panel, "stage3-single-option-mode.png");
  const trigger = panel.getByRole("button", { name: `${labels.a} 线路`, exact: true });
  await trigger.focus(); await trigger.press("Enter");
  const routes = panel.getByRole("dialog", { name: `${labels.a} 候选线路`, exact: true });
  await expect(routes).toContainText("同型号");
  const detailSummaries = routes.locator("summary");
  expect(await detailSummaries.count()).toBeGreaterThan(0);
  await expect(detailSummaries).toHaveText(Array.from({ length: await detailSummaries.count() }, () => "价格明细"));
  await capture(panel, "stage3-route-picker.png");
  await page.keyboard.press("Control+Enter"); expect(f.submissions).toHaveLength(0);
  await page.keyboard.press("Escape"); await expect(trigger).toBeFocused();
  await expect(panel).toBeVisible();
  await openParameterDetails(panel, "价格明细"); await expect(panel.getByLabel("当前参数价格", { exact: true })).toContainText("0.125 CNY");
  expect(f.submissions).toHaveLength(0); f.assertSafe();
});

test("stage3 长限定报价最多两行，完整内容保留在明细和tooltip", async ({ page, request }) => {
  const longImage = { ...image, name: "一个需要优先截断且完整名称可通过无障碍读取的图像模型", pricing: {
    kind: "per-image" as const, currency: "USD", confidence: "estimate" as const, checkedAt: "2026-10-18",
    tiers: [0.02, 0.04, 0.08].map((price, index) => ({ id: `tier-${index}`, dimension: "resolution" as const, value: `${index + 1}K`, label: `${index + 1}K`, price })),
    timeMultipliers: [{ timeZone: "Asia/Shanghai" as const, startHour: 9, endHour: 12, multiplier: 2 }],
  } };
  const f = await fixture(page, request, { image: longImage }); await f.open("a");
  const panel = f.panel("a");
  await page.locator(".canvas-parameter-deck").evaluate(element => { (element as HTMLElement).style.width = "320px"; });
  const rate = panel.getByTestId("param-panel-unit-price");
  await expect(rate).toContainText("0.02–0.08 USD / 张"); await expect(rate).toContainText("参考"); await expect(rate).toContainText("时段倍率");
  expect(await rate.evaluate(element => element.getBoundingClientRect().height <= parseFloat(getComputedStyle(element).lineHeight) * 2 + 1)).toBe(true);
  await expect(rate).toHaveAttribute("title", /0.02–0.08 USD \/ 张.*时段倍率/);
  await expect(panel.locator(".node-model-select-trigger")).toHaveAccessibleName(`${labels.a} 模型 · ${longImage.name}`);
  await openParameterDetails(panel, "价格明细");
  await expect(panel.getByLabel("当前参数价格", { exact: true })).toContainText("0.02");
  expect(f.submissions).toHaveLength(0); f.assertSafe();
});

test("stage3 点击静态值后运行快捷键仍属于参数卡，不写入唯一选项", async ({ page, request }) => {
  const f = await fixture(page, request); await f.open("a");
  await f.owner("b").getByText(labels.b, { exact: true }).click();
  const before = (await f.saved()).nodes.find(node => node.id === "a")?.data.parameters;
  const mode = f.panel("a").getByRole("group", { name: "生成模式", exact: true });
  await mode.click(); await expect(mode).toBeFocused();
  expect((await f.saved()).nodes.find(node => node.id === "a")?.data.parameters).toEqual(before);
  await page.keyboard.press("Control+Enter");
  await expect.poll(() => f.submissions.length).toBe(1);
  expect(f.submissions[0]).toMatchObject({ nodeId: "a", scope: "node" });
  expect(f.submissions[0]!.graph.nodes.find(node => node.id === "a")?.data.parameters).toEqual(before);
  f.assertSafe();
});
