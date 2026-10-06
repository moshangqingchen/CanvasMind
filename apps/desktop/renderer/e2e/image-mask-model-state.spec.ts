import { expect, test } from "@playwright/test";
import sharp from "sharp";
import type { ModelDescriptor } from "@super-canvas/providers";
import type { ProviderConnectionView } from "../lib/client-api";
import { CANGYUAN_IMAGE_CONNECTOR } from "../lib/provider-presets";

test.beforeAll(() => {
  expect(process.env.PLAYWRIGHT_BASE_URL, "蒙版模型状态测试必须使用隔离数据目录").toBeFalsy();
});

test("沧元已保存蒙版型号：核对中、读取失败、恢复成功不混淆能力", async ({ page, request }, info) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const model: ModelDescriptor = { id: "gpt-image-2-1k", name: "GPT Image 2 · 1K", operations: ["image.generate", "image.edit"],
    inputKinds: ["text", "image[]"], outputKinds: ["image"], metadata: { canvasRunnable: true },
    parameters: [{ key: "quality", label: "质量", control: "select", default: "high", options: [{ value: "high", label: "高" }] }] };
  const storedResponse = await request.post("/api/providers", { data: {
    name: "沧元蒙版模型状态隔离验收", provider: "rest", apiKey: "isolated-no-paid-generation",
    config: { baseUrl: "https://mask-model-state.invalid", defaultModel: model.id,
      connector: { ...structuredClone(CANGYUAN_IMAGE_CONNECTOR), models: [model] } },
  } });
  expect(storedResponse.ok()).toBeTruthy();
  const stored = await storedResponse.json();
  const connection: ProviderConnectionView = { ...stored, apiKey: "", apiKeySet: true, apiKeyUsable: true,
    config: { supplierId: "isolated-mask-state-supplier", supplierKey: "cangyuan", supplierName: "沧元状态验收", usage: "canvas",
      baseUrl: "https://ai.cangyuansuanli.cn/", modelGroup: "IMAGE", accountKeyGroup: "IMAGE", defaultModel: model.id,
      connector: { ...structuredClone(CANGYUAN_IMAGE_CONNECTOR), models: [model] },
      modelScanStatus: "live", modelCatalogModels: [model], scannedModelIds: [model.id] } };
  let phase: "pending" | "failed" | "ready" = "pending";
  let releasePending: () => void = () => {};
  const pending = new Promise<void>(resolve => { releasePending = resolve; });
  let reads = 0, submissions = 0, upstream = 0;
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.route(/https:\/\/(?:[^/]*cangyuansuanli\.cn|mask-model-state\.invalid)\//, route => { upstream++; return route.abort(); });
  await page.route(/\/api\/runs(?:\?.*)?$/, route => {
    if (route.request().method() === "POST") { submissions++; return route.abort(); }
    return route.continue();
  });
  await page.route(/\/api\/suppliers(?:\?.*)?$/, route => route.fulfill({ json: [] }));
  await page.route(/\/api\/providers(?:\?.*)?$/, route => route.fulfill({ json: [connection] }));
  await page.route(`**/api/providers/${connection.id}/models*`, async route => {
    reads++;
    if (phase === "pending") await pending;
    if (phase === "failed") return route.fulfill({ status: 500, json: { error: "隔离测试：模型列表暂时不可用" } });
    return route.fulfill({ json: [model], headers: { "X-Model-Scan-Status": "live" } });
  });
  await page.route("**/api/providers/*/availability*", route => route.fulfill({ json: {
    items: [], ready: true, enabled: true, source: "live", checkedAt: new Date().toISOString(),
  } }));
  const bytes = await sharp({ create: { width: 128, height: 128, channels: 4, background: "#698bce" } }).png().toBuffer();
  const sourceUpload = await request.post("/api/assets/upload?name=mask-state-original.png", { headers: { "content-type": "image/png" }, data: bytes });
  const maskUpload = await request.post("/api/assets/upload?name=mask-state-mask.png", { headers: { "content-type": "image/png" }, data: bytes });
  expect(sourceUpload.status()).toBe(201); expect(maskUpload.status()).toBe(201);
  const source = await sourceUpload.json(), mask = await maskUpload.json();
  const projectResponse = await request.post("/api/canvas", { data: { title: "蒙版模型状态隔离", graph: {
    schemaVersion: 1, viewport: { x: 0, y: 0, zoom: 1 }, edges: [{ id: "source-edit", source: "source", sourceHandle: "asset", target: "edit", targetHandle: "references" }],
    nodes: [{ id: "source", type: "workflow", position: { x: 60, y: 90 }, style: { width: 240, height: 230 },
      data: { nodeType: "asset-input", label: "原图", assetId: source.id, assetKind: "image", outputs: [{ id: "asset", kind: "image", label: "图片" }] } },
    { id: "edit", type: "workflow", position: { x: 380, y: 90 }, style: { width: 300, height: 210 },
      data: { nodeType: "image-generation", label: "局部重绘", provider: "rest", connectionId: connection.id, model: model.id,
        parts: [{ type: "text", text: "" }], parameters: { quality: "high", maskAssetId: mask.id, maskSourceAssetId: source.id },
        inputs: [{ id: "prompt", kind: "text", label: "修改要求" }, { id: "references", kind: "image[]", label: "原图", multiple: true }],
        outputs: [{ id: "images", kind: "image", label: "图片" }] } }],
  } } });
  expect(projectResponse.ok()).toBeTruthy();
  const project = await projectResponse.json();
  const edit = page.locator('.react-flow__node[data-id="edit"]');
  const prompt = edit.getByRole("textbox", { name: "编辑 局部重绘 提示词", exact: true });
  const run = edit.getByRole("button", { name: "运行 局部重绘 节点", exact: true });
  try {
    await page.goto(`/canvas/${project.id}`);
    await edit.locator(".node-head").click();
    await expect.poll(() => reads).toBeGreaterThan(0);
    await expect(edit.getByText("正在核对模型能力…", { exact: true })).toBeVisible();
    await expect(edit.getByText("当前模型不支持蒙版，请更换模型", { exact: true })).toHaveCount(0);
    await expect(run).toBeDisabled();
    await expect(prompt).toHaveAttribute("data-placeholder", /描述涂抹区域/);
    await prompt.fill("仅修改涂抹区域");
    await prompt.press("Control+Enter"); await prompt.press("Control+Shift+Enter");
    await edit.screenshot({ path: info.outputPath("mask-model-loading.png") });

    phase = "failed"; releasePending();
    await expect(edit.getByText("模型列表读取失败，请重试", { exact: true })).toBeVisible();
    await expect(edit.getByText("当前模型不支持蒙版，请更换模型", { exact: true })).toHaveCount(0);
    await expect(run).toBeDisabled();
    await prompt.press("Control+Enter"); await prompt.press("Control+Shift+Enter");
    await edit.getByRole("button", { name: "选择可编辑模型", exact: true }).click();
    await expect(page.getByRole("dialog", { name: "局部重绘 模型与参数", exact: true })).toBeVisible();
    await page.keyboard.press("Escape");
    await edit.screenshot({ path: info.outputPath("mask-model-failed.png") });

    phase = "ready";
    await page.reload();
    await edit.locator(".node-head").click();
    await expect(edit.getByText("已设置局部修改区域", { exact: true })).toBeVisible();
    await expect(run).toBeEnabled();
    await expect(edit.getByText("当前模型不支持蒙版，请更换模型", { exact: true })).toHaveCount(0);
    await expect(prompt).toContainText("仅修改涂抹区域");
    await edit.screenshot({ path: info.outputPath("mask-model-recovered.png") });
    const saved = (await (await request.get(`/api/canvas/${project.id}`)).json()).graph.nodes.find((node: { id: string }) => node.id === "edit");
    expect(saved.data.model).toBe(model.id);
    expect(saved.data.parameters).toMatchObject({ maskAssetId: mask.id, maskSourceAssetId: source.id });
    expect(submissions).toBe(0); expect(upstream).toBe(0); expect(errors).toEqual([]);
  } finally { releasePending(); }
});
