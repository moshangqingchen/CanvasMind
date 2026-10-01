import { expect, test, type Locator, type Page } from "@playwright/test";

function contrast(foreground: string, background: string): number {
  const luminance = (color: string) => {
    const values = color.match(/[\d.]+/gu)!.slice(0, 3).map(Number).map(value => {
      const channel = value / 255;
      return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
    });
    return values[0]! * 0.2126 + values[1]! * 0.7152 + values[2]! * 0.0722;
  };
  const first = luminance(foreground), second = luminance(background);
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
}

async function keyboardFocus(page: Page, control: Locator, offset = "2px") {
  await expect(control).toBeVisible();
  await page.keyboard.press("Tab");
  await control.focus();
  await expect(control).toBeFocused();
  expect(await control.evaluate(element => element.matches(":focus-visible"))).toBe(true);
  await expect(control).toHaveCSS("outline-style", "solid");
  await expect(control).toHaveCSS("outline-width", "2px");
  await expect(control).toHaveCSS("outline-color", "rgb(185, 167, 255)");
  await expect(control).toHaveCSS("outline-offset", offset);
}

test("退出等待与错误使用可读深色面板，长错误换行，返回软件仍有效", async ({ page }, info) => {
  const failure = `无法取消退出，请稍后再试。\n${"本机连接暂时不可用，请求诊断文本".repeat(50)}`;
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.addInitScript((failure) => {
    let cancelAttempts = 0;
    let draining: (value: boolean) => void = () => {};
    let openUpdate: () => void = () => {};
    Object.assign(window, {
      openFeedbackUpdate: () => openUpdate(),
      superCanvasDesktop: {
        getUpdate: async () => ({ desktop: true, formatVersion: 1, enabled: true, managerAvailable: true,
          repository: "moshangqingchen/CanvasMind", intervalSeconds: 21600, currentVersion: "0.2.44", phase: "idle" }),
        update: async () => { throw new Error(failure); },
        onPrepareExit: () => () => {}, completePrepareExit: () => {},
        onUpdate: () => () => {},
        onOpenUpdate: (callback: () => void) => { openUpdate = callback; return () => {}; },
        onDraining: (callback: (value: boolean) => void) => { draining = callback; callback(true); return () => {}; },
        cancelExit: async () => {
          if (++cancelAttempts === 1) throw new Error(failure);
          draining(false);
        },
      },
    });
  }, failure);
  await page.goto("/");
  const dialog = page.getByRole("dialog", { name: "正在准备退出" });
  const card = dialog.locator(":scope > div");
  await expect(dialog).toBeVisible();
  await expect(card).toHaveCSS("background-color", "rgb(30, 32, 38)");
  const title = dialog.getByRole("heading", { name: "正在保存并等待任务完成" });
  const colors = await title.evaluate(element => ({
    text: getComputedStyle(element).color,
    background: getComputedStyle(element.closest("[role=dialog]")!.firstElementChild!).backgroundColor,
  }));
  expect(contrast(colors.text, colors.background)).toBeGreaterThanOrEqual(4.5);
  await expect(dialog.locator('[aria-hidden="true"]').first()).toHaveCSS("animation-name", "none");
  const cancel = dialog.getByRole("button", { name: "返回软件" });
  await keyboardFocus(page, cancel);
  await cancel.click();
  const error = dialog.getByRole("alert");
  await expect(error).toHaveText(failure);
  await expect(error).toHaveCSS("white-space", "pre-wrap");
  await expect(error).toHaveCSS("overflow-wrap", "anywhere");
  expect(await error.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  const errorColors = await error.evaluate(element => ({ text: getComputedStyle(element).color, background: getComputedStyle(element).backgroundColor }));
  expect(contrast(errorColors.text, errorColors.background)).toBeGreaterThanOrEqual(4.5);
  await page.screenshot({ path: info.outputPath("exit-feedback.png") });
  await cancel.click();
  await expect(dialog).toBeHidden();

  await page.evaluate(() => (window as unknown as { openFeedbackUpdate(): void }).openFeedbackUpdate());
  const updates = page.getByRole("dialog", { name: "超级画布更新" });
  await expect(updates).toBeVisible();
  await updates.getByRole("button", { name: "立即检查", exact: true }).click();
  const toast = page.getByRole("alert").filter({ hasText: "无法取消退出，请稍后再试。" });
  await expect(toast).toHaveText(failure);
  await expect(toast).toHaveCSS("background-color", "rgb(32, 34, 40)");
  await expect(toast).toHaveCSS("color", "rgb(255, 192, 201)");
  expect(await toast.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  expect(contrast("rgb(255, 192, 201)", "rgb(32, 34, 40)")).toBeGreaterThanOrEqual(4.5);
});

test("生产画布焦点不被旧样式覆盖，缩放控件内侧焦点可见", async ({ page, request }, info) => {
  const response = await request.post("/api/canvas", {
    data: { title: "焦点隔离回归", graph: {
      schemaVersion: 1, edges: [], viewport: { x: 30, y: 40, zoom: 1 },
      nodes: [{ id: "focus-prompt", type: "workflow", position: { x: 100, y: 160 },
        data: { nodeType: "prompt", label: "焦点提示词", parts: [{ type: "text", text: "只检查键盘焦点，不提交生成" }],
          outputs: [{ id: "prompt", kind: "text", label: "提示词" }] } }],
    } },
  });
  expect(response.ok()).toBe(true);
  const canvas = await response.json();
  await page.goto(`/canvas/${canvas.id}`);
  await expect(page.locator('.react-flow__node[data-id="focus-prompt"]')).toBeVisible();
  await keyboardFocus(page, page.getByRole("button", { name: "返回主界面", exact: true }));
  await keyboardFocus(page, page.locator(".react-flow__controls-button").first(), "-3px");
  await page.getByRole("button", { name: "打开智能体", exact: true }).click();
  await keyboardFocus(page, page.locator("#inspector-agent-panel .agent-composer textarea").first());
  await keyboardFocus(page, page.getByRole("combobox", { name: "智能体 API 供应商", exact: true }).last());
  const canvasBackground = await page.locator(".canvas-editor").evaluate(element => getComputedStyle(element).backgroundColor);
  expect(contrast("rgb(185, 167, 255)", canvasBackground)).toBeGreaterThanOrEqual(3);
  await page.screenshot({ path: info.outputPath("canvas-keyboard-focus.png") });
});
