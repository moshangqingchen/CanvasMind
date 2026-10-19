import { idleCatalogCheckFixture } from "./helpers/catalog-check-fixture";
import { expect, test } from "@playwright/test";
import type { ModelDescriptor } from "@super-canvas/providers";
import type { ProviderConnectionView } from "../lib/client-api";

// These are the user's requested application presets, not measured supplier
// outputs. Keep the screenshot values independent of the preset implementation.
const screenshot4KPresets = [
  ["1:1", "2880x2880"],
  ["3:2", "3520x2336"],
  ["2:3", "2336x3520"],
  ["16:9", "3840x2160"],
  ["9:16", "2160x3840"],
  ["4:3", "3312x2480"],
  ["3:4", "2480x3312"],
  ["21:9", "3840x1648"],
  ["9:21", "1648x3840"],
] as const;

test("开放图片尺寸恢复自动、1K/2K/4K 和截图比例，宽高、保存、刷新与提交一致", async ({ page, request }, testInfo) => {
  test.setTimeout(90_000);
  expect(process.env.PLAYWRIGHT_BASE_URL, "尺寸预设回归只使用隔离测试数据库").toBeFalsy();
  await page.setViewportSize({ width: 1600, height: 1080 });
  const model: ModelDescriptor = {
    id: "gpt-image-2.5-flare", name: "Image 2.5 flare", operations: ["image.generate", "image.edit"],
    inputKinds: ["text", "image"], outputKinds: ["image"],
    metadata: { canvasRunnable: true, imageNativeParameterContract: true, imageOpenSizePreferences: true,
      imageSupportedResolutions: [], imageSizeContract: "weai-full-model-document-size", imageQualityEnumPublished: false },
    parameters: [
      { key: "aspect_ratio", label: "画面比例偏好", control: "text", valueType: "string", default: "auto" },
      { key: "size", label: "输出尺寸（size）", control: "dimensions", valueType: "string", default: "auto", step: 1,
        options: [{ value: "auto", label: "自动" }] },
      { key: "quality", label: "请求质量", control: "text", valueType: "string", default: "max", allowCustomValue: true,
        options: [{ value: "auto", label: "自动" }, { value: "max", label: "最高（应用偏好）" }] },
    ],
    pricing: { kind: "per-request", currency: "USD", unitAmount: 0.1, confidence: "exact", checkedAt: "2026-10-11" },
  };
  const created = await request.post("/api/providers", { data: {
    name: "隔离图片尺寸预设", provider: "openai",
    config: { baseUrl: "https://user-image-size-presets.invalid", defaultModel: model.id, usage: "canvas",
      modelScanStatus: "live", modelScanComplete: true, modelCatalogModels: [model], scannedModelIds: [model.id] },
  } });
  expect(created.ok()).toBeTruthy();
  const stored: ProviderConnectionView = await created.json();
  const connection: ProviderConnectionView = { ...stored, apiKey: "", apiKeySet: true, apiKeyUsable: true,
    config: { ...stored.config, baseUrl: "https://asian-acc.we-token.cc/v1", supplierKey: "weai", supplierName: "We-AI",
      accountKeyGroupId: "35", accountKeyGroup: "生图-openai-adobe-image2.5专属", modelGroup: "生图-openai-adobe-image2.5专属" } };
  const label = "图片尺寸预设验收";
  const canvasResponse = await request.post("/api/canvas", { data: { title: label, graph: {
    schemaVersion: 1, viewport: { x: 0, y: 0, zoom: 1 }, edges: [], nodes: [{
      id: "image-size-presets", type: "workflow", position: { x: 90, y: 60 }, style: { width: 420, height: 180 },
      data: { nodeType: "image-generation", label, provider: "openai", connectionId: connection.id, model: model.id,
        qualityMode: "custom", parameters: { size: "auto", aspect_ratio: "auto", quality: "max" },
        parts: [{ type: "text", text: "隔离参数提交验收，不请求供应商生成" }],
        inputs: [{ id: "prompt", kind: "text", label: "提示词" }], outputs: [{ id: "images", kind: "image", label: "图片" }] },
    }],
  } } });
  expect(canvasResponse.ok()).toBeTruthy();
  const canvas = await canvasResponse.json();
  const saved = async (): Promise<Record<string, unknown>> =>
    (await (await request.get(`/api/canvas/${canvas.id}`)).json()).graph.nodes
      .find((node: { id: string }) => node.id === "image-size-presets").data.parameters;
  let modelReads = 0, externalRequests = 0;
  const submissions: { body: unknown; parameters: Record<string, unknown> }[] = [];
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.route("**/*", async route => {
    const url = new URL(route.request().url());
    if (url.pathname.startsWith("/api/runs") && route.request().method() === "POST") {
      // The run API references the persisted graph. Capture that exact graph at
      // submission, then stop locally before any server/provider execution.
      submissions.push({ body: route.request().postDataJSON(), parameters: await saved() });
      return route.fulfill({ status: 400, json: { error: "隔离测试已捕获尺寸参数，未发起生成" } });
    }
    if (["http:", "https:"].includes(url.protocol) && !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)) {
      externalRequests++;
      return route.abort();
    }
    return route.continue();
  });
  await page.route(/\/api\/suppliers(?:\?.*)?$/u, route => route.fulfill({ json: [] }));
  await page.route("**/api/suppliers/catalog-upgrade*", route => route.fulfill({ json: idleCatalogCheckFixture() }));
  await page.route(/\/api\/providers(?:\?.*)?$/u, route => route.request().method() === "GET"
    ? route.fulfill({ json: [connection] }) : route.continue());
  await page.route(`**/api/providers/${connection.id}/models*`, route => {
    modelReads++;
    return route.fulfill({ json: [model], headers: { "X-Model-Scan-Status": "live", "X-Model-Scan-Complete": "true" } });
  });
  const panel = page.getByRole("dialog", { name: `${label} 模型与参数`, exact: true });
  const open = async () => {
    await page.getByRole("button", { name: `打开 ${label} 模型与参数`, exact: true }).click();
    await expect(panel).toBeVisible();
    const sidebar = page.getByRole("button", { name: "智能体面板", exact: true });
    if (await sidebar.getAttribute("aria-expanded") === "true") await sidebar.click();
  };
  try {
    await page.goto(`/canvas/${canvas.id}`);
    await open();
    const tiers = panel.getByRole("group", { name: "自动与输出分辨率快捷档位", exact: true });
    const size = panel.getByLabel("输出分辨率预设", { exact: true });
    const width = panel.getByLabel("图片宽度", { exact: true });
    const height = panel.getByLabel("图片高度", { exact: true });
    const quality = panel.getByLabel("质量", { exact: true });
    await expect(tiers.getByRole("button")).toHaveText(["自动", "1K", "2K", "4K"]);
    for (const tier of ["自动", "1K", "2K", "4K"])
      await expect(tiers.getByRole("button", { name: tier, exact: true })).toBeEnabled();
    await expect(width).toHaveJSProperty("readOnly", false);
    await expect(width).toHaveAttribute("step", "1");
    await expect(quality).toHaveValue("max");

    await tiers.getByRole("button", { name: "4K", exact: true }).click();
    for (const [ratio, pixels] of screenshot4KPresets) {
      const [w, h] = pixels.split("x");
      await expect(size.locator(`option[value="${pixels}"]`)).toContainText(`4K · ${ratio} · ${w} × ${h}`);
      await size.selectOption(pixels);
      await expect(width).toHaveValue(w!);
      await expect(height).toHaveValue(h!);
      await expect(tiers.getByRole("button", { name: "4K", exact: true })).toHaveAttribute("aria-pressed", "true");
      await expect.poll(saved).toMatchObject({ size: pixels, size_tier: "4K", quality: "max" });
    }
    await size.selectOption("3840x2160");
    await tiers.getByRole("button", { name: "2K", exact: true }).click();
    await expect(tiers.getByRole("button", { name: "2K", exact: true })).toHaveAttribute("aria-pressed", "true");
    await expect(size.locator("option:checked")).toContainText("2K · 16:9");
    await size.selectOption("2048x2048");
    await expect.poll(saved).toMatchObject({ size: "2048x2048", size_tier: "2K" });
    await tiers.getByRole("button", { name: "1K", exact: true }).click();
    await size.selectOption("1024x1024");
    await expect.poll(saved).toMatchObject({ size: "1024x1024", size_tier: "1K" });
    await tiers.getByRole("button", { name: "自动", exact: true }).click();
    await expect(size).toHaveValue("auto");
    await expect.poll(async () => ({ parameters: await saved() })).toMatchObject({ parameters: { size: "auto" } });
    expect((await saved()).size_tier).toBeUndefined();

    await tiers.getByRole("button", { name: "4K", exact: true }).click();
    await size.selectOption("3840x2160");
    await width.fill("3501");
    await height.fill("2301");
    await height.press("Tab");
    await expect.poll(saved).toMatchObject({ size: "3501x2301", quality: "max" });
    await expect(size).toHaveValue("");
    const customParameters = await saved();
    await page.reload();
    await open();
    await expect(width).toHaveValue("3501");
    await expect(height).toHaveValue("2301");
    expect(await saved()).toEqual(customParameters);

    await tiers.getByRole("button", { name: "4K", exact: true }).click();
    await size.selectOption("3840x2160");
    await expect.poll(saved).toMatchObject({ size: "3840x2160", size_tier: "4K", quality: "max" });
    const beforeRefresh = modelReads;
    await page.reload();
    await open();
    await expect.poll(() => modelReads).toBeGreaterThan(beforeRefresh);
    await expect(size).toHaveValue("3840x2160");
    await expect(width).toHaveValue("3840");
    await expect(height).toHaveValue("2160");
    await expect(tiers.getByRole("button", { name: "4K", exact: true })).toHaveAttribute("aria-pressed", "true");
    await expect(quality).toHaveValue("max");
    await panel.screenshot({ path: testInfo.outputPath("user-image-4k-size-presets.png") });
    await quality.scrollIntoViewIfNeeded();
    await panel.screenshot({ path: testInfo.outputPath("user-image-4k-quality-max.png") });

    const run = panel.getByRole("button", { name: `运行 ${label} 节点`, exact: true });
    await expect(run).toBeEnabled();
    await run.click();
    await expect.poll(() => submissions.length).toBe(1);
    expect(submissions[0]).toMatchObject({
      body: { canvasId: canvas.id, nodeId: "image-size-presets", scope: "node" },
      parameters: { size: "3840x2160", size_tier: "4K", quality: "max" },
    });
    expect({ externalRequests, errors }).toEqual({ externalRequests: 0, errors: [] });
  } finally {
    await request.delete(`/api/projects/${canvas.id}`);
    await request.delete(`/api/providers/${connection.id}`);
  }
});
