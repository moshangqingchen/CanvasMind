import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test, type APIRequestContext, type Locator, type Page } from "@playwright/test";
import type { ModelDescriptor } from "@super-canvas/providers";
import type { ProviderConnectionView } from "../lib/client-api";
import { CANGYUAN_IMAGE_CONNECTOR } from "../lib/provider-presets";

// All prices and capabilities in this file are isolated UI fixtures. No supplier
// credentials or generation requests are involved in these contract checks.
const checkedAt = "2026-10-07T20:00:00-07:00";
const image: ModelDescriptor = {
  id: "ui-contract-image", name: "图片参数验收 · 供应商原生图片输出", operations: ["image.generate", "image.edit"],
  inputKinds: ["text", "image[]"], outputKinds: ["image"], metadata: { canvasRunnable: true },
  parameters: [{ key: "n", label: "生成数量", control: "number", valueType: "integer", default: 1, min: 1, max: 4, step: 1 }],
  pricing: { kind: "per-image", currency: "CNY", unitAmount: 0.08, checkedAt, confidence: "exact" },
};
const video: ModelDescriptor = {
  id: "ui-contract-video-with-a-very-long-provider-model-identifier-720p-1080p",
  name: "视频参数验收 · 首尾帧与多模态参考素材 · 供应商原生高清渠道 · 保留完整名称用于长菜单布局检查",
  operations: ["video.generate", "video.image-to-video"], inputKinds: ["text", "image[]", "video[]", "audio[]"], outputKinds: ["video"],
  metadata: { canvasRunnable: true, supportsFirstLastFrames: true, allowFrameMediaMix: false, clampNumericParameters: true },
  parameters: [
    { key: "resolution", label: "视频分辨率", control: "select", default: "720p", options: [{ value: "720p", label: "720p" }, { value: "1080p", label: "1080p" }] },
    { key: "duration", label: "视频时长（秒）", control: "select", valueType: "integer", default: 5,
      options: [5, 10, 15].map(value => ({ value, label: `${value} 秒` })),
      constraints: [{ when: [{ parameter: "resolution", values: ["1080p"] }], options: [5, 10].map(value => ({ value, label: `${value} 秒` })) }] },
    { key: "aspect_ratio", label: "画面比例", control: "select", default: "16:9", options: [{ value: "16:9", label: "16:9" }, { value: "9:16", label: "9:16" }] },
    { key: "generate_audio", label: "生成声音", control: "toggle", valueType: "boolean", default: true },
    { key: "n", label: "生成数量", control: "number", valueType: "integer", default: 1, min: 1, max: 3, step: 1 },
  ],
  limits: { maxInputImages: 9, maxInputVideos: 3, maxInputAudios: 3, maxInputAssets: 12, maxInputVideoDurationSeconds: 15, maxTotalInputVideoDurationSeconds: 30 },
  pricing: { kind: "tiered", currency: "CNY", billingUnit: "second", checkedAt, confidence: "exact", tiers: [
    { id: "720p", label: "720p", price: 0.2, dimension: "resolution", value: "720p" },
    { id: "1080p", label: "1080p", price: 0.4, dimension: "resolution", value: "1080p" },
  ] },
};
const alternateVideo: ModelDescriptor = {
  id: "ui-contract-video-fixed-request", name: "视频参数验收 · 独立 4K 按次渠道",
  operations: ["video.generate", "video.image-to-video"], inputKinds: ["text", "image"], outputKinds: ["video"],
  metadata: { canvasRunnable: true, fixedOutputCount: 1 },
  parameters: [
    { key: "resolution", label: "视频分辨率", control: "select", default: "4K", options: [{ value: "4K", label: "4K" }] },
    { key: "duration", label: "视频时长（秒）", control: "select", valueType: "integer", default: 4, options: [4, 8].map(value => ({ value, label: `${value} 秒` })) },
  ],
  pricing: { kind: "per-request", currency: "USD", unitAmount: 2, billingUnit: "request", checkedAt, confidence: "snapshot" },
};
const music: ModelDescriptor = {
  id: "ui-contract-music", name: "音乐参数验收 · 歌词与纯音乐", operations: ["music.generate"], inputKinds: ["text"], outputKinds: ["audio"],
  metadata: { canvasRunnable: true, fixedOutputCount: 1 },
  parameters: [
    { key: "instrumental", label: "纯音乐", control: "toggle", valueType: "boolean", default: false },
    { key: "title", label: "作品名", control: "text", default: "" },
    { key: "lyrics", label: "歌词", control: "text", visibleWhen: [{ parameter: "instrumental", values: [false] }] },
    { key: "duration", label: "目标时长（秒）", control: "number", valueType: "integer", default: 90, min: 30, max: 180, step: 1 },
    { key: "bpm", label: "节奏 BPM", control: "number", valueType: "integer", default: 72, min: 40, max: 200, step: 1 },
    { key: "audio_format", label: "音频格式", control: "select", default: "mp3", options: [{ value: "mp3", label: "MP3" }, { value: "wav", label: "WAV" }] },
  ],
  pricing: { kind: "per-request", currency: "CNY", unitAmount: 0.8, checkedAt, confidence: "exact" },
};
const understanding: ModelDescriptor = { id: "ui-image-understanding", name: "只读图片理解模型", operations: [], inputKinds: ["image", "text"], outputKinds: ["text"] };
const speech: ModelDescriptor = { id: "ui-text-to-speech", name: "只读语音合成模型", operations: [], inputKinds: ["text"], outputKinds: ["audio"] };
const models = [image, video, alternateVideo, music, understanding, speech];
const screenshots = fileURLToPath(new URL("../../../../docs/supplier-media-ui-2026-10-07/", import.meta.url));
type MediaKind = "image" | "video" | "music";
const initialModel = { image, video, music };
const labels = { image: "图片合同验收", video: "视频合同验收", music: "音乐合同验收" };

test.beforeAll(async () => {
  expect(process.env.PLAYWRIGHT_BASE_URL, "媒体合同验收只能使用 globalSetup 创建的隔离数据目录").toBeFalsy();
  await mkdir(screenshots, { recursive: true });
});

async function setup(page: Page, request: APIRequestContext, kind: MediaKind) {
  await page.setViewportSize({ width: 1600, height: 1080 });
  const errors: string[] = [];
  let submissions = 0, upstreamRequests = 0, modelReads = 0;
  page.on("pageerror", error => errors.push(error.message));
  await page.route("https://media-contract-ui.invalid/**", route => { upstreamRequests++; return route.abort(); });
  await page.route(/\/api\/runs(?:\?.*)?$/u, route => {
    if (route.request().method() === "POST") { submissions++; return route.abort(); }
    return route.continue();
  });
  await page.route(/\/api\/suppliers(?:\?.*)?$/u, route => route.fulfill({ json: [] }));
  const created = await request.post("/api/providers", { data: {
    name: `媒体合同隔离验收 ${kind}`, provider: "rest", apiKey: "isolated-no-paid-generation",
    config: { baseUrl: "https://media-contract-ui.invalid", defaultModel: initialModel[kind].id,
      connector: { ...structuredClone(CANGYUAN_IMAGE_CONNECTOR), models, restrictModels: true } },
  } });
  expect(created.ok()).toBeTruthy();
  const stored = await created.json();
  const connection: ProviderConnectionView = { ...stored, apiKey: "", apiKeySet: true, apiKeyUsable: true,
    config: { ...stored.config, supplierKey: "custom-media-contract-ui", supplierName: "媒体验收 · 原生渠道",
      usage: "canvas", modelGroup: "图片、视频、音乐混合分组", accountKeyGroup: "图片、视频、音乐混合分组",
      modelScanStatus: "live", modelCatalogModels: models, scannedModelIds: models.map(model => model.id) } };
  await page.route(/\/api\/providers(?:\?.*)?$/u, route => route.request().method() === "GET" ? route.fulfill({ json: [connection] }) : route.continue());
  await page.route(`**/api/providers/${connection.id}/models*`, route => {
    modelReads++;
    return route.fulfill({ json: models, headers: { "X-Model-Scan-Status": "live", "X-Model-Scan-Complete": "true" } });
  });
  const parameters = kind === "video" ? { resolution: "720p", duration: 5, aspect_ratio: "16:9", generate_audio: true, n: 1 }
    : kind === "music" ? { instrumental: false, duration: 90, bpm: 72, audio_format: "mp3", title: "" } : { n: 1 };
  const output = kind === "music" ? "audio" : kind;
  const response = await request.post("/api/canvas", { data: { title: `媒体合同 ${kind} 隔离回归`, graph: {
    schemaVersion: 1, viewport: { x: 0, y: 0, zoom: 1 }, edges: [], nodes: [{
      id: "media-contract", type: "workflow", position: { x: 80, y: 60 }, style: { width: 420, height: 180 },
      data: { nodeType: `${kind}-generation`, label: labels[kind], provider: "rest", connectionId: connection.id,
        model: initialModel[kind].id, qualityMode: "custom", parameters, parts: [],
        inputs: [{ id: "prompt", kind: "text", label: "提示词" }], outputs: [{ id: "result", kind: output, label: "结果" }] },
    }],
  } } });
  expect(response.ok()).toBeTruthy();
  const canvas = await response.json();
  const saved = async () => (await (await request.get(`/api/canvas/${canvas.id}`)).json()).graph.nodes[0].data;
  const open = async () => {
    await page.getByRole("button", { name: `打开 ${labels[kind]} 模型与参数`, exact: true }).click();
    await expect(panel).toBeVisible();
  };
  const panel = page.getByRole("dialog", { name: `${labels[kind]} 模型与参数`, exact: true });
  await page.goto(`/canvas/${canvas.id}`);
  await open();
  const picker = panel.getByRole("combobox", { name: `${labels[kind]} 模型`, exact: true });
  const safe = () => {
    expect({ submissions, upstreamRequests }).toEqual({ submissions: 0, upstreamRequests: 0 });
    expect(errors).toEqual([]);
    expect(modelReads).toBeGreaterThan(0);
  };
  return { panel, picker, saved, open, safe };
}

async function selectValues(control: Locator) {
  return control.locator('option:not([value=""])').evaluateAll(options => options.map(option => (option as HTMLOptionElement).value));
}

async function expectContained(locator: Locator, viewportWidth: number) {
  const dimensions = await locator.evaluate(element => {
    const rect = element.getBoundingClientRect();
    return { x: rect.x, right: rect.right, width: rect.width, scrollWidth: element.scrollWidth, clientWidth: element.clientWidth };
  });
  expect(dimensions.width).toBeGreaterThan(0);
  expect(dimensions.x).toBeGreaterThanOrEqual(-1);
  expect(dimensions.right).toBeLessThanOrEqual(viewportWidth + 1);
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth + 1);
}

for (const kind of ["image", "video", "music"] as const) {
  test(`${labels[kind]}：混合分组只显示当前媒体类型，理解与语音合成不会混入`, async ({ page, request }) => {
    const f = await setup(page, request, kind);
    try {
      await f.picker.click();
      const expected = kind === "video" ? [video, alternateVideo] : [initialModel[kind]];
      await expect(f.panel.getByRole("listbox").getByRole("option")).toHaveCount(expected.length + 1);
      for (const model of expected) await expect(f.panel.getByRole("option", { name: model.name, exact: true })).toBeVisible();
      for (const model of models.filter(model => !expected.includes(model)))
        await expect(f.panel.getByRole("option", { name: model.name, exact: true })).toHaveCount(0);
      await f.panel.screenshot({ path: join(screenshots, `${kind}-typed-model-menu.png`) });
      if (kind === "image") {
        await page.keyboard.press("Escape");
        const prices = f.panel.getByLabel("当前参数价格", { exact: true });
        await expect(prices).toContainText("当前组合价格 0.08 CNY / 张");
        await f.panel.getByLabel("生成数量", { exact: true }).fill("3");
        await expect(prices).toContainText("本次预计费用 0.24 CNY");
        await expect.poll(async () => (await f.saved()).parameters.n).toBe(3);
        await page.reload(); await f.open();
        await expect(f.panel.getByLabel("生成数量", { exact: true })).toHaveValue("3");
        await expect(prices).toContainText("本次预计费用 0.24 CNY");
        await f.panel.screenshot({ path: join(screenshots, "image-count-price-restored.png") });
      }
    } finally { f.safe(); }
  });
}

test("视频分辨率切换收紧离散时长，费用随秒数和数量变化，型号与参数刷新恢复", async ({ page, request }) => {
  const f = await setup(page, request, "video");
  try {
    const resolution = f.panel.getByLabel("视频分辨率", { exact: true });
    const duration = f.panel.getByLabel("视频时长（秒）", { exact: true });
    const count = f.panel.getByLabel("生成数量", { exact: true });
    const prices = f.panel.getByLabel("当前参数价格", { exact: true });
    await expect(prices).toContainText("当前组合价格 0.2 CNY / 秒");
    await expect(prices).toContainText("本次预计费用 1 CNY");
    expect(await selectValues(duration)).toEqual(["5", "10", "15"]);
    await duration.selectOption("15");
    await count.fill("2");
    await expect(prices).toContainText("本次预计费用 6 CNY");
    await resolution.selectOption("1080p");
    await expect.poll(() => selectValues(duration)).toEqual(["5", "10"]);
    await expect(duration).toHaveValue("5");
    await duration.selectOption("10");
    await expect(prices).toContainText("当前组合价格 0.4 CNY / 秒");
    await expect(prices).toContainText("本次预计费用 8 CNY");
    await f.panel.getByLabel("生成声音", { exact: true }).uncheck();
    await expect.poll(async () => (await f.saved()).parameters).toMatchObject({ resolution: "1080p", duration: 10, n: 2, generate_audio: false });
    await page.reload(); await f.open();
    await expect(resolution).toHaveValue("1080p");
    await expect(duration).toHaveValue("10");
    await expect(count).toHaveValue("2");
    await expect(prices).toContainText("本次预计费用 8 CNY");
    await f.panel.getByText("参考素材与限制", { exact: true }).click();
    await expect(prices).toContainText("图片最多 9 张");
    await expect(prices).toContainText("首尾帧与参考素材分别使用");
    await f.panel.screenshot({ path: join(screenshots, "video-dynamic-parameters-price.png") });

    await f.picker.click();
    await f.panel.getByRole("option", { name: alternateVideo.name, exact: true }).click();
    await expect(resolution).toHaveValue("4K");
    await expect(duration).toHaveValue("4");
    await expect(count).toHaveCount(0);
    await expect(prices).toContainText("当前组合价格 2 USD / 次（参考）");
    await expect(prices).toContainText("本次预计费用 2 USD（参考）");
    await expect.poll(async () => (await f.saved()).model).toBe(alternateVideo.id);
    await expect.poll(async () => (await f.saved()).parameters).toEqual({ resolution: "4K", duration: 4 });
    await page.reload(); await f.open();
    await expect(f.picker).toContainText(alternateVideo.name);
    await expect(duration).toHaveValue("4");
    await expect(f.panel.getByRole("alert")).toHaveCount(0);
    await f.panel.screenshot({ path: join(screenshots, "video-fixed-request-model-restored.png") });
  } finally { f.safe(); }
});

test("音乐歌词占完整行，纯音乐切换隐藏歌词，音频参数与费用保存恢复", async ({ page, request }) => {
  const f = await setup(page, request, "music");
  try {
    const lyrics = f.panel.getByLabel("歌词", { exact: true });
    await expect(lyrics).toHaveAttribute("rows", "6");
    await expect(lyrics).toBeVisible();
    const widths = await lyrics.evaluate(element => ({ field: element.parentElement!.getBoundingClientRect().width, grid: element.closest(".parameter-grid")!.getBoundingClientRect().width }));
    expect(widths.field).toBeGreaterThanOrEqual(widths.grid - 1);
    await f.panel.getByLabel("作品名", { exact: true }).fill("晨光");
    await lyrics.fill("[Verse]\n晨光照进窗\n[Chorus]\n一起出发");
    await f.panel.getByLabel("目标时长（秒）", { exact: true }).fill("120");
    await f.panel.getByLabel("音频格式", { exact: true }).selectOption("wav");
    await expect(f.panel.getByLabel("当前参数价格", { exact: true })).toContainText("本次预计费用 0.8 CNY");
    await expect.poll(async () => (await f.saved()).parameters).toMatchObject({ title: "晨光", lyrics: "[Verse]\n晨光照进窗\n[Chorus]\n一起出发", duration: 120, audio_format: "wav" });
    await page.reload(); await f.open();
    await expect(lyrics).toHaveValue("[Verse]\n晨光照进窗\n[Chorus]\n一起出发");
    await f.panel.screenshot({ path: join(screenshots, "music-lyrics-parameters.png") });
    await f.panel.getByLabel("纯音乐", { exact: true }).check();
    await expect(lyrics).toHaveCount(0);
    await expect.poll(async () => (await f.saved()).parameters.instrumental).toBe(true);
    // Keep the editable lyric draft when switching to instrumental mode.
    // Runtime normalization and the music adapter omit it from the request.
    await expect.poll(async () => (await f.saved()).parameters.lyrics).toBe("[Verse]\n晨光照进窗\n[Chorus]\n一起出发");
    await page.reload(); await f.open();
    await expect(f.panel.getByLabel("纯音乐", { exact: true })).toBeChecked();
    await expect(lyrics).toHaveCount(0);
    await expect(f.panel.getByRole("alert")).toHaveCount(0);
    await expect(f.panel.getByLabel("当前参数价格", { exact: true })).toContainText("本次预计费用 0.8 CNY");
    await f.panel.screenshot({ path: join(screenshots, "music-instrumental-restored.png") });
    await page.setViewportSize({ width: 720, height: 1000 });
    const closeAgent = page.getByRole("button", { name: "关闭智能体", exact: true });
    if (await closeAgent.isVisible()) await closeAgent.click();
    await f.panel.getByLabel("纯音乐", { exact: true }).uncheck();
    await expect(lyrics).toBeVisible();
    await expect(lyrics).toHaveValue("[Verse]\n晨光照进窗\n[Chorus]\n一起出发");
    await expectContained(f.panel, 720);
    await expectContained(f.panel.locator(".parameter-grid"), 720);
    await expectContained(lyrics, 720);
    await f.panel.screenshot({ path: join(screenshots, "music-narrow-window-lyrics.png") });
  } finally { f.safe(); }
});

test("窄窗口长型号菜单、参数网格与费用说明不横向溢出", async ({ page, request }) => {
  const f = await setup(page, request, "video");
  try {
    await page.setViewportSize({ width: 720, height: 1000 });
    const closeAgent = page.getByRole("button", { name: "关闭智能体", exact: true });
    if (await closeAgent.isVisible()) await closeAgent.click();
    await expectContained(f.panel, 720);
    await expectContained(f.panel.locator(".node-config-popover-body"), 720);
    await expectContained(f.panel.locator(".parameter-grid"), 720);
    await f.picker.click();
    const menu = f.panel.locator(".node-model-select-options");
    await expect(menu).toBeVisible();
    await expectContained(menu, 720);
    await expectContained(menu.getByRole("listbox"), 720);
    await expect(f.panel.getByRole("option", { name: video.name, exact: true })).toBeVisible();
    await page.screenshot({ path: join(screenshots, "video-narrow-window-model-menu.png") });
    await page.keyboard.press("Escape");
    await expect(menu).toHaveCount(0);
    await f.panel.getByText("价格与参数依据", { exact: true }).click();
    await expectContained(f.panel.getByLabel("当前参数价格", { exact: true }), 720);
    await f.panel.screenshot({ path: join(screenshots, "video-narrow-window-parameters-price.png") });
  } finally { f.safe(); }
});
