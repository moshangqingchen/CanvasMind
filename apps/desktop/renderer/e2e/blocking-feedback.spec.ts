import { expect, test, type Locator, type Page } from "@playwright/test";

function colorChannels(color: string) {
  const values = color.match(/[\d.]+/gu)!.map(Number);
  // Chromium serializes color-mix() as normalized CSS Color 4 channels.
  if (color.startsWith("color(srgb ")) return [values[0]! * 255, values[1]! * 255, values[2]! * 255, values[3] ?? 1] as const;
  return [values[0]!, values[1]!, values[2]!, values[3] ?? 1] as const;
}

function contrast(foreground: string, background: string, underneath?: string): number {
  const backdrop = colorChannels(background);
  if (backdrop[3] < 1 && underneath === undefined)
    throw new Error("A translucent surface needs its actual underlying color for contrast");
  const composite = (paint: ReturnType<typeof colorChannels>, base: readonly number[]) =>
    paint.slice(0, 3).map((value, index) => value * paint[3] + base[index]! * (1 - paint[3]));
  // Error surfaces tint the real floating card. Resolve that background first,
  // then composite text over it, so theme changes do not reuse an old RGB base.
  const backgroundRgb = composite(backdrop, colorChannels(underneath ?? background));
  const foregroundRgb = composite(colorChannels(foreground), backgroundRgb);
  const luminance = (rgb: readonly number[]) => {
    const values = rgb.map(value => {
      const channel = value / 255;
      return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
    });
    return values[0]! * 0.2126 + values[1]! * 0.7152 + values[2]! * 0.0722;
  };
  const first = luminance(foregroundRgb), second = luminance(backgroundRgb);
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
  await expect(control).toHaveCSS("outline-color", await control.evaluate(element => {
    // Canvas controls inherit the restored canvas palette, which differs from
    // the workspace body's palette.
    const probe = document.createElement("span");
    probe.style.color = getComputedStyle(element).getPropertyValue("--focus-ring").trim();
    document.body.append(probe);
    const color = getComputedStyle(probe).color; probe.remove(); return color;
  }));
  await expect(control).toHaveCSS("outline-offset", offset);
}

test("退出等待与错误跟随主题并保持可读面板，长错误换行，返回软件仍有效", async ({ page }, info) => {
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
  await expect(card).toHaveCSS("opacity", "1");
  const title = dialog.getByRole("heading", { name: "正在保存并等待任务完成" });
  const colors = await title.evaluate(element => ({
    text: getComputedStyle(element).color,
    background: getComputedStyle(element.closest("[role=dialog]")!.firstElementChild!).backgroundColor,
  }));
  expect(colorChannels(colors.background)[3]).toBe(1);
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
  expect(contrast(errorColors.text, errorColors.background, colors.background)).toBeGreaterThanOrEqual(4.5);
  await page.screenshot({ path: info.outputPath("exit-feedback.png") });
  await cancel.click();
  await expect(dialog).toBeHidden();

  await page.evaluate(() => (window as unknown as { openFeedbackUpdate(): void }).openFeedbackUpdate());
  const updates = page.getByRole("dialog", { name: "超级画布更新" });
  await expect(updates).toBeVisible();
  // A previous exit failure remains in its own card; opening updates must not
  // revive that long message as a blocking toast before a new action fails.
  await expect(page.getByRole("alert").filter({ hasText: failure })).toHaveCount(0);
  await updates.getByRole("button", { name: "立即检查", exact: true }).click();
  const toast = page.getByRole("alert").filter({ hasText: "无法取消退出，请稍后再试。" });
  await expect(toast).toHaveText(failure);
  await expect(toast).toHaveCSS("opacity", "1");
  const toastColors = await toast.evaluate(element => ({ text: getComputedStyle(element).color,
    background: getComputedStyle(element).backgroundColor }));
  expect(colorChannels(toastColors.background)[3]).toBe(1);
  expect(await toast.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  expect(contrast(toastColors.text, toastColors.background)).toBeGreaterThanOrEqual(4.5);
  expect((await toast.boundingBox())!.height).toBeLessThanOrEqual(160);
  const fullMessage = toast.getByLabel("完整错误信息");
  await expect(fullMessage).toHaveText(failure);
  expect(await fullMessage.evaluate(element => element.scrollHeight > element.clientHeight)).toBe(true);
  await fullMessage.evaluate(element => { element.scrollTop = element.scrollHeight; });
  expect(await fullMessage.evaluate(element => element.scrollTop)).toBeGreaterThan(0);
  await toast.getByRole("button", { name: "关闭错误提示", exact: true }).click();
  await expect(toast).toHaveCount(0);

  // The same error can be shown again, and expires without a close click.
  await updates.getByRole("button", { name: "立即检查", exact: true }).click();
  await expect(toast).toBeVisible();
  await expect(toast).toHaveCount(0, { timeout: 6000 });
  await updates.getByRole("button", { name: "立即检查", exact: true }).click({ trial: true });
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
  await keyboardFocus(page, page.getByRole("region", { name: "通用创作智能体", exact: true }).getByRole("button", { name: "对话模型", exact: true }));
  const canvasBackground = await page.locator(".canvas-editor").evaluate(element => getComputedStyle(element).backgroundColor);
  const focusColor = await page.locator(".canvas-editor").evaluate(element => {
    const probe = document.createElement("span"); probe.style.color = "var(--focus-ring)"; element.append(probe);
    const resolved = getComputedStyle(probe).color; probe.remove(); return resolved;
  });
  expect(contrast(focusColor, canvasBackground)).toBeGreaterThanOrEqual(3);
  await page.screenshot({ path: info.outputPath("canvas-keyboard-focus.png") });
});
