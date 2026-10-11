import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import type { ModelDescriptor } from "@super-canvas/providers";
import type { CanvasResponse, ProviderConnectionView } from "../lib/client-api";
import { CANGYUAN_IMAGE_CONNECTOR } from "../lib/provider-presets";

// Isolated fixtures verify common parameter preservation. They do not assert
// that the real suppliers share an enum, price or output capability.
test.beforeAll(() => {
  expect(process.env.PLAYWRIGHT_BASE_URL, "API示例参数验收必须使用隔离数据库和profile").toBeFalsy();
});

async function setup(page: Page, request: APIRequestContext, supplier: string) {
  const label = `${supplier} API示例参数验收`;
  const origin = "https://supplier-example-parameters.invalid";
  const example: ModelDescriptor = { id: `${supplier}-api-example-fixture`, name: `${supplier} API 示例合同`, operations: ["video.generate"],
    inputKinds: ["text"], outputKinds: ["video"], metadata: { supplier, canvasRunnable: true,
      durationRangeUnverified: true, resolutionRangeUnverified: true, videoResolutionAllowsCustom: true },
    parameters: [
      { key: "duration", label: "视频时长", control: "number", valueType: "integer", allowCustomValue: true, min: 1, step: 1,
        options: [{ value: 5, label: "5 秒（API 示例）" }] },
      { key: "resolution", label: "输出分辨率", control: "text", valueType: "string", allowCustomValue: true,
        options: [{ value: "720p", label: "720p（API 示例）" }] },
    ], pricing: { kind: "per-request", currency: "CNY", unitAmount: 1, checkedAt: "2026-10-10", confidence: "exact" } };
  let activeModels = [example], modelReads = 0, submissions = 0, externalRequests = 0;
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.setViewportSize({ width: 1440, height: 1080 });
  await page.route("**/*", route => {
    const url = new URL(route.request().url());
    if (url.pathname.startsWith("/api/runs") && route.request().method() === "POST") {
      submissions++; return route.abort();
    }
    if (["http:", "https:"].includes(url.protocol) && !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)) {
      externalRequests++; return route.abort();
    }
    return route.continue();
  });
  await page.route(/\/api\/suppliers(?:\?.*)?$/u, route => route.fulfill({ json: [] }));
  const created = await request.post("/api/providers", { data: { name: label, provider: "rest", apiKey: "isolated-no-generation-key",
    config: { baseUrl: origin, defaultModel: example.id,
      connector: { ...structuredClone(CANGYUAN_IMAGE_CONNECTOR), models: activeModels, restrictModels: true } } } });
  expect(created.ok()).toBe(true);
  const stored: ProviderConnectionView = await created.json();
  const connection: ProviderConnectionView = { ...stored, apiKey: "", apiKeySet: true, apiKeyUsable: true,
    config: { ...stored.config, supplierKey: `custom-${supplier}-example-fixture`, supplierName: label,
      usage: "canvas", modelGroup: "API 示例验收分组", accountKeyGroup: "API 示例验收分组", modelScanStatus: "live" } };
  await page.route(/\/api\/providers(?:\?.*)?$/u, route => route.request().method() === "GET"
    ? route.fulfill({ json: [{ ...connection, config: { ...connection.config,
      connector: { ...structuredClone(CANGYUAN_IMAGE_CONNECTOR), models: activeModels, restrictModels: true },
      modelCatalogModels: activeModels, scannedModelIds: activeModels.map(model => model.id) } }] }) : route.continue());
  await page.route(`**/api/providers/${connection.id}/models*`, route => {
    modelReads++;
    return route.fulfill({ json: activeModels, headers: { "X-Model-Scan-Status": "live", "X-Model-Scan-Complete": "true" } });
  });
  const initial = { duration: 5, resolution: "720p", materials: [{ type: "image", url: "https://example.invalid/reference.png", name: "保存的参考图" }] };
  const response = await request.post("/api/canvas", { data: { title: label, graph: {
    schemaVersion: 1, viewport: { x: 0, y: 0, zoom: 1 }, edges: [], nodes: [{ id: "example-video", type: "workflow",
      position: { x: 90, y: 60 }, style: { width: 420, height: 180 }, data: {
        nodeType: "video-generation", label, provider: "rest", connectionId: connection.id, model: example.id,
        qualityMode: "custom", parameters: initial, parts: [{ type: "text", text: "离线参数验收" }],
        inputs: [{ id: "prompt", kind: "text", label: "提示词" }], outputs: [{ id: "result", kind: "video", label: "视频" }],
      } }],
  } } });
  expect(response.ok()).toBe(true);
  const canvas: CanvasResponse = await response.json();
  const saved = async () => (await (await request.get(`/api/canvas/${canvas.id}`)).json()).graph.nodes[0].data.parameters;
  const panel = page.getByRole("dialog", { name: `${label} 模型与参数`, exact: true });
  const open = async () => {
    await page.getByRole("button", { name: `打开 ${label} 模型与参数`, exact: true }).click();
    await expect(panel).toBeVisible();
    const sidebar = page.getByRole("button", { name: "智能体面板", exact: true });
    if (await sidebar.getAttribute("aria-expanded") === "true") await sidebar.click();
    await expect(sidebar).toHaveAttribute("aria-expanded", "false");
  };
  await page.goto(`/canvas/${canvas.id}`);
  await open();
  return { panel, initial, saved, open, replaceModels: (models: ModelDescriptor[]) => { activeModels = models; }, example,
    reads: () => modelReads,
    safe: () => { expect({ submissions, externalRequests }).toEqual({ submissions: 0, externalRequests: 0 }); expect(errors).toEqual([]); } };
}

for (const supplier of ["jiasu", "secure", "chentu", "cangyuan"]) {
  test(`${supplier}: API examples remain suggestions and saved inputs survive refresh and reopen`, async ({ page, request }, testInfo) => {
    const f = await setup(page, request, supplier);
    const resolution = f.panel.getByRole("combobox", { name: "输出分辨率", exact: true });
    const duration = f.panel.getByRole("spinbutton", { name: "视频时长", exact: true });
    await expect(resolution).toHaveValue("720p");
    await expect(resolution).toHaveAttribute("list", /options$/u);
    await expect(f.panel).toContainText("API 示例：720p");
    await expect(f.panel).toContainText("API 示例：5");
    await resolution.fill("");
    await duration.fill("");
    await expect.poll(f.saved).toEqual({ materials: f.initial.materials });
    await resolution.fill("1440p");
    await duration.fill("38");
    const selected = { ...f.initial, resolution: "1440p", duration: 38 };
    await expect.poll(f.saved).toEqual(selected);
    await expect(f.panel).not.toContainText("选择供应商默认会清除当前自定义值");
    await page.reload();
    await f.open();
    await expect(resolution).toHaveValue("1440p");
    await expect(duration).toHaveValue("38");
    expect(await f.saved()).toEqual(selected);

    // A later directory may publish narrower legal values. Preserve the saved
    // request and expose its old values for correction; never silently downgrade.
    const before = f.reads();
    f.replaceModels([{ ...f.example, metadata: { ...f.example.metadata, durationRangeUnverified: false,
      resolutionRangeUnverified: false, videoResolutionAllowsCustom: false }, parameters: [
      { key: "duration", label: "视频时长", control: "number", valueType: "integer", min: 1, max: 30, step: 1, default: 5 },
      { key: "resolution", label: "输出分辨率", control: "select", valueType: "string", default: "720p", options: [{ value: "720p", label: "720p" }] },
    ] }]);
    await page.reload();
    await f.open();
    await expect.poll(f.reads).toBeGreaterThan(before);
    await expect(f.panel.getByRole("combobox", { name: "输出分辨率", exact: true })).toHaveValue("1440p");
    await expect(f.panel).toContainText("1440p（已保存）");
    await expect(f.panel).toContainText("38（已保存）");
    expect(await f.saved()).toEqual(selected);
    await page.reload();
    await f.open();
    expect(await f.saved()).toEqual(selected);
    await testInfo.attach("参数保留和目录范围", { body: await page.screenshot(), contentType: "image/png" });
    f.safe();
  });
}
