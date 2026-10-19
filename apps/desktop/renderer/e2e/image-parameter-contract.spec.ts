import { idleCatalogCheckFixture } from "./helpers/catalog-check-fixture";
import { expect, test } from "@playwright/test";
import type { ModelDescriptor } from "@super-canvas/providers";
import { userImageSizeOptions } from "@super-canvas/providers/image-size-presets";
import { chooseParameterOption, expectParameterValue, openParameterDetails, readParameterOptions } from "./helpers/parameter-controls";

test("统一图片合同保留完整面板，4K 16:9 max 保存重载且没有上游请求", async ({ page, request }, testInfo) => {
  // global-setup creates an ephemeral database and isolated storage. Never attach
  // this mutation test to an installed application or a user's existing server.
  expect(process.env.PLAYWRIGHT_BASE_URL).toBeFalsy();
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 1440, height: 1080 });
  const modelId = "gpt-image-2.5-flare";
  const model: ModelDescriptor = {
    id: modelId, name: modelId, operations: ["image.generate", "image.edit"],
    parameters: [{ key: "quality", label: "质量（quality）", control: "text", valueType: "string" }],
    metadata: { mikotoImageContract: true, imageQualityEnumPublished: false, supplierPriceGroupId: "39" },
    pricing: { kind: "per-image", currency: "USD", unitAmount: 0.12,
      checkedAt: "2026-10-11T04:48:27.246Z", sourceUrl: "https://quotes.invalid/mikoto-fixture", confidence: "exact" },
  };
  const created = await request.post("/api/providers", { data: {
    name: "隔离图片合同参数验收", provider: "openai",
    config: { baseUrl: "https://image-contract.invalid", defaultModel: modelId, usage: "canvas",
      modelScanStatus: "live", modelScanComplete: true, modelCatalogModels: [model], scannedModelIds: [modelId] },
  } });
  expect(created.ok()).toBeTruthy();
  const stored = await created.json();
  // Only the browser's intercepted read sees this real contract identity. The
  // isolated backend has no supplier credential and retains the .invalid URL.
  const connection = { ...stored, apiKey: "", apiKeySet: true, apiKeyUsable: true, config: { ...stored.config,
    baseUrl: "https://api.mikoto.vip/v1", supplierKey: "mikoto", supplierName: "MikotoPro",
    accountKeyGroupId: "39", accountKeyGroup: "生图（2k4k 高质量）" } };
  let submissions = 0;
  const upstreamRequests: string[] = [];
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.route(/^https?:\/\//u, route => {
    const url = new URL(route.request().url());
    if (url.hostname === "127.0.0.1" || url.hostname === "localhost") return route.continue();
    upstreamRequests.push(url.origin);
    return route.abort();
  });
  await page.route(/\/api\/runs(?:\?.*)?$/u, route => {
    if (route.request().method() === "POST") { submissions++; return route.abort(); }
    return route.continue();
  });
  await page.route(/\/api\/suppliers(?:\?.*)?$/u, route => route.fulfill({ json: [] }));
  await page.route("**/api/suppliers/catalog-upgrade*", route => route.fulfill({ json: idleCatalogCheckFixture() }));
  await page.route(/\/api\/providers(?:\?.*)?$/u, route => route.request().method() === "GET"
    ? route.fulfill({ json: [connection] }) : route.continue());
  await page.route(`**/api/providers/${connection.id}/models*`, route => route.fulfill({ json: [model],
    headers: { "X-Model-Scan-Status": "live", "X-Model-Scan-Complete": "true" } }));
  const response = await request.post("/api/canvas", { data: {
    title: "图片规则统一 · 参数面板隔离验收", graph: {
      schemaVersion: 1, viewport: { x: 0, y: 0, zoom: 1 }, edges: [], nodes: [{
        id: "contract-image", type: "workflow", position: { x: 80, y: 60 }, style: { width: 420, height: 180 },
        data: { nodeType: "image-generation", label: "图片合同验收", provider: "openai", connectionId: connection.id,
          model: modelId, qualityMode: "custom", parameters: { size: "2720x1536", size_tier: "2K", aspect_ratio: "16:9", quality: "low" },
          parts: [{ type: "text", text: "仅验证参数与保存，不提交图片生成。" }],
          inputs: [{ id: "prompt", kind: "text", label: "提示词" }], outputs: [{ id: "images", kind: "image", label: "图片" }] },
      }],
    },
  } });
  expect(response.ok()).toBeTruthy();
  const canvas = await response.json();
  const saved = async () => (await (await request.get(`/api/canvas/${canvas.id}`)).json()).graph.nodes[0].data.parameters;
  const open = () => page.getByRole("button", { name: "打开 图片合同验收 模型与参数", exact: true }).click();
  await page.goto(`/canvas/${canvas.id}`);
  await open();
  const panel = page.getByRole("dialog", { name: "图片合同验收 模型与参数", exact: true });
  const tiers = panel.getByRole("group", { name: "自动与输出分辨率快捷档位", exact: true });
  const preset = panel.getByRole("combobox", { name: "输出分辨率预设", exact: true });
  const width = panel.getByLabel("图片宽度", { exact: true });
  const height = panel.getByLabel("图片高度", { exact: true });
  const quality = panel.getByLabel("质量", { exact: true });
  await openParameterDetails(panel, "自定义宽高");
  await openParameterDetails(panel, "高级设置");
  await expect(tiers).toHaveCount(1);
  // This exact official group declares 2K/4K. Do not invent a 1K option simply
  // to make the screenshot resemble another supplier's panel.
  await expect(tiers.getByRole("button")).toHaveText(["自动", "2K", "4K"]);
  await expect(width).toHaveCount(1);
  await expect(height).toHaveCount(1);
  await expect(width).toHaveJSProperty("readOnly", false);
  await expect(height).toHaveJSProperty("readOnly", false);
  await expect(panel.getByRole("group", { name: "生成模式", exact: true })).toBeVisible();
  await expectParameterValue(quality, "low");
  await tiers.getByRole("button", { name: "4K", exact: true }).click();
  await chooseParameterOption(preset, "3840x2160");
  await chooseParameterOption(quality, "max");
  const expected = { size: "3840x2160", size_tier: "4K", aspect_ratio: "16:9", quality: "max" };
  await expect.poll(saved).toMatchObject(expected);
  await page.reload();
  await open();
  await expect(tiers.getByRole("button", { name: "4K", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expectParameterValue(preset, "3840x2160");
  await expect(preset).toContainText("16:9");
  await expect(preset).toContainText("4K · 3840 × 2160");
  await openParameterDetails(panel, "自定义宽高");
  await openParameterDetails(panel, "高级设置");
  await expect(width).toHaveValue("3840");
  await expect(height).toHaveValue("2160");
  await expectParameterValue(quality, "max");
  await expect(panel.getByLabel("当前参数价格", { exact: true })).toContainText("0.12 USD");
  const fullScreenshot = testInfo.outputPath("image-parameter-contract-4k-max-panel.png");
  await panel.screenshot({ path: fullScreenshot });
  await testInfo.attach("4K 16:9 max 参数面板", { path: fullScreenshot, contentType: "image/png" });

  // Explicit independent W/H and a lower quality remain the user's choice
  // after the resolver is called again during reload and model refresh.
  await width.fill("3501");
  await height.fill("2301");
  await height.press("Tab");
  await chooseParameterOption(quality, "low");
  await expect.poll(saved).toMatchObject({ size: "3501x2301", size_tier: "4K", quality: "low" });
  await expect.poll(async () => (await saved()).aspect_ratio).toBeUndefined();
  await page.reload();
  await open();
  await openParameterDetails(panel, "自定义宽高");
  await expect(width).toHaveValue("3501");
  await expect(height).toHaveValue("2301");
  await expectParameterValue(quality, "low");
  await expect(tiers.getByRole("button", { name: "4K", exact: true })).toHaveAttribute("aria-pressed", "true");
  const explicitScreenshot = testInfo.outputPath("image-parameter-contract-custom-values-restored.png");
  await panel.screenshot({ path: explicitScreenshot });
  await testInfo.attach("自定义宽高与显式质量恢复", { path: explicitScreenshot, contentType: "image/png" });
  expect({ submissions, upstreamRequests, errors }).toEqual({ submissions: 0, upstreamRequests: [], errors: [] });
});

test("离线手工合同完整控件预览：自动1K2K4K、宽高、max、返回格式与透明模式", async ({ page, request }, testInfo) => {
  expect(process.env.PLAYWRIGHT_BASE_URL).toBeFalsy();
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 1440, height: 1080 });
  const modelId = "gpt-image-2.5-flare";
  // This explicitly manual schema demonstrates existing controls, not the
  // declared capabilities or output pixels of any actual supplier/group.
  const model: ModelDescriptor = {
    id: modelId, name: "离线示例 · 完整图片参数", operations: ["image.generate", "image.edit"],
    metadata: { source: "manual", canvasRunnable: true, imageNativeParameterContract: true,
      imageUserSizePresets: "offline-layout-fixture", imageResolutionTierParameter: "size_tier",
      imageParameterContractNote: "离线手工示例：仅展示现有控件布局，不代表任何供应商能力或生成结果。" },
    parameters: [
      { key: "size", label: "比例与尺寸（W × H）", control: "dimensions", valueType: "string",
        default: "auto", step: 16, allowCustomValue: true, options: userImageSizeOptions(["1K", "2K", "4K"]) },
      { key: "quality", label: "质量", control: "select", valueType: "string", default: "max",
        options: [
          { value: "auto", label: "自动" }, { value: "low", label: "低" }, { value: "medium", label: "中" },
          { value: "high", label: "高" }, { value: "xhigh", label: "超高" }, { value: "max", label: "最高（max）" },
        ] },
      { key: "response_format", label: "返回格式", control: "select", valueType: "string", default: "url",
        options: [{ value: "url", label: "图片链接（url）" }, { value: "b64_json", label: "Base64（b64_json）" }] },
      { key: "background", label: "背景", control: "select", valueType: "string", default: "opaque",
        options: [{ value: "opaque", label: "普通" }, { value: "transparent", label: "透明" }] },
    ],
  };
  const created = await request.post("/api/providers", { data: {
    name: "离线手工布局示例", provider: "openai", config: {
      baseUrl: "https://manual-panel-preview.invalid/v1", usage: "canvas", manualProtocol: true,
      defaultModel: modelId, modelScanStatus: "live", modelScanComplete: true,
      modelCatalogModels: [model], scannedModelIds: [modelId],
    },
  } });
  expect(created.ok()).toBeTruthy();
  const stored = await created.json();
  // Transparency has an exact-origin capability gate independent of descriptors.
  // This intercepted, offline read borrows an existing supported route solely to
  // exercise that button. Manual schema guards retain the explicitly synthetic
  // controls; the backend remains credential-free with the .invalid URL above.
  const connection = { ...stored, apiKey: "", apiKeySet: true, apiKeyUsable: true, config: { ...stored.config,
    baseUrl: "https://genimage.pro/v1", accountKeyGroup: "default", modelGroup: "default",
    supplierKey: "offline-panel-preview", supplierName: "离线手工布局示例", manualProtocol: true } };
  let submissions = 0;
  const upstreamRequests: string[] = [];
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.route(/^https?:\/\//u, route => {
    const url = new URL(route.request().url());
    if (url.hostname === "127.0.0.1" || url.hostname === "localhost") return route.continue();
    upstreamRequests.push(url.origin);
    return route.abort();
  });
  await page.route(/\/api\/runs(?:\?.*)?$/u, route => {
    if (route.request().method() === "POST") { submissions++; return route.abort(); }
    return route.continue();
  });
  await page.route(/\/api\/suppliers(?:\?.*)?$/u, route => route.fulfill({ json: [] }));
  await page.route("**/api/suppliers/catalog-upgrade*", route => route.fulfill({ json: idleCatalogCheckFixture() }));
  await page.route(/\/api\/providers(?:\?.*)?$/u, route => route.request().method() === "GET"
    ? route.fulfill({ json: [connection] }) : route.continue());
  await page.route(`**/api/providers/${connection.id}/models*`, route => route.fulfill({ json: [model],
    headers: { "X-Model-Scan-Status": "live", "X-Model-Scan-Complete": "true" } }));
  const initial = { size: "3840x2160", size_tier: "4K", aspect_ratio: "16:9", quality: "max", response_format: "url", background: "opaque" };
  const response = await request.post("/api/canvas", { data: {
    title: "离线手工示例 · 完整图片参数布局", graph: {
      schemaVersion: 1, viewport: { x: 0, y: 0, zoom: 1 }, edges: [], nodes: [{
        id: "manual-panel-preview", type: "workflow", position: { x: 80, y: 60 }, style: { width: 420, height: 180 },
        data: { nodeType: "image-generation", label: "离线完整控件示例", provider: "openai", connectionId: connection.id,
          model: modelId, qualityMode: "custom", parameters: initial,
          parts: [{ type: "text", text: "离线手工示例：只验证控件布局与保存，不调用供应商，不生成图片。" }],
          inputs: [{ id: "prompt", kind: "text", label: "提示词" }], outputs: [{ id: "images", kind: "image", label: "图片" }] },
      }],
    },
  } });
  expect(response.ok()).toBeTruthy();
  const canvas = await response.json();
  const saved = async () => (await (await request.get(`/api/canvas/${canvas.id}`)).json()).graph.nodes[0].data.parameters;
  const open = () => page.getByRole("button", { name: "打开 离线完整控件示例 模型与参数", exact: true }).click();
  await page.goto(`/canvas/${canvas.id}`);
  await open();
  const panel = page.getByRole("dialog", { name: "离线完整控件示例 模型与参数", exact: true });
  const tiers = panel.getByRole("group", { name: "自动与输出分辨率快捷档位", exact: true });
  const preset = panel.getByRole("combobox", { name: "输出分辨率预设", exact: true });
  const quality = panel.getByLabel("质量", { exact: true });
  const responseFormat = panel.getByLabel("返回格式", { exact: true });
  const modes = panel.getByRole("group", { name: "生成模式", exact: true });
  await openParameterDetails(panel, "自定义宽高");
  await openParameterDetails(panel, "高级设置");
  await expect(tiers.getByRole("button")).toHaveText(["自动", "1K", "2K", "4K"]);
  await expectParameterValue(preset, "3840x2160");
  await expect(preset).toContainText("16:9");
  await expect(preset).toContainText("4K · 3840 × 2160");
  await expect(panel.getByLabel("图片宽度", { exact: true })).toHaveValue("3840");
  await expect(panel.getByLabel("图片高度", { exact: true })).toHaveValue("2160");
  await expect(panel.getByLabel("图片宽度", { exact: true })).toHaveJSProperty("readOnly", false);
  await expect(panel.getByLabel("图片高度", { exact: true })).toHaveJSProperty("readOnly", false);
  await expectParameterValue(quality, "max");
  await expect(modes.getByRole("button")).toHaveText(["普通模式", "透明模式"]);
  expect((await readParameterOptions(responseFormat)).map(option => option.value).filter(Boolean))
    .toEqual(["url", "b64_json"]);
  await chooseParameterOption(responseFormat, "b64_json");
  await modes.getByRole("button", { name: "透明模式", exact: true }).click();
  await expect.poll(saved).toMatchObject({ ...initial, response_format: "b64_json", background: "transparent", output_format: "png" });
  await page.reload();
  await open();
  await openParameterDetails(panel, "高级设置");
  await expectParameterValue(responseFormat, "b64_json");
  await expect(modes.getByRole("button", { name: "透明模式", exact: true })).toHaveAttribute("aria-pressed", "true");
  await modes.getByRole("button", { name: "普通模式", exact: true }).click();
  await chooseParameterOption(responseFormat, "url");
  await expect.poll(saved).toMatchObject(initial);
  await expect(tiers.getByRole("button", { name: "4K", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expectParameterValue(quality, "max");
  await expect(modes.getByRole("button", { name: "普通模式", exact: true })).toHaveAttribute("aria-pressed", "true");
  const previewPath = testInfo.outputPath("image-parameter-contract-panel-preview.png");
  await panel.screenshot({ path: previewPath });
  await testInfo.attach("离线手工示例 · 完整图片参数布局（不代表供应商能力）", { path: previewPath, contentType: "image/png" });
  expect({ submissions, upstreamRequests, errors }).toEqual({ submissions: 0, upstreamRequests: [], errors: [] });
});
