import { expect, test, type Browser, type Page } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { installNeuralFixture, neuralProjects } from "./helpers/neural-fixture";
import { neuralScaleFixture } from "./helpers/neural-scale-fixture";

const repository = fileURLToPath(new URL("../../../..", import.meta.url));
const output = resolve(
  repository,
  process.env.NEURAL_EVIDENCE_DIR ?? ".codex-logs/2026-10-16-redesign/out",
);
const screenshots = join(output, "screenshots");
const workspace = (page: Page) => page.getByTestId("neural-workspace");
const inspector = (page: Page) => page.getByTestId("neural-inspector");
const scene = (page: Page) => page.locator("[data-renderer]").first();
const item = (page: Page, id: string) => page.getByTestId(`neural-item-${id}`);
const moduleButton = (
  page: Page,
  id: "canvases" | "suppliers" | "accounts" | "starts",
) => page.getByTestId(`neural-module-${id}`);
async function capture(page: Page, name: string) {
  await mkdir(screenshots, { recursive: true });
  await page.screenshot({
    path: join(screenshots, `${name}.png`),
    animations: "allow",
  });
}
async function captureRuntimeAvatars(page: Page, theme: "dark" | "light") {
  await expect(scene(page)).toHaveAttribute("data-renderer", "webgl");
  await expect(scene(page)).toHaveAttribute("data-avatars", "4");
  const viewport = page.viewportSize()!;
  const radius = Math.min(viewport.width, viewport.height) * .0832;
  const directory = join(output, "avatars", theme);
  await mkdir(directory, { recursive: true });
  const captures = [];
  for (const moduleId of ["canvases", "suppliers", "accounts", "starts"] as const) {
    const bounds = await moduleButton(page, moduleId).boundingBox();
    expect(bounds, `${moduleId} DOM projection must be present`).not.toBeNull();
    const center = { x: bounds!.x + bounds!.width / 2, y: bounds!.y + bounds!.height / 2 };
    // Contours occupy y[-1.20,.52] × radius; leave breathing/relief margins.
    // The lower edge stops before the glass card at center.y+48, preserving
    // the full silhouette without mistaking the card for part of the avatar.
    const clip = {
      x: Math.floor(Math.max(0, center.x - radius * 1.12)),
      y: Math.floor(Math.max(0, center.y - radius * 1.32)),
      width: Math.ceil(Math.min(radius * 2.24, viewport.width - Math.max(0, center.x - radius * 1.12))),
      height: Math.ceil(Math.min(radius * 1.94, viewport.height - Math.max(0, center.y - radius * 1.32))),
    };
    const filename = `${moduleId}-runtime.png`;
    await page.screenshot({ path: join(directory, filename), clip, animations: "allow", scale: "css" });
    captures.push({ module: moduleId, filename, viewport, center, satelliteRadiusCssPx: radius, clip, source: "Live single WebGL2 scene; four validated avatar data files ready; screenshot clip at native CSS resolution", contourLocalBounds: { x: [-.86, .86], y: [-1.2, .52] } });
  }
  const webgl = await scene(page).locator("canvas").evaluate(element => {
    const context = (element as HTMLCanvasElement).getContext("webgl2")!;
    const error = context.getError();
    return { error, lost: context.isContextLost(), contexts: window.__superCanvasNeuralMetrics?.activeContexts, currentProgramBound: context.getParameter(context.CURRENT_PROGRAM) !== null };
  });
  expect(webgl.error, "角色三角带着色器绘制不能留下 WebGL 错误").toBe(0);
  expect(webgl.lost).toBe(false);
  expect(webgl.contexts).toBe(1);
  await writeFile(join(directory, "runtime-captures.json"), JSON.stringify({ at: new Date().toISOString(), theme, webgl, captures }, null, 2));
}
async function openHome(page: Page) {
  await page.goto("/");
  await expect(workspace(page)).toBeVisible();
  await expect(scene(page)).toHaveAttribute("data-avatars", "4");
}
async function canvasPanel(page: Page) {
  await moduleButton(page, "canvases").click();
  await item(page, "neural-autumn").click();
  await expect(inspector(page)).toContainText("秋日品牌视觉");
}
async function expectNoOverflow(page: Page) {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth - innerWidth,
    ),
    "窗口不得横向溢出",
  ).toBeLessThanOrEqual(1);
  for (const element of [workspace(page), inspector(page)]) {
    if (!(await element.isVisible())) continue;
    const bounds = (await element.boundingBox())!;
    expect(bounds.x).toBeGreaterThanOrEqual(-1);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(
      (page.viewportSize()?.width ?? 1440) + 1,
    );
  }
}

test("三层工作台通过键盘进入与逐层返回，读取已有数据且不扫描", async ({
  page,
}) => {
  const fixture = await installNeuralFixture(page);
  await openHome(page);
  await expect(moduleButton(page, "canvases")).toContainText("3");
  await expect(moduleButton(page, "suppliers")).toContainText("2");
  await expect(moduleButton(page, "accounts")).toContainText("2");
  expect(fixture.mutations).toEqual([]);
  expect(fixture.canvasReads).toEqual([]);
  await moduleButton(page, "canvases").focus();
  await page.keyboard.press("Enter");
  await expect(item(page, "neural-autumn")).toBeVisible();
  const entry = item(page, "neural-autumn");
  const activate = entry.getByRole("button").first();
  if (await activate.count()) await activate.focus();
  else await entry.focus();
  await page.keyboard.press("Enter");
  await expect(inspector(page)).toContainText("秋日品牌视觉");
  await expect(
    inspector(page).getByRole("button", { name: "打开画布", exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(inspector(page)).toHaveCount(0);
  await expect(entry).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("graph-search")).toBeVisible();
  fixture.assertSafe();
});

test("图谱检索匹配完整型号 ID，键盘选中结果后定位供应商", async ({ page }) => {
  const fixture = await installNeuralFixture(page);
  await openHome(page);
  const search = page.getByTestId("graph-search");
  await search.fill("fixture-image-2.5-4k");
  const results = page.getByTestId("graph-results");
  await expect(results).toBeVisible();
  await expect(results).toContainText("fixture-image-2.5-4k");
  await search.press("ArrowDown");
  await search.press("ArrowUp");
  await search.press("Enter");
  await expect(inspector(page)).toContainText("fixture-image-2.5-4k");
  await expect(inspector(page)).toContainText("晨星创作");
  await expect(inspector(page)).toContainText("¥0.40");
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await search.fill("不存在的图谱条目");
  await expect(results).toBeVisible();
  await expect(results).toContainText("交给创作助手");
  await search.press("Escape");
  await expect(results).toHaveCount(0);
  fixture.assertSafe();
});

test("交给创作助手只预填草稿，不发送任务或生成请求", async ({ page }) => {
  const fixture = await installNeuralFixture(page);
  await openHome(page);
  const prompt = "想聊聊秋天的海报，先不要生成";
  await page.getByTestId("graph-search").fill(prompt);
  await page
    .getByTestId("graph-results")
    .getByRole("button", { name: /交给创作助手/u })
    .click();
  await expect(page).toHaveURL(/\/canvas\/neural-created-1(?:\?.*)?$/u);
  const agent = page.getByRole("region", { name: "通用创作智能体" });
  await expect(agent.getByLabel("创作任务要求")).toHaveValue(prompt);
  await expect(
    agent.getByRole("button", { name: "聊天", exact: true }),
  ).toHaveCount(0);
  expect(fixture.createdTitles).toEqual(["创作对话"]);
  fixture.assertSafe();
});

test("鼠标关闭检索后保持关闭，重新输入才再次展开", async ({ page }) => {
  const fixture = await installNeuralFixture(page, { motion: false });
  await openHome(page);
  const search = page.getByTestId("graph-search"),
    results = page.getByTestId("graph-results");
  await search.fill("fixture-image");
  await expect(results).toBeVisible();
  await results.getByRole("button", { name: "关闭检索", exact: true }).click();
  await expect(results).toHaveCount(0);
  await page.waitForTimeout(200);
  await expect(results).toHaveCount(0);
  await expect(search).toHaveAttribute("aria-expanded", "false");
  await capture(page, "dark-graph-closed");
  await search.fill("fixture-personal-image");
  await expect(results).toBeVisible();
  fixture.assertSafe();
});

test("检索个人账号完整型号 ID 后打开其所属账号及设置", async ({ page }) => {
  const fixture = await installNeuralFixture(page, { motion: false });
  await openHome(page);
  const search = page.getByTestId("graph-search");
  await search.fill("fixture-personal-image");
  await expect(page.getByTestId("graph-results")).toContainText(
    "fixture-personal-image",
  );
  await search.press("Enter");
  await expect(inspector(page)).toContainText("我的即梦工作室");
  await expect(inspector(page)).toContainText("fixture-personal-image");
  await capture(page, "dark-account-model-inspector");
  await inspector(page)
    .getByRole("button", { name: "打开设置", exact: true })
    .click();
  await expect(
    page
      .getByRole("dialog", { name: "供应商与模型设置" })
      .getByLabel("连接名称", { exact: true }),
  ).toHaveValue("我的即梦工作室");
  fixture.assertSafe();
});

test("条目管理真正定位到供应商和个人连接，打开设置不发起主动请求", async ({
  page,
}) => {
  const fixture = await installNeuralFixture(page);
  await openHome(page);
  await moduleButton(page, "suppliers").click();
  await item(page, "neural-supplier-1").click();
  await inspector(page)
    .getByRole("button", { name: "管理连接", exact: true })
    .click();
  const settings = page.getByRole("dialog", { name: "供应商与模型设置" });
  await expect(
    settings.getByRole("heading", { name: "纸月模型", exact: true }),
  ).toBeVisible();
  await settings.getByRole("tab", { name: "连接配置", exact: true }).click();
  await expect(settings.getByLabel("供应商名称", { exact: true })).toHaveValue(
    "纸月模型",
  );
  await settings.getByRole("button", { name: "关闭设置", exact: true }).click();
  await moduleButton(page, "accounts").click();
  await item(page, "neural-account-1").click();
  await inspector(page)
    .getByRole("button", { name: "打开设置", exact: true })
    .click();
  await expect(
    settings.getByRole("tab", { name: "个人 AI 网站", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await expect(settings.getByLabel("连接名称", { exact: true })).toHaveValue(
    "灵感实验室",
  );
  fixture.assertSafe();
});

test("减少动态效果和隐藏页面停止渲染，恢复后只有有效循环", async ({ page }) => {
  const fixture = await installNeuralFixture(page);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await openHome(page);
  await expect(scene(page)).toHaveAttribute("data-animating", "false");
  await page.waitForTimeout(200);
  const still = await scene(page).getAttribute("data-frame");
  await page.waitForTimeout(250);
  expect(await scene(page).getAttribute("data-frame")).toBe(still);
  await capture(page, "reduced-motion");
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await expect(scene(page)).toHaveAttribute("data-animating", "true");
  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", {
      configurable: true,
      value: true,
    });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect(scene(page)).toHaveAttribute("data-animating", "false");
  await page.waitForTimeout(100);
  const hidden = await scene(page).getAttribute("data-frame");
  await page.waitForTimeout(200);
  expect(await scene(page).getAttribute("data-frame")).toBe(hidden);
  await page.evaluate(() => {
    Reflect.deleteProperty(document, "hidden");
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect(scene(page)).toHaveAttribute("data-animating", "true");
  fixture.assertSafe();
});

test("WebGL 不可用时保留 Canvas2D 场景和完整 DOM 交互", async ({ page }) => {
  const fixture = await installNeuralFixture(page, {
    noWebGL: true,
    motion: false,
  });
  await openHome(page);
  await expect(scene(page)).toHaveAttribute("data-renderer", "canvas2d");
  await expect(scene(page).locator("canvas")).toBeVisible();
  await capture(page, "webgl-fallback");
  await canvasPanel(page);
  await expect(
    inspector(page).getByRole("button", { name: "打开画布", exact: true }),
  ).toBeEnabled();
  fixture.assertSafe();
});

test("WebGL 上下文丢失后释放场景资源并切换到 Canvas2D", async ({ page }) => {
  const fixture = await installNeuralFixture(page, { motion: false });
  await openHome(page);
  await expect(scene(page)).toHaveAttribute("data-renderer", "webgl");
  await scene(page)
    .locator("canvas")
    .evaluate((element) => {
      const context = (element as HTMLCanvasElement).getContext("webgl2");
      const extension = context?.getExtension("WEBGL_lose_context");
      if (!extension)
        throw new Error("Context-loss fixture requires WEBGL_lose_context");
      extension.loseContext();
    });
  await expect(scene(page)).toHaveAttribute("data-renderer", "canvas2d");
  await canvasPanel(page);
  await expect(inspector(page)).toContainText("秋日品牌视觉");
  expect(
    await page.evaluate(
      () => window.__superCanvasNeuralMetrics?.activeContexts,
    ),
  ).toBe(0);
  fixture.assertSafe();
});

for (const theme of ["dark", "light"] as const) {
  test(`${theme} 1440×900 完整流程录屏及截图`, async ({
    browser,
  }, testInfo) => {
    test.setTimeout(120_000);
    await recordFlow(browser, theme, String(testInfo.project.use.baseURL));
  });
  test(`${theme} 画布内设置加载真实列表详情且可操作、不创建首页上下文`, async ({
    page,
  }) => {
    const fixture = await installNeuralFixture(page, { theme, motion: false });
    await page.goto("/canvas/neural-autumn");
    await expect(page.locator(".react-flow")).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
    await page.getByRole("button", { name: "API 设置", exact: true }).click();
    const settings = page.getByRole("dialog", { name: "供应商与模型设置" });
    await expect(settings).toBeVisible();
    const suppliers = settings.getByRole("complementary", {
      name: "供应商列表",
    });
    await expect(
      suppliers.getByRole("button", { name: /^晨星创作 \d+ 个已配置连接/ }),
    ).toBeVisible();
    await expect(
      suppliers.getByRole("button", { name: /^纸月模型 \d+ 个已配置连接/ }),
    ).toBeVisible();
    await expect(
      settings
        .locator(".sm-main")
        .getByRole("heading", { name: "晨星创作", exact: true }),
    ).toBeVisible();
    const modelsTab = settings.getByRole("tab", {
      name: "模型与分组",
      exact: true,
    });
    await expect(modelsTab).toHaveAttribute("aria-selected", "true");
    await expect(
      settings
        .locator(".sm-model-item code")
        .getByText("fixture-image-2.5-4k", { exact: true }),
    ).toBeVisible();
    await expect(workspace(page)).toHaveCount(0);
    await expect(page.locator("[data-renderer]")).toHaveCount(0);
    await expect(
      page.locator('[data-settings-context="canvas"]'),
    ).toBeVisible();
    expect(
      await settings
        .locator(".sm-settings-body")
        .evaluate((element) => getComputedStyle(element).backgroundColor),
    ).toMatch(/\/\s*0\.94\)/u);
    await capture(page, `${theme}-canvas-settings`);
    const supplierSearch = settings.getByRole("textbox", {
      name: "搜索供应商",
      exact: true,
    });
    await supplierSearch.fill("纸月");
    await expect(
      suppliers.getByRole("button", { name: /^纸月模型 \d+ 个已配置连接/ }),
    ).toBeVisible();
    await expect(
      suppliers.getByRole("button", { name: /^晨星创作 \d+ 个已配置连接/ }),
    ).toHaveCount(0);
    await supplierSearch.clear();
    await settings.getByRole("tab", { name: "连接配置", exact: true }).click();
    const supplierName = settings.getByRole("textbox", {
      name: "供应商名称",
      exact: true,
    });
    await expect(supplierName).toHaveValue("晨星创作");
    await expect(supplierName).toBeEditable();
    await supplierName.click();
    await expect(supplierName).toBeFocused();
    await supplierName.fill("晨星创作 · 界面验收草稿");
    await expect(supplierName).toHaveValue("晨星创作 · 界面验收草稿");
    await supplierName.fill("晨星创作");
    await capture(page, `${theme}-canvas-settings-connection`);
    await modelsTab.click();
    const cachedModel = settings
      .locator(".sm-model-item code")
      .getByText("fixture-image-2.5-4k", { exact: true });
    await cachedModel.scrollIntoViewIfNeeded();
    await expect(cachedModel).toBeInViewport();
    await capture(page, `${theme}-canvas-settings-models`);
    await settings
      .getByRole("button", { name: "关闭设置", exact: true })
      .click();
    await expect(settings).toHaveCount(0);
    fixture.assertSafe();
  });
}

test("1024×700 模块、分析面板与设置无横向溢出", async ({ page }) => {
  const fixture = await installNeuralFixture(page, { motion: false });
  await page.setViewportSize({ width: 1024, height: 700 });
  await openHome(page);
  await expectNoOverflow(page);
  await canvasPanel(page);
  await expectNoOverflow(page);
  await capture(page, "narrow-1024x700");
  await page.getByTestId("workspace-settings").click();
  const settings = page.getByRole("dialog", { name: "供应商与模型设置" });
  await expect(settings).toBeVisible();
  expect(
    await settings.evaluate(
      (element) => element.scrollWidth - element.clientWidth,
    ),
  ).toBeLessThanOrEqual(1);
  fixture.assertSafe();
});

async function recordFlow(
  browser: Browser,
  theme: "dark" | "light",
  baseURL: string,
) {
  await mkdir(output, { recursive: true });
  const context = await browser.newContext({
    baseURL,
    viewport: { width: 1440, height: 900 },
    colorScheme: theme,
    extraHTTPHeaders: {
      "x-supercanvas-desktop-token": "supercanvas-isolated-e2e-session",
    },
    recordVideo: {
      dir: join(output, "video-raw"),
      size: { width: 1440, height: 900 },
    },
  });
  const page = await context.newPage();
  const fixture = await installNeuralFixture(page, { theme });
  const video = page.video();
  try {
    await openHome(page);
    await page.waitForTimeout(2700);
    await capture(page, `${theme}-hub`);
    await moduleButton(page, "canvases").hover({ force: true });
    await page.waitForTimeout(500);
    if (theme === "dark") await capture(page, "dark-hover-satellite");
    await moduleButton(page, "canvases").click({ force: true });
    await page.waitForTimeout(800);
    await capture(page, `${theme}-canvases-module`);
    await item(page, neuralProjects[0]!.id).hover();
    await page.waitForTimeout(350);
    await item(page, neuralProjects[0]!.id).click();
    await page.waitForTimeout(800);
    await capture(page, `${theme}-canvas-inspector`);
    if (theme === "dark") {
      await moduleButton(page, "suppliers").click({ force: true });
      await page.waitForTimeout(750);
      await capture(page, "dark-suppliers-module");
      await item(page, "neural-supplier-0").click();
      await page.waitForTimeout(750);
      await capture(page, "dark-supplier-inspector");
      await moduleButton(page, "accounts").click({ force: true });
      await page.waitForTimeout(750);
      await capture(page, "dark-accounts-module");
      await page.keyboard.press("Escape");
      await page.getByTestId("graph-search").fill("fixture-image");
      await page.waitForTimeout(500);
      await capture(page, "dark-graph-search");
      await page.keyboard.press("Escape");
    }
    await page.getByTestId("workspace-settings").click();
    const settings = page.getByRole("dialog", { name: "供应商与模型设置" });
    await expect(
      settings.getByRole("heading", { name: "晨星创作", exact: true }),
    ).toBeVisible();
    await page.waitForTimeout(500);
    await capture(page, `${theme}-settings-suppliers`);
    await settings
      .getByRole("tab", { name: "个人 AI 网站", exact: true })
      .click();
    await expect(settings.getByLabel("连接名称", { exact: true })).toHaveValue(
      "我的即梦工作室",
    );
    if (theme === "dark") await capture(page, "dark-settings-accounts");
    await settings
      .getByRole("button", { name: "关闭设置", exact: true })
      .click();
    await canvasPanel(page);
    await inspector(page)
      .getByRole("button", { name: "打开画布", exact: true })
      .click();
    await expect(page).toHaveURL(/\/canvas\/neural-autumn$/u);
    await expect(page.locator(".react-flow")).toBeVisible();
    await page.waitForTimeout(600);
    await page.getByRole("button", { name: "返回主界面", exact: true }).click();
    await expect(workspace(page)).toBeVisible();
    await page.waitForTimeout(800);
    fixture.assertSafe();
  } finally {
    await context.close();
    if (video) await video.saveAs(join(output, `flow-${theme}.webm`));
  }
}

test("首页与画布往返 20 次后堆、DOM 和 WebGL 上下文保持稳定", async ({
  page,
  context,
}) => {
  test.setTimeout(240_000);
  const fixture = await installNeuralFixture(page, { motion: false });
  await installContextProbe(page);
  const cdp = await context.newCDPSession(page);
  await cdp.send("Performance.enable");
  const samples: Array<Record<string, number>> = [];
  const sample = async (cycle: number) => {
    await cdp.send("HeapProfiler.collectGarbage");
    const { metrics } = await cdp.send("Performance.getMetrics");
    const counters = await cdp.send("Memory.getDOMCounters");
    const contexts = await page.evaluate(() => {
      const probe =
        (
          window as Window & {
            __neuralContextProbe?: Array<{
              deref(): WebGLRenderingContext | undefined;
            }>;
          }
        ).__neuralContextProbe ?? [];
      const active = probe.filter((reference) => {
        const value = reference.deref();
        return value && !value.isContextLost();
      });
      // Prune expired probe wrappers too, so the measurement harness does not
      // introduce an ever-growing array while checking the product's retention.
      probe.splice(0, probe.length, ...active);
      return active.length;
    });
    samples.push({
      cycle,
      heapBytes:
        metrics.find((metric) => metric.name === "JSHeapUsedSize")?.value ?? 0,
      documents: counters.documents,
      nodes: counters.nodes,
      listeners: counters.jsEventListeners,
      webglContexts: contexts,
    });
    await writeFile(
      join(output, "memory-20-roundtrips.json"),
      JSON.stringify(samples, null, 2),
    );
  };
  await openHome(page);
  // Warm both routes before the baseline, so one-time route/module loading is excluded.
  await canvasPanel(page);
  await inspector(page)
    .getByRole("button", { name: "打开画布", exact: true })
    .click();
  await expect(page.locator(".react-flow")).toBeVisible();
  await page.getByRole("button", { name: "返回主界面", exact: true }).click();
  await expect(workspace(page)).toBeVisible();
  await sample(0);
  for (let cycle = 1; cycle <= 20; cycle++) {
    await canvasPanel(page);
    await inspector(page)
      .getByRole("button", { name: "打开画布", exact: true })
      .click();
    await expect(page.locator(".react-flow")).toBeVisible();
    await page.getByRole("button", { name: "返回主界面", exact: true }).click();
    await expect(workspace(page)).toBeVisible();
    await sample(cycle);
  }
  const tail = samples.slice(-6),
    baseline = samples[0]!;
  expect(
    tail.every((value) => value.webglContexts! <= 1),
    "只保留首页当前唯一上下文",
  ).toBe(true);
  expect(
    Math.max(...tail.map((value) => value.heapBytes!)) - baseline.heapBytes!,
    "预热后堆增长应低于 12 MiB",
  ).toBeLessThan(12 * 1024 ** 2);
  expect(
    tail[tail.length - 1]!.nodes! - baseline.nodes!,
    "DOM 不得随每次往返累加",
  ).toBeLessThan(300);
  expect(
    tail.every(
      (value, index) =>
        !index || value.heapBytes! > tail[index - 1]!.heapBytes!,
    ),
    "最后六轮 GC 后堆不能严格单调增长",
  ).toBe(false);
  fixture.assertSafe();
});

async function installContextProbe(page: Page) {
  await page.addInitScript(() => {
    const references: Array<{ deref(): WebGLRenderingContext | undefined }> =
      [];
    const WeakReference = (
      globalThis as unknown as {
        WeakRef: new (context: WebGLRenderingContext) => {
          deref(): WebGLRenderingContext | undefined;
        };
      }
    ).WeakRef;
    const seen = new WeakSet<object>();
    Object.assign(window, { __neuralContextProbe: references });
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (
      this: HTMLCanvasElement,
      ...args: Parameters<typeof original>
    ) {
      const result = Reflect.apply(original, this, args);
      if (String(args[0]).startsWith("webgl") && result && !seen.has(result)) {
        seen.add(result);
        references.push(new WeakReference(result as WebGLRenderingContext));
      }
      return result;
    } as typeof original;
  });
}

test("1440×900 记录真实 GPU 与帧时间，持续慢帧依次降低画质", async ({
  page,
}) => {
  test.setTimeout(45_000);
  const fixture = await installNeuralFixture(page);
  await openHome(page);
  await page.bringToFront();
  await page.waitForTimeout(2700);
  const environment = await scene(page)
    .locator("canvas")
    .evaluate((element) => {
      const canvas = element as HTMLCanvasElement,
        gl = canvas.getContext("webgl2");
      const debug = gl?.getExtension("WEBGL_debug_renderer_info");
      return {
        userAgent: navigator.userAgent,
        devicePixelRatio: devicePixelRatio,
        canvasWidth: canvas.width,
        canvasHeight: canvas.height,
        cssWidth: canvas.clientWidth,
        cssHeight: canvas.clientHeight,
        vendor: gl
          ? gl.getParameter(debug ? debug.UNMASKED_VENDOR_WEBGL : gl.VENDOR)
          : null,
        renderer: gl
          ? gl.getParameter(debug ? debug.UNMASKED_RENDERER_WEBGL : gl.RENDERER)
          : "canvas2d",
        version: gl ? gl.getParameter(gl.VERSION) : null,
        debugRendererInfoAvailable: Boolean(debug),
      };
    });
  const phases: Array<{
    phase: string;
    samples: Array<Record<string, number | string | null>>;
  }> = [];
  const sample = async (phase: string) => {
    const samples = await page.evaluate(
      () =>
        new Promise<Array<Record<string, number | string | null>>>(
          (resolve) => {
            const values: Array<Record<string, number | string | null>> = [];
            const tick = () => {
              const stats = window.__superCanvasNeuralMetrics;
              if (stats)
                values.push({
                  gpuMilliseconds: stats.gpuMilliseconds,
                  cpuMilliseconds: stats.cpuMilliseconds,
                  frameMilliseconds: stats.frameMilliseconds,
                  quality: stats.quality,
                  renderer: stats.renderer,
                });
              if (values.length < 120) requestAnimationFrame(tick);
              else resolve(values);
            };
            requestAnimationFrame(tick);
          },
        ),
    );
    phases.push({ phase, samples });
  };
  await sample("idle");
  await moduleButton(page, "canvases").click({ force: true });
  await item(page, "neural-autumn").click();
  await sample("module-and-inspector");
  await page.getByTestId("workspace-settings").click();
  await expect(
    page.getByRole("dialog", { name: "供应商与模型设置" }),
  ).toBeVisible();
  await page.waitForTimeout(300);
  await sample("settings-open-dimmed");
  await page.getByRole("button", { name: "关闭设置", exact: true }).click();
  await page.evaluate(() => window.dispatchEvent(new Event("blur")));
  await page.waitForTimeout(150);
  await sample("window-blurred");
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  const before = Number(await scene(page).getAttribute("data-quality"));
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        // An explicit main-thread stall exercises the real sustained-frame watchdog;
        // it is recorded separately and excluded from idle/interaction GPU samples.
        const end = performance.now() + 4800;
        const busyFrame = () => {
          const until = performance.now() + 30;
          while (performance.now() < until) {
            /* Deliberate slow-frame fixture. */
          }
          if (performance.now() < end) requestAnimationFrame(busyFrame);
          else resolve();
        };
        requestAnimationFrame(busyFrame);
      }),
  );
  const after = Number(await scene(page).getAttribute("data-quality"));
  await writeFile(
    join(output, "frame-performance.json"),
    JSON.stringify(
      {
        viewport: page.viewportSize(),
        environment,
        phases,
        degradation: {
          before,
          after,
          method:
            "4800 ms deliberate 30 ms main-thread work per rAF; excluded from measured phases",
        },
        interpretation:
          "GPU milliseconds are latest EXT_disjoint_timer_query_webgl2 snapshots, refreshed about every 45 rendered frames; 120 rAF snapshots are not 120 independent GPU queries. Null means unavailable. Frame interval includes compositor scheduling and is not GPU time. Development preview and concurrent verification may affect timings.",
      },
      null,
      2,
    ),
  );
  expect(after, "持续慢帧应先减粒子再关闭 bloom").toBe(2);
  const idleGpu = phases[0]!.samples.flatMap((value) =>
    typeof value.gpuMilliseconds === "number" ? [value.gpuMilliseconds] : [],
  );
  if (idleGpu.length)
    expect(
      Math.max(...idleGpu),
      "空闲已观测 GPU 查询快照应低于 6ms 目标",
    ).toBeLessThan(6);
  fixture.assertSafe();
});

for (const theme of ["dark", "light"] as const) for (const extreme of [false, true]) {
  test(`ordered neural scale ${theme} ${extreme ? "extreme" : "real"}`, async ({ page }) => {
    const data = neuralScaleFixture(extreme);
    const fixture = await installNeuralFixture(page, { ...data, theme, motion: true });
    await openHome(page);
    await expect(scene(page)).toHaveAttribute("data-renderer", "webgl");
    await expect(scene(page)).toHaveAttribute("data-avatars", "4");
    await expect(moduleButton(page, "suppliers")).toContainText(String(data.counts.suppliers));
    await expect(moduleButton(page, "suppliers")).toContainText(data.counts.models.toLocaleString("zh-CN"));
    await expect(scene(page)).toHaveAttribute("data-entity-points", String((extreme ? 25 : 4) + data.counts.suppliers + 2 + 5));
    if (extreme) await expect(scene(page).getByText("+176", { exact: true })).toBeVisible();
    expect(data.connections.length).toBe(data.counts.connections);
    await page.waitForTimeout(2600);
    await capture(page, `v2-${theme}-${extreme ? "extreme" : "real"}-hub`);
    if (!extreme) await captureRuntimeAvatars(page, theme);
    await moduleButton(page, "suppliers").hover();
    await page.waitForTimeout(250);
    await capture(page, `v2-${theme}-${extreme ? "extreme" : "real"}-hover`);
    await page.mouse.move(660, 650); await page.mouse.move(680, 638, { steps: 4 }); await page.mouse.move(705, 632, { steps: 4 });
    await capture(page, `v2-${theme}-${extreme ? "extreme" : "real"}-trail`);
    await moduleButton(page, "canvases").click();
    await expect(item(page, "scale-canvas-0")).toBeVisible();
    await page.keyboard.press("Escape");
    await expectNoOverflow(page);
    const performanceSample = await page.evaluate(async () => {
      const frames: number[] = [], cpu: number[] = [], gpu: number[] = [];
      for (let i = 0; i < 120; i++) {
        await new Promise(requestAnimationFrame);
        const metrics = window.__superCanvasNeuralMetrics;
        if (metrics) { frames.push(metrics.frameMilliseconds); cpu.push(metrics.cpuMilliseconds); if (metrics.gpuMilliseconds !== null) gpu.push(metrics.gpuMilliseconds); }
      }
      return { frames, cpu, gpu, metrics: window.__superCanvasNeuralMetrics };
    });
    await mkdir(output, { recursive: true });
    await writeFile(join(output, `v2-${theme}-${extreme ? "extreme" : "real"}-scene-performance.json`), JSON.stringify({ fixture: data.counts, sample: performanceSample }, null, 2));
    fixture.assertSafe();
  });
}
