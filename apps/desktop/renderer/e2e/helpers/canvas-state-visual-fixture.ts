import { expect, type APIRequestContext } from "@playwright/test";
import sharp from "sharp";
import type { ModelDescriptor } from "@super-canvas/providers";
import type { CanvasDocument } from "../../components/types";
import type { ProviderConnectionView } from "../../lib/client-api";

/** Existing 12-node/Fake visual fixture; default bytes and data remain unchanged. */
export async function createCanvasStateVisualFixture(request: APIRequestContext, imageBuffer?: Buffer) {
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
    // Synthetic fixture quote, not a claim about any real supplier's price.
    pricing: { kind: "per-request", currency: "USD", unitAmount: 0.1, confidence: "exact", checkedAt: "2026-10-14" },
  };
  const models = Array.from({ length: 12 }, (_, i) => ({ ...model, ...(i ? { id: `gpt-image-2.5-flare-variant-${i}`, name: `图像创作型号 ${i}` } : {}) }));
  const storedResponse = await request.post("/api/providers", { data: { name: "隔离图片控件展示", provider: "openai",
    config: { baseUrl: "https://phase2-ui.invalid", defaultModel: model.id, usage: "canvas", modelScanStatus: "live",
      modelScanComplete: true, modelCatalogModels: models, scannedModelIds: models.map(item => item.id) } } });
  expect(storedResponse.ok()).toBeTruthy();
  const stored: ProviderConnectionView = await storedResponse.json();
  const connection: ProviderConnectionView = { ...stored, apiKey: "", apiKeySet: true, apiKeyUsable: true };
  const fakeResponse = await request.post("/api/providers", { data: { name: "本地 Fake 状态展示", provider: "fake", apiKey: "fixture-only",
    config: { usage: "canvas", defaultModel: "fake-image-v1" } } });
  expect(fakeResponse.ok()).toBeTruthy();
  const fake: ProviderConnectionView = await fakeResponse.json();
  const buffer = imageBuffer ?? await sharp({ create: { width: 1200, height: 900, channels: 3, background: { r: 43, g: 95, b: 133 } } }).png().toBuffer();
  const imageResponse = await request.post("/api/assets/upload", { multipart: { file: { name: "phase2-synthetic-fixture.png", mimeType: "image/png", buffer } } });
  expect(imageResponse.ok()).toBeTruthy();
  const asset = await imageResponse.json();
  const graph: CanvasDocument = { schemaVersion: 1, viewport: { x: 0, y: 0, zoom: 1 }, nodes: [], edges: [] };
  const prompt = (id: string, label: string, x: number, y: number) => ({ id, type: "workflow" as const, position: { x, y }, style: { width: 300, height: 220 },
    data: { nodeType: "prompt", label, parts: [{ type: "text" as const, text: "晨光穿过树林，镜头缓慢推进。此画布仅展示隔离测试状态。" }],
      inputs: [{ id: "in", kind: "text", label: "输入" }], outputs: [{ id: "prompt", kind: "text", label: "提示词" }] } });
  graph.nodes.push(prompt("prompt", "镜头与画面", 60, 60), prompt("caption", "标题文案", 1110, 660));
  const runId = "phase2-mixed-status-fixture";
  const createdAt = new Date(Date.now() - 42_000).toISOString();
  const statuses = ["queued", "running", "succeeded", "failed"] as const;
  const labels = ["排队", "运行", "完成", "失败"];
  const positions = [[410, 60, 760, 60], [60, 360, 410, 360], [760, 360, 1110, 360], [60, 660, 410, 660]];
  for (let i = 0; i < statuses.length; i++) {
    const status = statuses[i], [x, y, rx, ry] = positions[i]!;
    graph.nodes.push({ id: `source-${status}`, type: "workflow", position: { x: x!, y: y! }, style: { width: 300, height: 220 },
      data: { nodeType: "image-generation", label: `${labels[i]} · 本地生成`, provider: "fake", connectionId: fake.id, model: "fake-image-v1", parameters: { n: 1 }, parts: [],
        inputs: [{ id: "prompt", kind: "text", label: "提示词" }, { id: "references", kind: "image[]", label: "参考图", multiple: true }],
        outputs: [{ id: "images", kind: "image", label: "图片" }] } });
    graph.nodes.push({ id: `result-${status}`, type: "workflow", position: { x: rx!, y: ry! }, style: { width: 300, height: 225 },
      data: { nodeType: "asset-input", label: `${labels[i]} · 图片结果`, assetKind: "image", ...(status === "succeeded" ? { assetId: asset.id } : {}),
        generatedResult: true, generatedStatus: status, generatedFromNodeId: `source-${status}`, generatedFromRunId: runId, generatedOutputIndex: 0,
        generatedProvider: "fake", generatedModel: "fake-image-v1", generatedCreatedAt: createdAt, generatedParameters: { n: 1 }, mediaAspectRatio: 4 / 3,
        ...(status === "failed" ? { generatedError: { message: "隔离示例：模拟生成失败，可查看原因", code: "FAKE_VISUAL_FIXTURE", source: "provider_response" as const } } : {}),
        inputs: [], outputs: [{ id: "image", kind: "image", label: "图片" }] } });
    graph.edges.push({ id: `result-edge-${status}`, source: `source-${status}`, sourceHandle: "images", target: `result-${status}` });
  }
  graph.nodes.push({ id: "parameters", type: "workflow", position: { x: 760, y: 660 }, style: { width: 300, height: 250 },
    data: { nodeType: "image-generation", label: "完整图片参数", provider: "openai", connectionId: connection.id, model: model.id, qualityMode: "custom",
      parameters: { size: "3840x2160", size_tier: "4K", aspect_ratio: "16:9", quality: "max" }, parts: [{ type: "text", text: "仅展示参数，不提交生成。" }],
      inputs: [{ id: "prompt", kind: "text", label: "提示词" }, { id: "references", kind: "image[]", label: "参考图", multiple: true }], outputs: [{ id: "images", kind: "image", label: "图片" }] } });
  graph.nodes.push({ id: "asset", type: "workflow", position: { x: 1110, y: 60 }, style: { width: 240, height: 180 },
    data: { nodeType: "asset-input", label: "参考素材", assetId: asset.id, assetKind: "image", mediaAspectRatio: 4 / 3, inputs: [], outputs: [{ id: "image", kind: "image", label: "图片" }] } });
  graph.edges.push({ id: "prompt-queued", source: "prompt", sourceHandle: "prompt", target: "source-queued", targetHandle: "prompt" });
  const response = await request.post("/api/canvas", { data: { title: "工作室状态与控件 · 隔离视觉基准", graph } });
  expect(response.ok()).toBeTruthy();
  const canvas = await response.json();
  const snapshot = { run: { id: runId, canvasId: canvas.id, scope: "canvas", status: "running", createdAt },
    nodes: statuses.map(status => ({ id: `fixture-run-${status}`, nodeId: `source-${status}`, status, createdAt,
      outputAssetIds: status === "succeeded" ? [asset.id] : [],
      ...(status === "failed" ? { errorJson: { message: "隔离示例：模拟生成失败，可查看原因", code: "FAKE_VISUAL_FIXTURE" } } : {}) })) };
  return { graph, canvas, connection, fake, models, snapshot, asset };
}

