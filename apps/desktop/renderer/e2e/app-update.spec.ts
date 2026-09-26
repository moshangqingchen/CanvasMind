import { test, expect, type Page } from "@playwright/test";

async function bridge(page: Page, initial: Record<string, unknown>) {
  await page.addInitScript((initial) => {
    let state = { desktop: true, formatVersion: 1, enabled: true, managerAvailable: true,
      repository: "moshangqingchen/CanvasMind", intervalSeconds: 21600, currentVersion: "0.2.36",
      updatedAt: "2026-09-26T00:00:00Z", currentNotes: "## 本版改进\n- 优化画布参数面板", ...initial };
    const updates: ((next: typeof state) => void)[] = [];
    const opens: (() => void)[] = [];
    const publish = (patch: Record<string, unknown>) => { state = { ...state, ...patch }; updates.forEach(fn => fn(state)); };
    Object.assign(window, { updateFixture: publish, openUpdateFixture: () => opens.forEach(fn => fn()),
      superCanvasDesktop: {
        getUpdate: async () => state,
        update: async (action: string) => {
          if (action === "defer") publish({ phase: "idle" });
          if (action === "check") publish({ phase: "idle", error: undefined, latest: undefined, lastSuccessfulCheckAt: new Date().toISOString() });
          if (action === "download") publish({ phase: "downloading", progress: { downloadedBytes: 5, totalBytes: 10 } });
        },
        onUpdate: (fn: (next: typeof state) => void) => { updates.push(fn); return () => { updates.splice(updates.indexOf(fn), 1); }; },
        onOpenUpdate: (fn: () => void) => { opens.push(fn); return () => { opens.splice(opens.indexOf(fn), 1); }; },
        onPrepareExit: () => () => {}, onDraining: () => () => {}, completePrepareExit: () => {}, cancelExit: async () => {},
      },
    });
  }, initial);
}
test("home announces a release already found before mount; notes are readable and download continues", async ({ page }, info) => {
  await bridge(page, { phase: "available", latest: { version: "0.2.37", tag: "v0.2.37",
    notes: "<h2>软件更新</h2><ul><li>修复自动更新配置缺失</li><li>整理模型与参数面板</li></ul>", publishedAt: "2026-09-26T00:00:00Z" } });
  await page.goto("/");
  const dialog = page.getByRole("dialog", { name: "超级画布更新" });
  await expect(dialog).toHaveCount(1);
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("发现新版本");
  await expect(dialog.getByRole("heading", { name: "软件更新", exact: true })).toBeVisible();
  await expect(dialog).not.toContainText("<li>");
  await page.screenshot({ path: info.outputPath("update-available.png") });
  await page.setViewportSize({ width: 390, height: 680 });
  const box = await dialog.boundingBox();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(390);
  expect(box!.y + box!.height).toBeLessThanOrEqual(680);
  await page.screenshot({ path: info.outputPath("update-narrow.png") });
  await dialog.getByRole("button", { name: "下载更新", exact: true }).click();
  await expect(dialog).toContainText("50%");
  await expect(dialog.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "50");
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
});
test("failed and unconfirmed checks never claim latest; retry clears the error", async ({ page }, info) => {
  await bridge(page, { phase: "failed", error: "暂时无法连接 GitHub，请检查网络后重试。" });
  await page.goto("/");
  await page.waitForFunction(() => Boolean((window as unknown as { openUpdateFixture: unknown }).openUpdateFixture));
  // Ensure the bridge has mounted before dispatching its tray event.
  await expect(page.getByText("我的画布", { exact: true }).first()).toBeVisible();
  await page.evaluate(() => (window as unknown as { openUpdateFixture(): void }).openUpdateFixture());
  const dialog = page.getByRole("dialog", { name: "超级画布更新" });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("尚未确认");
  await expect(dialog).not.toContainText("已是最新版本");
  await page.screenshot({ path: info.outputPath("update-failed.png") });
  await dialog.getByRole("button", { name: "重新检查" }).click();
  await expect(dialog).toContainText("已是最新版本");
  await expect(dialog).not.toContainText("暂时无法连接");
  await expect(dialog).toContainText("优化画布参数面板");
});
