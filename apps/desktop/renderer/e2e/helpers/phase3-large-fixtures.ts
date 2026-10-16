import { test, type Page } from "@playwright/test";
import type { ModelDescriptor } from "@super-canvas/providers";
import type { AssetView, CanvasDocument, RunSnapshot } from "../../components/types";
import type { ProjectFileItem } from "../../components/project-files-modal";
import type { AgentSession } from "../../lib/agent-contracts";
import type { AgentModelOption } from "../../lib/agent-models";
import type { ProviderConnectionView } from "../../lib/client-api";
import type { SupplierRecord } from "../../lib/client-suppliers";

/** Fixed UI data only. Optional screenshot thumbnails never run in the default performance fixture. */
export const PHASE3_COUNTS = { assets: 1050, runs: 500, groups: 304, models: 1900, messages: 240 };
const now = "2026-10-14T12:00:00.000Z";
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");

export async function installPhase3LargeFixture(page: Page, options: { imageParameters?: boolean } = {}) {
  const visual = process.env.UI_PHASE3_VISUAL_ASSET_DIR
    ? await (await import("./phase3-visual-assets")).loadPhase3VisualAssets(process.env.UI_PHASE3_VISUAL_ASSET_DIR)
    : undefined;
  if (visual) await test.info().attach("phase3-visual-thumbnail-sources", {
    body: Buffer.from(JSON.stringify(visual.evidence, null, 2)), contentType: "application/json",
  });
  const canvasId = "phase3-isolated-ui";
  const errors: string[] = [], warnings: string[] = [], unexpected: string[] = [], prohibited: string[] = [], mockedAutomatic: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => {
    if (["error", "warning"].includes(message.type())) warnings.push(`${message.type()}: ${message.text()}`);
  });
  const assets: AssetView[] = Array.from({ length: PHASE3_COUNTS.assets }, (_, index) => ({
    id: `phase3-image-${index}`, name: `创作成果 ${String(index + 1).padStart(4, "0")} · 城市光影与自然材质.png`,
    kind: "image", mimeType: "image/png", size: png.length, storageKey: "phase3-ui-only.png",
    createdAt: new Date(Date.parse(now) - index * 60_000).toISOString(),
    metadata: { runId: `phase3-run-${index % PHASE3_COUNTS.runs}`, width: 1, height: 1,
      imageDesignReview: { revision: 1, status: index % 3 === 0 ? "approved" : "unreviewed", note: index % 3 === 0 ? "构图与留白已确认。" : "" } },
  }));
  if (visual) for (const [index, asset] of assets.entries()) {
    const { preview } = visual.previews[index % visual.previews.length]!.evidence;
    asset.size = preview.bytes;
    asset.storageKey = `phase3-visual-thumbnail-${index % visual.previews.length}.png`;
    asset.metadata = { ...asset.metadata, width: preview.width, height: preview.height, imageFormat: "png", imagePages: 1,
      imageHasAlpha: preview.hasAlpha, imageHasTransparentPixels: preview.hasTransparentPixels, imageHasVisiblePixels: preview.hasVisiblePixels,
      fixtureThumbnail: visual.previews[index % visual.previews.length]!.evidence };
  }
  const assetPositions = visual ? new Map(assets.map((asset, index) => [asset.id, index])) : undefined;
  const assetBytes = (id?: string) => {
    const index = id === undefined ? undefined : assetPositions?.get(id);
    return visual && index !== undefined ? visual.previews[index % visual.previews.length]!.bytes : png;
  };
  const models: ModelDescriptor[] = Array.from({ length: PHASE3_COUNTS.models }, (_, index) => ({
    id: `phase3-image-model-${String(index).padStart(4, "0")}`, name: `图像创作型号 ${index + 1}`,
    operations: ["image.generate"], inputKinds: ["text", "image"], outputKinds: ["image"],
    metadata: { priceLabel: "¥0.20 / 张（隔离夹具）", canvasRunnable: true },
    parameters: [{ key: "n", label: "张数", control: "number", valueType: "number", default: 1, min: 1, max: 4 }],
  }));
  // Separate visual-controls variant: the large-list baseline above remains unchanged.
  if (options.imageParameters) models[0] = {
    id: "gpt-image-2.5-flare", name: "Image 2.5 flare", operations: ["image.generate", "image.edit"],
    inputKinds: ["text", "image"], outputKinds: ["image"],
    metadata: { canvasRunnable: true, imageNativeParameterContract: true, imageOpenSizePreferences: true,
      imageSupportedResolutions: [], imageSizeContract: "weai-full-model-document-size", imageQualityEnumPublished: false },
    parameters: [
      { key: "aspect_ratio", label: "画面比例偏好", control: "text", valueType: "string", default: "auto" },
      { key: "size", label: "输出尺寸（size）", control: "dimensions", valueType: "string", default: "auto", step: 1, options: [{ value: "auto", label: "自动" }] },
      { key: "quality", label: "请求质量", control: "text", valueType: "string", default: "max", allowCustomValue: true,
        options: [{ value: "auto", label: "自动" }, { value: "max", label: "最高（应用偏好）" }] },
    ],
    pricing: { kind: "per-request", currency: "USD", unitAmount: .1, confidence: "exact", checkedAt: "2026-10-14" },
  };
  const groups = Array.from({ length: PHASE3_COUNTS.groups }, (_, index) => {
    // One large catalog exercises the table as well as the long group list.
    const mainGroupCount = models.length - PHASE3_COUNTS.groups + 1;
    const start = index === 0 ? 0 : mainGroupCount + index - 1;
    const end = index === 0 ? mainGroupCount : start + 1;
    return { id: `group-${String(index + 1).padStart(3, "0")}`, label: `创作分组 ${index + 1}`, source: "catalog" as const,
      models: models.slice(start, end).map(model => ({ id: model.id, name: model.name, capability: "image" as const })),
      details: { source: "key-groups" as const, rateMultiplier: 1, description: "隔离 UI 规模夹具。此目录不代表任何真实供应商。" } };
  });
  const supplier: SupplierRecord = { id: "phase3-supplier", supplierKey: "phase3-supplier", name: "创作服务 · 隔离目录",
    kind: "openai-compatible", siteUrl: "https://phase3-ui.invalid", apiUrl: "https://phase3-ui.invalid/v1",
    catalog: { groups }, scanStatus: "live", scannedAt: now, scanLastSuccessAt: now, createdAt: now, updatedAt: now };
  const connections: ProviderConnectionView[] = groups.map(group => ({
    id: `phase3-connection-${group.id}`, name: `${group.label} · 展示连接`, provider: "openai", apiKey: "", apiKeySet: true, apiKeyUsable: true,
    config: { supplierId: supplier.id, supplierKey: supplier.supplierKey, baseUrl: supplier.apiUrl, modelGroup: group.id, usage: "canvas",
      defaultModel: group.models[0]!.id, modelCatalogModels: models.filter(model => group.models.some(item => item.id === model.id)),
      scannedModelIds: group.models.map(model => model.id), modelScanStatus: "live", modelScanComplete: true, modelScanCheckedAt: now,
      modelScanLastSuccessAt: now },
  }));
  const graph: CanvasDocument = { schemaVersion: 1, viewport: { x: 70, y: 60, zoom: .8 }, nodes: [
    { id: "phase3-prompt", type: "workflow", position: { x: 100, y: 120 }, style: { width: 300, height: 240 },
      data: { nodeType: "prompt", label: "画面构思", parts: [{ type: "text", text: "晨光照亮安静的城市街角。保留自然材质与清晰的文字层级。" }],
        inputs: [{ id: "in", label: "输入", kind: "text" }], outputs: [{ id: "prompt", label: "提示词", kind: "text" }] } },
    { id: "phase3-generator", type: "workflow", position: { x: 540, y: 120 }, style: { width: 300, height: 240 },
      data: { nodeType: "image-generation", label: "主视觉生成", provider: "fake", model: "fake-image-v1", parts: [], parameters: { n: 1 },
        inputs: [{ id: "prompt", kind: "text", label: "提示词" }], outputs: [{ id: "images", kind: "image", label: "图片" }] } },
  ], edges: [{ id: "phase3-edge", source: "phase3-prompt", sourceHandle: "prompt", target: "phase3-generator", targetHandle: "prompt" }] };
  if (options.imageParameters) Object.assign(graph.nodes[1]!.data, {
    label: "完整图片参数", provider: "openai", connectionId: connections[0]!.id, model: models[0]!.id, qualityMode: "custom",
    parameters: { size: "3840x2160", size_tier: "4K", aspect_ratio: "16:9", quality: "max" },
    parts: [{ type: "text", text: "仅展示完整图片控件，不提交生成。" }],
  });
  const canvas = { id: canvasId, title: "工作室全屏精修 · 隔离基准", revision: 1, graph };
  const project = { id: canvasId, title: canvas.title, createdAt: now, updatedAt: now, nodeCount: graph.nodes.length,
    thumbnailAssetId: assets[0]!.id };
  const runs: RunSnapshot[] = Array.from({ length: PHASE3_COUNTS.runs }, (_, index) => {
    const status = index < 8 ? "running" : index % 7 === 0 ? "failed" : "succeeded";
    const createdAt = new Date(Date.parse(now) - index * 90_000).toISOString();
    return { run: { id: `phase3-run-${index}`, canvasId, scope: "node", nodeId: `historical-node-${index}`, status,
      createdAt, updatedAt: new Date(Date.parse(createdAt) + 42_000).toISOString(), canResume: false },
      nodes: [{ id: `phase3-node-run-${index}`, nodeId: `historical-node-${index}`, status,
        updatedAt: new Date(Date.parse(createdAt) + 42_000).toISOString(), outputAssetIds: status === "succeeded" ? [assets[index]!.id] : [],
        request: { provider: "fake", supplier: "隔离 Fake", model: "fake-image-v1", modelGroup: "展示组", operation: "image.generate" },
        ...(status === "failed" ? { errorJson: { message: "隔离示例：读取生成结果时连接中断，请查看原任务详情。", code: "FAKE_UI_FIXTURE", source: "provider_response" as const } } : {}) }] };
  });
  const agentModel: AgentModelOption = { supplierId: supplier.id, supplierName: supplier.name, group: "创作组", connectionId: "phase3-agent-connection",
    connectionName: "隔离对话连接", modelId: "phase3-chat", modelName: "创作对话模型", protocol: "openai-chat-completions", source: "manual", available: true,
    capabilities: { text: true, imageInput: true, audioInput: false, videoInput: false, structuredOutput: false, toolCalling: false, nativeWebSearch: false, reasoning: false },
    reasoningOptions: [{ value: "auto", label: "自动" }], inputLimits: { maxImages: 4 } };
  const session: AgentSession = { id: "phase3-long-conversation", canvasId, title: "城市主视觉讨论", plans: [],
    messages: Array.from({ length: PHASE3_COUNTS.messages }, (_, index) => ({ id: `phase3-message-${index}`, role: index % 2 ? "assistant" : "user", createdAt: now,
      metadata: {}, content: index % 2 ? `第 ${index + 1} 条方案建议：以内容为中心，保留清晰的主体与自然光。\n\n标题、正文和操作分成三个层级，控制色彩数量，让设计在不同尺寸下保持易读。${index % 9 === 0 ? '\n\n```css\n.card { padding: 16px; border-radius: 10px; }\n```' : ""}` : `第 ${index + 1} 条创作要求：检查画面的留白、对齐与文字层级。` })) };
  const files: ProjectFileItem[] = assets.slice(0, 80).map((asset, index) => ({ fileId: `phase3-file-${index}`, name: asset.name,
    section: index < 40 ? "finished" : "draft", kind: "image", mimeType: "image/png", canDelete: true, subfolder: "图片", size: asset.size, modifiedAt: now,
    contentUrl: `/api/projects/${canvasId}/files/content?fileId=phase3-file-${index}`,
    previewUrl: `/api/projects/${canvasId}/files/content?fileId=phase3-file-${index}&preview=640` }));

  await page.addInitScript(({ canvasId, sessionId }) => {
    try { localStorage.setItem(`agent-task:${canvasId}`, sessionId); } catch { /* Isolated preference only. */ }
    const opens: Array<() => void> = [];
    Object.assign(window, { phase3OpenUpdate: () => opens.forEach(open => open()), phase3UpdateReady: () => opens.length > 0,
      superCanvasDesktop: {
        getUpdate: async () => ({ desktop: true, formatVersion: 1, enabled: true, managerAvailable: true, repository: "fixture/fixture", intervalSeconds: 21600,
          currentVersion: "0.2.100", updatedAt: "2026-10-14T12:00:00Z", phase: "idle", currentNotes: "## 工作室体验\n- 统一间距、对齐与交互反馈\n- 保留完整参数与用户内容" }),
        update: async () => { throw new Error("Phase3 screenshot fixture never installs or downloads an update"); },
        onUpdate: () => () => {}, onOpenUpdate: (fn: () => void) => { opens.push(fn); return () => { opens.splice(opens.indexOf(fn), 1); }; },
        onPrepareExit: () => () => {}, onDraining: () => () => {}, completePrepareExit: () => {}, cancelExit: async () => {},
      } });
  }, { canvasId, sessionId: session.id });
  await page.route("**/*", route => {
    const url = new URL(route.request().url());
    if (["http:", "https:"].includes(url.protocol) && !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)) {
      prohibited.push(`external ${url.origin}`); return route.abort();
    }
    return route.continue();
  });
  await page.route("**/api/**", async route => {
    const request = route.request(), url = new URL(request.url()), path = url.pathname, method = request.method();
    if (path === "/api/suppliers/catalog-upgrade") {
      mockedAutomatic.push(`${method} ${path}`);
      return route.fulfill({ json: { phase: "complete", updatedConnectionIds: [] } });
    }
    if (method !== "GET" && path !== `/api/canvas/${canvasId}`) {
      prohibited.push(`${method} ${path}`); return route.fulfill({ status: 403, json: { error: "隔离视觉夹具禁止业务写入" } });
    }
    if (path === "/api/projects") return route.fulfill({ json: { projects: [project] } });
    if (path === `/api/canvas/${canvasId}`) {
      if (method === "PUT") { canvas.graph = request.postDataJSON().graph; canvas.revision++; }
      return route.fulfill({ json: canvas });
    }
    if (path === "/api/assets") return route.fulfill({ json: assets });
    if (/\/api\/assets\/[^/]+\/(?:content|preview)$/u.test(path)) return route.fulfill({ contentType: "image/png", body: assetBytes(path.split("/")[3]) });
    if (/\/api\/assets\/[^/]+$/u.test(path)) return route.fulfill({ json: assets.find(asset => path.endsWith(asset.id)) });
    if (path === `/api/projects/${canvasId}/results`) return route.fulfill({ json: assets.map(asset => ({ assetId: asset.id, canvasId,
      runId: asset.metadata.runId, nodeId: asset.id, label: asset.name, instruction: "隔离视觉展示，不提交生成。", requirements: "" })) });
    if (path === `/api/projects/${canvasId}/files`) return route.fulfill({ json: { files, ignoredFiles: 0 } });
    if (path === `/api/projects/${canvasId}/files/content`) {
      const fileIndex = Number(url.searchParams.get("fileId")?.match(/^phase3-file-(\d+)$/u)?.[1]);
      return route.fulfill({ contentType: "image/png", body: assetBytes(assets[fileIndex]?.id) });
    }
    if (path === `/api/projects/${canvasId}/chat`) return route.fulfill({ json: { messages: [] } });
    if (path === "/api/providers") return route.fulfill({ json: connections });
    if (/\/api\/providers\/[^/]+\/models$/u.test(path)) return route.fulfill({ json: connections.find(connection => path.includes(connection.id))?.config.modelCatalogModels ?? [],
      headers: { "X-Model-Scan-Status": "live", "X-Model-Scan-Complete": "true" } });
    if (path === "/api/suppliers") return route.fulfill({ json: [supplier] });
    if (path.endsWith("/verification")) return route.fulfill({ json: null });
    if (path === "/api/runs") return route.fulfill({ json: url.searchParams.has("runIds") || url.searchParams.has("clientRequestIds") ? [] : runs });
    if (/\/api\/runs\/[^/]+\/events$/u.test(path)) return route.fulfill({ contentType: "text/event-stream", body: ": fixture\n\n" });
    if (/\/api\/runs\/[^/]+$/u.test(path)) return route.fulfill({ json: runs.find(item => path.endsWith(item.run.id)) });
    if (path === "/api/agent/models") return route.fulfill({ json: [agentModel] });
    if (path === "/api/agent/sessions") return route.fulfill({ json: [{ id: session.id, title: session.title }] });
    if (path === `/api/agent/sessions/${session.id}`) return route.fulfill({ json: session });
    if (path === "/api/integrations/material-drops") return route.fulfill({ json: [] });
    unexpected.push(`${method} ${path}`);
    return route.fulfill({ status: 404, json: { error: `Missing phase3 UI fixture: ${method} ${path}` } });
  });
  return { canvasId, canvas, assets, runs, supplier, session, errors, warnings, unexpected, prohibited, mockedAutomatic,
    visualFixture: visual?.evidence };
}
