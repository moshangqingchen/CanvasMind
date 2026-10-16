import { readFile } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";

const project = { id: "phase3-library-tasks", title: "界面回归", nodeCount: 0, createdAt: "2026-10-14T00:00:00Z", updatedAt: "2026-10-14T00:00:00Z" };
const assets = Array.from({ length: 1002 }, (_, index) => ({
  id: `media-${String(index).padStart(4, "0")}`, name: `素材 ${String(index).padStart(4, "0")}`,
  kind: index === 1000 ? "video" : index === 1001 ? "audio" : "image",
  mimeType: index === 1000 ? "video/mp4" : index === 1001 ? "audio/wav" : "image/png",
  storageKey: "isolated-test", size: 1024, createdAt: project.createdAt,
  metadata: index < 1000 ? { runId: "isolated-run", width: 512, height: 512 } : { fake: true },
}));
const runs = Array.from({ length: 600 }, (_, index) => {
  const status = ["running", "failed", "succeeded"][index % 3]!;
  return {
    run: { id: `task-${String(index).padStart(4, "0")}`, canvasId: project.id, scope: "node", status, createdAt: project.createdAt, updatedAt: project.updatedAt },
    nodes: [{ id: `task-node-${index}`, nodeId: `node-${index}`, status, outputAssetIds: [], request: { provider: "fake", model: `fake-model-${index}` }, errorJson: status === "failed" ? { message: `隔离任务 ${index} 的错误详情，请重试` } : null }],
  };
});

async function openFixture(page: Page) {
  const png = await readFile(new URL("../../assets/icon.png", import.meta.url));
  const canvas = { id: project.id, title: project.title, revision: 1, graph: { schemaVersion: 1, nodes: [] as unknown[], edges: [] as unknown[], viewport: { x: 0, y: 0, zoom: 1 } } };
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (["error", "warning"].includes(message.type())) errors.push(message.text()); });
  await page.route("**/api/**", route => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/projects") return route.fulfill({ json: { projects: [project] } });
    if (path.startsWith("/api/canvas/")) {
      if (route.request().method() === "PUT") { canvas.graph = route.request().postDataJSON().graph; canvas.revision++; }
      return route.fulfill({ json: canvas });
    }
    if (path === "/api/assets") return route.fulfill({ json: assets });
    if (/\/api\/assets\/[^/]+\/(preview|content)$/.test(path)) return route.fulfill({ contentType: "image/png", body: png });
    if (/\/api\/assets\/[^/]+$/.test(path)) return route.fulfill({ json: { ...assets.find(asset => path.endsWith(asset.id)), actualDimensions: { width: 512, height: 512 } } });
    if (path.endsWith("/results")) return route.fulfill({ json: assets.slice(0, 1000).map(asset => ({ assetId: asset.id, canvasId: project.id, runId: "isolated-run", nodeId: "source", label: asset.name })) });
    if (path === "/api/runs") return route.fulfill({ json: runs });
    if (["/api/providers", "/api/suppliers", "/api/agent/models", "/api/agent/sessions", "/api/integrations/material-drops"].includes(path)) return route.fulfill({ json: [] });
    return route.fulfill({ json: { items: [], sessions: [], groups: [], messages: [], runs: [], drops: [] } });
  });
  await page.goto(`/canvas/${project.id}`);
  await expect(page.getByRole("button", { name: "历史生成", exact: true })).toBeVisible();
  return errors;
}

test("千项素材按窗口渲染，Shift跨窗口选区、Ctrl减选和媒体筛选保持完整", async ({ page }) => {
  const errors = await openFixture(page);
  await page.getByRole("button", { name: "历史生成", exact: true }).click();
  const library = page.getByRole("dialog", { name: "历史生成", exact: true });
  await expect(library.getByRole("checkbox", { name: "选择 素材 0000", exact: true })).toBeVisible();
  expect(await library.locator(".library-card").count()).toBeLessThan(60);
  await library.getByRole("checkbox", { name: "选择 素材 0000", exact: true }).click();
  await library.locator(".library-scroll").evaluate(element => { element.scrollTop = 2400; });
  await expect(library.getByRole("checkbox", { name: "取消选择 素材 0000", exact: true })).toHaveCount(0);
  const lastLabel = (await library.locator(".library-card").last().getByRole("checkbox").getAttribute("aria-label"))!;
  const lastId = Number(lastLabel.match(/\d+$/)![0]);
  const last = library.getByRole("checkbox", { name: lastLabel, exact: true });
  await last.click({ modifiers: ["Shift"] });
  await expect(library.locator(".library-bulk strong")).toHaveText(`已选 ${lastId + 1} 张`);
  await library.getByRole("checkbox", { name: lastLabel.replace("选择 ", "取消选择 "), exact: true }).click({ modifiers: ["Control"] });
  await expect(library.locator(".library-bulk strong")).toHaveText(`已选 ${lastId} 张`);
  await library.getByRole("button", { name: "取消选择", exact: true }).click();
  await library.getByLabel("作品范围").selectOption("assets");
  await library.getByRole("group", { name: "素材类型" }).getByRole("button", { name: "视频", exact: true }).click();
  await expect(library.locator(".library-card")).toHaveCount(1);
  await expect(library.locator(".library-card")).toContainText("素材 1000");
  await page.keyboard.press("Control+f");
  await expect(library.getByRole("textbox", { name: "搜索图片名称或评审备注" })).toBeFocused();
  expect(errors).toEqual([]);
});

test("四图比稿在窄窗重新排成两列，数字选图不抢评审输入，预览按过滤顺序左右切换", async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  const errors = await openFixture(page);
  await page.getByRole("button", { name: "历史生成", exact: true }).click();
  const library = page.getByRole("dialog", { name: "历史生成", exact: true });
  for (let index = 0; index < 4; index++) await library.getByRole("checkbox", { name: `选择 素材 000${index}`, exact: true }).click();
  await library.getByRole("button", { name: "并排比稿", exact: true }).click();
  await page.keyboard.press("4");
  const selected = library.locator('[data-asset-id="media-0003"]');
  await expect(selected).toHaveAttribute("data-selected", "true");
  const positions = await library.locator("[data-asset-id]").evaluateAll(cards => cards.map(card => { const rect = card.getBoundingClientRect(); return { left: rect.left, top: rect.top, right: rect.right }; }));
  expect(Math.abs(positions[0]!.left - positions[2]!.left)).toBeLessThan(1);
  expect(positions[2]!.top).toBeGreaterThan(positions[0]!.top);
  expect(Math.max(...positions.map(position => position.right))).toBeLessThanOrEqual(1024);
  const note = selected.getByRole("textbox");
  await note.focus();
  await note.pressSequentially("1234");
  await expect(selected).toHaveAttribute("data-selected", "true");
  await note.fill("");
  await library.getByRole("button", { name: "返回图片列表", exact: true }).click();
  await library.getByRole("button", { name: "取消选择", exact: true }).click();
  await library.getByRole("button", { name: "查看详情 素材 0000", exact: true }).press("Space");
  const preview = page.getByRole("dialog", { name: "素材预览", exact: true });
  await expect(preview.getByRole("heading")).toHaveText("素材 0000");
  await page.keyboard.press("ArrowRight");
  await expect(preview.getByRole("heading")).toHaveText("素材 0001");
  await page.keyboard.press("ArrowLeft");
  await expect(preview.getByRole("heading")).toHaveText("素材 0000");
  await preview.locator(".image-zoom-stage").hover();
  await page.mouse.wheel(0, -100);
  await expect(preview.locator(".asset-zoom-level").last()).toHaveText("115%");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  await expect(preview.getByRole("heading")).toHaveText("素材 0003");
  expect(await preview.evaluate(element => element.contains(document.activeElement))).toBe(true);
  await expect(preview.locator(".asset-zoom-level").last()).toHaveText("100%");
  await page.keyboard.press("Escape");
  await expect(library).toBeVisible();
  expect(errors).toEqual([]);
});

test("素材卡悬停展示真实类型尺寸，键盘快捷放入复用原素材", async ({ page }) => {
  const errors = await openFixture(page);
  await page.getByRole("button", { name: "历史生成", exact: true }).click();
  const library = page.getByRole("dialog", { name: "历史生成", exact: true });
  const preview = library.getByRole("button", { name: "查看详情 素材 0000", exact: true });
  await preview.hover();
  // `has` is evaluated inside each card; its inner locator must not repeat
  // the outer dialog scope, which is an ancestor rather than a descendant.
  const card = library.locator(".library-card").filter({ has: page.getByRole("button", { name: "查看详情 素材 0000", exact: true }) });
  await expect(card.locator(".library-preview-info")).toContainText("图片");
  await expect(card.locator(".library-preview-info")).toContainText("512 × 512");
  await expect(card.locator(".library-preview-info")).toHaveCSS("opacity", "1");
  const add = card.getByRole("button", { name: "放入画布 素材 0000", exact: true });
  await expect(add).toHaveAttribute("title", "放入画布：素材 0000");
  await preview.focus();
  await page.keyboard.press("Tab");
  await expect(add).toBeFocused();
  await expect(add).toHaveCSS("outline-style", "solid");
  await add.press("Enter");
  await expect(library).toBeHidden();
  await expect(page.locator(".react-flow__node")).toHaveCount(1);
  await expect(page.locator(".react-flow__node")).toContainText("固定输出 · 素材 0000");
  expect(errors).toEqual([]);
});

test("素材多选操作条的入场动画全程居中，减少动态效果时静止", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.addInitScript(() => localStorage.setItem("super-canvas:gentle-motion", "on"));
  const errors = await openFixture(page);
  await page.getByRole("button", { name: "历史生成", exact: true }).click();
  const library = page.getByRole("dialog", { name: "历史生成", exact: true });
  await library.getByRole("checkbox", { name: "选择 素材 0000", exact: true }).click();
  const bar = library.locator(".library-bulk");
  const centerErrors = await bar.evaluate(element => {
    // Restart the actual CSS animation so slow test machines cannot miss its
    // first 180ms. Inspect its real keyframes rather than synthesizing motion.
    const target = element as HTMLElement;
    target.style.animation = "none";
    target.getBoundingClientRect();
    target.style.animation = "";
    const animation = target.getAnimations()[0];
    if (!animation) return null;
    animation.pause();
    return [0, 90, 179].map(time => {
      animation.currentTime = time;
      const bounds = target.getBoundingClientRect();
      const parent = target.closest(".library-browser")!.getBoundingClientRect();
      return Math.abs(bounds.x + bounds.width / 2 - parent.x - parent.width / 2);
    });
  });
  expect(centerErrors).not.toBeNull();
  expect(Math.max(...centerErrors!)).toBeLessThan(1);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect.poll(() => bar.evaluate(element => element.getAnimations().length)).toBe(0);
  expect(errors).toEqual([]);
});

test("六百任务有计数标签与窗口化，筛选搜索覆盖未挂载记录且详情按需保留", async ({ page }) => {
  const errors = await openFixture(page);
  await page.getByRole("button", { name: "打开项目菜单", exact: true }).click();
  await page.getByRole("menuitem", { name: "运行历史", exact: true }).click();
  const history = page.getByRole("dialog", { name: "运行历史", exact: true });
  await expect(history.getByRole("tab", { name: "进行中 200" })).toBeVisible();
  await expect(history.locator('[data-run-id="task-0000"]').getByRole("img", { name: "0 / 1 个节点已完成" })).toBeVisible();
  const completed = history.locator('[data-run-id="task-0002"]');
  await expect(completed.getByRole("img", { name: "1 / 1 个节点已完成" })).toBeVisible();
  await expect(completed.locator(".task-progress-value")).toHaveAttribute("stroke-dasharray", "100 100");
  expect(await history.locator(".history-row").count()).toBeLessThan(15);
  await expect(history.locator(".history-error-detail")).toHaveCount(0);
  await history.getByRole("tab", { name: "需要处理 200" }).click();
  await history.locator("summary.history-error").first().click();
  await expect(history.locator(".history-error-detail").first()).toBeVisible();
  const firstId = await history.locator(".history-row").first().getAttribute("data-run-id");
  await history.locator(".history-list").focus();
  await history.locator(".history-list").evaluate(element => { element.scrollTop = 6000; });
  await expect(history.locator(`.history-row[data-run-id="${firstId}"]`)).toHaveCount(0);
  await history.locator(".history-list").evaluate(element => { element.scrollTop = 0; });
  await expect(history.locator(".history-error-detail").first()).toBeVisible();
  await page.keyboard.press("Control+f");
  await expect(history.getByRole("textbox", { name: "搜索任务" })).toBeFocused();
  await history.getByRole("tab", { name: "全部 600" }).click();
  await history.getByRole("textbox", { name: "搜索任务" }).fill("fake-model-599");
  await expect(history.locator(".history-row")).toHaveCount(1);
  await expect(history.locator(".history-row")).toContainText("fake-model-599");
  expect(errors).toEqual([]);
});

test("平面设计输入法组词期间 Escape 不关闭，正常 Escape 保留草稿并归还焦点", async ({ page }) => {
  const errors = await openFixture(page);
  const trigger = page.getByRole("button", { name: "打开平面设计", exact: true });
  await trigger.click();
  const studio = page.getByRole("dialog", { name: "平面设计", exact: true });
  await expect(studio).toBeVisible();
  const title = studio.getByLabel("主标题", { exact: true });
  await title.fill("输入法草稿保留");
  await title.evaluate(element => element.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", isComposing: true, bubbles: true })));
  await expect(studio).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(studio).toBeHidden();
  await expect(trigger).toBeFocused();
  await trigger.click();
  await expect(studio.getByLabel("主标题", { exact: true })).toHaveValue("输入法草稿保留");
  expect(errors).toEqual([]);
});

test("多选素材一次拖入画布，重开图库后首次详情点击有效", async ({ page }) => {
  const errors = await openFixture(page);
  await page.getByRole("button", { name: "历史生成", exact: true }).click();
  const library = page.getByRole("dialog", { name: "历史生成", exact: true });
  await library.getByRole("checkbox", { name: "选择 素材 0000", exact: true }).click();
  await library.getByRole("checkbox", { name: "选择 素材 0001", exact: true }).click();
  const preview = library.getByRole("button", { name: "查看详情 素材 0000", exact: true });
  const bounds = (await preview.boundingBox())!;
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
  await page.mouse.down();
  await page.mouse.move(16, 100, { steps: 10 });
  await page.mouse.up();
  await expect(library).toBeHidden();
  await expect(page.locator(".react-flow__node")).toHaveCount(2);
  await page.getByRole("button", { name: "历史生成", exact: true }).click();
  await library.getByRole("button", { name: "取消选择", exact: true }).click();
  await preview.click();
  await expect(library.locator(".library-inspector")).toBeVisible();
  expect(errors).toEqual([]);
});

test("项目文件搜索快捷键只作用于当前模态，输入斜杠不被吞掉", async ({ page }, testInfo) => {
  // Diagnose real key routing without moving focus or changing application
  // behavior. Retain bounded scalar summaries, never elements, event objects,
  // input values or API payloads in the attached observations.
  await page.addInitScript(() => {
    const records: Record<string, unknown>[] = [];
    (window as unknown as Record<string, unknown>).__projectFilesShortcutDiagnostics = records;
    const describe = (target: EventTarget | null) => target instanceof Element ? {
      tag: target.tagName, role: target.getAttribute("role"),
      aria: target.getAttribute("aria-label")?.slice(0, 120) ?? null,
      title: target.getAttribute("title")?.slice(0, 120) ?? null,
    } : null;
    const record = (value: Record<string, unknown>) => {
      records.push({ at: performance.now(), ...value });
      if (records.length > 64) records.shift();
    };
    let eventId = 0;
    window.addEventListener("focusin", event => record({ phase: "focusin", target: describe(event.target), active: describe(document.activeElement) }), true);
    window.addEventListener("keydown", event => {
      const id = ++eventId;
      const key = event.key;
      record({ id, phase: "keydown-capture", key, code: event.code,
        isComposing: event.isComposing, defaultPrevented: event.defaultPrevented,
        target: describe(event.target), active: describe(document.activeElement) });
      // A task observes the complete dispatch, including React's bubble handler.
      // Its short-lived closure is discarded after collecting scalar results.
      setTimeout(() => record({ id, phase: "keydown-after", key,
        isComposing: event.isComposing, defaultPrevented: event.defaultPrevented,
        active: describe(document.activeElement) }), 0);
    }, true);
  });
  try {
  const errors = await openFixture(page);
  await page.route(`**/api/projects/${project.id}/files`, route => route.fulfill({ json: { files: [], ignoredFiles: 0 } }));
  const trigger = page.getByRole("button", { name: "项目文件", exact: true });
  await trigger.click();
  const files = page.getByRole("dialog", { name: "项目文件", exact: true });
  const place = files.getByRole("button", { name: "放入画布", exact: true });
  await expect(place).toBeDisabled();
  const contrast = await place.evaluate(element => {
    const style = getComputedStyle(element);
    const luminance = (color: string) => {
      const channels = color.match(/[\d.]+/g)!.slice(0, 3).map(Number).map(channel => {
        const normalized = channel / 255;
        return normalized <= .04045 ? normalized / 12.92 : ((normalized + .055) / 1.055) ** 2.4;
      });
      return channels[0]! * .2126 + channels[1]! * .7152 + channels[2]! * .0722;
    };
    const foreground = luminance(style.color), background = luminance(style.backgroundColor);
    return { opacity: style.opacity, ratio: (Math.max(foreground, background) + .05) / (Math.min(foreground, background) + .05) };
  });
  expect(contrast.opacity).toBe("1");
  expect(contrast.ratio).toBeGreaterThanOrEqual(4.5);
  await expect(files.getByRole("button", { name: "刷新", exact: true })).toBeEnabled();
  await expect(files.getByRole("searchbox", { name: "搜索项目文件" })).toBeEnabled();
  await page.keyboard.press("/");
  const search = files.getByRole("searchbox", { name: "搜索项目文件" });
  await expect(search).toBeFocused();
  await page.keyboard.type("/设计");
  await expect(search).toHaveValue("/设计");
  await files.getByRole("button", { name: "关闭项目文件", exact: true }).focus();
  await page.keyboard.press("Control+f");
  await expect(search).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(files).toBeHidden();
  await expect(trigger).toBeFocused();
  expect(errors).toEqual([]);
  } finally {
    const observations = await page.evaluate(() => (window as unknown as Record<string, unknown>).__projectFilesShortcutDiagnostics)
      .catch(error => ({ diagnosticReadError: error instanceof Error ? error.message : String(error) }));
    await testInfo.attach("project-files-shortcut-events", { body: JSON.stringify(observations), contentType: "application/json" });
  }
});
