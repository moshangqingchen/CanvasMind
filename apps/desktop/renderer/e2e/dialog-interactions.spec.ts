import { readFile } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";

const project = {
  id: "dialog-interactions-fixture", title: "交互回归画布", nodeCount: 0,
  createdAt: "2026-10-03T00:00:00.000Z", updatedAt: "2026-10-03T00:00:00.000Z",
};
const asset = {
  id: "dialog-review-image", name: "评审回归图片.png", kind: "image", mimeType: "image/png",
  size: 1024, storageKey: "fixture.png", metadata: { runId: "dialog-review-run" },
  createdAt: project.createdAt,
};

async function openMockCanvas(page: Page, runs: object[] = []) {
  const imageBytes = await readFile(new URL("../../assets/icon.png", import.meta.url));
  // Every API request is mocked, including mutations; these cases never edit user data.
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path === "/api/projects") return route.fulfill({ json: { projects: [project] } });
    if (path.startsWith("/api/canvas/")) return route.fulfill({ json: {
      id: project.id, title: project.title, revision: 1,
      graph: { schemaVersion: 1, nodes: [], edges: [], drawings: [], viewport: { x: 0, y: 0, zoom: 1 } },
    } });
    if (path === "/api/assets") return route.fulfill({ json: [asset] });
    if (path === `/api/assets/${asset.id}/preview` || path === `/api/assets/${asset.id}/content`)
      return route.fulfill({ body: imageBytes, contentType: "image/png" });
    if (path === `/api/assets/${asset.id}`) return route.fulfill({ json: {
      ...asset, actualDimensions: { width: 1024, height: 1024 },
    } });
    if (path === `/api/projects/${project.id}/results`) return route.fulfill({ json: [{
      assetId: asset.id, canvasId: project.id, runId: "dialog-review-run", nodeId: "source",
      label: "图片回归", instruction: "", requirements: "",
    }] });
    if (path === "/api/runs") return route.fulfill({ json: runs });
    if (["/api/providers", "/api/suppliers", "/api/agent/models", "/api/agent/sessions"].includes(path))
      return route.fulfill({ json: [] });
    return route.fulfill({ json: { messages: [], sessions: [], groups: [], items: [], runs: [], drops: [] } });
  });
  await page.goto(`/canvas/${project.id}`);
  await expect(page.getByRole("button", { name: "打开项目菜单", exact: true })).toBeVisible();
}

async function openTaskCenter(page: Page) {
  await page.getByRole("button", { name: "打开项目菜单", exact: true }).click();
  await page.getByRole("menuitem", { name: "运行历史", exact: true }).click();
  return page.getByRole("dialog", { name: "运行历史", exact: true });
}

const cancelledTask = {
  run: { id: "recoverable-run", canvasId: project.id, scope: "node", status: "cancelled",
    createdAt: project.createdAt, updatedAt: project.updatedAt, canRecoverOutputs: true, canResume: false },
  nodes: [{ id: "recoverable-node", nodeId: "source", status: "cancelled", outputAssetIds: [], errorJson: null }],
};

test("快捷键弹窗约束 Tab，Escape 关闭后返回入口", async ({ page }) => {
  await page.setViewportSize({ width: 1680, height: 960 });
  await openMockCanvas(page);
  const trigger = page.getByRole("button", { name: "抓手模式", exact: true });
  await trigger.focus();
  await page.keyboard.press("Shift+/");
  const dialog = page.getByRole("dialog", { name: "键盘快捷键", exact: true });
  const close = dialog.getByRole("button", { name: "关闭", exact: true });
  await expect(close).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(close).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(close).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();
});

test("任务取回失败仍可立即重试，轮询保留操作错误", async ({ page }) => {
  await openMockCanvas(page, [cancelledTask]);
  let reads = 0;
  let recoveries = 0;
  await page.route(/\/api\/runs(?:\?|\/|$)/, async (route) => {
    if (route.request().method() === "POST") {
      recoveries++;
      return route.fulfill({ status: 503, json: { error: "取回暂时失败，请重试" } });
    }
    reads++;
    return route.fulfill({ json: [cancelledTask] });
  });
  const history = await openTaskCenter(page);
  const recover = history.getByRole("button", { name: "取回已有图片", exact: true });
  await recover.click();
  await expect(history.getByRole("alert")).toContainText("取回暂时失败，请重试");
  await expect(recover).toBeVisible();
  await expect(recover).toBeEnabled();
  const readCount = reads;
  await expect.poll(() => reads, { timeout: 10_000 }).toBeGreaterThan(readCount);
  await expect(history.getByRole("alert")).toContainText("取回暂时失败，请重试");
  await recover.click();
  await expect.poll(() => recoveries).toBe(2);
  await expect(recover).toBeEnabled();
});

test("刷新失败保留任务及输出按钮，错误详情可以通过 Tab 打开", async ({ page }) => {
  const failed = {
    run: { ...cancelledTask.run, status: "failed", canRecoverOutputs: false },
    nodes: [{ ...cancelledTask.nodes[0], status: "failed", errorJson: { message: "供应商任务失败" } }],
  };
  await openMockCanvas(page, [failed]);
  const history = await openTaskCenter(page);
  const diagnostic = history.getByRole("button", { name: "导出诊断信息", exact: true });
  await expect(diagnostic).toBeVisible();
  await diagnostic.focus();
  await page.keyboard.press("Tab");
  const errors = history.locator("summary.history-error");
  await expect(errors).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(history.locator(".history-error-detail")).toBeVisible();
  await page.route(/\/api\/runs(?:\?|$)/, route => route.fulfill({ status: 503, json: { error: "历史刷新失败" } }));
  await history.getByRole("button", { name: "刷新", exact: true }).click();
  await expect(history.getByRole("alert")).toContainText("无法读取运行历史");
  await expect(diagnostic).toBeVisible();
});

test("评审确认约束焦点和遮罩点击，Escape 只关闭确认层", async ({ page }) => {
  await openMockCanvas(page);
  await page.getByRole("button", { name: "历史生成", exact: true }).click();
  const library = page.getByRole("dialog", { name: "历史生成", exact: true });
  await library.getByRole("button", { name: `查看详情 ${asset.name}`, exact: true }).click();
  const note = library.getByRole("textbox", { name: "评审备注", exact: true });
  await note.fill("保留这份未保存的评审");
  const close = library.getByRole("button", { name: "关闭历史生成", exact: true });
  await close.click();
  const confirm = page.getByRole("alertdialog", { name: "保存评审草稿", exact: true });
  const first = confirm.getByRole("button", { name: "保存并继续", exact: true });
  const last = confirm.getByRole("button", { name: "放弃草稿并继续", exact: true });
  await expect(first).toBeFocused();
  await first.press("Shift+Tab");
  await expect(last).toBeFocused();
  await last.press("Tab");
  await expect(first).toBeFocused();
  const closeBox = await close.boundingBox();
  expect(closeBox).not.toBeNull();
  await page.mouse.click(closeBox!.x + closeBox!.width / 2, closeBox!.y + closeBox!.height / 2);
  await expect(confirm).toHaveCount(0);
  await expect(library).toBeVisible();
  await expect(note).toHaveValue("保留这份未保存的评审");
  await close.click();
  await expect(confirm).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(confirm).toHaveCount(0);
  await expect(library).toBeVisible();
  await expect(close).toBeFocused();
});

test("保存评审并继续期间不会被 Escape 或继续编辑提前撤回", async ({ page }) => {
  await openMockCanvas(page);
  const trigger = page.getByRole("button", { name: "历史生成", exact: true });
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route(`**/api/assets/${asset.id}/design-review`, async route => {
    const review = route.request().postDataJSON() as { status: string; note: string };
    await gate;
    return route.fulfill({ json: {
      ...asset, metadata: { ...asset.metadata, imageDesignReview: {
        status: review.status, note: review.note, revision: 1, updatedAt: project.updatedAt,
      } },
    } });
  });
  try {
    await trigger.click();
    const library = page.getByRole("dialog", { name: "历史生成", exact: true });
    await library.getByRole("button", { name: `查看详情 ${asset.name}`, exact: true }).click();
    await library.getByRole("textbox", { name: "评审备注", exact: true }).fill("正在保存的评审");
    await library.getByRole("button", { name: "关闭历史生成", exact: true }).click();
    const confirm = page.getByRole("alertdialog", { name: "保存评审草稿", exact: true });
    await confirm.getByRole("button", { name: "保存并继续", exact: true }).click();
    await expect(confirm.getByRole("button", { name: "继续编辑", exact: true })).toBeDisabled();
    await page.keyboard.press("Escape");
    await expect(confirm).toBeVisible();
    await expect(library).toBeVisible();
    release();
    await expect(library).toHaveCount(0);
    await expect(trigger).toBeFocused();
  } finally {
    release();
  }
});

test("放弃评审草稿关闭父子弹窗后焦点返回历史入口", async ({ page }) => {
  await openMockCanvas(page);
  const trigger = page.getByRole("button", { name: "历史生成", exact: true });
  await trigger.click();
  const library = page.getByRole("dialog", { name: "历史生成", exact: true });
  await library.getByRole("button", { name: `查看详情 ${asset.name}`, exact: true }).click();
  await library.getByRole("textbox", { name: "评审备注", exact: true }).fill("将要放弃的评审");
  await library.getByRole("button", { name: "关闭历史生成", exact: true }).click();
  const confirm = page.getByRole("alertdialog", { name: "保存评审草稿", exact: true });
  await confirm.getByRole("button", { name: "放弃草稿并继续", exact: true }).click();
  await expect(confirm).toHaveCount(0);
  await expect(library).toHaveCount(0);
  await expect(trigger).toBeFocused();
});

test("小窗口的图片库和设置关闭按钮可点击", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 740 });
  await openMockCanvas(page);
  await page.getByRole("button", { name: "历史生成", exact: true }).click();
  const library = page.getByRole("dialog", { name: "历史生成", exact: true });
  await library.getByRole("button", { name: "关闭历史生成", exact: true }).click();
  await expect(library).toHaveCount(0);
  await page.getByRole("button", { name: "API 设置", exact: true }).click();
  const settings = page.getByRole("dialog", { name: "供应商与模型设置", exact: true });
  await settings.getByRole("button", { name: "关闭设置", exact: true }).click();
  await expect(settings).toHaveCount(0);
});
