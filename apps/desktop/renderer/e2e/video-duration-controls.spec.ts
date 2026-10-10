import { expect, test, type APIRequestContext, type Locator, type Page } from "@playwright/test";
import { remainingVideoModel, type ModelDescriptor } from "@super-canvas/providers";
import type { CanvasResponse, ProviderConnectionView } from "../lib/client-api";
import { CANGYUAN_IMAGE_CONNECTOR } from "../lib/provider-presets";

const checkedAt = "2026-10-09T02:00:00.000Z";
const label = "视频时长验收";
const origin = "https://video-duration-controls.invalid";
const continuous: ModelDescriptor = {
  id: "duration-continuous-request", name: "连续时长 · 按次渠道",
  operations: ["video.generate"], inputKinds: ["text"], outputKinds: ["video"],
  metadata: { canvasRunnable: true, clampNumericParameters: true },
  parameters: [{ key: "duration", label: "视频时长", control: "number", valueType: "integer", default: 5, min: 4, max: 30, step: 1 }],
  pricing: { kind: "per-request", currency: "CNY", unitAmount: 5.5, checkedAt, confidence: "exact" },
};
const conditional: ModelDescriptor = {
  ...continuous, id: "duration-conditional-seconds", name: "条件时长 · 按秒渠道",
  parameters: [
    { key: "resolution", label: "视频分辨率", control: "select", default: "720p", options: [{ value: "720p", label: "720p" }, { value: "1080p", label: "1080p" }] },
    { key: "duration", label: "视频时长", control: "number", valueType: "integer", default: 5, min: 4, max: 30, step: 1,
      constraints: [{ when: [{ parameter: "resolution", values: ["1080p"] }], max: 12 }] },
  ],
  pricing: { kind: "tiered", currency: "CNY", billingUnit: "second", checkedAt, confidence: "exact", tiers: [
    { id: "720p", label: "720p", price: 0.2, dimension: "resolution", value: "720p" },
    { id: "1080p", label: "1080p", price: 0.4, dimension: "resolution", value: "1080p" },
  ] },
};
const discrete: ModelDescriptor = {
  ...continuous, id: "duration-discrete", name: "离散时长 · 5 或 10 秒",
  parameters: [{ key: "duration", label: "视频时长", control: "select", valueType: "integer", default: 5,
    options: [{ value: 5, label: "5 秒" }, { value: 10, label: "10 秒" }] }],
};
const fixedSelect: ModelDescriptor = {
  ...continuous, id: "duration-fixed-select", name: "固定时长 · 单一档位",
  parameters: [{ key: "duration", label: "视频时长", control: "select", valueType: "integer", default: 30, options: [{ value: 30, label: "30 秒" }] }],
};
const fixedSeconds: ModelDescriptor = {
  ...continuous, id: "duration-fixed-seconds", name: "固定时长 · seconds 原始参数",
  parameters: [{ key: "seconds", label: "视频时长", control: "number", valueType: "integer", default: 30, min: 30, max: 30, step: 1 }],
};
const unknownMaximum: ModelDescriptor = {
  ...continuous, id: "duration-unknown-maximum", name: "时长上限未公开",
  metadata: { canvasRunnable: true },
  parameters: [{ key: "duration", label: "视频时长", control: "number", valueType: "integer", min: 4, step: 1 }],
};
const legacyValue: ModelDescriptor = {
  ...continuous, id: "duration-saved-outside-range", name: "保留非法历史时长",
  metadata: { canvasRunnable: true },
};
const suggestedValues: ModelDescriptor = {
  ...unknownMaximum, id: "duration-suggested-values", name: "时长建议含自动哨兵",
  parameters: [{ key: "duration", label: "视频时长", control: "number", valueType: "integer", default: 5, min: 4, max: 30, step: 1,
    options: [{ value: -1, label: "自动" }, { value: 5, label: "5 秒" }] }],
};
const unverifiedMaximum: ModelDescriptor = {
  ...continuous, id: "duration-unverified-safety-maximum", name: "真实上限待确认 · 安全限制 30 秒",
  metadata: { canvasRunnable: true, durationRangeUnverified: true },
};
const referenceConditional: ModelDescriptor = {
  ...continuous, id: "duration-with-reference-video", name: "参考视频条件时长",
  metadata: { canvasRunnable: true, durationMaxWithReferenceVideo: 18 },
  parameters: [{ key: "duration", label: "视频时长", control: "number", valueType: "integer", default: 5, min: 4, max: 29, step: 1 }],
};
const jiasuUndocumented: ModelDescriptor = {
  ...remainingVideoModel("jiasu", "seedance2.5-全参真人", {
    id: "seedance2.5-全参真人", name: "seedance2.5-全参真人", operations: ["video.generate"],
    metadata: { canvasRunnable: true },
  }, { group: "vip" })!,
  pricing: { kind: "per-request", currency: "CNY", unitAmount: 1.1, checkedAt, confidence: "exact" },
};
const documentedDefaults: ModelDescriptor = {
  ...remainingVideoModel("jiasu", "jiasu-exact-default-fixture", {
    id: "jiasu-exact-default-fixture", name: "精确默认值隔离合同", operations: ["video.generate"],
    metadata: { jiasuCatalogRecord: { supportedEndpointTypes: ["openai-video"], apiParameters: [
      { name: "duration", default: "8" }, { name: "resolution", default: "1080p" },
    ] } },
  }, { group: "vip" })!,
  pricing: { kind: "per-request", currency: "CNY", unitAmount: 1.1, checkedAt, confidence: "exact" },
};
const manualDuration: ModelDescriptor = { ...continuous, id: "manual-free-duration", name: "手动配置自由时长",
  metadata: { source: "manual", canvasRunnable: true },
  parameters: [{ key: "duration", label: "视频时长", control: "number", valueType: "integer", default: 35, min: 1 }],
};
const nativeUnknown: ModelDescriptor = { ...remainingVideoModel("chentu", "grok--video1.0")!,
  pricing: { kind: "per-request", currency: "CNY", unitAmount: 1.1, checkedAt, confidence: "exact" },
};
const models = [continuous, conditional, discrete, fixedSelect, fixedSeconds, unknownMaximum, legacyValue, suggestedValues, unverifiedMaximum, referenceConditional, jiasuUndocumented, documentedDefaults, manualDuration, nativeUnknown];

test.beforeAll(() => {
  expect(process.env.PLAYWRIGHT_BASE_URL, "时长验收必须使用 globalSetup 的隔离数据库与 profile").toBeFalsy();
});

async function setup(page: Page, request: APIRequestContext, initial: ModelDescriptor, extraParameters: Record<string, unknown> = {}) {
  await page.setViewportSize({ width: 1440, height: 1080 });
  const errors: string[] = [];
  let submissions = 0, supplierRequests = 0;
  page.on("pageerror", error => errors.push(error.message));
  // The fixture has no upstream service. Deny every external browser request,
  // and refuse run submissions even if a control accidentally triggers one.
  await page.route("**/*", route => {
    const url = new URL(route.request().url());
    if (url.pathname.startsWith("/api/runs") && route.request().method() === "POST") {
      submissions++;
      return route.abort();
    }
    if (["http:", "https:"].includes(url.protocol) && !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) {
      if (url.origin === origin) supplierRequests++;
      return route.abort();
    }
    return route.continue();
  });
  await page.route(/\/api\/suppliers(?:\?.*)?$/u, route => route.fulfill({ json: [] }));
  const created = await request.post("/api/providers", { data: {
    name: "视频时长隔离供应商", provider: "rest", apiKey: "isolated-no-paid-generation",
    config: { baseUrl: origin, defaultModel: initial.id,
      connector: { ...structuredClone(CANGYUAN_IMAGE_CONNECTOR), models, restrictModels: true } },
  } });
  expect(created.ok()).toBeTruthy();
  const stored: ProviderConnectionView = await created.json();
  const connection: ProviderConnectionView = {
    ...stored, apiKey: "", apiKeySet: true, apiKeyUsable: true,
    config: { ...stored.config, supplierKey: "custom-video-duration-controls", supplierName: "时长验收供应商",
      usage: "canvas", modelGroup: "视频", accountKeyGroup: "视频", modelScanStatus: "live",
      modelCatalogModels: models, scannedModelIds: models.map(model => model.id) },
  };
  // POST /api/providers intentionally discards client-provided scan state;
  // represent an authoritative completed scan in the GET fixture instead.
  await page.route(/\/api\/providers(?:\?.*)?$/u, route => route.request().method() === "GET"
    ? route.fulfill({ json: [connection] }) : route.continue());
  await page.route(`**/api/providers/${connection.id}/models*`, route => route.fulfill({
    json: models, headers: { "X-Model-Scan-Status": "live", "X-Model-Scan-Complete": "true" },
  }));
  const parameters = { ...Object.fromEntries((initial.parameters ?? []).filter(parameter => parameter.default !== undefined)
    .map(parameter => [parameter.key, parameter.default])), ...extraParameters };
  const createdCanvas = await request.post("/api/canvas", { data: { title: "视频时长控件隔离验收", graph: {
    schemaVersion: 1, viewport: { x: 0, y: 0, zoom: 1 },
    nodes: [
      { id: "duration-prompt", type: "workflow", position: { x: 590, y: 60 },
        data: { nodeType: "prompt", label: "时长验收提示词", parts: [{ type: "text", text: "隔离参数检查" }],
          outputs: [{ id: "prompt", kind: "text", label: "提示词" }] } },
      { id: "duration-video", type: "workflow", position: { x: 90, y: 60 }, style: { width: 420, height: 180 },
        data: { nodeType: "video-generation", label, provider: "rest", connectionId: connection.id,
          model: initial.id, qualityMode: "custom", parameters, parts: [],
          inputs: [{ id: "prompt", kind: "text", label: "提示词" }], outputs: [{ id: "result", kind: "video", label: "视频" }] } },
    ],
    edges: [{ id: "duration-prompt-video", source: "duration-prompt", sourceHandle: "prompt",
      target: "duration-video", targetHandle: "prompt", type: "smoothstep" }],
  } } });
  expect(createdCanvas.ok()).toBeTruthy();
  const canvas: CanvasResponse = await createdCanvas.json();
  const saved = async (): Promise<CanvasResponse> => {
    const response = await request.get(`/api/canvas/${canvas.id}`);
    expect(response.ok()).toBeTruthy();
    return response.json();
  };
  const savedParameters = async () => (await saved()).graph.nodes.find(node => node.id === "duration-video")!.data.parameters;
  const geometry = (value: CanvasResponse) => ({
    nodes: value.graph.nodes.map(node => ({ id: node.id, position: node.position })), edges: value.graph.edges,
  });
  const baseline = geometry(canvas);
  const panel = page.getByRole("dialog", { name: `${label} 模型与参数`, exact: true });
  const picker = panel.getByRole("combobox", { name: `${label} 模型`, exact: true });
  const closeSidebar = async () => {
    const sidebar = page.getByRole("button", { name: "智能体面板", exact: true });
    if ((await sidebar.getAttribute("aria-expanded")) === "true") await sidebar.click();
    await expect(sidebar).toHaveAttribute("aria-expanded", "false");
  };
  const open = async () => {
    await page.getByRole("button", { name: `打开 ${label} 模型与参数`, exact: true }).click();
    await expect(panel).toBeVisible();
    await expect(picker).toContainText(initial.name);
    // Wait for actual canvas/model controls before closing the first-frame
    // desktop drawer; do the same after reload before shrinking the viewport.
    await closeSidebar();
  };
  await page.goto(`/canvas/${canvas.id}`);
  await open();
  const choose = async (model: ModelDescriptor) => {
    await picker.click();
    await panel.getByRole("option", { name: model.name, exact: true }).click();
    await expect(picker).toContainText(model.name);
  };
  const assertUnmoved = async () => expect(geometry(await saved())).toEqual(baseline);
  const safe = () => {
    expect({ submissions, supplierRequests }).toEqual({ submissions: 0, supplierRequests: 0 });
    expect(errors).toEqual([]);
  };
  return { panel, picker, choose, open, savedParameters, assertUnmoved, safe };
}

async function expectContained(control: Locator, width: number) {
  const dimensions = await control.evaluate(element => {
    const bounds = element.getBoundingClientRect();
    return { left: bounds.left, right: bounds.right, width: bounds.width, scroll: element.scrollWidth, client: element.clientWidth };
  });
  expect(dimensions.width).toBeGreaterThan(0);
  expect(dimensions.left).toBeGreaterThanOrEqual(-1);
  expect(dimensions.right).toBeLessThanOrEqual(width + 1);
  expect(dimensions.scroll).toBeLessThanOrEqual(dimensions.client + 1);
}

test("连续视频时长通过键盘和鼠标选择，按次费用不随秒数加价，保存刷新和窄窗均正确", async ({ page, request }, testInfo) => {
  const f = await setup(page, request, continuous);
  try {
    const slider = f.panel.getByRole("slider", { name: "视频时长", exact: true });
    const range = f.panel.locator(".parameter-duration-range");
    const price = f.panel.getByLabel("当前参数价格", { exact: true });
    await expect(slider).toHaveAttribute("type", "range");
    await expect(slider).toHaveClass(/parameter-duration-slider nodrag nopan/u);
    await expect(slider).toHaveAttribute("min", "4");
    await expect(slider).toHaveAttribute("max", "30");
    await expect(slider).toHaveAttribute("step", "1");
    await expect(slider).toHaveValue("5");
    await expect(slider).toHaveAttribute("aria-valuetext", "5 秒");
    await expect(range.locator("output")).toHaveText("5 秒");
    await expect(range.locator(".parameter-duration-bounds span")).toHaveText(["4 秒", "30 秒"]);
    await expect(price).toContainText("当前组合价格 5.5 CNY / 次");
    await expect(price).toContainText("本次预计费用 5.5 CNY");
    await slider.press("Home");
    await expect(slider).toHaveValue("4");
    await slider.press("ArrowRight");
    await expect(slider).toHaveValue("5");
    await slider.press("End");
    await expect(slider).toHaveValue("30");
    await slider.press("ArrowLeft");
    await expect(slider).toHaveValue("29");

    const bounds = await slider.boundingBox();
    expect(bounds).not.toBeNull();
    await slider.click({ position: { x: bounds!.width / 2, y: bounds!.height / 2 } });
    await expect(slider).toHaveValue("17");
    const centerY = bounds!.y + bounds!.height / 2;
    await page.mouse.move(bounds!.x + bounds!.width / 2, centerY);
    await page.mouse.down();
    await page.mouse.move(bounds!.x + bounds!.width / 4, centerY, { steps: 8 });
    await page.mouse.up();
    const mouseValue = Number(await slider.inputValue());
    expect(Number.isInteger(mouseValue)).toBe(true);
    expect(mouseValue).toBeGreaterThanOrEqual(4);
    expect(mouseValue).toBeLessThan(17);
    await expect(range.locator("output")).toHaveText(`${mouseValue} 秒`);
    await expect.poll(async () => (await f.savedParameters())?.duration).toBe(mouseValue);
    await expect(price).toContainText("本次预计费用 5.5 CNY");
    await f.assertUnmoved();

    await page.reload(); await f.open();
    await expect(slider).toHaveValue(String(mouseValue));
    await expect(slider).toHaveAttribute("aria-valuetext", `${mouseValue} 秒`);
    expect(typeof (await f.savedParameters())?.duration).toBe("number");
    await page.setViewportSize({ width: 620, height: 980 });
    await expectContained(f.panel, 620);
    await expectContained(f.panel.locator(".parameter-grid"), 620);
    await expectContained(range, 620);
    await expectContained(slider, 620);
    await slider.click({ trial: true });
    await f.assertUnmoved();
    await page.screenshot({ path: testInfo.outputPath("video-duration-continuous-narrow.png") });
  } finally { f.safe(); }
});

test("分辨率切换收紧滑条但保留旧秒数，明确修正后按秒费用保存恢复", async ({ page, request }, testInfo) => {
  const f = await setup(page, request, conditional);
  try {
    const slider = f.panel.getByRole("slider", { name: "视频时长", exact: true });
    const resolution = f.panel.getByLabel("视频分辨率", { exact: true });
    const price = f.panel.getByLabel("当前参数价格", { exact: true });
    await expect(slider).toHaveAttribute("max", "30");
    await expect(price).toContainText("本次预计费用 1 CNY");
    await slider.press("End");
    await expect(slider).toHaveValue("30");
    await expect(price).toContainText("当前组合价格 0.2 CNY / 秒");
    await expect(price).toContainText("本次预计费用 6 CNY");
    await resolution.selectOption("1080p");
    await expect(slider).toHaveAttribute("max", "12");
    await expect(slider).toHaveAttribute("aria-invalid", "true");
    await expect(f.panel.locator(".parameter-duration-saved")).toContainText("已保存的时长 30");
    await expect.poll(f.savedParameters).toEqual({ resolution: "1080p", duration: 30 });
    await expect(price).not.toContainText("本次预计费用");
    await slider.press("End");
    await expect(slider).toHaveValue("12");
    await expect(slider).toHaveAttribute("aria-valuetext", "12 秒");
    await expect(f.panel.locator(".parameter-duration-bounds span")).toHaveText(["4 秒", "12 秒"]);
    await expect(price).toContainText("当前组合价格 0.4 CNY / 秒");
    await expect(price).toContainText("本次预计费用 4.8 CNY");
    await slider.press("ArrowLeft");
    await expect(slider).toHaveValue("11");
    await expect(price).toContainText("本次预计费用 4.4 CNY");
    await expect.poll(f.savedParameters).toEqual({ resolution: "1080p", duration: 11 });
    await page.reload(); await f.open();
    await expect(resolution).toHaveValue("1080p");
    await expect(slider).toHaveValue("11");
    await expect(slider).toHaveAttribute("max", "12");
    await expect(price).toContainText("本次预计费用 4.4 CNY");
    await resolution.selectOption("720p");
    await expect(slider).toHaveAttribute("max", "30");
    await expect(slider).toHaveValue("11");
    await expect(price).toContainText("本次预计费用 2.2 CNY");
    await expect.poll(f.savedParameters).toEqual({ resolution: "720p", duration: 11 });
    await f.assertUnmoved();
    await f.panel.screenshot({ path: testInfo.outputPath("video-duration-conditional-price.png") });
  } finally { f.safe(); }
});

test("离散与固定时长只提供供应商下拉档位，并保存原始 seconds 参数键", async ({ page, request }, testInfo) => {
  const f = await setup(page, request, discrete);
  try {
    const duration = f.panel.getByLabel("视频时长", { exact: true });
    await expect(duration).toHaveJSProperty("tagName", "SELECT");
    expect(await duration.locator('option:not([value=""])').evaluateAll(options => options.map(option => (option as HTMLOptionElement).value)))
      .toEqual(["5", "10"]);
    await expect(f.panel.getByRole("slider")).toHaveCount(0);
    await duration.selectOption("10");
    await expect(duration).toHaveValue("10");
    await expect.poll(f.savedParameters).toEqual({ duration: 10 });

    await f.choose(fixedSelect);
    await expect(duration).toHaveJSProperty("tagName", "SELECT");
    await expect(duration).toHaveValue("30");
    await expect(duration.locator('option:not([value=""])')).toHaveText(["30 秒"]);
    await expect.poll(f.savedParameters).toEqual({ duration: 30 });

    await f.choose(fixedSeconds);
    await expect(duration).toHaveValue("30");
    await expect(duration).toHaveJSProperty("tagName", "SELECT");
    await expect(duration.locator('option:not([value=""])')).toHaveText(["30 秒"]);
    await expect(f.panel.getByRole("slider")).toHaveCount(0);
    await expect.poll(f.savedParameters).toEqual({ seconds: 30 });
    await f.assertUnmoved();
    await f.panel.screenshot({ path: testInfo.outputPath("video-duration-fixed-seconds.png") });
  } finally { f.safe(); }
});

test("未知上限、非法历史值与自动哨兵建议不伪造视频时长范围", async ({ page, request }, testInfo) => {
  const f = await setup(page, request, unknownMaximum, { duration: 45 });
  try {
    const duration = f.panel.getByLabel("视频时长", { exact: true });
    await expect(duration).toHaveJSProperty("tagName", "SELECT");
    await expect(duration).toHaveValue("45");
    await expect(duration).toHaveAttribute("aria-invalid", "true");
    await expect(duration).not.toHaveAttribute("max");
    await expect(f.panel.getByRole("slider")).toHaveCount(0);
    await expect(duration.locator('option:not([disabled])')).toHaveText(["供应商默认（未公开可选范围）"]);
    await expect.poll(f.savedParameters).toEqual({ duration: 45 });

    await f.choose(legacyValue);
    await expect(duration).toHaveAttribute("type", "range");
    await expect(duration).toHaveAttribute("max", "30");
    await expect(duration).toHaveAttribute("aria-invalid", "true");
    await expect(f.panel.locator(".parameter-duration-saved")).toContainText("已保存的时长 45");
    await expect(f.panel.getByRole("spinbutton")).toHaveCount(0);
    await expect.poll(f.savedParameters).toEqual({ duration: 45 });
    await f.panel.getByRole("button", { name: "使用 5 秒", exact: true }).click();
    await expect(f.panel.getByRole("slider", { name: "视频时长", exact: true })).toHaveValue("5");
    await f.choose(suggestedValues);
    await expect(duration).toHaveJSProperty("tagName", "SELECT");
    await expect(duration).toHaveValue("5");
    await expect(f.panel.getByRole("slider")).toHaveCount(0);
    await expect(duration.locator('option:not([disabled])')).toHaveText(["供应商默认（未公开可选范围）"]);
    await expect.poll(f.savedParameters).toEqual({ duration: 5 });
    await f.choose(unverifiedMaximum);
    await expect(duration).toHaveJSProperty("tagName", "SELECT");
    await expect(duration).toHaveValue("5");
    await expect(duration).not.toHaveAttribute("max");
    await expect(f.panel.getByRole("slider")).toHaveCount(0);
    await expect(f.panel.locator(".parameter-duration-bounds")).toHaveCount(0);
    await expect.poll(f.savedParameters).toEqual({ duration: 5 });
    await f.assertUnmoved();
    await f.panel.screenshot({ path: testInfo.outputPath("video-duration-no-guessed-range.png") });
  } finally { f.safe(); }
});

test("失效历史枚举保留并提示，下拉只允许当前供应商档位", async ({ page, request }) => {
  const f = await setup(page, request, discrete, { duration: 35 });
  try {
    const duration = f.panel.getByLabel("视频时长", { exact: true });
    await expect(duration).toHaveJSProperty("tagName", "SELECT");
    await expect(duration).toHaveValue("35");
    await expect(duration).toHaveAttribute("aria-invalid", "true");
    await expect(f.panel.getByText("已保留原时长 35，请选择供应商当前支持的档位。", { exact: true })).toBeVisible();
    expect(await duration.locator('option:not([disabled])').evaluateAll(options => options.map(option => (option as HTMLOptionElement).value))).toEqual(["", "5", "10"]);
    await expect.poll(f.savedParameters).toEqual({ duration: 35 });
    await duration.selectOption("10");
    await expect(duration).not.toHaveAttribute("aria-invalid", "true");
    await expect.poll(f.savedParameters).toEqual({ duration: 10 });
    await page.reload(); await f.open();
    await expect(duration).toHaveValue("10");
    await f.assertUnmoved();
  } finally { f.safe(); }
});

test("佳速 vip 全参真人保留旧38秒与720p，显式选择供应商默认后清除别名并恢复按次报价", async ({ page, request }, testInfo) => {
  const f = await setup(page, request, jiasuUndocumented, { duration: 38, seconds: 35, resolution: "720p" });
  try {
    const duration = f.panel.getByLabel(jiasuUndocumented.parameters!.find(parameter => parameter.key === "duration")!.label, { exact: true });
    const resolution = f.panel.getByLabel("输出分辨率", { exact: true });
    const price = f.panel.getByLabel("当前参数价格", { exact: true });
    for (const control of [duration, resolution]) {
      await expect(control).toHaveJSProperty("tagName", "SELECT");
      await expect(control).toHaveAttribute("aria-invalid", "true");
      await expect(control.locator('option:not([disabled])')).toHaveText(["供应商默认（未公开可选范围）"]);
    }
    await expect(duration).toHaveValue("38");
    await expect(resolution).toHaveValue("720p");
    await expect(f.panel.getByRole("spinbutton")).toHaveCount(0);
    await expect(f.panel.getByRole("slider")).toHaveCount(0);
    await expect(price).not.toContainText("本次预计费用");
    await expect.poll(f.savedParameters).toMatchObject({ duration: 38, seconds: 35, resolution: "720p" });
    await page.reload(); await f.open();
    await expect(duration).toHaveValue("38");
    await expect(resolution).toHaveValue("720p");
    await f.panel.screenshot({ path: testInfo.outputPath("jiasu-real-person-preserved-unconfirmed.png") });
    await resolution.evaluate(element => element.scrollIntoView({ block: "nearest" }));
    await expect(resolution).toBeInViewport({ ratio: 1 });
    await f.panel.screenshot({ path: testInfo.outputPath("jiasu-real-person-preserved-resolution.png") });
    await duration.selectOption("");
    await expect.poll(async () => {
      const saved = (await f.savedParameters())!;
      return { duration: saved.duration, seconds: saved.seconds, resolution: saved.resolution };
    }).toEqual({ duration: undefined, seconds: undefined, resolution: "720p" });
    await expect(price).not.toContainText("本次预计费用");
    await resolution.selectOption("");
    await expect.poll(async () => {
      const saved = (await f.savedParameters())!;
      return ["duration", "seconds", "resolution"].filter(key => key in saved);
    }).toEqual([]);
    await expect(price).toContainText("本次预计费用 1.1 CNY");
    await page.reload(); await f.open();
    await expect(duration).toHaveValue("");
    await expect(resolution).toHaveValue("");
    await expect(price).toContainText("本次预计费用 1.1 CNY");
    await f.assertUnmoved();
    await f.panel.screenshot({ path: testInfo.outputPath("jiasu-real-person-supplier-defaults.png") });
  } finally { f.safe(); }
});

test("精确声明默认值可下拉选择但不扩展未知范围，报价与保存一致", async ({ page, request }) => {
  const f = await setup(page, request, documentedDefaults, { duration: 38, resolution: "720p" });
  try {
    const duration = f.panel.getByLabel(documentedDefaults.parameters!.find(parameter => parameter.key === "duration")!.label, { exact: true });
    const resolution = f.panel.getByLabel("输出分辨率", { exact: true });
    const price = f.panel.getByLabel("当前参数价格", { exact: true });
    await expect(duration.locator('option:not([disabled])')).toHaveText(["供应商默认（未公开可选范围）", "8（已公布默认值）"]);
    await expect(resolution.locator('option:not([disabled])')).toHaveText(["供应商默认（未公开可选范围）", "1080p（已公布默认值）"]);
    await expect(f.panel.getByRole("slider")).toHaveCount(0);
    await expect(price).not.toContainText("本次预计费用");
    await duration.selectOption("8"); await resolution.selectOption("1080p");
    await expect(duration).not.toHaveAttribute("aria-invalid", "true");
    await expect(resolution).not.toHaveAttribute("aria-invalid", "true");
    await expect.poll(f.savedParameters).toMatchObject({ duration: 8, resolution: "1080p" });
    await expect(price).toContainText("本次预计费用 1.1 CNY");
    await page.reload(); await f.open();
    await expect(duration).toHaveValue("8"); await expect(resolution).toHaveValue("1080p");
    await expect(price).toContainText("本次预计费用 1.1 CNY");
    await f.assertUnmoved();
  } finally { f.safe(); }
});

test("明确手动配置的自由时长保留原控件和默认语义", async ({ page, request }) => {
  const f = await setup(page, request, manualDuration);
  try {
    const duration = f.panel.getByRole("spinbutton", { name: "视频时长", exact: true });
    await expect(duration).toHaveValue("35");
    await duration.fill("38");
    await expect.poll(f.savedParameters).toEqual({ duration: 38 });
    await page.reload(); await f.open();
    await expect(duration).toHaveValue("38");
    await f.assertUnmoved();
  } finally { f.safe(); }
});

test("其他供应商原生合同的seconds别名保留到用户明确选择默认", async ({ page, request }) => {
  const f = await setup(page, request, nativeUnknown, { seconds: 38, resolution: "720p" });
  try {
    const duration = f.panel.getByLabel("视频时长", { exact: true });
    await expect(duration).toHaveJSProperty("tagName", "SELECT");
    await expect(duration).toHaveValue("38");
    await expect(duration).toHaveAttribute("aria-invalid", "true");
    await expect.poll(f.savedParameters).toMatchObject({ seconds: 38, resolution: "720p" });
    await page.reload(); await f.open();
    await expect(duration).toHaveValue("38");
    await duration.selectOption("");
    await expect.poll(async () => {
      const saved = (await f.savedParameters())!;
      return ["duration", "seconds"].filter(key => key in saved);
    }).toEqual([]);
    await expect.poll(f.savedParameters).toHaveProperty("resolution", "720p");
    await f.assertUnmoved();
  } finally { f.safe(); }
});

for (const reference of [
  { name: "参考视频", maximum: 18, invalidSavedDuration: true, parameters: { reference_videos: [`${origin}/fixtures/reference.mp4`] } },
  { name: "仅参考图片和音频", maximum: 29, invalidSavedDuration: false, parameters: {
    reference_image_urls: [`${origin}/fixtures/reference.png`], reference_audios: [`${origin}/fixtures/reference.mp3`],
  } },
]) {
  test(`${reference.name}决定有效视频时长上限，保存刷新不删除原参考数组`, async ({ page, request }, testInfo) => {
    // Explicit reference parameters exercise the same effective contract as
    // linked video assets, without uploading or fetching any external media.
    const f = await setup(page, request, referenceConditional, {
      ...reference.parameters, ...(reference.invalidSavedDuration ? { duration: 29 } : {}),
    });
    try {
      const slider = f.panel.getByRole("slider", { name: "视频时长", exact: true });
      const price = f.panel.getByLabel("当前参数价格", { exact: true });
      if (reference.invalidSavedDuration) {
        const savedDuration = f.panel.getByLabel("视频时长", { exact: true });
        await expect(savedDuration).toHaveAttribute("type", "range");
        await expect(savedDuration).toHaveAttribute("max", "18");
        await expect(savedDuration).toHaveAttribute("aria-invalid", "true");
        await expect(f.panel.locator(".parameter-duration-saved")).toContainText("已保存的时长 29");
        await expect(f.panel.getByRole("alert")).toContainText("18");
        await expect(price).not.toContainText("本次预计费用");
        await expect.poll(f.savedParameters).toEqual({ duration: 29, ...reference.parameters });
        await f.panel.screenshot({ path: testInfo.outputPath("video-duration-reference-invalid-no-estimate.png") });
        await f.panel.getByRole("button", { name: "使用 5 秒", exact: true }).click();
        await expect(slider).toHaveAttribute("type", "range");
        await expect(f.panel.getByRole("alert")).toHaveCount(0);
      }
      await expect(slider).toHaveValue("5");
      await expect(price).toContainText("本次预计费用 5.5 CNY");
      await expect(slider).toHaveAttribute("min", "4");
      await expect(slider).toHaveAttribute("max", String(reference.maximum));
      await expect(f.panel.locator(".parameter-duration-bounds span")).toHaveText(["4 秒", `${reference.maximum} 秒`]);
      await slider.press("End");
      await expect(slider).toHaveValue(String(reference.maximum));
      await slider.press("ArrowLeft");
      const duration = reference.maximum - 1;
      await expect(slider).toHaveValue(String(duration));
      await expect(slider).toHaveAttribute("aria-valuetext", `${duration} 秒`);
      await expect.poll(f.savedParameters).toEqual({ duration, ...reference.parameters });
      expect(typeof (await f.savedParameters())?.duration).toBe("number");
      await page.reload(); await f.open();
      await expect(slider).toHaveValue(String(duration));
      await expect(slider).toHaveAttribute("max", String(reference.maximum));
      await expect.poll(f.savedParameters).toEqual({ duration, ...reference.parameters });
      await f.assertUnmoved();
      await f.panel.screenshot({ path: testInfo.outputPath(`video-duration-reference-max-${reference.maximum}.png`) });
    } finally { f.safe(); }
  });
}
