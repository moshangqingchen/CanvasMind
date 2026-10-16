import { expect, test, type Locator, type Page } from "@playwright/test";
import { installPhase5StateFixture } from "./helpers/phase5-state-fixture";

const preferenceKey = "supercanvas:appearance";
type Theme = "light" | "dark";
type ThemeWindow = Window & {
  __themePaints?: { theme?: string; scheme: string }[];
  __themeCards?: Element[];
  __themeNativeCalls?: string[];
};

test.use({ viewport: { width: 1920, height: 1080 } });

async function seedTheme(page: Page, theme: "system" | Theme) {
  await page.addInitScript(({ key, choice }) => {
    // Initialize a fresh profile only; reloading must use the actual UI choice.
    if (localStorage.getItem(key) === null) localStorage.setItem(key, choice);
  }, { key: preferenceKey, choice: theme });
}

async function expectTheme(page: Page, theme: Theme, preference?: string) {
  await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
  await expect(page.locator("html")).toHaveCSS("color-scheme", theme);
  if (preference) await expect(page.locator("html")).toHaveAttribute("data-theme-preference", preference);
}

async function openCanvas(page: Page, id: string) {
  await page.goto(`/canvas/${id}`);
  await expect(page.locator('.react-flow__node[data-id="prompt"]')).toBeVisible();
  await expect(page.locator(".react-flow__node")).toHaveCount(14);
}

async function appearance(page: Page): Promise<Locator> {
  await page.getByRole("button", { name: "API 设置", exact: true }).click();
  await page.getByRole("tab", { name: "外观", exact: true }).click();
  const panel = page.getByRole("tabpanel", { name: "外观", exact: true });
  await expect(panel).toBeVisible();
  return panel.getByRole("combobox", { name: "外观主题", exact: true });
}

test("更多菜单可快捷切换外观，Esc归还焦点且CtrlK搜索不受影响", async ({ page, request }) => {
  const f = await installPhase5StateFixture(page, request);
  await seedTheme(page, "light");
  await openCanvas(page, f.canvas.id);
  const more = page.getByRole("button", { name: "打开项目菜单", exact: true });
  await more.click();
  const menu = page.getByRole("menu", { name: "项目操作", exact: true });
  const control = menu.getByRole("combobox", { name: "外观主题", exact: true });
  await expect(control).toBeVisible();
  await control.selectOption("dark");
  await expectTheme(page, "dark", "dark");
  await control.press("Escape");
  await expect(menu).toBeHidden();
  await expect(more).toBeFocused();
  await page.keyboard.press("Control+k");
  const commands = page.getByRole("dialog", { name: "快捷操作", exact: true });
  await expect(commands.getByRole("combobox", { name: "搜索画布操作", exact: true })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(commands).toBeHidden();
  f.check();
});

for (const theme of ["light", "dark"] as const) {
  test(`显式${theme}主题在相反系统主题下首帧正确且无主题闪烁`, async ({ page, request }) => {
    const f = await installPhase5StateFixture(page, request);
    await page.emulateMedia({ colorScheme: theme === "light" ? "dark" : "light" });
    await seedTheme(page, theme);
    await page.addInitScript(() => {
      const samples: { theme?: string; scheme: string }[] = [];
      (window as ThemeWindow).__themePaints = samples;
      let frames = 0;
      const frame = () => {
        if (document.body?.children.length && document.body.getBoundingClientRect().height > 0)
          samples.push({ theme: document.documentElement.dataset.theme, scheme: document.documentElement.style.colorScheme });
        if (++frames < 90) requestAnimationFrame(frame);
      };
      requestAnimationFrame(frame);
    });
    await openCanvas(page, f.canvas.id);
    await expectTheme(page, theme, theme);
    await expect.poll(() => page.evaluate(() => (window as ThemeWindow).__themePaints?.length ?? 0)).toBeGreaterThan(0);
    const samples = await page.evaluate(() => (window as ThemeWindow).__themePaints ?? []);
    expect(samples.every(sample => sample.theme === theme && sample.scheme === theme), "正文第一次可绘制起，主题必须已经设置好").toBe(true);
    f.check();
  });
}

test("设置外观真实切换，刷新及恢复同一资料的新浏览器上下文保持选择", async ({ page, request, browser, context }, testInfo) => {
  const f = await installPhase5StateFixture(page, request);
  await page.emulateMedia({ colorScheme: "light" });
  await seedTheme(page, "light");
  await openCanvas(page, f.canvas.id);
  const control = await appearance(page);
  await expect(control).toHaveValue("light");
  await control.selectOption("dark");
  await expectTheme(page, "dark", "dark");
  expect(await page.evaluate(key => localStorage.getItem(key), preferenceKey)).toBe("dark");
  await page.reload();
  await expect(page.locator('.react-flow__node[data-id="prompt"]')).toBeVisible();
  await expectTheme(page, "dark", "dark");
  const persisted = await context.storageState();
  const resumed = await browser.newContext({ storageState: persisted, colorScheme: "light",
    baseURL: testInfo.project.use.baseURL, extraHTTPHeaders: testInfo.project.use.extraHTTPHeaders,
    viewport: { width: 1920, height: 1080 } });
  try {
    const nextPage = await resumed.newPage();
    const nextFixture = await installPhase5StateFixture(nextPage, request);
    await openCanvas(nextPage, nextFixture.canvas.id);
    await expectTheme(nextPage, "dark", "dark");
    const nextControl = await appearance(nextPage);
    await expect(nextControl).toHaveValue("dark");
    nextFixture.check();
  } finally { await resumed.close(); }
  f.check();
});

test("默认跟随系统，并响应系统变化而不写入显式偏好", async ({ page, request }) => {
  const f = await installPhase5StateFixture(page, request);
  await page.emulateMedia({ colorScheme: "light" });
  await openCanvas(page, f.canvas.id);
  await expectTheme(page, "light", "system");
  expect(await page.evaluate(key => localStorage.getItem(key), preferenceKey)).toBeNull();
  const control = await appearance(page);
  await expect(control).toHaveValue("system");
  await page.emulateMedia({ colorScheme: "dark" });
  await expectTheme(page, "dark", "system");
  await expect(control).toHaveValue("system");
  await page.emulateMedia({ colorScheme: "light" });
  await expectTheme(page, "light", "system");
  expect(await page.evaluate(key => localStorage.getItem(key), preferenceKey)).toBeNull();
  f.check();
});

test("跨标签页外观切换与清除偏好同步，不产生轮询或付费请求", async ({ page, request, context }) => {
  const f = await installPhase5StateFixture(page, request);
  await page.emulateMedia({ colorScheme: "light" });
  await seedTheme(page, "light");
  await openCanvas(page, f.canvas.id);
  const firstControl = await appearance(page);
  const other = await context.newPage();
  try {
    await other.emulateMedia({ colorScheme: "light" });
    const secondFixture = await installPhase5StateFixture(other, request);
    await openCanvas(other, secondFixture.canvas.id);
    const secondControl = await appearance(other);
    await firstControl.selectOption("dark");
    await expectTheme(other, "dark", "dark");
    await expect(secondControl).toHaveValue("dark");
    await secondControl.selectOption("light");
    await expectTheme(page, "light", "light");
    await expect(firstControl).toHaveValue("light");
    await other.evaluate(key => localStorage.removeItem(key), preferenceKey);
    await expectTheme(page, "light", "system");
    await expect(firstControl).toHaveValue("system");
    secondFixture.check();
  } finally { await other.close(); }
  f.check();
});

test("外观存储被阻止时仍能按系统首绘并在本次会话切换", async ({ page, request }) => {
  const f = await installPhase5StateFixture(page, request);
  await page.emulateMedia({ colorScheme: "dark" });
  await page.addInitScript(key => {
    const get = Storage.prototype.getItem, set = Storage.prototype.setItem;
    Storage.prototype.getItem = function (name) {
      if (name === key) throw new DOMException("Blocked", "SecurityError");
      return get.call(this, name);
    };
    Storage.prototype.setItem = function (name, value) {
      if (name === key) throw new DOMException("Blocked", "QuotaExceededError");
      return set.call(this, name, value);
    };
  }, preferenceKey);
  await openCanvas(page, f.canvas.id);
  await expectTheme(page, "dark", "system");
  const control = await appearance(page);
  await control.selectOption("light");
  await expectTheme(page, "light", "light");
  await expect(control).toHaveValue("light");
  await page.reload();
  await expectTheme(page, "dark", "system");
  f.check();
});

test("主题桥只向桌面发送合法外观枚举并跟随真实设置选择", async ({ page, request }) => {
  const f = await installPhase5StateFixture(page, request);
  await page.addInitScript(() => {
    const calls: string[] = [];
    (window as ThemeWindow).__themeNativeCalls = calls;
    const cleanup = () => () => {};
    window.superCanvasDesktop = {
      setThemeSource: async (source: string) => { calls.push(source); },
      onPrepareExit: cleanup, onDraining: cleanup, onOpenUpdate: cleanup, onUpdate: cleanup,
      getUpdate: async () => ({ phase: "idle", currentVersion: "isolated-theme-test" }),
    } as unknown as NonNullable<Window["superCanvasDesktop"]>;
  });
  await page.emulateMedia({ colorScheme: "light" });
  await openCanvas(page, f.canvas.id);
  await expect.poll(() => page.evaluate(() => (window as ThemeWindow).__themeNativeCalls ?? [])).toContain("system");
  const control = await appearance(page);
  for (const choice of ["dark", "light", "system"] as const) {
    await control.selectOption(choice);
    await expect.poll(() => page.evaluate(() => (window as ThemeWindow).__themeNativeCalls?.at(-1))).toBe(choice);
  }
  expect(await page.evaluate(() => (window as ThemeWindow).__themeNativeCalls?.every(source => ["system", "light", "dark"].includes(source)))).toBe(true);
  f.check();
});

test("切换主题不重挂节点或丢失图片参数，减少动态效果仍保留静态状态", async ({ page, request }) => {
  const f = await installPhase5StateFixture(page, request);
  await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
  await seedTheme(page, "light");
  await openCanvas(page, f.canvas.id);
  await page.locator('.react-flow__node[data-id="parameters"] .node-head').dblclick();
  const parameters = page.getByRole("dialog", { name: "完整图片参数 模型与参数", exact: true });
  await expect(parameters).toBeVisible();
  await expect(parameters.locator('[data-panel-loading="true"]')).toHaveCount(0);
  const values = async () => Promise.all(["图片宽度", "图片高度", "质量"].map(label => parameters.getByLabel(label, { exact: true }).inputValue()));
  expect(await values()).toEqual(["3840", "2160", "max"]);
  await page.evaluate(() => { (window as ThemeWindow).__themeCards = [...document.querySelectorAll(".react-flow__node .node-card")]; });
  const control = await appearance(page);
  await control.selectOption("dark");
  await expectTheme(page, "dark", "dark");
  await page.getByRole("button", { name: "关闭设置", exact: true }).click();
  await expect(parameters).toBeVisible();
  expect(await values()).toEqual(["3840", "2160", "max"]);
  const tiers = parameters.getByRole("group", { name: "自动与输出分辨率快捷档位", exact: true });
  await expect(tiers.getByRole("button")).toHaveText(["自动", "1K", "2K", "4K"]);
  await expect(parameters.getByLabel("输出分辨率预设", { exact: true }).locator('option[value="3840x2160"]')).toContainText("4K · 16:9 · 3840 × 2160");
  await expect(parameters.getByRole("group", { name: "生成模式", exact: true })).toBeAttached();
  await expect(parameters.getByLabel("当前参数价格", { exact: true })).toBeAttached();
  expect(await page.evaluate(() => {
    const current = [...document.querySelectorAll(".react-flow__node .node-card")];
    return (window as ThemeWindow).__themeCards?.every((card, index) => card.isConnected && card === current[index]);
  })).toBe(true);
  await expect(page.locator('.react-flow__node[data-id="source-running"] .node-status-label')).toBeVisible();
  const animations = await page.locator(".canvas-editor").evaluate(element => element.getAnimations({ subtree: true }).filter(animation => animation.playState === "running").map(animation => ({ name: animation instanceof CSSAnimation ? animation.animationName : "transition", duration: animation.effect?.getTiming().duration })));
  expect(animations.filter(animation => typeof animation.duration === "number" && animation.duration > 1), "减少动态效果时不能继续播放循环或面板动效").toEqual([]);
  f.check();
});
