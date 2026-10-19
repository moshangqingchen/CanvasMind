import { expect, test, type Locator, type Page } from "./helpers/canvas-offline-test";
import { mkdir, writeFile } from "node:fs/promises";
import { freemem } from "node:os";
import { join } from "node:path";
import { installPhase3LargeFixture, PHASE3_COUNTS } from "./helpers/phase3-large-fixtures";
import { memorySampleValidity, minimumAvailableMemoryBytes } from "./helpers/performance-environment";

// Phase5 captures reuse the exact screen/asset fixtures; normal regression
// runs retain their default browser preference. No hidden theme mutation.
const evidenceTheme = process.env.UI_PHASE5_THEME;
if (evidenceTheme && evidenceTheme !== "light" && evidenceTheme !== "dark") throw new Error("Invalid UI_PHASE5_THEME");
test.beforeEach(async ({ page }) => {
  if (!evidenceTheme) return;
  await page.emulateMedia({ colorScheme: evidenceTheme as "light" | "dark" });
  await page.addInitScript(theme => localStorage.setItem("supercanvas:appearance", theme), evidenceTheme);
});

const output = process.env.UI_PHASE3_OUTPUT_DIR;
const phase = process.env.UI_PHASE3_PHASE ?? "sample";
const repetitions = Math.max(1, Number(process.env.UI_PHASE3_ITERATIONS ?? 5));
const cpuRate = Math.max(1, Number(process.env.UI_PHASE3_CPU_RATE ?? 4));
const visualOnly = Boolean(process.env.UI_PHASE3_VISUAL_ASSET_DIR);
type Capture = { started: number; frames: number[]; tasks: number[]; lastFrame: number; raf: number; observer: PerformanceObserver; clicked: number | null };
type CapturedWindow = Window & { __phase3Capture?: Capture };
const captureAvailableBefore = new WeakMap<Page, number>();

async function beginCapture(page: Page) {
  captureAvailableBefore.set(page, freemem());
  await page.evaluate(() => {
    const state = window as CapturedWindow;
    const capture: Capture = { started: performance.now(), frames: [], tasks: [], lastFrame: 0, raf: 0,
      observer: new PerformanceObserver(list => capture.tasks.push(...list.getEntries().map(entry => entry.duration))), clicked: null };
    capture.observer.observe({ type: "longtask", buffered: false });
    const frame = (at: number) => { if (capture.lastFrame) capture.frames.push(at - capture.lastFrame); capture.lastFrame = at; capture.raf = requestAnimationFrame(frame); };
    capture.raf = requestAnimationFrame(frame);
    window.addEventListener("pointerdown", () => { capture.clicked = performance.now(); }, { once: true, capture: true });
    state.__phase3Capture = capture;
  });
}

async function endCapture(page: Page) {
  const measurement = await page.evaluate(() => {
    const capture = (window as CapturedWindow).__phase3Capture!;
    capture.tasks.push(...capture.observer.takeRecords().map(entry => entry.duration));
    capture.observer.disconnect(); cancelAnimationFrame(capture.raf);
    const frames = capture.frames.sort((a, b) => a - b);
    return { durationMs: performance.now() - capture.started,
      clickToInteractiveMs: capture.clicked === null ? null : performance.now() - capture.clicked,
      frameSamples: frames.length, frameP95Ms: frames[Math.min(frames.length - 1, Math.floor(frames.length * .95))] ?? null,
      longTasks: capture.tasks.length, longTaskMs: capture.tasks.reduce((sum, value) => sum + value, 0) };
  });
  const availableBeforeBytes = captureAvailableBefore.get(page) ?? 0;
  captureAvailableBefore.delete(page);
  const availableAfterBytes = freemem();
  return { ...measurement, system: { availableBeforeBytes, availableAfterBytes, minimumAvailableMemoryBytes,
    valid: memorySampleValidity(availableBeforeBytes, availableAfterBytes) } };
}

async function ready(control: Locator) {
  await expect(control).toBeVisible();
  await expect(control).toBeEnabled();
  await expect.poll(() => control.evaluate(element => {
    const bounds = element.getBoundingClientRect();
    const hit = document.elementFromPoint(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
    return Boolean(hit && (element === hit || element.contains(hit)));
  })).toBe(true);
  await control.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
}

async function recordScroll(page: Page, container: Locator) {
  const targetId = `phase3-scroll-${Date.now()}`;
  await container.evaluate((element, id) => {
    let target: Element | null = element;
    while (target && !(target.scrollHeight > target.clientHeight + 1 && /auto|scroll/u.test(getComputedStyle(target).overflowY))) target = target.parentElement;
    if (!target) throw new Error("No real scrolling ancestor for phase3 measurement");
    target.setAttribute("data-phase3-scroll-target", id);
  }, targetId);
  const scrollingElement = page.locator(`[data-phase3-scroll-target="${targetId}"]`);
  await scrollingElement.evaluate(element => { element.scrollTop = 0; });
  await page.waitForTimeout(100);
  await beginCapture(page);
  await scrollingElement.evaluate(async element => {
    await new Promise<void>(resolve => {
      const started = performance.now();
      const move = (at: number) => {
        const progress = Math.min(1, (at - started) / 1200);
        // Sweep four viewport heights; preserves a comparable distance after virtualization.
        element.scrollTop = Math.min(element.scrollHeight - element.clientHeight, progress * element.clientHeight * 4);
        if (progress < 1) requestAnimationFrame(move); else requestAnimationFrame(() => resolve());
      };
      requestAnimationFrame(move);
    });
  });
  const measurement = await endCapture(page);
  const geometry = await scrollingElement.evaluate(element => ({ scrollHeight: element.scrollHeight, clientHeight: element.clientHeight, scrollTop: element.scrollTop, descendants: element.querySelectorAll("*").length }));
  expect(geometry.scrollTop, "A scroll baseline must move a real overflow container").toBeGreaterThan(0);
  await scrollingElement.evaluate(element => { element.scrollTop = 0; element.removeAttribute("data-phase3-scroll-target"); });
  return { ...measurement, ...geometry };
}

const sizes = [{ width: 1366, height: 768 }, { width: 1920, height: 1080 }, { width: 1024, height: 768 }, { width: 1280, height: 800 }];

async function showSupplierModelTable(settings: Locator) {
  const modelsTab = settings.getByRole("tab", { name: "模型与分组", exact: true });
  if (await modelsTab.count()) {
    await modelsTab.click();
    await expect(modelsTab).toHaveAttribute("aria-selected", "true");
  }
  const model = settings.locator(".sm-model-item").first();
  await model.scrollIntoViewIfNeeded();
  await expect(model).toBeVisible();
  await expect.poll(() => model.evaluate(element => {
    const rect = element.getBoundingClientRect();
    return rect.top >= 0 && rect.bottom <= innerHeight && rect.left >= 0 && rect.right <= innerWidth;
  }), { message: "The settings-models evidence must actually show a complete model row" }).toBe(true);
}

async function waitForScreenshotImages(page: Page) {
  if (!visualOnly) return;
  await page.locator("img").evaluateAll(async elements => {
    const images = elements as HTMLImageElement[];
    await Promise.all(images.filter(image => {
      const rect = image.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.top < innerHeight && rect.right > 0 && rect.left < innerWidth;
    }).map(image => image.decode().catch(() => undefined)));
  });
}

async function readyAgentConversation(agent: Locator, firstMessage: string) {
  const conversation = agent.getByRole("list", { name: "智能体对话", exact: true });
  await expect(conversation.locator("article").filter({ hasText: /第 \d+ 条(?:创作要求|方案建议)/u }).first()).toBeAttached();
  // Restoring the session and smooth auto-scroll finish independently of the
  // composer. Show the same first message in both builds, after real data loads.
  await conversation.evaluate(element => element.scrollTo({ top: 0, behavior: "instant" }));
  const message = conversation.getByText(firstMessage, { exact: true });
  await expect(message).toBeVisible();
  await message.scrollIntoViewIfNeeded();
  await expect.poll(() => message.evaluate(element => {
    const row = element.getBoundingClientRect();
    const list = element.closest('[role="list"]')!.getBoundingClientRect();
    return Math.min(row.bottom, list.bottom, innerHeight) - Math.max(row.top, list.top, 0) > 12 &&
      Math.min(row.right, list.right, innerWidth) - Math.max(row.left, list.left, 0) > 12;
  }), { message: "The real first conversation message must intersect its scrolling viewport" }).toBe(true);
  return conversation.evaluate(element => ({ clientHeight: element.clientHeight, scrollHeight: element.scrollHeight,
    scrollTop: element.scrollTop, mountedArticles: element.querySelectorAll("article").length }));
}

for (const size of sizes.slice(0, 2)) {
  test(`第三阶段智能体对话补拍 ${size.width}x${size.height}`, async ({ page }, testInfo) => {
    test.skip(!output, "Set UI_PHASE3_OUTPUT_DIR for isolated evidence");
    test.setTimeout(60_000); page.setDefaultTimeout(10_000);
    await mkdir(output!, { recursive: true }); await page.setViewportSize(size);
    const fixture = await installPhase3LargeFixture(page);
    await page.goto(`/canvas/${fixture.canvasId}`);
    await expect(page.locator('.react-flow__node[data-id="phase3-prompt"]')).toBeVisible();
    const toggle = page.getByRole("button", { name: "智能体面板", exact: true });
    if (await toggle.getAttribute("aria-expanded") !== "true") await toggle.click();
    const agent = page.getByRole("region", { name: "通用创作智能体", exact: true });
    await ready(agent.getByRole("textbox").last());
    const conversation = await readyAgentConversation(agent, fixture.session.messages[0]!.content);
    await waitForScreenshotImages(page); await page.waitForTimeout(220);
    const file = `${phase}-agent-${size.width}x${size.height}.png`;
    await page.screenshot({ path: join(output!, file) });
    const evidence = join(output!, `${phase}-agent-${size.width}x${size.height}-supplement.json`);
    await writeFile(evidence, JSON.stringify({ phase, size, screenshots: [file], captureMode: "visual-only",
      firstMessage: fixture.session.messages[0]!.content, expectedSessionMessages: fixture.session.messages.length, conversation,
      visualFixture: fixture.visualFixture, errors: fixture.errors, warnings: fixture.warnings,
      unexpected: fixture.unexpected, prohibited: fixture.prohibited }, null, 2));
    await testInfo.attach("phase3-agent-supplement", { path: evidence, contentType: "application/json" });
    expect(fixture.errors).toEqual([]); expect(fixture.warnings).toEqual([]);
    expect(fixture.unexpected).toEqual([]); expect(fixture.prohibited).toEqual([]);
  });
}
test("供应商菜单 Esc 只关闭最上层并返回焦点", async ({ page }) => {
  const fixture = await installPhase3LargeFixture(page);
  await page.setViewportSize(sizes[0]!);
  await page.goto("/");
  const opener = page.getByTestId("workspace-settings").or(page.getByRole("button", { name: "供应商与模型", exact: true }));
  await opener.click();
  const settings = page.getByRole("dialog", { name: "供应商与模型设置", exact: true });
  const more = settings.getByRole("button", { name: `${fixture.supplier.name} 的更多操作`, exact: true });
  await more.click();
  const menu = page.getByRole("menu", { name: `${fixture.supplier.name} 操作`, exact: true });
  await expect(menu).toBeVisible();
  if (output) {
    await mkdir(output, { recursive: true });
    await page.screenshot({ path: join(output, `${phase}-supplier-menu-1366x768.png`) });
  }
  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);
  if (phase === "before" && output) {
    await writeFile(join(output, "before-supplier-menu-escape.json"), JSON.stringify({ settingsStillOpen: await settings.isVisible(),
      focusReturnedToMore: await more.evaluateAll(elements => elements[0] === document.activeElement), errors: fixture.errors }, null, 2));
  } else {
    await expect(settings).toBeVisible(); await expect(more).toBeFocused();
    await page.keyboard.press("Escape"); await expect(settings).toHaveCount(0); await expect(opener).toBeFocused();
  }
  expect(fixture.errors).toEqual([]); expect(fixture.prohibited).toEqual([]);
});
test("供应商长列表窗口化保留离屏草稿并支持局部搜索快捷键", async ({ page }) => {
  test.setTimeout(90_000);
  const fixture = await installPhase3LargeFixture(page);
  await page.setViewportSize(sizes[0]!); await page.goto("/");
  await page.getByTestId("workspace-settings").or(page.getByRole("button", { name: "供应商与模型", exact: true })).click();
  const settings = page.getByRole("dialog", { name: "供应商与模型设置", exact: true });
  const groups = settings.getByRole("list", { name: "供应商分组列表", exact: true });
  const connectionTab = settings.getByRole("tab", { name: "连接配置", exact: true });
  const modelsTab = settings.getByRole("tab", { name: "模型与分组", exact: true });
  await connectionTab.click();
  await expect(groups).toBeVisible();
  expect(await groups.locator(".sm-group-card").count()).toBeLessThan(40);
  // Local unsaved form state only: mock write guard forbids saving any credential.
  await groups.getByLabel("group-001 API Key", { exact: true }).fill("phase3-unsaved-local-draft");
  const groupSearch = settings.getByLabel("查找分组或模型", { exact: true });
  await groupSearch.fill("group-001"); await groupSearch.press("Enter");
  await expect(groups.getByLabel("group-001 API Key", { exact: true })).toHaveValue("phase3-unsaved-local-draft");
  await settings.getByRole("button", { name: "清除分组筛选", exact: true }).click();
  await expect(groups.getByLabel("group-001 API Key", { exact: true })).toHaveValue("phase3-unsaved-local-draft");
  await groups.focus();
  await groups.evaluate(element => { element.scrollTop = 9000; });
  await expect(groups.getByRole("button", { name: "group-001", exact: true })).toBeHidden();
  await groups.locator(".sm-group-card:visible .sm-group-select").first().click();
  await groups.evaluate(element => { element.scrollTop = 0; });
  await groups.getByRole("button", { name: "group-001", exact: true }).click();
  await expect(groups.getByLabel("group-001 API Key", { exact: true })).toHaveValue("phase3-unsaved-local-draft");
  await groups.getByRole("button", { name: "group-001", exact: true }).focus();
  await page.keyboard.press("Control+f");
  await expect(settings.getByLabel("查找分组或模型", { exact: true })).toBeFocused();
  const firstGroupToggle = groups.getByRole("button", { name: "group-001", exact: true });
  if (await firstGroupToggle.getAttribute("aria-expanded") !== "true") await firstGroupToggle.click();
  const firstGroupKey = groups.getByLabel("group-001 API Key", { exact: true });
  await expect(firstGroupKey).toBeVisible();
  await expect(firstGroupKey).toHaveValue("phase3-unsaved-local-draft");
  await firstGroupKey.fill("");
  await modelsTab.click();
  const nestedModel = groups.getByRole("list", { name: "Key 实际读取型号列表", exact: true });
  const evidence = nestedModel.locator(".sm-model-evidence summary").first();
  await evidence.focus();
  await groups.evaluate(element => { element.scrollTop = 9000; });
  await expect(evidence).toBeFocused();
  await expect(groups.locator('[data-virtual-key="group-001"]')).not.toHaveAttribute("hidden");
  await groups.focus(); await groups.evaluate(element => { element.scrollTop = 0; });
  await groups.getByRole("button", { name: "group-001", exact: true }).click();
  const firstRow = groups.locator('[data-virtual-key="group-001"]');
  await expect.poll(() => firstRow.evaluate(element => element.getBoundingClientRect().height)).toBeLessThan(180);
  await groups.focus(); await groups.evaluate(element => { element.scrollTop = 600; });
  await expect(firstRow).toBeHidden();
  // A group first opened by filtering also needs retention when clearing it.
  await connectionTab.click();
  await groupSearch.fill("group-250"); await groupSearch.press("Enter");
  await groups.getByLabel("group-250 API Key", { exact: true }).fill("phase3-search-only-draft");
  await settings.getByRole("button", { name: "清除分组筛选", exact: true }).click();
  await groupSearch.fill("group-250"); await groupSearch.press("Enter");
  await expect(groups.getByLabel("group-250 API Key", { exact: true })).toHaveValue("phase3-search-only-draft");
  await groups.getByLabel("group-250 API Key", { exact: true }).fill("");
  await settings.getByRole("button", { name: "清除分组筛选", exact: true }).click();
  await settings.getByRole("button", { name: "供应商分组 304 收起", exact: true }).click();
  await page.keyboard.press("Escape");
  await page.getByTestId("workspace-settings").or(page.getByRole("button", { name: "供应商与模型", exact: true })).click();
  await expect(settings.getByRole("button", { name: "供应商分组 304 展开", exact: true })).toHaveAttribute("aria-expanded", "false");
  expect(fixture.errors).toEqual([]); expect(fixture.prohibited).toEqual([]);
});
test("第三阶段供应商真实滚动 1366x768", async ({ page }) => {
  test.skip(!output, "Set UI_PHASE3_OUTPUT_DIR for isolated evidence");
  test.setTimeout(120_000); page.setDefaultTimeout(10_000);
  await mkdir(output!, { recursive: true }); await page.setViewportSize(sizes[0]!);
  const fixture = await installPhase3LargeFixture(page);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: cpuRate });
  await page.goto("/");
  const measurements: Array<{ iteration: number; opening: Awaited<ReturnType<typeof endCapture>>;
    scrolling?: Awaited<ReturnType<typeof recordScroll>>;
    additionalScrollRegions: Record<string, Awaited<ReturnType<typeof recordScroll>>> }> = [];
  const settings = page.getByRole("dialog", { name: "供应商与模型设置", exact: true });
  const save = async () => writeFile(join(output!, `${phase}-1366x768-supplier-corrected.json`), JSON.stringify({ phase, size: sizes[0], cpuRate,
    minimumAvailableMemoryBytes, measurements,
    performanceValid: measurements.length > 0 && measurements.every(row => row.opening.system.valid && row.scrolling?.system.valid &&
      Object.values(row.additionalScrollRegions).every(capture => capture.system.valid)),
    supersedes: "supplier scrolling in the original before-1366x768.json used a non-scroll container and is invalid",
    errors: fixture.errors, warnings: fixture.warnings, unexpected: fixture.unexpected, prohibited: fixture.prohibited }, null, 2));
  for (let i = 0; i < repetitions; i++) {
    await beginCapture(page);
    await page.getByTestId("workspace-settings").or(page.getByRole("button", { name: "供应商与模型", exact: true })).click();
    await expect(settings.locator(".sm-model-item").first()).toBeAttached();
    await ready(settings.getByLabel("搜索供应商", { exact: true }));
    const opening = await endCapture(page);
    const row: typeof measurements[number] = { iteration: i + 1, opening, additionalScrollRegions: {} };
    measurements.push(row); await save();
    row.scrolling = await recordScroll(page, settings.locator(".sm-detail"));
    await save();
    for (const selector of [".sm-group-virtual", ".sm-model-virtual"]) {
      const region = settings.locator(selector).first();
      if (await region.count()) {
        await region.scrollIntoViewIfNeeded();
        row.additionalScrollRegions[selector] = await recordScroll(page, region);
        await save();
      }
    }
    await page.keyboard.press("Escape"); await page.waitForTimeout(180);
  }
  await save();
  expect(fixture.errors).toEqual([]); expect(fixture.warnings).toEqual([]); expect(fixture.unexpected).toEqual([]); expect(fixture.prohibited).toEqual([]);
  await cdp.detach();
  expect(measurements.every(row => row.opening.system.valid && row.scrolling?.system.valid &&
    Object.values(row.additionalScrollRegions).every(capture => capture.system.valid)),
  "Performance samples require available RAM >= 6 GiB at both capture boundaries; invalid partial measurements were retained").toBe(true);
});
for (const size of sizes.slice(0, 2)) {
  test(`第三阶段供应商型号表证据 ${size.width}x${size.height}`, async ({ page }) => {
    test.skip(!output, "Set UI_PHASE3_OUTPUT_DIR for isolated evidence");
    test.setTimeout(60_000); page.setDefaultTimeout(10_000);
    await mkdir(output!, { recursive: true }); await page.setViewportSize(size);
    const fixture = await installPhase3LargeFixture(page);
    await page.goto("/"); await page.getByTestId("workspace-settings").or(page.getByRole("button", { name: "供应商与模型", exact: true })).click();
    await showSupplierModelTable(page.getByRole("dialog", { name: "供应商与模型设置", exact: true }));
    await page.waitForTimeout(250);
    await page.screenshot({ path: join(output!, `${phase}-settings-table-${size.width}x${size.height}.png`) });
    expect(fixture.errors).toEqual([]); expect(fixture.warnings).toEqual([]); expect(fixture.prohibited).toEqual([]);
  });
}
for (const size of sizes) {
  test(`第三阶段完整图片控件证据 ${size.width}x${size.height}`, async ({ page }, testInfo) => {
    test.skip(!output, "Set UI_PHASE3_OUTPUT_DIR for isolated evidence");
    test.setTimeout(90_000); page.setDefaultTimeout(10_000);
    await mkdir(output!, { recursive: true }); await page.setViewportSize(size);
    const fixture = await installPhase3LargeFixture(page, { imageParameters: true });
    await page.goto(`/canvas/${fixture.canvasId}`);
    const node = page.locator('.react-flow__node[data-id="phase3-generator"]');
    await expect(node).toBeVisible();
    const inspector = page.getByRole("button", { name: "智能体面板", exact: true });
    if (await inspector.getAttribute("aria-expanded") === "true") await inspector.click();
    const geometry: Array<{ screen: string; failures: string[] }> = [];
    const screenshots: string[] = [];
    const shot = async (screen: string, surface: Locator = page.locator("body")) => {
      await page.waitForTimeout(250);
      await waitForScreenshotImages(page);
      const failures = await surface.evaluate(element => {
        const rect = element.getBoundingClientRect();
        return [rect.left < -1 || rect.right > innerWidth + 1 || (element !== document.body && (rect.top < -1 || rect.bottom > innerHeight + 1)) ? "surface-outside-viewport" : null,
          element.scrollWidth > element.clientWidth + 1 ? "surface-horizontal-overflow" : null,
          document.documentElement.scrollWidth > innerWidth + 1 ? "document-horizontal-overflow" : null].filter((failure): failure is string => failure !== null);
      });
      geometry.push({ screen, failures });
      if (size.width === 1366 || size.width === 1920 || failures.length) {
        const file = `${phase}-${size.width}x${size.height}-${screen}.png`;
        await page.screenshot({ path: join(output!, file) }); screenshots.push(file);
      }
      const evidencePath = join(output!, `${phase}-${size.width}x${size.height}-parameters.json`);
      await writeFile(evidencePath, JSON.stringify({ phase, size, screenshots, geometry, visualFixture: fixture.visualFixture,
        errors: fixture.errors, warnings: fixture.warnings, prohibited: fixture.prohibited, unexpected: fixture.unexpected }, null, 2));
      if (phase === "after") expect.soft(failures, `${screen} ${size.width}x${size.height} geometry`).toEqual([]);
    };
    await shot("canvas");
    await node.locator(".node-head").click();
    await page.getByRole("button", { name: "打开 完整图片参数 模型与参数", exact: true }).click();
    const panel = page.getByRole("dialog", { name: "完整图片参数 模型与参数", exact: true });
    const tiers = panel.getByRole("group", { name: "自动与输出分辨率快捷档位", exact: true });
    await expect(tiers.getByRole("button")).toHaveText(["自动", "1K", "2K", "4K"]);
    await tiers.scrollIntoViewIfNeeded(); await ready(tiers.getByRole("button").first()); await shot("image-parameters-tiers", panel);
    const preset = panel.getByLabel("输出分辨率预设", { exact: true });
    await expect(preset.locator('option[value="3840x2160"]')).toContainText("4K · 16:9 · 3840 × 2160");
    const width = panel.getByLabel("图片宽度", { exact: true }), height = panel.getByLabel("图片高度", { exact: true });
    await width.scrollIntoViewIfNeeded(); await expect(width).toHaveValue("3840"); await expect(height).toHaveValue("2160");
    await ready(width); await ready(height); await shot("image-parameters-dimensions", panel);
    const quality = panel.getByLabel("质量", { exact: true });
    await quality.scrollIntoViewIfNeeded(); await expect(quality).toHaveValue("max"); await ready(quality); await shot("image-parameters-quality", panel);
    await panel.getByRole("combobox", { name: "完整图片参数 模型", exact: false }).click();
    await expect(panel.getByRole("combobox", { name: "搜索模型名称或 ID", exact: true })).toBeVisible();
    await ready(panel.getByRole("combobox", { name: "搜索模型名称或 ID", exact: true }));
    await shot("model-picker", panel);
    expect(fixture.errors).toEqual([]); expect(fixture.warnings).toEqual([]);
    expect(fixture.unexpected).toEqual([]); expect(fixture.prohibited).toEqual([]);
    await testInfo.attach("phase3-parameter-evidence", { path: join(output!, `${phase}-${size.width}x${size.height}-parameters.json`), contentType: "application/json" });
  });
}
for (const size of sizes) {
  test(`第三阶段逐屏隔离证据 ${size.width}x${size.height}`, async ({ page }, testInfo) => {
    test.skip(!output, "Set UI_PHASE3_OUTPUT_DIR for the isolated screen baseline and acceptance run");
    test.setTimeout(300_000);
    page.setDefaultTimeout(10_000);
    await mkdir(output!, { recursive: true });
    await page.setViewportSize(size);
    const fixture = await installPhase3LargeFixture(page);
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: cpuRate });
    const screenshots: string[] = [];
    const geometry: Array<{ screen: string; failures: string[]; rect: unknown; horizontalOverflow: number }> = [];
    const measurements: Record<string, Array<{ iteration: number; opening: Awaited<ReturnType<typeof endCapture>>;
      scrolling?: Awaited<ReturnType<typeof recordScroll>> }>> = {};
    const save = async () => writeFile(join(output!, `${phase}-${size.width}x${size.height}.json`), JSON.stringify({ phase, size, cpuRate,
      counts: PHASE3_COUNTS, repetitions, screenshots, geometry, measurements, visualFixture: fixture.visualFixture,
      captureMode: visualOnly ? "visual-only" : "performance-and-geometry",
      performance: { minimumAvailableMemoryBytes,
        valid: !visualOnly && Object.values(measurements).some(rows => rows.length > 0) && Object.values(measurements).every(rows => rows.every(row => row.opening.system.valid && row.scrolling?.system.valid)),
        invalidSamples: Object.entries(measurements).flatMap(([screen, rows]) => rows.flatMap(row =>
          [!row.opening.system.valid ? { screen, iteration: row.iteration, capture: "opening" } : null,
            row.scrolling && !row.scrolling.system.valid ? { screen, iteration: row.iteration, capture: "scrolling" } : null].filter(Boolean))) },
      errors: fixture.errors, warnings: fixture.warnings, unexpected: fixture.unexpected, prohibited: fixture.prohibited, mockedAutomatic: fixture.mockedAutomatic }, null, 2));
    const shot = async (name: string, surface: Locator) => {
      await expect(surface).toBeVisible();
      await page.waitForTimeout(220);
      await waitForScreenshotImages(page);
      const result = await surface.evaluate(element => {
        const rect = element.getBoundingClientRect();
        const failures: string[] = [];
        if (rect.left < -1 || rect.right > innerWidth + 1 || (element !== document.body && (rect.top < -1 || rect.bottom > innerHeight + 1))) failures.push("surface-outside-viewport");
        const horizontalOverflow = element.scrollWidth - element.clientWidth;
        if (horizontalOverflow > 1) failures.push("surface-horizontal-overflow");
        if (document.documentElement.scrollWidth > innerWidth + 1) failures.push("document-horizontal-overflow");
        return { failures, rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height }, horizontalOverflow };
      });
      geometry.push({ screen: name, ...result });
      if (size.width === 1366 || size.width === 1920 || result.failures.length) {
        const file = `${phase}-${name}-${size.width}x${size.height}.png`;
        await page.screenshot({ path: join(output!, file) }); screenshots.push(file);
      }
      await save();
      if (phase === "after") expect.soft(result.failures, `${name} ${size.width}x${size.height} geometry`).toEqual([]);
    };
    const openCanvas = async () => {
      await page.goto(`/canvas/${fixture.canvasId}`);
      await expect(page.locator('.react-flow__node[data-id="phase3-prompt"]')).toBeVisible();
      const toggle = page.getByRole("button", { name: "智能体面板", exact: true });
      if (await toggle.getAttribute("aria-expanded") === "true") await toggle.click();
      await page.waitForTimeout(250);
    };
    const measure = async (name: string, open: () => Promise<void>, control: Locator, container: Locator, content: Locator, close: () => Promise<void>) => {
      const data: typeof measurements[string] = [];
      measurements[name] = data;
      if (visualOnly) {
        await open(); await expect(content).toBeAttached(); await ready(control);
        return;
      }
      const count = size.width === 1366 ? repetitions : 1;
      for (let i = 0; i < count; i++) {
        await beginCapture(page);
        await open();
        // A responsive close/search button alone must not conceal delayed list work.
        await expect(content).toBeAttached();
        await ready(control);
        const opening = await endCapture(page);
        const row: typeof data[number] = { iteration: i + 1, opening };
        data.push(row); await save();
        row.scrolling = await recordScroll(page, container);
        await save();
        if (i < count - 1) { await close(); await page.waitForTimeout(180); }
      }
      await save();
    };
    try {
      await page.goto("/");
      await expect(page.getByTestId("neural-workspace")).toBeVisible();
      await shot("home", page.locator("body"));

      const settings = page.getByRole("dialog", { name: "供应商与模型设置", exact: true });
      await measure("supplier", () => page.getByTestId("workspace-settings").or(page.getByRole("button", { name: "供应商与模型", exact: true })).click(),
        settings.getByLabel("搜索供应商", { exact: true }), settings.locator(".sm-detail"), settings.locator(".sm-model-item").first(), () => page.keyboard.press("Escape"));
      await shot("settings", settings);
      await showSupplierModelTable(settings);
      await shot("settings-models", settings);
      await page.keyboard.press("Escape");

      await openCanvas();
      const library = page.getByRole("dialog", { name: "历史生成", exact: true });
      await measure("image-library", () => page.getByRole("button", { name: "历史生成", exact: true }).click(),
        library.getByRole("textbox", { name: "搜索图片名称或评审备注", exact: true }), library.locator(".library-scroll"), library.locator(".library-card").first(), () => page.keyboard.press("Escape"));
      await shot("image-library", library);
      for (let index = 0; index < 4; index++) await library.getByRole("checkbox", { name: `选择 ${fixture.assets[index]!.name}`, exact: true }).click();
      await library.getByRole("button", { name: "并排比稿", exact: true }).click();
      await expect(library.getByRole("heading", { name: "图片比稿", exact: true })).toBeVisible();
      await shot("compare", library);
      await page.keyboard.press("Escape");
      await page.keyboard.press("Escape");

      await openCanvas();
      const tasks = page.getByRole("dialog", { name: "运行历史", exact: true });
      await measure("task-center", () => page.getByRole("button", { name: "打开任务中心", exact: true }).click(),
        tasks.getByRole("button", { name: "刷新", exact: true }), tasks.locator(".history-list"), tasks.locator(".history-row").first(), () => page.keyboard.press("Escape"));
      await shot("task-center", tasks);
      // Existing failure details are expanded; the redesigned list may expose an explicit disclosure.
      const statusSelect = tasks.getByLabel("筛选任务状态", { exact: true });
      if (await statusSelect.count()) await statusSelect.selectOption("attention");
      else await tasks.getByRole("tab", { name: /^需要处理/u }).click();
      const failed = tasks.locator(".history-row").filter({ hasText: "隔离示例：读取生成结果时连接中断" }).first();
      await failed.scrollIntoViewIfNeeded();
      const reason = failed.getByRole("button", { name: "查看原因", exact: true });
      if (await reason.count()) await reason.click();
      await shot("failure", tasks);
      await page.keyboard.press("Escape");

      await openCanvas();
      const agent = page.getByRole("region", { name: "通用创作智能体", exact: true });
      await measure("agent", () => page.getByRole("button", { name: "打开智能体", exact: true }).click(),
        agent.getByRole("textbox").last(), agent.locator('[class*="conversation"]'), agent.locator('[class*="conversation"] article').first(), () => page.getByRole("button", { name: "智能体面板", exact: true }).click());
      await readyAgentConversation(agent, fixture.session.messages[0]!.content);
      await shot("agent", agent);
      await page.getByRole("button", { name: "智能体面板", exact: true }).click();

      await page.getByRole("button", { name: "打开平面设计", exact: true }).click();
      const graphic = page.getByRole("dialog", { name: "平面设计", exact: true });
      await expect(graphic.getByLabel("客户原文", { exact: true })).toBeVisible();
      await shot("graphic-design", graphic);
      await page.keyboard.press("Escape");

      await page.getByRole("button", { name: "项目文件", exact: true }).click();
      const projectFiles = page.getByRole("dialog", { name: "项目文件", exact: true });
      await expect(projectFiles.locator("article[data-file-id]").first()).toBeVisible();
      await shot("project-files", projectFiles);
      await page.keyboard.press("Escape");

      await page.locator('input[type="file"][accept*=".json"]').setInputFiles({ name: "phase3-visual-import.json", mimeType: "application/json",
        buffer: Buffer.from(JSON.stringify({ title: "导入布局预览 · 未执行替换", graph: fixture.canvas.graph })) });
      const importing = page.getByRole("dialog", { name: "确认替换当前画布", exact: true });
      await shot("import", importing);
      await page.keyboard.press("Escape");

      await page.getByRole("button", { name: "打开任务中心", exact: true }).focus();
      await page.keyboard.press("Shift+/");
      const shortcuts = page.getByRole("dialog", { name: "键盘快捷键", exact: true });
      await shot("shortcuts", shortcuts);
      await page.keyboard.press("Escape");

      await page.waitForFunction(() => (window as Window & { phase3UpdateReady?: () => boolean }).phase3UpdateReady?.());
      await page.evaluate(() => (window as Window & { phase3OpenUpdate?: () => void }).phase3OpenUpdate?.());
      await shot("update", page.getByRole("dialog", { name: "超级画布更新", exact: true }));
      expect(fixture.prohibited, "No external or business write request is allowed").toEqual([]);
      expect(fixture.unexpected, "Every mock must follow the actual API contract").toEqual([]);
      expect(fixture.errors).toEqual([]);
      expect(fixture.warnings).toEqual([]);
    } finally {
      await save();
      await testInfo.attach("phase3-screen-evidence", { path: join(output!, `${phase}-${size.width}x${size.height}.json`), contentType: "application/json" });
      await cdp.detach();
    }
  });
}
