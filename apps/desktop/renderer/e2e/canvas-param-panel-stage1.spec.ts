import { expect, test, type APIRequestContext, type Locator, type Page } from "./helpers/canvas-offline-test";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { ModelDescriptor } from "@super-canvas/providers";
import { expectParameterValue, openParameterDetails } from "./helpers/parameter-controls";

const evidence = "D:/project development/超级画布/.codex-logs/2026-10-18-param-panel/stage2/legacy-stage1-regression-screenshots";

const image: ModelDescriptor = {
  id: "stage1-image", name: "参数层级图片模型", operations: ["image.generate", "image.edit"],
  inputKinds: ["text", "image"], outputKinds: ["image"], metadata: { canvasRunnable: true },
  pricing: { kind: "per-image", currency: "CNY", unitAmount: .125, checkedAt: "2026-10-18", confidence: "exact" },
  parameters: [
    { key: "size", label: "精确尺寸", control: "dimensions", valueType: "string", default: "2048x2048", min: 256, max: 4096, step: 1, allowCustomValue: true,
      options: [{ label: "自动", value: "auto" }, { label: "1K · 1:1 · 1024 × 1024", value: "1024x1024" },
        { label: "2K · 1:1 · 2048 × 2048", value: "2048x2048" }, { label: "4K · 1:1 · 4096 × 4096", value: "4096x4096" },
        { label: "4K · 16:9 · 3840 × 2160", value: "3840x2160" }] },
    { key: "quality", label: "质量", control: "select", valueType: "string", default: "max", options: [{ label: "高", value: "high" }, { label: "最高", value: "max" }] },
    { key: "n", label: "数量", control: "number", valueType: "integer", default: 1, min: 1, max: 10, step: 1 },
  ],
};
const video: ModelDescriptor = {
  id: "stage1-video", name: "参数层级视频模型", operations: ["video.generate", "video.image-to-video"],
  inputKinds: ["text", "image", "video", "audio"], outputKinds: ["video"], metadata: { canvasRunnable: true },
  pricing: { kind: "per-second", currency: "USD", unitAmount: .05, checkedAt: "2026-10-18", confidence: "exact" },
  parameters: [
    { key: "duration", label: "视频时长", control: "number", valueType: "integer", default: 8, min: 1, max: 15, step: 1 },
    { key: "aspect_ratio", label: "画面比例", control: "select", valueType: "string", default: "16:9", options: [{ label: "16:9", value: "16:9" }, { label: "9:16", value: "9:16" }] },
    { key: "resolution", label: "输出分辨率", control: "select", valueType: "string", default: "1080p", options: [{ label: "720p", value: "720p" }, { label: "1080p", value: "1080p" }] },
    { key: "generate_audio", label: "生成声音", control: "toggle", valueType: "boolean", default: true },
    { key: "seed", label: "随机种子", control: "number", valueType: "integer" },
  ],
};
const music: ModelDescriptor = {
  id: "stage1-music", name: "参数层级音乐模型", operations: ["music.generate"], inputKinds: ["text"], outputKinds: ["audio"], metadata: { canvasRunnable: true },
  pricing: { kind: "per-request", currency: "CNY", unitAmount: .6, checkedAt: "2026-10-18", confidence: "exact" },
  parameters: [
    { key: "title", label: "作品名", control: "text", valueType: "string" },
    { key: "instrumental", label: "纯音乐", control: "toggle", valueType: "boolean", default: false },
    { key: "lyrics", label: "歌词", control: "text", valueType: "string", visibleWhen: [{ parameter: "instrumental", values: [false] }] },
    { key: "duration", label: "目标时长（秒）", control: "number", valueType: "integer", min: 5, max: 300, step: 1 },
    { key: "bpm", label: "节奏 BPM", control: "number", valueType: "integer", min: 30, max: 300, step: 1 },
    { key: "audio_format", label: "音频格式", control: "select", valueType: "string", default: "mp3", options: [{ label: "MP3", value: "mp3" }, { label: "WAV", value: "wav" }] },
  ],
};
type Graph = { nodes: Array<{ id: string; data: { parameters?: Record<string, unknown>; [key: string]: unknown } }> };
type Submission = { nodeId?: string; scope?: string; graph: Graph };
type Kind = "image" | "video" | "music";
const labels = { a: "图片甲", b: "图片乙", video: "视频甲", music: "音乐甲", mask: "蒙版待修正", missing: "连接待修正", unknown: "缺价图片" };

async function fixture(page: Page, request: APIRequestContext) {
  expect(process.env.PLAYWRIGHT_BASE_URL, "stage1 只使用隔离数据运行时").toBeFalsy();
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.addInitScript(() => {
    localStorage.setItem("super-canvas:inspector-open", "false");
    localStorage.setItem("supercanvas:appearance", "light");
  });
  const unknown: ModelDescriptor = { ...image, id: "stage1-unknown", name: "缺价图片模型", pricing: undefined };
  const models = [image, video, music, unknown];
  const createdConnection = await request.post("/api/providers", { data: {
    provider: "rest", apiKey: "stage1-isolated-no-upstream", name: "参数层级隔离线路", config: { usage: "canvas", baseUrl: "http://127.0.0.1:9", defaultModel: image.id,
      modelCatalogModels: models, scannedModelIds: models.map(model => model.id), modelScanStatus: "live",
      connector: { auth: { type: "none" }, models, restrictModels: true, submit: { path: "/stage1-never-submit", method: "POST", bodyMode: "json" }, output: { path: "$.data", kind: "image" } } },
  } });
  expect(createdConnection.ok()).toBeTruthy();
  const connection = await createdConnection.json();
  const submissions: Submission[] = [], errors: string[] = [], external: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.route("**/*", route => {
    const url = new URL(route.request().url());
    if (["data:", "blob:", "about:"].includes(url.protocol)) return route.fallback();
    if (!["http:", "https:"].includes(url.protocol) || !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)) {
      external.push(`${url.protocol}//${url.hostname}`); return route.abort();
    }
    return route.fallback();
  });
  await page.route(`**/api/providers/${connection.id}/models*`, route => route.fulfill({ json: models,
    headers: { "X-Model-Scan-Status": "live", "X-Model-Scan-Complete": "true" } }));
  let canvasId = "";
  const saved = async (): Promise<Graph> => {
    const response = await request.get(`/api/canvas/${canvasId}`); expect(response.ok()).toBeTruthy();
    return (await response.json()).graph;
  };
  // Intercept before the server sees a run: no adapter, paid task or fake output
  // generation is required to check the UI's submission identity and saved edits.
  await page.route("**/api/runs**", async route => {
    if (!["GET", "HEAD"].includes(route.request().method())) {
      const body = route.request().postDataJSON() as { nodeId?: string; scope?: string };
      submissions.push({ ...body, graph: await saved() });
      return route.fulfill({ status: 400, json: { error: "stage1 隔离拦截：没有提交任何生成任务" } });
    }
    return route.fallback();
  });
  const node = (id: keyof typeof labels, kind: Kind, index: number, parameters: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
    id, type: "workflow", position: { x: 100 + index % 3 * 450, y: 140 + Math.floor(index / 3) * 310 }, style: { width: 360, height: 240 },
    data: { nodeType: `${kind === "music" ? "music" : kind}-generation`, label: labels[id], provider: "rest", connectionId: connection.id,
      model: ({ image, video, music })[kind].id, qualityMode: "custom", parameters,
      parts: [{ type: "text", text: `${labels[id]}的隔离提示词。` }], inputs: [{ id: "prompt", kind: "text", label: "提示词" }],
      outputs: [{ id: "output", kind: kind === "music" ? "audio" : kind, label: "结果" }], ...extra },
  });
  const created = await request.post("/api/canvas", { data: { title: "参数面板 stage1 隔离验收", graph: {
    schemaVersion: 1, viewport: { x: 0, y: 0, zoom: 1 }, edges: [], nodes: [
      node("a", "image", 0, { size: "4096x4096", quality: "max", n: 1 }),
      node("b", "image", 1, { size: "2048x2048", quality: "high", n: 2 }),
      node("video", "video", 2, { duration: 8, aspect_ratio: "16:9", resolution: "1080p", generate_audio: true }),
      node("music", "music", 3, { title: "晨光", instrumental: false, lyrics: "[Verse]\n晨光照进窗", duration: 90, bpm: 72, audio_format: "wav" }),
      node("mask", "image", 4, { size: "2048x2048", quality: "max", maskAssetId: "stage1-nonexistent-mask", maskSourceAssetId: "stage1-nonexistent-source" }),
      node("missing", "image", 5, { size: "2048x2048", quality: "max" }, { connectionId: "stage1-deleted-connection" }),
      node("unknown", "image", 6, { size: "2048x2048", quality: "max", n: 1 }, { model: unknown.id }),
    ],
  } } });
  expect(created.ok()).toBeTruthy(); canvasId = (await created.json()).id;
  await page.goto(`/canvas/${canvasId}`);
  await expect(page.getByRole("button", { name: "智能体面板", exact: true })).toBeVisible();
  const inspector = page.getByRole("button", { name: "智能体面板", exact: true });
  if (await inspector.getAttribute("aria-expanded") === "true") await inspector.click();
  const panel = (id: keyof typeof labels) => page.locator(`.node-config-docked[data-config-node-id="${id}"]`);
  const owner = (id: keyof typeof labels) => page.locator(`.react-flow__node[data-id="${id}"]`);
  const run = (id: keyof typeof labels, surface: "panel" | "node" = "panel") => (surface === "panel" ? panel(id) : owner(id)).getByRole("button", { name: `运行 ${labels[id]} 节点`, exact: true });
  const open = async (id: keyof typeof labels) => {
    await owner(id).getByRole("button", { name: `打开 ${labels[id]} 模型与参数`, exact: true }).click();
    await expect(panel(id)).toBeVisible();
    await openParameterDetails(panel(id), "自定义宽高");
  };
  const closeAll = async () => {
    const buttons = page.getByRole("button", { name: "关闭模型与参数面板", exact: true });
    while (await buttons.count()) await buttons.first().click();
  };
  return { panel, owner, open, run, saved, submissions, closeAll, assertSafe: () => expect({ external, errors }).toEqual({ external: [], errors: [] }) };
}

test("stage1 step1 Ctrl+Enter 运行面板 owner 恰一次并先提交 W/H 草稿", async ({ page, request }) => {
  const f = await fixture(page, request); await f.open("a");
  // Keep A's parameter owner while React Flow's selected node is B.
  await f.owner("b").getByText(labels.b, { exact: true }).click();
  await expect(f.owner("b")).toHaveClass(/\bselected\b/u);
  const width = f.panel("a").getByLabel("图片宽度", { exact: true });
  await width.fill("3072"); await expect(f.owner("b")).toHaveClass(/\bselected\b/u); await width.press("Control+Enter");
  await expect.poll(() => f.submissions.length).toBe(1);
  expect(f.submissions[0]).toMatchObject({ nodeId: "a", scope: "node" });
  expect(f.submissions[0]!.graph.nodes.find(node => node.id === "a")?.data.parameters?.size).toBe("3072x4096");
  expect(f.submissions[0]!.graph.nodes.find(node => node.id === "b")?.data.parameters?.size).toBe("2048x2048");
  // A second physical activation has its own run; the first key event cannot
  // bubble to the canvas shortcut and submit the selected B as well.
  await expect.poll(async () => (await f.saved()).nodes.find(node => node.id === "a")?.data.parameters?.size).toBe("3072x4096");
  expect(f.submissions).toHaveLength(1); f.assertSafe();
});

test("stage1 step1 自定义下拉与 ModelPicker 的 Enter/Escape 及 IME/repeat 不运行", async ({ page, request }) => {
  const f = await fixture(page, request); await f.open("a");
  const panel = f.panel("a"), quality = panel.getByRole("combobox", { name: "质量", exact: true });
  await quality.click(); await expect(quality).toHaveAttribute("aria-expanded", "true");
  await page.keyboard.press("Enter"); await expect(panel).toBeVisible();
  await expect(quality).toHaveAttribute("aria-expanded", "false"); await expectParameterValue(quality, "max");
  await quality.click(); await page.keyboard.press("Escape"); await expect(panel).toBeVisible();
  const picker = panel.getByRole("combobox", { name: `${labels.a} 模型`, exact: true });
  await picker.click();
  const search = panel.getByRole("combobox", { name: "搜索模型名称或 ID", exact: true });
  await expect(search).toBeFocused(); await search.press("Escape"); await expect(panel).toBeVisible();
  await picker.click(); await search.fill(image.id); await search.press("Enter");
  await expect(search).toHaveCount(0); await expect(panel).toBeVisible(); expect(f.submissions).toHaveLength(0);
  await panel.focus();
  await panel.dispatchEvent("keydown", { key: "Enter", ctrlKey: true, isComposing: true });
  await panel.dispatchEvent("keydown", { key: "Enter", ctrlKey: true, repeat: true });
  expect(f.submissions).toHaveLength(0); f.assertSafe();
});

async function noHorizontalOverflow(panel: Locator) {
  const overflows = await panel.evaluate(element => {
    const outer = element.getBoundingClientRect();
    return [...element.querySelectorAll<HTMLElement>(".node-config-header, .node-config-popover-body, .node-config-run, input, select, textarea, button, [data-testid='param-panel-unit-price'], [data-testid='param-panel-total-price']")]
      .filter(item => item.getClientRects().length && !item.closest(".node-model-select-options"))
      .flatMap(item => {
        const rect = item.getBoundingClientRect();
        return item.scrollWidth > item.clientWidth + 2 || rect.left < outer.left - 1 || rect.right > outer.right + 1
          ? [{ tag: item.tagName, label: item.getAttribute("aria-label"), className: item.className, width: item.clientWidth, scroll: item.scrollWidth }] : [];
      });
  });
  expect(overflows).toEqual([]);
}


test("stage1 step2 运行入口共享连接和蒙版禁用条件及原因", async ({ page, request }) => {
  const f = await fixture(page, request);
  for (const id of ["a", "mask", "missing"] as const) {
    await f.open(id);
    expect(await f.run(id).isDisabled()).toBe(await f.run(id, "node").isDisabled());
    expect(await f.run(id).getAttribute("title")).toBe(await f.run(id, "node").getAttribute("title"));
    if (id === "a") await expect(f.run(id)).toBeEnabled();
    else { await expect(f.run(id)).toBeDisabled(); await f.panel(id).focus(); await page.keyboard.press("Control+Enter"); }
    await f.closeAll();
  }
  expect(f.submissions).toHaveLength(0); f.assertSafe();
});



test("stage1 step2 面板按钮运行先提交 W/H 草稿", async ({ page, request }) => {
  const f = await fixture(page, request); await f.open("a");
  const width = f.panel("a").getByLabel("图片宽度", { exact: true });
  await width.fill("2816"); await f.run("a").click();
  await expect.poll(() => f.submissions.length).toBe(1);
  expect(f.submissions[0]).toMatchObject({ nodeId: "a", scope: "node" });
  expect(f.submissions[0]!.graph.nodes.find(node => node.id === "a")?.data.parameters?.size).toBe("2816x4096");
  f.assertSafe();
});

test("stage1 step2 线路浮层和原生下拉的 Escape 各自归还焦点且不关闭 owner", async ({ page, request }) => {
  const f = await fixture(page, request); await f.open("video");
  const panel = f.panel("video");
  const trigger = panel.getByRole("button", { name: `${labels.video} 线路`, exact: true });
  const routes = panel.getByRole("dialog", { name: `${labels.video} 候选线路`, exact: true });
  await trigger.click(); await expect(routes).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(routes).toBeHidden(); await expect(trigger).toBeFocused(); await expect(panel).toBeVisible();
  await trigger.press("Enter"); await expect(routes).toBeVisible();
  const current = routes.locator('button[data-route-choice][aria-pressed="true"]');
  await expect(current).toBeFocused();
  await current.press("Control+k");
  const commands = page.getByRole("dialog", { name: "快捷操作", exact: true });
  const commandSearch = commands.getByRole("combobox", { name: "搜索画布操作", exact: true });
  await expect(commandSearch).toBeFocused(); await expect(routes).toBeHidden();
  await commandSearch.press("Escape");
  await expect(commands).toBeHidden(); await expect(trigger).toBeFocused(); await expect(panel).toBeVisible();
  await trigger.press("Enter"); await expect(routes).toBeVisible(); await expect(current).toBeFocused();
  await current.press("Tab"); await expect(current.locator("..").locator("summary")).toBeFocused();
  const manage = routes.getByRole("button", { name: "管理供应商与密钥", exact: true });
  const tabBudget = await routes.locator("button[data-route-choice]").count() * 3 + 4;
  for (let index = 0; index < tabBudget && !await manage.evaluate(element => element === document.activeElement); index++) {
    await page.keyboard.press("Tab");
  }
  await expect(manage).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(routes).toBeHidden(); await expect(trigger).toBeFocused(); await expect(panel).toBeVisible();
  // Supplier selects have become one route picker. The video's remaining
  // native resolution control retains its separate first-Escape ownership.
  const resolution = panel.getByRole("combobox", { name: "输出分辨率", exact: true });
  await resolution.focus(); await resolution.press("Alt+ArrowDown");
  await expect.poll(() => resolution.evaluate(element => element.matches(":open"))).toBe(true);
  await page.keyboard.press("Escape");
  await expect.poll(() => resolution.evaluate(element => element.matches(":open"))).toBe(false);
  await expect(resolution).toBeFocused(); await expect(panel).toBeVisible();
  await page.keyboard.press("Escape"); await expect(panel).toHaveCount(0);
  expect(f.submissions).toHaveLength(0); f.assertSafe();
});

test("stage1 step2 侧开模型菜单在双卡和并排智能体中保持 owner、键盘和视口边界", async ({ page, request }) => {
  const f = await fixture(page, request); await f.open("a"); await f.open("b");
  const supplemental = join(evidence, "supplemental"); await mkdir(supplemental, { recursive: true });
  const panel = f.panel("b"), picker = panel.getByRole("combobox", { name: `${labels.b} 模型`, exact: true });
  const search = panel.getByRole("combobox", { name: "搜索模型名称或 ID", exact: true });
  const menu = panel.locator(".node-model-select-options");
  const options = panel.getByRole("listbox", { name: `${labels.b} 模型 可选模型`, exact: true });
  const expectMenuInsideViewport = async () => {
    await expect(menu).toBeVisible();
    const bounds = (await menu.boundingBox())!, cardBounds = (await panel.boundingBox())!, viewport = page.viewportSize()!;
    expect(bounds.x).toBeGreaterThanOrEqual(0); expect(bounds.y).toBeGreaterThanOrEqual(0);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(viewport.width);
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(viewport.height);
    expect(bounds.x + bounds.width <= cardBounds.x + 1 || bounds.x >= cardBounds.x + cardBounds.width - 1).toBe(true);
  };
  await picker.click(); await expect(search).toBeFocused(); await expectMenuInsideViewport();
  // The shared inventory has four media models. This image card's actual list
  // contains its two image models plus the automatic entry; all stay reachable.
  const names = ["自动模型", image.name, "缺价图片模型"];
  await expect(options.getByRole("option")).toHaveCount(names.length);
  await search.press("Home");
  for (const [index, name] of names.entries()) {
    if (index) await search.press("ArrowDown");
    await expect(options.getByRole("option", { name, exact: true })).toHaveAttribute("data-active", "true");
  }
  await page.screenshot({ path: join(supplemental, "model-menu-two-cards.png"), animations: "disabled" });
  await search.press("Escape"); await expect(menu).toHaveCount(0); await expect(picker).toBeFocused();
  await expect(page.locator('.canvas-parameter-dock[data-parameter-node-id="b"]')).toHaveAttribute("data-active", "true");
  await picker.click(); await expectMenuInsideViewport();
  await f.panel("a").locator(".node-config-header").click({ position: { x: 40, y: 20 } });
  await expect(menu).toHaveCount(0);
  await expect(page.locator('.canvas-parameter-dock[data-parameter-node-id="a"]')).toHaveAttribute("data-active", "true");
  await expect(f.panel("a").getByRole("combobox", { name: `${labels.a} 模型`, exact: true })).toHaveAttribute("aria-expanded", "false");
  await f.closeAll();
  const agent = page.getByRole("button", { name: "智能体面板", exact: true });
  await agent.click(); await expect(agent).toHaveAttribute("aria-expanded", "true");
  await f.open("b"); await expect(page.locator(".canvas-parameter-deck")).toHaveAttribute("data-alongside-agent", "true");
  await picker.click(); await expectMenuInsideViewport(); await expect(search).toBeFocused();
  await expect(options.getByRole("option")).toHaveCount(names.length);
  await page.screenshot({ path: join(supplemental, "model-menu-alongside-agent.png"), animations: "disabled" });
  await agent.click(); await expect(agent).toHaveAttribute("aria-expanded", "false");
  await expect(menu).toHaveCount(0); await expect(panel).toBeVisible();
  expect((await f.saved()).nodes.find(node => node.id === "b")?.data.model).toBe(image.id);
  expect(f.submissions).toHaveLength(0); f.assertSafe();
});

for (const [chord, scope] of [["Meta+Enter", "node"], ["Control+Shift+Enter", "downstream"]] as const) {
  test(`stage1 step2 ${chord} 保留面板 owner 和运行范围`, async ({ page, request }) => {
    const f = await fixture(page, request); await f.open("a");
    await f.owner("b").getByText(labels.b, { exact: true }).click();
    await f.panel("a").focus();
    await expect(f.owner("b")).toHaveClass(/\bselected\b/u);
    await page.keyboard.press(chord);
    await expect.poll(() => f.submissions.length).toBe(1);
    expect(f.submissions[0]).toMatchObject({ nodeId: "a", scope });
    f.assertSafe();
  });
}

test("stage1 step2 顶部单价和底栏总价分别正确，详情默认折叠且缺价不编造", async ({ page, request }) => {
  const f = await fixture(page, request); await f.open("a");
  const panel = f.panel("a"); await panel.getByRole("spinbutton", { name: "数量", exact: true }).fill("3");
  const header = panel.getByTestId("param-panel-unit-price"), footer = panel.getByTestId("param-panel-total-price");
  await expect(header).toContainText("0.125 CNY"); await expect(header).toContainText("/ 张");
  await expect(header).not.toContainText("0.375"); await expect(footer).toHaveText("0.375 CNY");
  const detail = panel.getByLabel("当前参数价格", { exact: true });
  await expect(detail).toBeHidden();
  await openParameterDetails(panel, "价格明细");
  await expect(detail).toBeVisible();
  await expect(detail.getByText("本次预计费用", { exact: false })).toContainText("0.375 CNY");
  await f.closeAll(); await f.open("unknown");
  await expect(f.panel("unknown").getByTestId("param-panel-unit-price")).toHaveText("—");
  await expect(f.panel("unknown").getByTestId("param-panel-total-price")).toHaveText("—");
  expect(f.submissions).toHaveLength(0); f.assertSafe();
});

test("stage1 step2 浅深主题与 320/360/420 像素图片视频音乐 18 张及双卡低高度 2 张截图", async ({ page, request }) => {
  test.setTimeout(120_000);
  const f = await fixture(page, request); await mkdir(evidence, { recursive: true });
  const screenshots: string[] = [];
  for (const theme of ["light", "dark"] as const) for (const width of [320, 360, 420]) for (const id of ["a", "video", "music"] as const) {
    await f.closeAll();
    await page.evaluate(value => { localStorage.setItem("supercanvas:appearance", value); window.dispatchEvent(new StorageEvent("storage", { key: "supercanvas:appearance", newValue: value })); }, theme);
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
    await f.open(id);
    await page.locator(".canvas-parameter-deck").evaluate((element, pixels) => { (element as HTMLElement).style.width = `${pixels}px`; }, width);
    await noHorizontalOverflow(f.panel(id));
    const footer = f.run(id); await expect(footer).toBeInViewport();
    const name = `stage1-${theme}-${width}-${id === "a" ? "image" : id}.png`;
    await f.panel(id).screenshot({ path: join(evidence, name), animations: "disabled" }); screenshots.push(name);
  }
  await f.closeAll(); await page.setViewportSize({ width: 1920, height: 1080 });
  await page.locator(".canvas-parameter-deck").evaluate(element => { (element as HTMLElement).style.removeProperty("width"); });
  await f.open("a"); await f.open("b"); await expect(f.panel("a")).toBeVisible(); await expect(f.panel("b")).toBeVisible();
  await noHorizontalOverflow(f.panel("a")); await noHorizontalOverflow(f.panel("b"));
  await page.locator(".canvas-parameter-deck").screenshot({ path: join(evidence, "stage1-two-cards.png"), animations: "disabled" }); screenshots.push("stage1-two-cards.png");
  await f.closeAll(); await page.setViewportSize({ width: 1280, height: 560 }); await f.open("a");
  await page.locator(".canvas-parameter-deck").evaluate(element => { (element as HTMLElement).style.width = "320px"; });
  await noHorizontalOverflow(f.panel("a")); await expect(f.run("a")).toBeInViewport();
  const body = f.panel("a").locator(".node-config-popover-body");
  await body.evaluate(element => { element.scrollTop = element.scrollHeight; }); await expect(f.run("a")).toBeInViewport();
  await f.panel("a").screenshot({ path: join(evidence, "stage1-low-height.png"), animations: "disabled" }); screenshots.push("stage1-low-height.png");
  expect(screenshots).toHaveLength(20); await writeFile(join(evidence, "screenshots.json"), `${JSON.stringify(screenshots, null, 2)}\n`, "utf8");
  expect(f.submissions).toHaveLength(0); f.assertSafe();
});
