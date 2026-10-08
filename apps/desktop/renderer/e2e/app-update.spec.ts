import { test, expect, type Page } from "@playwright/test";

async function bridge(page: Page, initial: Record<string, unknown>) {
  await page.addInitScript((initial) => {
    let state = { desktop: true, formatVersion: 1, enabled: true, managerAvailable: true,
      repository: "moshangqingchen/CanvasMind", intervalSeconds: 21600, currentVersion: "0.2.36",
      updatedAt: "2026-09-26T00:00:00Z", currentNotes: "## 本版改进\n- 优化画布参数面板", ...initial };
    const updates: ((next: typeof state) => void)[] = [];
    const opens: (() => void)[] = [];
    const commands: string[] = [];
    const publish = (patch: Record<string, unknown>) => { state = { ...state, ...patch }; updates.forEach(fn => fn(state)); };
    Object.assign(window, { updateFixture: publish, openUpdateFixture: () => opens.forEach(fn => fn()), updateBridgeReady: () => opens.length > 0, updateCommands: commands,
      superCanvasDesktop: {
        getUpdate: async () => state,
        update: async (action: string) => {
          commands.push(action);
          if (action === "defer") publish({ phase: "idle" });
          if (action === "check") publish({ phase: "idle", error: undefined, diagnostic: undefined, progress: undefined, download: undefined, latest: undefined, lastSuccessfulCheckAt: new Date().toISOString() });
          if (action === "download") publish({ phase: "downloading", progress: { downloadedBytes: 5, totalBytes: 10 } });
          if (action === "apply") publish({ phase: "waiting_for_idle" });
        },
        onUpdate: (fn: (next: typeof state) => void) => { updates.push(fn); return () => { updates.splice(updates.indexOf(fn), 1); }; },
        onOpenUpdate: (fn: () => void) => { opens.push(fn); return () => { opens.splice(opens.indexOf(fn), 1); }; },
        onPrepareExit: () => () => {}, onDraining: () => () => {}, completePrepareExit: () => {}, cancelExit: async () => {},
      },
    });
  }, initial);
}

async function publish(page: Page, patch: Record<string, unknown>) {
  await page.evaluate(patch => (window as unknown as { updateFixture(patch: Record<string, unknown>): void }).updateFixture(patch), patch);
}

async function openUpdate(page: Page) {
  await expect(page.getByText("我的画布", { exact: true }).first()).toBeVisible();
  await page.waitForFunction(() => (window as unknown as { updateBridgeReady(): boolean }).updateBridgeReady());
  await page.evaluate(() => (window as unknown as { openUpdateFixture(): void }).openUpdateFixture());
  return page.getByRole("dialog", { name: "超级画布更新" });
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
  await expect(dialog).toContainText("正在测量");
  await expect(dialog).toContainText("暂无法估计");
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
});

test("download speed and estimate survive closing the modal and a full-package fallback on a narrow screen", async ({ page }, info) => {
  await page.setViewportSize({ width: 390, height: 680 });
  await bridge(page, { phase: "available", latest: { version: "0.2.37", tag: "v0.2.37", notes: "## 下载改进\n- 显示速度和剩余时间" } });
  await page.goto("/");
  const dialog = page.getByRole("dialog", { name: "超级画布更新" });
  await dialog.getByRole("button", { name: "下载更新", exact: true }).click();
  await publish(page, {
    progress: { downloadedBytes: 10 * 1024 ** 2, totalBytes: 40 * 1024 ** 2, bytesPerSecond: 2.5 * 1024 ** 2, estimatedRemainingSeconds: 12 },
    download: { mode: "differential" },
  });
  await expect(dialog.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "25");
  await expect(dialog).toContainText("2.5 MB/s");
  await expect(dialog).toContainText("约 12 秒");
  await expect(dialog).toContainText("差分下载");
  await page.screenshot({ path: info.outputPath("update-download-speed-narrow.png"), animations: "disabled" });
  await dialog.getByRole("button", { name: "后台下载", exact: true }).click();
  await expect(dialog).toBeHidden();
  await publish(page, {
    progress: { downloadedBytes: 20 * 1024 ** 2, totalBytes: 200 * 1024 ** 2, bytesPerSecond: 512 * 1024, estimatedRemainingSeconds: 360 },
    download: { mode: "full", fallback: true, reason: "https://private.example/update?token=do-not-render" },
    diagnostic: { stage: "download", category: "network", code: "ECONNRESET", retryable: true },
  });
  await openUpdate(page);
  await expect(dialog.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "10");
  await expect(dialog).toContainText("512 KB/s");
  await expect(dialog).toContainText("约 6 分钟");
  await expect(dialog).toContainText("完整安装包");
  await expect(dialog).toContainText("差分下载未完成，已切换完整安装包。");
  await expect(dialog).not.toContainText("private.example");
  await expect(dialog).not.toContainText("do-not-render");
  await dialog.getByText("查看差分失败信息", { exact: true }).click();
  await expect(dialog).toContainText("网络连接");
  await expect(dialog).toContainText("ECONNRESET");
  const bounds = await dialog.boundingBox();
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390);
  expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(680);
  expect(await dialog.evaluate(element => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1);
  await page.screenshot({ path: info.outputPath("update-download-fallback-narrow.png"), animations: "disabled" });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await expect(dialog.getByText("ECONNRESET", { exact: true })).toBeVisible();
  expect(await dialog.evaluate(element => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1);
  await page.screenshot({ path: info.outputPath("update-download-fallback-desktop.png"), animations: "disabled" });
  await page.setViewportSize({ width: 390, height: 680 });
  await publish(page, { diagnostic: { stage: "download", category: "network", code: "NXKQRTZVJMBDWPAGHFYSCUELI", retryable: true } });
  await expect(dialog).not.toContainText("错误编号");
  await expect(dialog).not.toContainText("NXKQRTZVJMBDWPAGHFYSCUELI");
  await publish(page, { diagnostic: { stage: "download", category: "unknown" } });
  await expect(dialog.getByText("查看差分失败信息", { exact: true })).toHaveCount(0);
  await expect(dialog).not.toContainText("private.example");
  expect(await page.evaluate(() => (window as unknown as { updateCommands: string[] }).updateCommands)).toEqual(["download"]);
});

test("unknown or stalled transfers never claim an ETA and completed bytes still require verification", async ({ page }) => {
  await bridge(page, { phase: "available", latest: { version: "0.2.37", tag: "v0.2.37" } });
  await page.goto("/");
  const dialog = page.getByRole("dialog", { name: "超级画布更新" });
  await dialog.getByRole("button", { name: "下载更新", exact: true }).click();
  await publish(page, { progress: { downloadedBytes: 0, estimatedRemainingSeconds: 120 }, download: { mode: "preparing" } });
  await expect(dialog).toContainText("正在测量");
  await expect(dialog).toContainText("暂无法估计");
  await expect(dialog.getByRole("progressbar")).not.toHaveAttribute("aria-valuenow");
  await publish(page, { progress: { downloadedBytes: 10, totalBytes: 100, bytesPerSecond: 0, estimatedRemainingSeconds: 0 } });
  await expect(dialog).toContainText("等待传输");
  await expect(dialog).toContainText("暂无法估计");
  await expect(dialog).not.toContainText("约 0 秒");
  await expect(dialog).not.toContainText("Infinity");
  await publish(page, { progress: { downloadedBytes: 100, totalBytes: 100, bytesPerSecond: 50, estimatedRemainingSeconds: 0 }, download: { mode: "full" } });
  await expect(dialog).toContainText("正在完成下载");
  await expect(dialog).not.toContainText("安装包已校验");
  await expect(dialog.getByRole("button", { name: "重启并更新", exact: true })).toHaveCount(0);
  await publish(page, { phase: "ready", downloadedVersion: "0.2.37", download: { mode: "cached" } });
  await expect(dialog).toContainText("使用已校验缓存");
  await expect(dialog.getByRole("progressbar")).toHaveCount(0);
  await dialog.getByRole("button", { name: "重启并更新", exact: true }).click();
  await expect(dialog).toContainText("等待生成任务完成");
  expect(await page.evaluate(() => (window as unknown as { updateCommands: string[] }).updateCommands)).toEqual(["download", "apply"]);
});

test("failure diagnostics show bounded known fields without leaking raw errors, URLs or unknown codes", async ({ page }, info) => {
  await page.setViewportSize({ width: 390, height: 680 });
  await bridge(page, { phase: "failed", error: "Request failed https://secret:password@private.example/asset?token=do-not-render", diagnostic: { stage: "download", category: "http", code: "ERR_HTTP_RESPONSE_CODE_FAILURE", statusCode: 403, retryable: true } });
  await page.goto("/");
  const dialog = await openUpdate(page);
  await expect(dialog).toBeVisible();
  await dialog.getByText("查看失败信息", { exact: true }).click();
  await expect(dialog).toContainText("下载安装包");
  await expect(dialog).toContainText("HTTP 403");
  await expect(dialog).toContainText("ERR_HTTP_RESPONSE_CODE_FAILURE");
  await expect(dialog).not.toContainText("private.example");
  await expect(dialog).not.toContainText("password");
  await expect(dialog).not.toContainText("do-not-render");
  await publish(page, { diagnostic: { stage: "verify", category: "checksum", code: "ERR_CHECKSUM_MISMATCH", retryable: false } });
  await expect(dialog).toContainText("校验安装包");
  await expect(dialog).toContainText("更新包未通过文件校验");
  await expect(dialog).toContainText("ERR_CHECKSUM_MISMATCH");
  await publish(page, { diagnostic: { stage: "verify", category: "checksum", code: "https://private.example/?token=do-not-render", statusCode: -1, retryable: false } });
  await expect(dialog).not.toContainText("错误编号");
  await expect(dialog).not.toContainText("HTTP -1");
  await expect(dialog).not.toContainText("do-not-render");
  expect(await dialog.evaluate(element => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1);
  await page.screenshot({ path: info.outputPath("update-diagnostic-narrow.png"), animations: "disabled" });
  await dialog.getByRole("button", { name: "重新检查", exact: true }).click();
  await expect(dialog.getByText("查看失败信息", { exact: true })).toHaveCount(0);
  await expect(dialog).toContainText("已是最新版本");
});
test("failed and unconfirmed checks never claim latest; retry clears the error", async ({ page }, info) => {
  await bridge(page, { phase: "failed", error: "暂时无法连接 GitHub，请检查网络后重试。" });
  await page.goto("/");
  const dialog = await openUpdate(page);
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("尚未确认");
  await expect(dialog).not.toContainText("已是最新版本");
  await page.screenshot({ path: info.outputPath("update-failed.png") });
  await dialog.getByRole("button", { name: "重新检查" }).click();
  await expect(dialog).toContainText("已是最新版本");
  await expect(dialog).not.toContainText("暂时无法连接");
  await expect(dialog).toContainText("优化画布参数面板");
});
