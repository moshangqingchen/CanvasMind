import { readFile } from "node:fs/promises";
import {
  expect,
  test,
  type APIRequestContext,
  type Locator,
  type Page,
  type Route,
} from "@playwright/test";
import {
  CANGYUAN_BACKUP_IMAGE_GROUP,
  CANGYUAN_IMAGE_CONNECTOR,
  cangyuanImageConnectorForGroup,
} from "../lib/provider-presets";
import { applyMonsterImageCapabilities } from "@super-canvas/providers/monster-image-capabilities";

const REFERENCE_ASSET_NAME = "e2e reference asset.png";
const PNG_1X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

type JsonRecord = Record<string, unknown>;

interface CanvasResponse {
  id: string;
  title: string;
  revision: number;
  graph: {
    schemaVersion: number;
    nodes: Array<{
      id: string;
      type: string;
      position: { x: number; y: number };
      width?: number;
      height?: number;
      measured?: { width?: number; height?: number };
      style?: JsonRecord;
      data: JsonRecord;
    }>;
    edges: Array<JsonRecord>;
    viewport?: { x: number; y: number; zoom: number };
    drawings?: Array<{ id: string; color: string; width: number; points: Array<{ x: number; y: number }> }>;
  };
}

type CanvasGraphNode = CanvasResponse["graph"]["nodes"][number];

interface AssetResponse {
  id: string;
  name: string;
  kind: "image" | "video" | "text";
  metadata: JsonRecord;
}

interface ProviderConnectionResponse {
  id: string;
  name: string;
  provider: string;
  config: JsonRecord;
}

interface RunResponse {
  run: { id: string; status: string };
  nodes: Array<{
    nodeId: string;
    status: string;
    outputAssetIds: string[];
  }>;
}

function generatedResultsFor(
  canvas: CanvasResponse,
  sourceNodeId: string,
  runId?: string,
): CanvasGraphNode[] {
  return canvas.graph.nodes
    .filter(
      (node) =>
        node.data.generatedResult === true &&
        node.data.generatedFromNodeId === sourceNodeId &&
        (runId === undefined || node.data.generatedFromRunId === runId),
    )
    .sort(
      (left, right) =>
        Number(left.data.generatedOutputIndex) -
        Number(right.data.generatedOutputIndex),
    );
}

function generatedResultEdgesFor(
  canvas: CanvasResponse,
  sourceNodeId: string,
  targetNodeIds?: readonly string[],
): JsonRecord[] {
  const targets = targetNodeIds ? new Set(targetNodeIds) : undefined;
  return canvas.graph.edges.filter(
    (edge) =>
      edge.source === sourceNodeId &&
      (targets === undefined || targets.has(String(edge.target))),
  );
}

function persistedStyleAspectRatio(node: CanvasGraphNode): number {
  const width = Number.parseFloat(String(node.style?.width ?? ""));
  const height = Number.parseFloat(String(node.style?.height ?? ""));
  expect(width).toBeGreaterThan(0);
  expect(height).toBeGreaterThan(0);
  return width / height;
}

function workflowGraph(): CanvasResponse["graph"] {
  return {
    schemaVersion: 1,
    nodes: [
      {
        id: "e2e-prompt",
        type: "workflow",
        position: { x: 30, y: 150 },
        data: {
          nodeType: "prompt",
          label: "E2E Prompt",
          parts: [{ type: "text", text: "电影感的未来城市" }],
          outputs: [{ id: "prompt", kind: "text", label: "提示词" }],
        },
      },
      {
        id: "e2e-image",
        type: "workflow",
        position: { x: 295, y: 135 },
        data: {
          nodeType: "image-generation",
          label: "E2E 图片生成",
          provider: "fake",
          connectionId: "fake-default",
          model: "fake-image-v1",
          inputs: [
            {
              id: "prompt",
              kind: "text",
              label: "Prompt",
              required: true,
            },
            {
              id: "references",
              kind: "image[]",
              label: "参考图",
              multiple: true,
            },
          ],
          outputs: [{ id: "images", kind: "image", label: "图片" }],
          parameters: { size: "1024x1024", quality: "auto" },
        },
      },
      {
        id: "e2e-video",
        type: "workflow",
        position: { x: 560, y: 135 },
        data: {
          nodeType: "video-generation",
          label: "E2E 视频生成",
          provider: "fake",
          connectionId: "fake-default",
          model: "fake-video-v1",
          inputs: [
            { id: "prompt", kind: "text", label: "Prompt" },
            { id: "firstFrame", kind: "image", label: "首帧" },
          ],
          outputs: [{ id: "video", kind: "video", label: "视频" }],
          parameters: { duration: 5, ratio: "1280:720" },
        },
      },
      {
        id: "e2e-preview",
        type: "workflow",
        position: { x: 825, y: 150 },
        data: {
          nodeType: "preview",
          label: "E2E 结果预览",
          inputs: [
            { id: "image", kind: "image", label: "图片" },
            { id: "video", kind: "video", label: "视频" },
          ],
        },
      },
    ],
    edges: [
      {
        id: "e2e-prompt-image",
        source: "e2e-prompt",
        sourceHandle: "prompt",
        target: "e2e-image",
        targetHandle: "prompt",
        type: "smoothstep",
      },
      {
        id: "e2e-prompt-video",
        source: "e2e-prompt",
        sourceHandle: "prompt",
        target: "e2e-video",
        targetHandle: "prompt",
        type: "smoothstep",
      },
      {
        id: "e2e-image-video",
        source: "e2e-image",
        sourceHandle: "images",
        target: "e2e-video",
        targetHandle: "firstFrame",
        type: "smoothstep",
      },
      {
        id: "e2e-video-preview",
        source: "e2e-video",
        sourceHandle: "video",
        target: "e2e-preview",
        targetHandle: "video",
        type: "smoothstep",
      },
    ],
    viewport: { x: 8, y: 35, zoom: 0.72 },
  };
}

function resultAspectGraph(): CanvasResponse["graph"] {
  return {
    schemaVersion: 1,
    nodes: [
      {
        id: "e2e-aspect-image",
        type: "workflow",
        position: { x: 80, y: 130 },
        style: { width: 360, height: 390 },
        data: {
          nodeType: "image-generation",
          label: "竖版比例图片",
          provider: "fake",
          connectionId: "fake-default",
          model: "fake-image-v1",
          parts: [{ type: "text", text: "竖版电影海报" }],
          inputs: [
            { id: "prompt", kind: "text", label: "Prompt" },
            {
              id: "references",
              kind: "image[]",
              label: "参考图",
              multiple: true,
            },
          ],
          outputs: [{ id: "images", kind: "image", label: "图片" }],
          parameters: { aspect_ratio: "9:16", quality: "auto", n: 1 },
        },
      },
      {
        id: "e2e-aspect-video",
        type: "workflow",
        position: { x: 560, y: 130 },
        style: { width: 360, height: 390 },
        data: {
          nodeType: "video-generation",
          label: "竖版比例视频",
          provider: "fake",
          connectionId: "fake-default",
          model: "fake-video-v1",
          parts: [{ type: "text", text: "镜头沿竖版街道向前推进" }],
          inputs: [
            { id: "prompt", kind: "text", label: "Prompt" },
            { id: "firstFrame", kind: "image", label: "首帧" },
          ],
          outputs: [{ id: "video", kind: "video", label: "视频" }],
          parameters: { duration: 5, ratio: "720:1280" },
        },
      },
    ],
    edges: [],
    viewport: { x: 15, y: 40, zoom: 0.78 },
  };
}

function generatedLifecycleGraph(
  nodeId: string,
  scenario: "async" | "fail",
  count: number,
): CanvasResponse["graph"] {
  return {
    schemaVersion: 1,
    nodes: [
      {
        id: nodeId,
        type: "workflow",
        position: { x: 90, y: 180 },
        style: { width: 420, height: 210 },
        data: {
          nodeType: "image-generation",
          label: scenario === "fail" ? "E2E 失败图片生成" : "E2E 异步图片生成",
          provider: "fake",
          connectionId: "fake-default",
          model: "fake-image-v1",
          fakeScenario: scenario,
          parts: [{ type: "text", text: "一组雨夜电影感街景" }],
          inputs: [
            { id: "prompt", kind: "text", label: "Prompt" },
            {
              id: "references",
              kind: "image[]",
              label: "参考图",
              multiple: true,
            },
          ],
          outputs: [{ id: "images", kind: "image", label: "图片" }],
          parameters: {
            size: "1536x1024",
            quality: "high",
            n: count,
          },
        },
      },
    ],
    edges: [],
    viewport: { x: 25, y: 45, zoom: 0.82 },
  };
}

interface HeldRunCreation {
  requested: Promise<void>;
  captured: Promise<RunResponse>;
  release: () => void;
  dispose: () => Promise<void>;
}

async function mockCangyuanBackupCatalog(page: Page): Promise<void> {
  const group = CANGYUAN_BACKUP_IMAGE_GROUP;
  const models = structuredClone(
    cangyuanImageConnectorForGroup(group).models ?? [],
  );
  await page.route(/\/api\/providers\/[^/]+\/models(?:\?.*)?$/u, async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", headers: { "X-Model-Scan-Status": "live" }, body: JSON.stringify(models) });
  });
  const marketplaceModels = models.map((model) => ({
    id: model.id,
    name: model.name,
    description: model.description,
    capability: "image" as const,
    priceLabel: "测试目录价格",
    billingLabel: "按请求计费",
    tags: [],
    endpointTypes: ["image.generate"],
  }));

  await page.route(/\/cangyuan-catalog(?:\?.*)?$/u, async (route) => {
    const url = new URL(route.request().url());
    const body = url.searchParams.has("group")
      ? {
          group,
          checkedAt: new Date().toISOString(),
          source: "fallback",
          models,
        }
      : {
          checkedAt: new Date().toISOString(),
          source: "fallback",
          groups: [
            {
              id: group,
              description: "E2E 固定目录，避免测试依赖实时模型广场变化",
              ratio: 1,
              canvasSupported: true,
              models: marketplaceModels,
            },
          ],
        };
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(body),
    });
  });
}

async function holdRunCreationResponse(page: Page): Promise<HeldRunCreation> {
  const routePattern = "**/api/runs";
  let released = false;
  let releaseRequest!: () => void;
  const requestGate = new Promise<void>((resolve) => {
    releaseRequest = resolve;
  });
  let resolveRequested!: () => void;
  let rejectRequested!: (error: unknown) => void;
  const requested = new Promise<void>((resolve, reject) => {
    resolveRequested = resolve;
    rejectRequested = reject;
  });
  let resolveCaptured!: (snapshot: RunResponse) => void;
  let rejectCaptured!: (error: unknown) => void;
  const captured = new Promise<RunResponse>((resolve, reject) => {
    resolveCaptured = resolve;
    rejectCaptured = reject;
  });
  const handler = async (route: Route) => {
    if (route.request().method() !== "POST") {
      await route.continue();
      return;
    }
    try {
      resolveRequested();
      await requestGate;
      const response = await route.fetch();
      resolveCaptured((await response.json()) as RunResponse);
      await route.fulfill({ response });
    } catch (error) {
      rejectRequested(error);
      rejectCaptured(error);
    }
  };
  await page.route(routePattern, handler);
  return {
    requested,
    captured,
    release: () => {
      if (released) return;
      released = true;
      releaseRequest();
    },
    dispose: async () => {
      if (!released) releaseRequest();
      released = true;
      await page.unroute(routePattern, handler);
    },
  };
}

async function getJson<T>(
  request: APIRequestContext,
  path: string,
): Promise<T> {
  const response = await request.get(path);
  expect(response.ok(), `${path} should return success`).toBeTruthy();
  return response.json() as Promise<T>;
}

async function resetWorkspace(request: APIRequestContext): Promise<string> {
  const canvas = await getJson<CanvasResponse>(request, "/api/canvas");
  const assets = await getJson<AssetResponse[]>(request, "/api/assets");
  const connections = await getJson<Array<{ id: string }>>(
    request,
    "/api/providers",
  );

  await Promise.all([
    ...assets.map((asset) => request.delete(`/api/assets/${asset.id}`)),
    ...connections.map((connection) =>
      request.delete(`/api/providers/${connection.id}`),
    ),
  ]);
  const saved = await request.put(`/api/canvas/${canvas.id}`, {
    data: {
      title: "E2E 验收画布",
      graph: workflowGraph(),
    },
  });
  expect(
    saved.ok(),
    "workspace reset should save the fixture graph",
  ).toBeTruthy();
  return canvas.id;
}

async function configureFakeScenario(
  request: APIRequestContext,
  scenario: "sync" | "async" | "fail",
): Promise<void> {
  const canvas = await getJson<CanvasResponse>(request, "/api/canvas");
  const imageNode = canvas.graph.nodes.find((node) => node.id === "e2e-image");
  expect(imageNode).toBeDefined();
  imageNode!.data.fakeScenario = scenario;
  const response = await request.put(`/api/canvas/${canvas.id}`, {
    data: { title: canvas.title, graph: canvas.graph },
  });
  expect(response.ok(), "fake scenario should be saved").toBeTruthy();
}

async function gotoCanvasPage(page: Page): Promise<void> {
  const canvas = await getJson<CanvasResponse>(page.request, "/api/canvas");
  await page.goto(`/canvas/${encodeURIComponent(canvas.id)}`);
}

async function openWorkspace(page: Page): Promise<void> {
  await gotoCanvasPage(page);
  await expect(page.getByRole("button", { name: "返回主界面", exact: true })).toBeVisible();
  await expect(
    page.locator('.react-flow__node[data-id="e2e-prompt"]'),
  ).toBeVisible();
}

function attachedPanelGeometry(panel: Locator) {
  return panel.evaluate(element => {
    const node = element.closest(".react-flow__node")!;
    const card = node.querySelector(".node-card")!.getBoundingClientRect();
    const bounds = element.getBoundingClientRect();
    const viewport = document.querySelector(".react-flow__viewport")!;
    const zoom = new DOMMatrixReadOnly(getComputedStyle(viewport).transform).a;
    const close = element.querySelector('[aria-label="关闭模型与参数面板"]')!;
    return {
      zoom, width: bounds.width, y: bounds.y,
      attachmentError: Math.max(
        Math.abs(bounds.x - card.x),
        Math.abs(bounds.width - card.width),
        Math.abs(bounds.y - card.bottom - 10 * zoom),
        Math.abs(bounds.height - 560 * zoom),
        Math.abs(close.getBoundingClientRect().width - Number.parseFloat(getComputedStyle(close).width) * zoom),
      ),
    };
  });
}

async function expectInsideViewport(
  locator: Locator,
  viewportWidth: number,
): Promise<void> {
  await expect(locator).toBeVisible();
  const bounds = await locator.boundingBox();
  expect(bounds).not.toBeNull();
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(viewportWidth + 0.5);
}

async function openLibrary(page: Page): Promise<void> {
  const sidebar = page.locator("aside.sidebar");
  if (!(await sidebar.isVisible())) {
    await page.getByRole("button", { name: "打开节点与素材库" }).click();
  }
  await expect(sidebar).toBeVisible();
}

async function openNodeParameters(node: Locator, connection?: ProviderConnectionResponse): Promise<Locator> {
  await node.getByRole("button", { name: /^打开 .* 模型与参数$/u }).click();
  const panel = node.getByRole("dialog");
  await expect(panel).toBeVisible();
  if (connection) {
    await panel.getByRole("combobox", { name: / 供应商$/u }).selectOption(String(connection.config.supplierKey ?? connection.provider));
    await panel.getByRole("combobox", { name: / 模型群组$/u }).selectOption(String(connection.config.modelGroup ?? "默认群组"));
    const connections = panel.getByRole("combobox", { name: / API 连接$/u });
    if (await connections.count()) await connections.selectOption(connection.id);
  }
  return panel;
}

async function savedCanvas(page: Page): Promise<CanvasResponse> {
  const response = await page.request.get("/api/canvas");
  expect(response.ok()).toBeTruthy();
  return response.json() as Promise<CanvasResponse>;
}

async function runNodeAndWait(
  page: Page,
  nodeId: string,
  label: string,
): Promise<RunResponse> {
  const responsePromise = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/runs") &&
      response.request().method() === "POST",
  );
  await page
    .locator(`.react-flow__node[data-id="${nodeId}"]`)
    .getByRole("button", { name: `运行 ${label} 节点` })
    .click();
  const response = await responsePromise;
  expect(response.status()).toBe(201);
  const initial = (await response.json()) as RunResponse;
  await expect
    .poll(
      async () => {
        const snapshot = await getJson<RunResponse>(
          page.request,
          `/api/runs/${initial.run.id}`,
        );
        return snapshot.run.status;
      },
      { timeout: 20_000 },
    )
    .toBe("succeeded");
  await expect(
    page.locator(`.react-flow__node[data-id="${nodeId}"]`).getByRole("status"),
  ).toHaveAccessibleName("状态：已完成");
  return getJson<RunResponse>(page.request, `/api/runs/${initial.run.id}`);
}

async function uploadedAsset(
  page: Page,
  name = REFERENCE_ASSET_NAME,
): Promise<AssetResponse> {
  await expect
    .poll(
      async () => {
        const response = await page.request.get("/api/assets");
        const assets = (await response.json()) as AssetResponse[];
        return assets.find((asset) => asset.name === name) ?? null;
      },
      { timeout: 10_000 },
    )
    .not.toBeNull();

  const assets = await getJson<AssetResponse[]>(page.request, "/api/assets");
  return assets.find((asset) => asset.name === name)!;
}

async function uploadImageAsset(
  request: APIRequestContext,
  name = REFERENCE_ASSET_NAME,
): Promise<AssetResponse> {
  const response = await request.post("/api/assets/upload", {
    multipart: {
      file: {
        name,
        mimeType: "image/png",
        buffer: PNG_1X1,
      },
    },
  });
  expect(response.status()).toBe(201);
  return response.json() as Promise<AssetResponse>;
}

async function createImageModelFixture(
  request: APIRequestContext,
): Promise<ProviderConnectionResponse> {
  const baseModel = {
    id: "e2e-image-base",
    name: "E2E Image Base",
    operations: ["image.generate", "image.edit"],
    parameters: [
      {
        key: "size",
        label: "尺寸",
        control: "text",
        valueType: "string",
        default: "1024x1024",
      },
      {
        key: "quality",
        label: "质量",
        control: "select",
        valueType: "string",
        default: "medium",
        options: [
          { label: "中", value: "medium" },
          { label: "高", value: "high" },
        ],
      },
      {
        key: "aspect_ratio",
        label: "画面比例",
        control: "select",
        valueType: "string",
        default: "16:9",
        options: [
          { label: "16:9", value: "16:9" },
          { label: "9:16", value: "9:16" },
        ],
      },
      {
        key: "n",
        label: "生成张数",
        control: "number",
        valueType: "integer",
        default: 1,
        min: 1,
        max: 10,
        step: 1,
      },
    ],
  } as const;
  const connector = {
    ...structuredClone(CANGYUAN_IMAGE_CONNECTOR),
    models: [
      {
        ...structuredClone(baseModel),
        id: "e2e-image-balanced",
        name: "E2E Image Balanced",
        isDefault: true,
      },
      {
        ...structuredClone(baseModel),
        id: "e2e-image-cinematic",
        name: "E2E Image Cinematic",
        isDefault: false,
      },
    ],
  };
  const response = await request.post("/api/providers", {
    data: {
      name: "E2E 双模型图片 API",
      provider: "rest",
      apiKey: "e2e-model-fixture-secret",
      config: {
        baseUrl: "https://ai.cangyuansuanli.cn",
        defaultModel: "e2e-image-balanced",
        connector,
      },
    },
  });
  expect(response.status()).toBe(201);
  return response.json() as Promise<ProviderConnectionResponse>;
}

async function createOfflineImageModelFixture(
  request: APIRequestContext,
): Promise<ProviderConnectionResponse> {
  const response = await request.post("/api/providers", {
    data: {
      name: "E2E 离线图片 API",
      provider: "fake",
      apiKey: "e2e-offline-fixture-secret",
      config: {
        defaultModel: "fake-image-v1",
        connector: {
          auth: { type: "none" },
          models: [
            {
              id: "fake-image-v1",
              name: "E2E Offline Image",
              isDefault: true,
              operations: ["image.generate", "image.edit"],
              parameters: [
                {
                  key: "size",
                  label: "尺寸",
                  control: "text",
                  valueType: "string",
                  default: "1024x1024",
                },
                {
                  key: "quality",
                  label: "质量",
                  control: "select",
                  valueType: "string",
                  default: "auto",
                  options: [
                    { label: "自动", value: "auto" },
                    { label: "高", value: "high" },
                  ],
                },
                {
                  key: "n",
                  label: "数量",
                  control: "number",
                  valueType: "integer",
                  default: 1,
                  min: 1,
                  max: 4,
                  step: 1,
                },
              ],
            },
          ],
        },
      },
    },
  });
  expect(response.status()).toBe(201);
  return response.json() as Promise<ProviderConnectionResponse>;
}

test.describe("超级画布完整验收", () => {
  test.beforeEach(async ({ request }) => {
    await resetWorkspace(request);
  });

  for (const modelGroup of ["B1-GPT生图原生渠道V1", "B3-GPT生图-特惠渠道"]) {
    test(`怪兽已实测分辨率与请求质量可选并保存：${modelGroup}`, async ({ page, request }) => {
      const descriptor = applyMonsterImageCapabilities({ provider: "openai", config: { baseUrl: "https://api.eaheng.com", modelGroup } }, {
        id: "gpt-image-2.5-sunburst", name: "E2E 怪兽已实测型号", operations: ["image.generate"],
      });
      // The fixture has no real key or reachable provider; exercise only local UI/save.
      const created = await request.post("/api/providers", { data: { name: "E2E 怪兽尺寸选项", provider: "rest", apiKey: "e2e-local-only", config: {
        baseUrl: "https://example.invalid", defaultModel: descriptor.id,
        connector: { ...structuredClone(CANGYUAN_IMAGE_CONNECTOR), models: [descriptor] },
      } } });
      expect(created.status()).toBe(201);
      const connection = await created.json() as ProviderConnectionResponse;
      const canvas = await getJson<CanvasResponse>(request, "/api/canvas");
      const image = canvas.graph.nodes.find(n => n.id === "e2e-image")!;
      Object.assign(image.data, { provider: "rest", connectionId: connection.id, model: descriptor.id, parameters: { size: "auto", quality: "medium" } });
      expect((await request.put(`/api/canvas/${canvas.id}`, { data: { graph: canvas.graph } })).ok()).toBeTruthy();
      await openWorkspace(page);
      const node = page.locator('.react-flow__node[data-id="e2e-image"]');
      await node.getByRole("button", { name: /打开 E2E 图片生成 模型与参数/u }).click();
      const panel = page.getByRole("dialog", { name: "E2E 图片生成 模型与参数" });
      await expect(panel.getByText(/^实测说明：/u)).toBeVisible();
      const tiers = panel.getByRole("group", { name: "自动与输出分辨率快捷档位" });
      await expect(tiers.getByRole("button", { name: "1K", exact: true })).toBeVisible();
      await expect(tiers.getByRole("button", { name: "4K", exact: true })).toHaveCount(modelGroup.startsWith("B3-") ? 0 : 1);
      if (!modelGroup.startsWith("B3-")) {
        await expect(panel.getByText(/^实测说明：/u)).toContainText("3584×2016");
        await tiers.getByRole("button", { name: "4K", exact: true }).click();
        await panel.getByLabel("输出分辨率预设", { exact: true }).selectOption("3840x2160");
        await expect.poll(async () => (await savedCanvas(page)).graph.nodes.find(n => n.id === "e2e-image")?.data.parameters).toMatchObject({ size: "3840x2160", size_tier: "4K" });
        await tiers.getByRole("button", { name: "自动", exact: true }).click();
      }
      await tiers.getByRole("button", { name: "2K", exact: true }).click();
      await expect.poll(async () => (await savedCanvas(page)).graph.nodes.find(n => n.id === "e2e-image")?.data.parameters).toMatchObject({ size: "auto", size_tier: "2K" });
      await panel.getByLabel("输出分辨率预设", { exact: true }).selectOption("1536x2720");
      await panel.getByLabel("请求质量", { exact: true }).selectOption("high");
      await expect.poll(async () => (await savedCanvas(page)).graph.nodes.find(n => n.id === "e2e-image")?.data.parameters).toMatchObject({ size: "1536x2720", size_tier: "2K", quality: "high" });
      await page.reload();
      await node.getByRole("button", { name: /打开 E2E 图片生成 模型与参数/u }).click();
      await expect(panel.getByLabel("输出分辨率预设", { exact: true })).toHaveValue("1536x2720");
      await expect(panel.getByLabel("请求质量", { exact: true })).toHaveValue("high");
    });
  }

  test("独立分辨率型号快捷切换显示价格并保留竖图比例", async ({ page, request }) => {
    const sizes = [["1K", "1024x1024", "768x1360", "0.03"], ["2K", "2048x2048", "1536x2720", "0.06"], ["4K", "2880x2880", "2160x3840", "0.095"]];
    const models = sizes.map(([tier, square, portrait, price]) => ({
      id: `e2e-image-${tier!.toLowerCase()}`, name: `E2E ${tier}`, operations: ["image.generate", "image.edit"],
      metadata: { priceLabel: `¥${price}/张` },
      parameters: [{ key: "size", label: "尺寸", control: "dimensions", valueType: "string", default: "auto", options: [
        { label: "自动", value: "auto" }, { label: `${tier} 1:1`, value: square }, { label: `${tier} 9:16`, value: portrait },
      ] }],
    }));
    const created = await request.post("/api/providers", { data: { name: "E2E 分辨率档位", provider: "rest", apiKey: "e2e-local-only", config: {
      baseUrl: "https://example.invalid", defaultModel: models[0]!.id, connector: { ...structuredClone(CANGYUAN_IMAGE_CONNECTOR), models },
    } } });
    expect(created.status()).toBe(201);
    const connection = await created.json() as ProviderConnectionResponse;
    const canvas = await getJson<CanvasResponse>(request, "/api/canvas");
    const image = canvas.graph.nodes.find(n => n.id === "e2e-image")!;
    Object.assign(image.data, { provider: "rest", connectionId: connection.id, model: models[0]!.id, parameters: { size: "768x1360", size_tier: "1K" } });
    expect((await request.put(`/api/canvas/${canvas.id}`, { data: { graph: canvas.graph } })).ok()).toBeTruthy();
    await openWorkspace(page);
    const node = page.locator('.react-flow__node[data-id="e2e-image"]');
    await node.getByRole("button", { name: /打开 E2E 图片生成 模型与参数/u }).click();
    const panel = page.getByRole("dialog", { name: "E2E 图片生成 模型与参数" });
    const switches = panel.getByRole("group", { name: "切换同渠道型号的分辨率" });
    await expect(switches.getByRole("button", { name: "4K ¥0.095/张" })).toBeVisible();
    await switches.getByRole("button", { name: "4K ¥0.095/张" }).click();
    await expect.poll(async () => (await savedCanvas(page)).graph.nodes.find(n => n.id === "e2e-image")?.data).toMatchObject({ model: "e2e-image-4k", parameters: { size: "2160x3840", size_tier: "4K" } });
    await page.reload();
    await node.getByRole("button", { name: /打开 E2E 图片生成 模型与参数/u }).click();
    await expect(switches.getByRole("button", { name: "4K ¥0.095/张" })).toHaveAttribute("aria-pressed", "true");
    await switches.getByRole("button", { name: "2K ¥0.06/张" }).click();
    await expect.poll(async () => (await savedCanvas(page)).graph.nodes.find(n => n.id === "e2e-image")?.data).toMatchObject({ model: "e2e-image-2k", parameters: { size: "1536x2720", size_tier: "2K" } });
  });

  test("桌面更新通过 IPC 展示说明、延后并进入后台下载", async ({ page }) => {
    let phase = "available";
    const commands: string[] = [];
    await page.exposeFunction("desktopTestGetUpdate", () => ({
      desktop: true, formatVersion: 1, currentVersion: "0.1.0", phase,
      latest: { version: "0.2.0", tag: "v0.2.0", notes: "桌面安装包更新，并保留本地画布数据。" },
      progress: phase === "downloading" ? { downloadedBytes: 512, totalBytes: 1024 } : undefined,
      enabled: true, repository: "moshangqingchen/CanvasMind", intervalSeconds: 600, managerAvailable: true, updatedAt: "2026-09-21T00:00:00Z",
    }));
    await page.exposeFunction("desktopTestUpdate", (action: string) => { commands.push(action); if (action === "defer") phase = "idle"; if (action === "download") phase = "downloading"; });
    await page.addInitScript(() => {
      const host = window as typeof window & { desktopTestGetUpdate(): Promise<unknown>; desktopTestUpdate(action: string): Promise<void> };
      Object.assign(window, { superCanvasDesktop: {
        getUpdate: () => host.desktopTestGetUpdate(), update: (action: string) => host.desktopTestUpdate(action),
        onPrepareExit: () => () => {}, completePrepareExit: () => {}, onOpenUpdate: () => () => {},
        onUpdate: () => () => {}, onDraining: () => () => {}, cancelExit: async () => {},
      } });
    });
    await openWorkspace(page);
    const dialog = page.getByRole("dialog", { name: "超级画布更新" });
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText("v0.1.0"); await expect(dialog).toContainText("v0.2.0");
    await expect(dialog).toContainText("桌面安装包更新，并保留本地画布数据。");
    await dialog.getByRole("button", { name: "稍后提醒" }).click();
    await expect(dialog).toBeHidden(); expect(commands).toContain("defer");
    await page.getByRole("button", { name: "打开项目菜单" }).click();
    await page.getByRole("menuitem", { name: /检查更新/ }).click();
    await dialog.getByRole("button", { name: "下载更新" }).click();
    await expect(dialog).toContainText("正在后台下载更新包"); await expect(dialog).toContainText("50%");
    expect(commands).toContain("download");
  });

  test("画布响应损坏时退出加载态并显示可恢复错误", async ({ page }) => {
    const fixture = await getJson<CanvasResponse>(page.request, "/api/canvas");
    await page.route(`**/api/canvas/${fixture.id}`, async (route) => {
      if (route.request().method() !== "GET") {
        await route.continue();
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          id: fixture.id,
          title: "Broken canvas",
          revision: 1,
          graph: {
            schemaVersion: 1,
            nodes: [
              {
                id: "broken-node",
                type: "workflow",
                position: { x: 0, y: 0 },
                data: null,
              },
            ],
            edges: [],
            viewport: { x: 0, y: 0, zoom: 1 },
          },
        }),
      });
    });

    await page.goto(`/canvas/${fixture.id}`);

    const error = page.locator('.canvas-empty-state[role="alert"]');
    await expect(error).toContainText("画布加载失败");
    await expect(page.getByText("正在加载画布…")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "重新加载" })).toBeVisible();
  });

  test("智能体直接进入供应商设置，界面不再显示导演台和手动能力配置", async ({ page }) => {
    await openWorkspace(page);
    await page.getByRole("button", { name: "打开智能体", exact: true }).click();
    const inspector = page.locator("aside.inspector");
    await expect(inspector.getByText("创作智能体", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "打开超级导演", exact: true })).toHaveCount(0);
    await expect(inspector.getByRole("tab", { name: "导演台", exact: true })).toHaveCount(0);
    await expect(inspector.getByRole("button", { name: "智能体模型设置", exact: true })).toHaveCount(0);
    await inspector.getByRole("button", { name: "管理供应商与模型", exact: true }).click();
    const settings = page.getByRole("dialog", { name: "供应商与模型设置", exact: true });
    await expect(settings.getByRole("button", { name: "添加供应商", exact: true })).toBeVisible();
    await expect(settings.getByRole("tab", { name: "导演设置", exact: true })).toHaveCount(0);
  });

  test("智能体读取已保存分组模型，无需另建导演连接", async ({ page }) => {
    const groupId = "LLM-GPT-plus";
    const modelIds = ["gpt-5.4", "gpt-5.4-mini"];
    await page.route("**/api/agent/models", route => route.fulfill({ json: modelIds.map(modelId => ({
      supplierId: "saved-supplier", supplierName: "已接入供应商", group: groupId,
      connectionId: "existing-canvas-key", connectionName: "已有分组连接", modelId, modelName: modelId,
      protocol: "openai-chat-completions", available: true, source: "key",
      capabilities: { text: true, imageInput: true, audioInput: false, videoInput: false, structuredOutput: false, toolCalling: false, reasoning: false },
    })) }));
    const writes: string[] = [];
    page.on("request", request => {
      if (request.method() !== "GET" && /\/api\/(?:providers|director)(?:\/|$)/u.test(new URL(request.url()).pathname)) writes.push(request.url());
    });
    await openWorkspace(page);
    await page.getByRole("button", { name: "打开智能体", exact: true }).click();
    const inspector = page.locator("aside.inspector");
    await expect(inspector.getByLabel("智能体 API 供应商")).toHaveValue("saved-supplier");
    await expect(inspector.getByLabel("智能体模型群组")).toHaveValue(groupId);
    const models = inspector.getByLabel("智能体模型", { exact: true });
    await expect(models.locator('option[value]:not([value=""])')).toHaveCount(2);
    await models.selectOption("existing-canvas-key\ngpt-5.4-mini");
    await expect(models).toHaveValue("existing-canvas-key\ngpt-5.4-mini");
    expect(writes).toEqual([]);
  });

  test("画布渲染固定工作流，并可新增和自动保存 Prompt", async ({ page }) => {
    await openWorkspace(page);

    await expect(page.locator("aside.sidebar")).toBeHidden();
    await openLibrary(page);
    await expect(page.getByText("节点库")).toBeVisible();
    await expect(page.locator(".react-flow__node")).toHaveCount(4);
    await expect(page.locator(".react-flow__edge")).toHaveCount(4);

    await page
      .getByRole("button", { name: /Prompt/ })
      .first()
      .click();
    await expect(page.locator(".react-flow__node")).toHaveCount(5);
    const promptNode = page
      .locator('.react-flow__node:has(.node-card[data-node-type="prompt"])')
      .last();
    const editor = promptNode.locator(".tiptap-prompt");
    await expect(editor).toBeVisible();
    await editor.click();
    await editor.press("ControlOrMeta+A");
    await editor.pressSequentially("新增节点中的可保存提示词", { delay: 5 });

    await expect
      .poll(
        async () => {
          const canvas = await savedCanvas(page);
          return canvas.graph.nodes.find((node) => {
            const parts = node.data.parts as
              Array<{ type?: string; text?: string }> | undefined;
            return parts?.some(
              (part) =>
                part.type === "text" &&
                part.text === "新增节点中的可保存提示词",
            );
          })?.id;
        },
        { timeout: 10_000 },
      )
      .not.toBeUndefined();

    const persisted = await savedCanvas(page);
    const savedPromptId = persisted.graph.nodes.find((node) =>
      (
        node.data.parts as Array<{ type?: string; text?: string }> | undefined
      )?.some(
        (part) =>
          part.type === "text" && part.text === "新增节点中的可保存提示词",
      ),
    )?.id;
    expect(savedPromptId).toBeDefined();

    await page.reload();
    const restoredEditor = page
      .locator(`.react-flow__node[data-id="${String(savedPromptId)}"]`)
      .locator(".tiptap-prompt");
    await expect(restoredEditor).toContainText("新增节点中的可保存提示词");
  });

  test("编辑后立即返回主界面会保存最新内容，再次打开同一画布保留修改", async ({ page }) => {
    await openWorkspace(page);
    await expect(page.getByRole("button", { name: "画布自动保存状态" })).toContainText("已保存");
    const before = await savedCanvas(page);
    const editor = page.locator('.react-flow__node[data-id="e2e-prompt"] .tiptap-prompt');
    await editor.fill("返回主界面前的最新灵感");
    await page.getByRole("button", { name: "返回主界面", exact: true }).click();
    await expect(page).toHaveURL(/\/$/u);
    await expect(page.getByRole("heading", { name: "我的画布", exact: true })).toBeVisible();
    const persisted = await getJson<CanvasResponse>(page.request, `/api/canvas/${before.id}`);
    expect(JSON.stringify(persisted.graph.nodes.find((node) => node.id === "e2e-prompt")?.data.parts)).toContain("返回主界面前的最新灵感");
    await page.locator(`a[href="/canvas/${before.id}"]`).last().click();
    await expect(editor).toContainText("返回主界面前的最新灵感");
  });

  test("保存失败时浏览器后退仍保留完整草稿，重新进入可恢复并保存", async ({ page, request }) => {
    const canvas = await getJson<CanvasResponse>(request, "/api/canvas");
    await page.goto("/");
    await page.locator(`a[href="/canvas/${canvas.id}"]`).last().click();
    await expect(page.getByRole("button", { name: "画布自动保存状态" })).toContainText("已保存");
    const canvasRoute = `**/api/canvas/${canvas.id}`;
    const failSave = async (route: Route) => {
      if (route.request().method() === "PUT") {
        await route.fulfill({ status: 503, json: { error: "E2E 暂时无法保存" } });
      } else await route.continue();
    };
    await page.route(canvasRoute, failSave);
    const editor = page.locator('.react-flow__node[data-id="e2e-prompt"] .tiptap-prompt');
    await editor.fill("浏览器后退时保留的离线草稿");
    await page.goBack();
    await expect(page).toHaveURL(/\/$/u);
    await page.locator(`a[href="/canvas/${canvas.id}"]`).last().click();
    await expect(editor).toContainText("浏览器后退时保留的离线草稿");
    await page.unroute(canvasRoute, failSave);
    await editor.press("ControlOrMeta+s");
    await expect.poll(async () => {
      const saved = await getJson<CanvasResponse>(request, `/api/canvas/${canvas.id}`);
      return JSON.stringify(saved.graph.nodes.find((node) => node.id === "e2e-prompt")?.data.parts);
    }).toContain("浏览器后退时保留的离线草稿");
    await page.reload();
    await expect(editor).toContainText("浏览器后退时保留的离线草稿");
  });

  test("保存冲突会阻止返回按钮离开，浏览器后退再进入仍保留冲突副本", async ({ page, request }) => {
    const canvas = await getJson<CanvasResponse>(request, "/api/canvas");
    await page.goto("/");
    await page.locator(`a[href="/canvas/${canvas.id}"]`).last().click();
    await expect(page.getByRole("button", { name: "画布自动保存状态" })).toContainText("已保存");
    const latest = await getJson<CanvasResponse>(request, `/api/canvas/${canvas.id}`);
    const serverGraph = structuredClone(latest.graph);
    serverGraph.nodes.find((node) => node.id === "e2e-preview")!.data.label = "服务器保留的较新内容";
    const externalSave = await request.put(`/api/canvas/${canvas.id}`, { data: { graph: serverGraph, title: latest.title } });
    expect(externalSave.ok()).toBeTruthy();
    const external = await externalSave.json() as CanvasResponse;
    const editor = page.locator('.react-flow__node[data-id="e2e-prompt"] .tiptap-prompt');
    await editor.fill("需要保留的本地冲突副本");
    let conflict = page.getByRole("dialog", { name: "画布已在其他窗口更新" });
    await expect(conflict).toBeVisible();
    await conflict.getByRole("button", { name: "稍后处理保存冲突" }).click();
    await page.getByRole("button", { name: "返回主界面", exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/canvas/${canvas.id}$`, "u"));
    await expect(page.getByRole("button", { name: "处理画布保存冲突" })).toContainText("保存冲突");
    await page.goBack();
    await expect(page).toHaveURL(/\/$/u);
    await page.locator(`a[href="/canvas/${canvas.id}"]`).last().click();
    conflict = page.getByRole("dialog", { name: "画布已在其他窗口更新" });
    await expect(conflict).toBeVisible();
    await expect(editor).toContainText("需要保留的本地冲突副本");
    const protectedCanvas = await getJson<CanvasResponse>(request, `/api/canvas/${canvas.id}`);
    expect(protectedCanvas.revision).toBe(external.revision);
    expect(protectedCanvas.graph.nodes.find((node) => node.id === "e2e-preview")?.data.label).toBe("服务器保留的较新内容");
    expect(JSON.stringify(protectedCanvas.graph)).not.toContain("需要保留的本地冲突副本");
  });

  test("绘图后返回主界面再打开会保留矩形笔迹", async ({ page, request }) => {
    await openWorkspace(page);
    const canvas = await getJson<CanvasResponse>(request, "/api/canvas");
    await page.getByRole("button", { name: "画笔模式", exact: true }).click();
    await page.getByRole("button", { name: "矩形工具", exact: true }).click();
    const layer = page.locator(".canvas-drawing-input-layer");
    const bounds = await layer.boundingBox();
    expect(bounds).not.toBeNull();
    const x = bounds!.x + bounds!.width * .4;
    const y = bounds!.y + bounds!.height * .55;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + 120, y + 80, { steps: 8 });
    await page.mouse.up();
    await expect(page.locator(".canvas-drawing-stroke:not(.active)")).toHaveCount(1);
    await page.getByRole("button", { name: "返回主界面", exact: true }).click();
    await expect(page).toHaveURL(/\/$/u);
    const saved = await getJson<CanvasResponse>(request, `/api/canvas/${canvas.id}`);
    expect(saved.graph.drawings).toHaveLength(1);
    expect(saved.graph.drawings![0]!.points.length).toBeGreaterThanOrEqual(4);
    await page.locator(`a[href="/canvas/${canvas.id}"]`).last().click();
    await expect(page.locator(".canvas-drawing-stroke:not(.active)")).toHaveCount(1);
  });

  test("快速在两个画布之间往返会等待旧保存，内容和版本不会串到另一个画布", async ({ page, request }) => {
    const canvas = await getJson<CanvasResponse>(request, "/api/canvas");
    const created = await request.post("/api/projects", { data: { title: `E2E 切换隔离 ${crypto.randomUUID()}` } });
    expect(created.status()).toBe(201);
    const { project: other } = await created.json() as { project: { id: string } };
    let releaseSave: (() => void) | undefined;
    const saveGate = new Promise<void>((resolve) => { releaseSave = resolve; });
    let holding = false;
    let serverAccepted = false;
    const canvasRoute = `**/api/canvas/${canvas.id}`;
    const holdFirstSave = async (route: Route) => {
      if (route.request().method() !== "PUT" || holding) return route.continue();
      holding = true;
      const response = await route.fetch();
      serverAccepted = true;
      await saveGate;
      await route.fulfill({ response });
    };
    try {
      await page.goto("/");
      await page.locator(`a[href="/canvas/${canvas.id}"]`).last().click();
      await expect(page.getByRole("button", { name: "画布自动保存状态" })).toContainText("已保存");
      await page.route(canvasRoute, holdFirstSave);
      const editor = page.locator('.react-flow__node[data-id="e2e-prompt"] .tiptap-prompt');
      await editor.fill("A 画布正在保存的第一版");
      await expect.poll(() => serverAccepted).toBe(true);
      await editor.fill("A 画布应保留的最新第二版");
      await page.goBack();
      await expect(page).toHaveURL(/\/$/u);
      await page.locator(`a[href="/canvas/${other.id}"]`).last().click();
      await expect(page.getByRole("heading", { name: "让灵感，在这里发生" })).toBeVisible();
      await page.goBack();
      await page.locator(`a[href="/canvas/${canvas.id}"]`).last().click();
      await expect(page).toHaveURL(new RegExp(`/canvas/${canvas.id}$`, "u"));
      releaseSave?.();
      await expect(editor).toContainText("A 画布应保留的最新第二版");
      await expect(page.getByRole("dialog", { name: "画布已在其他窗口更新" })).toHaveCount(0);
      await expect.poll(async () => JSON.stringify((await getJson<CanvasResponse>(request, `/api/canvas/${canvas.id}`)).graph)).toContain("A 画布应保留的最新第二版");
      expect((await getJson<CanvasResponse>(request, `/api/canvas/${other.id}`)).graph.nodes).toEqual([]);
    } finally {
      releaseSave?.();
      await page.unroute(canvasRoute, holdFirstSave);
      await request.delete(`/api/projects/${other.id}`);
    }
  });

  test("较新的服务器版本会暂停自动保存并保留本地冲突副本", async ({
    page,
    request,
  }) => {
    await openWorkspace(page);
    const saveStatus = page.getByRole("button", {
      name: "画布自动保存状态",
    });
    await expect(saveStatus).toContainText("已保存");

    const beforeExternalUpdate = await getJson<CanvasResponse>(
      request,
      "/api/canvas",
    );
    const serverGraph = structuredClone(beforeExternalUpdate.graph);
    const serverMarkerNode = serverGraph.nodes.find(
      (node) => node.id === "e2e-preview",
    );
    expect(serverMarkerNode).toBeDefined();
    serverMarkerNode!.data.label = "E2E 服务器新版本标记";
    const serverTitle = "E2E 服务器较新画布";
    const externalUpdate = await request.put(
      `/api/canvas/${beforeExternalUpdate.id}`,
      {
        data: { title: serverTitle, graph: serverGraph },
      },
    );
    expect(externalUpdate.ok()).toBeTruthy();
    const externalCanvas = (await externalUpdate.json()) as CanvasResponse;
    expect(externalCanvas.revision).toBeGreaterThan(
      beforeExternalUpdate.revision,
    );

    const promptEditor = page
      .locator('.react-flow__node[data-id="e2e-prompt"]')
      .locator(".tiptap-prompt");
    await promptEditor.fill("E2E 本地冲突草稿");

    const conflictDialog = page.getByRole("dialog", {
      name: "画布已在其他窗口更新",
    });
    await expect(conflictDialog).toBeVisible();
    await expect(conflictDialog).toContainText(
      `服务器当前版本为 ${externalCanvas.revision}`,
    );
    await expect(conflictDialog).toContainText("本页不会继续自动保存");

    const conflictStatus = page.getByRole("button", {
      name: "处理画布保存冲突",
    });
    await expect(conflictStatus).toContainText("保存冲突");
    await conflictDialog
      .getByRole("button", { name: "稍后处理保存冲突" })
      .click();
    await expect(conflictDialog).toHaveCount(0);
    await expect(conflictStatus).toContainText("保存冲突");
    await conflictStatus.click();
    await expect(conflictDialog).toBeVisible();

    const downloadPromise = page.waitForEvent("download");
    await conflictDialog.getByRole("button", { name: "导出当前副本" }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/\.canvas\.json$/u);
    const downloadPath = await download.path();
    expect(downloadPath).not.toBeNull();
    const exported = JSON.parse(await readFile(downloadPath!, "utf8")) as {
      graph: CanvasResponse["graph"];
    };
    expect(
      (
        exported.graph.nodes.find((node) => node.id === "e2e-prompt")?.data
          .parts as Array<JsonRecord> | undefined
      )?.find((part) => part.type === "text")?.text,
    ).toBe("E2E 本地冲突草稿");

    await conflictDialog
      .getByRole("button", { name: "稍后处理保存冲突" })
      .click();
    let canvasPutRequestsAfterConflict = 0;
    page.on("request", (browserRequest) => {
      if (
        browserRequest.method() === "PUT" &&
        /\/api\/canvas\/[^/]+$/u.test(new URL(browserRequest.url()).pathname)
      ) {
        canvasPutRequestsAfterConflict += 1;
      }
    });
    await promptEditor.fill("E2E 本地冲突草稿第二版");
    await page.waitForTimeout(800);
    expect(canvasPutRequestsAfterConflict).toBe(0);
    await page.evaluate(() => {
      window.dispatchEvent(new PageTransitionEvent("pagehide"));
    });
    await page.waitForTimeout(200);
    expect(canvasPutRequestsAfterConflict).toBe(0);

    const protectedServerCanvas = await getJson<CanvasResponse>(
      request,
      "/api/canvas",
    );
    expect(protectedServerCanvas).toMatchObject({
      title: serverTitle,
      revision: externalCanvas.revision,
    });
    expect(
      protectedServerCanvas.graph.nodes.find(
        (node) => node.id === "e2e-preview",
      )?.data.label,
    ).toBe("E2E 服务器新版本标记");

    await page.close();
    await new Promise((resolve) => setTimeout(resolve, 750));
    const afterPageClose = await getJson<CanvasResponse>(
      request,
      "/api/canvas",
    );
    expect(afterPageClose).toMatchObject({
      title: serverTitle,
      revision: externalCanvas.revision,
    });
  });

  test("提示词按 Enter 会另起一行并在刷新后保留", async ({ page }) => {
    await openWorkspace(page);
    const promptNode = page.locator('.react-flow__node[data-id="e2e-image"]');
    const editor = promptNode.locator(".tiptap-prompt");
    await expect(editor).toBeVisible();
    await editor.fill("第一行提示词");
    await editor.press("End");
    await editor.press("Enter");
    await editor.type("第二行提示词");
    await expect(editor).toHaveCSS("display", "block");
    await expect(editor.locator("br")).toHaveCount(1);
    expect(
      await editor.evaluate((element) => (element as HTMLElement).innerText),
    ).toBe("第一行提示词\n第二行提示词");

    await page.getByRole("button", { name: "运行全部" }).focus();
    await expect
      .poll(async () => {
        const canvas = await savedCanvas(page);
        const node = canvas.graph.nodes.find(
          (candidate) => candidate.id === "e2e-image",
        );
        return (node?.data.parts as Array<JsonRecord> | undefined)?.find(
          (part) => part.type === "text",
        )?.text;
      })
      .toBe("第一行提示词\n第二行提示词");

    await page.reload();
    const restoredEditor = page
      .locator('.react-flow__node[data-id="e2e-image"]')
      .locator(".tiptap-prompt");
    await expect(restoredEditor.locator("br")).toHaveCount(1);
    expect(
      await restoredEditor.evaluate(
        (element) => (element as HTMLElement).innerText,
      ),
    ).toBe("第一行提示词\n第二行提示词");
  });

  test("复制粘贴节点时贴近当前选中节点并向下避让", async ({
    page,
    request,
  }) => {
    const canvas = await getJson<CanvasResponse>(request, "/api/canvas");
    const response = await request.put(`/api/canvas/${canvas.id}`, {
      data: {
        title: "E2E 紧邻粘贴",
        graph: {
          schemaVersion: 1,
          nodes: [
            {
              id: "paste-source",
              type: "workflow",
              position: { x: 100, y: 180 },
              style: { width: 420, height: 210 },
              data: {
                nodeType: "image-generation",
                label: "复制源节点",
                provider: "fake",
                connectionId: "fake-default",
                model: "fake-image-v1",
                inputs: [{ id: "prompt", kind: "text", label: "Prompt" }],
                outputs: [{ id: "images", kind: "image", label: "图片" }],
                parameters: { size: "1024x1024", quality: "auto" },
              },
            },
            {
              id: "paste-target",
              type: "workflow",
              position: { x: 700, y: 180 },
              style: { width: 420, height: 210 },
              data: {
                nodeType: "image-generation",
                label: "粘贴目标节点",
                provider: "fake",
                connectionId: "fake-default",
                model: "fake-image-v1",
                inputs: [{ id: "prompt", kind: "text", label: "Prompt" }],
                outputs: [{ id: "images", kind: "image", label: "图片" }],
                parameters: { size: "1024x1024", quality: "auto" },
              },
            },
          ],
          edges: [],
          viewport: { x: 0, y: 0, zoom: 1 },
        },
      },
    });
    expect(response.ok()).toBeTruthy();

    await gotoCanvasPage(page);
    const source = page.locator('.react-flow__node[data-id="paste-source"]');
    await expect(source).toBeVisible();
    await source.locator(".node-head").click();
    await page.keyboard.press("ControlOrMeta+C");
    await page
      .locator('.react-flow__node[data-id="paste-target"] .node-head')
      .click();
    await page.keyboard.press("ControlOrMeta+V");
    await expect(page.locator(".react-flow__node")).toHaveCount(3);
    await page.keyboard.press("ControlOrMeta+V");
    await expect(page.locator(".react-flow__node")).toHaveCount(4);

    await expect
      .poll(async () => {
        const saved = await savedCanvas(page);
        return saved.graph.nodes
          .filter(
            (node) => node.id !== "paste-source" && node.id !== "paste-target",
          )
          .map((node) => node.position)
          .sort((left, right) => left.y - right.y);
      })
      .toEqual([
        { x: 700, y: 406 },
        { x: 700, y: 632 },
      ]);
  });

  test("多选节点后显示浮动对齐工具并保存位置", async ({ page }) => {
    await openWorkspace(page);
    await page.locator(".react-flow").focus();
    await page.keyboard.press("ControlOrMeta+A");

    const toolbar = page.getByRole("toolbar", { name: "节点对齐工具" });
    await expect(toolbar).toBeVisible();
    await expect(toolbar).toContainText("4 个节点");
    await expect(
      toolbar.getByRole("button", { name: "水平等距分布" }),
    ).toBeEnabled();

    await toolbar.getByRole("button", { name: "左对齐" }).click();
    await expect
      .poll(async () => {
        const saved = await savedCanvas(page);
        return Array.from(
          new Set(saved.graph.nodes.map((node) => node.position.x)),
        );
      })
      .toEqual([30]);

    await toolbar.getByRole("button", { name: "上对齐" }).click();
    await expect
      .poll(async () => {
        const saved = await savedCanvas(page);
        return Array.from(
          new Set(saved.graph.nodes.map((node) => node.position.y)),
        );
      })
      .toEqual([135]);
  });

  test("Ctrl 点击可加选节点并高亮所有相连连线", async ({ page }) => {
    await openWorkspace(page);

    const promptNode = page.locator('.react-flow__node[data-id="e2e-prompt"]');
    const imageNode = page.locator('.react-flow__node[data-id="e2e-image"]');
    const previewNode = page.locator(
      '.react-flow__node[data-id="e2e-preview"]',
    );
    const edge = (id: string) =>
      page.locator(`.react-flow__edge[data-id="${id}"]`);

    await promptNode.locator(".node-head").click();
    await expect(promptNode.locator(".node-card")).toHaveClass(/\bselected\b/u);
    await expect(imageNode.locator(".node-card")).not.toHaveClass(
      /\bselected\b/u,
    );
    await expect(edge("e2e-prompt-image")).toHaveClass(
      /\bedge-connected-to-selection\b/u,
    );
    await expect(edge("e2e-prompt-video")).toHaveClass(
      /\bedge-connected-to-selection\b/u,
    );
    await expect(edge("e2e-image-video")).not.toHaveClass(
      /\bedge-connected-to-selection\b/u,
    );

    await imageNode.locator(".node-head").click({ modifiers: ["Control"] });
    await expect(promptNode.locator(".node-card")).toHaveClass(/\bselected\b/u);
    await expect(imageNode.locator(".node-card")).toHaveClass(/\bselected\b/u);
    await expect(
      page.getByRole("toolbar", { name: "节点对齐工具" }),
    ).toContainText("2 个节点");
    for (const id of [
      "e2e-prompt-image",
      "e2e-prompt-video",
      "e2e-image-video",
    ]) {
      await expect(edge(id)).toHaveClass(/\bedge-connected-to-selection\b/u);
    }
    await expect(edge("e2e-video-preview")).not.toHaveClass(
      /\bedge-connected-to-selection\b/u,
    );

    await imageNode.locator(".node-head").click({ modifiers: ["Control"] });
    await expect(promptNode.locator(".node-card")).toHaveClass(/\bselected\b/u);
    await expect(imageNode.locator(".node-card")).not.toHaveClass(
      /\bselected\b/u,
    );
    await expect(edge("e2e-image-video")).not.toHaveClass(
      /\bedge-connected-to-selection\b/u,
    );

    await previewNode.locator(".node-head").click();
    await expect(promptNode.locator(".node-card")).not.toHaveClass(
      /\bselected\b/u,
    );
    await expect(previewNode.locator(".node-card")).toHaveClass(
      /\bselected\b/u,
    );
    await expect(
      page.locator("aside.inspector").getByLabel("节点名称"),
    ).toHaveCount(0);
    await expect(page.locator("aside.inspector .agent-panel")).toBeVisible();
    await expect(edge("e2e-video-preview")).toHaveClass(
      /\bedge-connected-to-selection\b/u,
    );
    await expect(edge("e2e-prompt-video")).not.toHaveClass(
      /\bedge-connected-to-selection\b/u,
    );

    await previewNode.locator(".node-head").click({ modifiers: ["Control"] });
    await expect(previewNode.locator(".node-card")).not.toHaveClass(
      /\bselected\b/u,
    );
    await expect(page.locator(".node-card.selected")).toHaveCount(0);
    await page.getByRole("button", { name: "打开智能体", exact: true }).click();
    await expect(page.locator("aside.inspector .agent-panel")).toBeVisible();

    await imageNode.locator(".node-head").click();
    await expect(imageNode.locator(".node-card")).toHaveClass(/\bselected\b/u);
    const pane = page.locator(".react-flow__pane");
    const paneBounds = await pane.boundingBox();
    expect(paneBounds).not.toBeNull();
    await page.mouse.click(
      paneBounds!.x + paneBounds!.width / 2,
      paneBounds!.y + paneBounds!.height - 24,
    );
    await expect(page.locator(".node-card.selected")).toHaveCount(0);
    await page.getByRole("button", { name: "打开智能体", exact: true }).click();
    await expect(page.locator("aside.inspector .agent-panel")).toBeVisible();
  });

  test("问号可切换快捷键帮助且不会越过其它弹窗", async ({ page }) => {
    await openWorkspace(page);

    await page.keyboard.press("Shift+/");
    const shortcuts = page.getByRole("dialog", { name: "键盘快捷键" });
    await expect(shortcuts).toBeVisible();
    await expect(shortcuts).toContainText("加选或取消选择节点");
    await page.keyboard.press("Shift+/");
    await expect(shortcuts).toHaveCount(0);

    await page.getByRole("button", { name: "API 设置", exact: true }).click();
    const settings = page.getByRole("dialog", { name: "供应商与模型设置", exact: true });
    await expect(settings).toBeVisible();
    await page.keyboard.press("Shift+/");
    await expect(settings).toBeVisible();
    await expect(shortcuts).toHaveCount(0);
    await settings.getByRole("button", { name: "关闭设置", exact: true }).click();

    await openLibrary(page);
    await expect(page.getByText("上传图片、视频或音频")).toBeVisible();
    await page.getByRole("button", { name: "关闭素材库" }).click();
    await page
      .getByRole("button", { name: "打开项目菜单", exact: true })
      .click();
    await page.getByRole("menuitem", { name: "运行历史", exact: true }).click();
    const runHistory = page.getByRole("dialog", { name: "运行历史" });
    await expect(
      runHistory.getByRole("heading", { name: "任务中心", exact: true }),
    ).toBeVisible();
  });

  test("一键整理先聚合相连工作流再排列无关联分组", async ({
    page,
    request,
  }) => {
    const canvas = await getJson<CanvasResponse>(request, "/api/canvas");
    const graph = workflowGraph();
    for (let index = 0; index < 4; index += 1) {
      graph.nodes.push({
        id: `tidy-result-${index}`,
        type: "workflow",
        position: { x: 80 + index * 31, y: 760 - index * 97 },
        style: { width: 220, height: index % 2 === 0 ? 170 : 210 },
        data: {
          nodeType: "asset-input",
          label: `整理结果 ${index + 1}`,
          generatedResult: true,
          generatedStatus: "failed",
          generatedError: "E2E 布局占位",
          generatedFromNodeId: "e2e-image",
          generatedFromRunId: "e2e-tidy-run",
          generatedOutputIndex: index,
          assetKind: "image",
        },
      });
    }
    graph.nodes.push(
      {
        id: "tidy-other-prompt",
        type: "workflow",
        position: { x: 60, y: 1_080 },
        style: { width: 300, height: 160 },
        data: {
          nodeType: "prompt",
          label: "另一组提示词",
          parts: [{ type: "text", text: "另一条互不相连的工作流" }],
          outputs: [{ id: "prompt", kind: "text", label: "提示词" }],
        },
      },
      {
        id: "tidy-other-image",
        type: "workflow",
        position: { x: 590, y: 1_020 },
        style: { width: 360, height: 220 },
        data: {
          nodeType: "image-generation",
          label: "另一组图片生成",
          provider: "fake",
          connectionId: "fake-default",
          model: "fake-image-v1",
          inputs: [{ id: "prompt", kind: "text", label: "Prompt" }],
          outputs: [{ id: "images", kind: "image", label: "图片" }],
          parameters: { size: "1024x1024", quality: "auto" },
        },
      },
    );
    graph.edges.push({
      id: "tidy-other-edge",
      source: "tidy-other-prompt",
      sourceHandle: "prompt",
      target: "tidy-other-image",
      targetHandle: "prompt",
      type: "smoothstep",
    });
    const savedFixture = await request.put(`/api/canvas/${canvas.id}`, {
      data: { title: "E2E 一键整理", graph },
    });
    expect(savedFixture.ok()).toBeTruthy();

    await openWorkspace(page);
    await expect
      .poll(async () => (await savedCanvas(page)).graph.nodes.length)
      .toBe(10);
    const beforeTidy = await savedCanvas(page);
    const beforeImagePosition = beforeTidy.graph.nodes.find(
      (node) => node.id === "e2e-image",
    )!.position;

    await page.getByRole("button", { name: "一键整理画布" }).click();
    await expect(
      page.getByText(/已按关联分组并横向整理 10 个节点/),
    ).toBeVisible();
    await expect
      .poll(async () => {
        const saved = await savedCanvas(page);
        return saved.graph.nodes.find((node) => node.id === "e2e-image")
          ?.position;
      })
      .not.toEqual(beforeImagePosition);

    const arranged = await savedCanvas(page);
    const node = (id: string) =>
      arranged.graph.nodes.find((candidate) => candidate.id === id)!;
    const source = node("e2e-image");
    const video = node("e2e-video");
    const results = Array.from({ length: 4 }, (_, index) =>
      node(`tidy-result-${index}`),
    );
    expect(results[0]!.position.y).toBe(results[1]!.position.y);
    expect(results[0]!.position.x).toBe(results[2]!.position.x);
    expect(results[2]!.position.y).toBeGreaterThan(results[0]!.position.y);
    expect(results[1]!.position.x).toBeGreaterThan(results[0]!.position.x);
    expect(results[0]!.position.x).toBeGreaterThan(source.position.x);
    expect(video.position.x).toBeGreaterThan(
      Math.max(...results.map((result) => result.position.x + 220)),
    );
    const otherPrompt = node("tidy-other-prompt");
    const otherImage = node("tidy-other-image");
    expect(otherImage.position.x).toBeGreaterThan(otherPrompt.position.x);
    expect(otherPrompt.position.x).toBeGreaterThan(
      Math.max(
        source.position.x,
        video.position.x,
        ...results.map((result) => result.position.x + 220),
      ),
    );

    const arrangedPositions = Object.fromEntries(
      arranged.graph.nodes.map((item) => [item.id, item.position]),
    );
    await page.reload();
    await expect(
      page.getByRole("button", { name: "一键整理画布" }),
    ).toBeVisible();
    await expect
      .poll(async () => (await savedCanvas(page)).graph.nodes.length)
      .toBe(10);
    await expect
      .poll(async () => {
        const restored = await savedCanvas(page);
        return Object.fromEntries(
          restored.graph.nodes.map((item) => [item.id, item.position]),
        );
      })
      .toEqual(arrangedPositions);
  });

  test("超大画布可缩小到完整显示所有远距离节点", async ({ page, request }) => {
    const canvas = await getJson<CanvasResponse>(request, "/api/canvas");
    const farGraph: CanvasResponse["graph"] = {
      schemaVersion: 1,
      nodes: [
        {
          id: "far-left",
          type: "workflow",
          position: { x: 0, y: 180 },
          style: { width: 360, height: 210 },
          data: {
            nodeType: "prompt",
            label: "最左节点",
            parts: [{ type: "text", text: "左侧" }],
            outputs: [{ id: "prompt", kind: "text", label: "提示词" }],
          },
        },
        {
          id: "far-right",
          type: "workflow",
          position: { x: 30_000, y: 180 },
          style: { width: 360, height: 210 },
          data: {
            nodeType: "prompt",
            label: "最右节点",
            parts: [{ type: "text", text: "右侧" }],
            outputs: [{ id: "prompt", kind: "text", label: "提示词" }],
          },
        },
      ],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 },
    };
    const saved = await request.put(`/api/canvas/${canvas.id}`, {
      data: { title: "E2E 超大画布", graph: farGraph },
    });
    expect(saved.ok()).toBeTruthy();

    await gotoCanvasPage(page);
    await page.getByRole("button", { name: "Fit View" }).click();
    await expect(page.locator(".react-flow__node")).toHaveCount(2);

    const zoom = await page
      .locator(".react-flow__viewport")
      .evaluate((node) => new DOMMatrix(getComputedStyle(node).transform).a);
    expect(zoom).toBeGreaterThanOrEqual(0.02);
    expect(zoom).toBeLessThan(0.05);

    const [flowBounds, leftBounds, rightBounds] = await Promise.all([
      page.locator(".react-flow").boundingBox(),
      page.locator('.react-flow__node[data-id="far-left"]').boundingBox(),
      page.locator('.react-flow__node[data-id="far-right"]').boundingBox(),
    ]);
    expect(flowBounds).not.toBeNull();
    expect(leftBounds).not.toBeNull();
    expect(rightBounds).not.toBeNull();
    expect(leftBounds!.x).toBeGreaterThanOrEqual(flowBounds!.x);
    expect(rightBounds!.x + rightBounds!.width).toBeLessThanOrEqual(
      flowBounds!.x + flowBounds!.width,
    );
  });

  test("空白处右键新建图片节点，并可视化调整生成参数", async ({
    page,
    request,
  }) => {
    const connection = await createImageModelFixture(request);
    await openWorkspace(page);

    await page.locator(".react-flow__pane").click({
      button: "right",
      position: { x: 500, y: 520 },
    });
    const menu = page.getByRole("menu", { name: "新建节点" });
    await expect(menu).toBeVisible();
    await expect(
      menu.getByRole("menuitem", { name: "图片节点" }),
    ).toBeVisible();
    await expect(
      menu.getByRole("menuitem", { name: "视频节点" }),
    ).toBeVisible();
    await menu.getByRole("menuitem", { name: "图片节点" }).click();

    await expect(page.locator(".react-flow__node")).toHaveCount(5);
    await page.getByRole("button", { name: "Fit View", exact: true }).click();
    const created = page.locator('.react-flow__node:has(.node-card[data-node-type="image-generation"])').last();
    const inspector = await openNodeParameters(created, connection);
    await inspector.getByLabel("尺寸", { exact: true }).fill("1536x1024");
    await inspector.getByLabel("质量").selectOption("high");
    await inspector.getByLabel("生成张数").fill("3");

    await expect
      .poll(async () => {
        const canvas = await savedCanvas(page);
        return canvas.graph.nodes.find(
          (node) =>
            node.data.nodeType === "image-generation" &&
            node.id !== "e2e-image",
        )?.data.parameters;
      })
      .toMatchObject({ size: "1536x1024", quality: "high", n: 3 });
  });

  test("模型参数在窄窗口与缩放时保持与节点等宽并同比缩放", async ({ page }) => {
    await openWorkspace(page);
    const node = page.locator('.react-flow__node[data-id="e2e-image"]');
    await node.getByRole("button", { name: /打开 E2E 图片生成 模型与参数/u }).click();
    const dialog = page.getByRole("dialog", { name: "E2E 图片生成 模型与参数" });
    await expect(dialog).toBeVisible();
    const assertAttached = () => expect.poll(async () => (await attachedPanelGeometry(dialog)).attachmentError).toBeLessThanOrEqual(1);
    for (const width of [1280, 900, 390]) {
      await page.setViewportSize({ width, height: 820 });
      await assertAttached();
    }
    await page.setViewportSize({ width: 1280, height: 820 });
    const beforeZoom = (await attachedPanelGeometry(dialog)).zoom;
    await page.locator(".react-flow__controls-zoomout").click();
    await expect.poll(async () => (await attachedPanelGeometry(dialog)).zoom).toBeLessThan(beforeZoom);
    await assertAttached();
    await page.screenshot({ path: "../../../.codex-temp/redesign-model-panel.png" });
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
  });

  for (const zoom of [0.4, 1, 1.74]) test(`参数面板跟随节点移动、同比缩放和边角调整：${zoom}`, async ({ page, request }, testInfo) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    const canvas = await getJson<CanvasResponse>(request, "/api/canvas");
    const image = canvas.graph.nodes.find(node => node.id === "e2e-image")!;
    image.position = { x: 70, y: 35 };
    image.style = { width: 420, height: 180 };
    canvas.graph.nodes = [image]; canvas.graph.edges = []; canvas.graph.viewport = { x: 30, y: 120, zoom };
    expect((await request.put(`/api/canvas/${canvas.id}`, { data: { graph: canvas.graph } })).ok()).toBe(true);
    await gotoCanvasPage(page);
    const card = page.locator('.react-flow__node[data-id="e2e-image"] .node-card');
    await card.getByRole("button", { name: /打开 E2E 图片生成 模型与参数/u }).click();
    const panel = page.getByRole("dialog", { name: "E2E 图片生成 模型与参数" });
    const assertAttached = () => expect.poll(async () => (await attachedPanelGeometry(panel)).attachmentError).toBeLessThanOrEqual(1);
    await assertAttached();
    const pinnedBox = await panel.boundingBox();
    expect(pinnedBox!.width).toBeCloseTo((await card.boundingBox())!.width, 0);
    const header = card.locator(".node-head");
    const bounds = await header.boundingBox();
    const dragX = bounds!.x + bounds!.width * 0.7;
    await page.mouse.move(dragX, bounds!.y + bounds!.height / 2);
    await page.mouse.down(); await page.mouse.move(dragX + 80, bounds!.y + bounds!.height / 2 + 20, { steps: 8 }); await page.mouse.up();
    await assertAttached();
    expect((await panel.boundingBox())!.y).toBeGreaterThan(pinnedBox!.y);
    expect((await panel.boundingBox())!.width).toBeCloseTo(pinnedBox!.width, 0);
    const beforeZoom = await attachedPanelGeometry(panel);
    await page.mouse.move(100, 880);
    await page.mouse.wheel(0, 400);
    await expect.poll(async () => (await attachedPanelGeometry(panel)).zoom).toBeLessThan(beforeZoom.zoom);
    await assertAttached();
    const afterZoom = await attachedPanelGeometry(panel);
    expect(afterZoom.width / beforeZoom.width).toBeCloseTo(afterZoom.zoom / beforeZoom.zoom, 3);
    const beforeResize = await card.boundingBox();
    const handle = page.locator('.react-flow__node[data-id="e2e-image"] .react-flow__resize-control.handle.bottom.right');
    const resizeBox = await handle.boundingBox();
    await page.mouse.move(resizeBox!.x + resizeBox!.width / 2, resizeBox!.y + resizeBox!.height / 2);
    await page.mouse.down(); await page.mouse.move(resizeBox!.x + 65, resizeBox!.y + 20, { steps: 8 }); await page.mouse.up();
    await expect.poll(async () => (await card.boundingBox())!.width).toBeGreaterThan(beforeResize!.width + 20);
    await assertAttached();
    expect((await panel.boundingBox())!.width).toBeGreaterThan(beforeResize!.width + 20);
    await page.screenshot({ path: testInfo.outputPath("attached-panel.png") });
  });

  test("图片和视频只显示各自分组，混合分组按输出型号区分且不生成", async ({ page, request }) => {
    const image = { id: "fixture-image", name: "图片型号", operations: ["image.generate"], outputKinds: ["image"] };
    const video = { id: "fixture-video", name: "视频型号", operations: ["video.image-to-video"], inputKinds: ["image"], outputKinds: ["video"] };
    const connections: ProviderConnectionResponse[] = [];
    for (const [group, models] of [["图片专组", [image]], ["视频专组", [video]], ["综合组", [image, video]]] as const) {
      const response = await request.post("/api/providers", { data: { name: `类型隔离 · ${group}`, provider: "rest", apiKey: "e2e-local-only", config: {
        baseUrl: "https://media-fixture.invalid", modelGroup: group, supplierName: "类型隔离", modelScanStatus: "live", modelCatalogModels: models,
        connector: { ...structuredClone(CANGYUAN_IMAGE_CONNECTOR), models },
      } } });
      expect(response.ok()).toBe(true); const connection = await response.json(); connections.push(connection);
      await page.route(`**/api/providers/${connection.id}/models**`, route => route.fulfill({ json: models, headers: { "X-Model-Scan-Status": "live" } }));
    }
    const canvas = await getJson<CanvasResponse>(request, "/api/canvas");
    for (const [id, model] of [["e2e-image", image.id], ["e2e-video", video.id]])
      Object.assign(canvas.graph.nodes.find(node => node.id === id)!.data, { provider: "rest", connectionId: connections[2]!.id, model });
    expect((await request.put(`/api/canvas/${canvas.id}`, { data: { graph: canvas.graph } })).ok()).toBe(true);
    let submissions = 0; await page.route("**/api/runs", route => { if (route.request().method() === "POST") submissions++; return route.continue(); });
    await openWorkspace(page);
    for (const [id, label, included, excluded, modelName] of [["e2e-image", "E2E 图片生成", "图片专组", "视频专组", "图片型号"], ["e2e-video", "E2E 视频生成", "视频专组", "图片专组", "视频型号"]]) {
      await page.locator(`.react-flow__node[data-id="${id}"]`).getByRole("button", { name: `打开 ${label} 模型与参数` }).click();
      const panel = page.getByRole("dialog", { name: `${label} 模型与参数` });
      const groups = await panel.getByLabel(`${label} 模型群组`).locator("option").allTextContents();
      expect(groups).toContain(included); expect(groups).toContain("综合组"); expect(groups).not.toContain(excluded);
      await panel.getByRole("combobox", { name: `${label} 模型`, exact: true }).click();
      await expect(panel.getByRole("option", { name: modelName })).toBeVisible();
      await expect(panel.getByRole("option", { name: modelName === "图片型号" ? "视频型号" : "图片型号" })).toHaveCount(0);
      // In the lower half of the viewport the searchable menu opens upwards,
      // over the panel header. Dismiss that menu before closing its parent.
      await panel.getByRole("combobox", { name: "搜索模型名称或 ID", exact: true }).press("Escape");
      await expect(panel.getByRole("combobox", { name: `${label} 模型`, exact: true })).toHaveAttribute("aria-expanded", "false");
      await panel.getByRole("button", { name: "关闭模型与参数面板" }).click();
    }
    expect(submissions).toBe(0);
  });

  test("图片和视频节点内编辑提示词，通过节点参数面板保存并恢复配置", async ({
    page,
    request,
  }) => {
    const connection = await createImageModelFixture(request);
    await openWorkspace(page);

    const imageNode = page.locator('.react-flow__node[data-id="e2e-image"]');
    await imageNode.click();
    const imageEditor = imageNode.locator(".tiptap-prompt");
    await expect(imageEditor).toBeVisible();
    await imageEditor.pressSequentially("节点内的电影感城市海报", { delay: 5 });

    const imageConfigPopover = await openNodeParameters(imageNode, connection);
    await imageConfigPopover.getByRole("combobox", { name: "E2E 图片生成 模型", exact: true }).click();
    await imageConfigPopover.getByRole("option", { name: "E2E Image Cinematic", exact: true }).click();
    await imageConfigPopover.getByLabel("尺寸", { exact: true }).fill("2160x3840");
    await expect(
      imageConfigPopover.getByLabel("E2E 图片生成 模型", { exact: true }),
    ).toContainText("E2E Image Cinematic");
    await imageConfigPopover.getByLabel("质量").selectOption("high");
    await imageConfigPopover.getByLabel("画面比例").selectOption("9:16");
    await imageConfigPopover
      .getByRole("button", { name: "关闭模型与参数面板" })
      .click();

    const videoNode = page.locator('.react-flow__node[data-id="e2e-video"]');
    await videoNode.click();
    const videoEditor = videoNode.locator(".tiptap-prompt");
    await expect(videoEditor).toBeVisible();
    await videoEditor.pressSequentially("镜头缓慢向前推进", { delay: 5 });
    const videoConfig = await openNodeParameters(videoNode);
    await expect(videoConfig.getByRole("combobox", { name: "E2E 视频生成 模型", exact: true })).toContainText("Fake");
    await videoConfig.getByLabel("时长（秒）").fill("8");
    await videoConfig.getByLabel("画面比例").fill("720:1280");

    await expect
      .poll(async () => {
        const canvas = await savedCanvas(page);
        const image = canvas.graph.nodes.find(
          (node) => node.id === "e2e-image",
        );
        const video = canvas.graph.nodes.find(
          (node) => node.id === "e2e-video",
        );
        return {
          image: {
            connectionId: image?.data.connectionId,
            model: image?.data.model,
            parts: image?.data.parts,
            parameters: image?.data.parameters,
          },
          video: {
            parts: video?.data.parts,
            parameters: video?.data.parameters,
          },
        };
      })
      .toMatchObject({
        image: {
          connectionId: connection.id,
          model: "e2e-image-cinematic",
          parts: [{ type: "text", text: "节点内的电影感城市海报" }],
          parameters: {
            quality: "high",
            aspect_ratio: "9:16",
          },
        },
        video: {
          parts: [{ type: "text", text: "镜头缓慢向前推进" }],
          parameters: { duration: 8, ratio: "720:1280" },
        },
      });

    await page.reload();
    const restoredImage = page.locator(
      '.react-flow__node[data-id="e2e-image"]',
    );
    await restoredImage.click();
    await expect(restoredImage.locator(".tiptap-prompt")).toContainText(
      "节点内的电影感城市海报",
    );
    const restoredInspector = await openNodeParameters(restoredImage);
    await expect(restoredInspector.getByRole("combobox", { name: "E2E 图片生成 模型", exact: true })).toContainText("E2E Image Cinematic");
    await expect(restoredInspector.getByLabel("尺寸", { exact: true })).toHaveValue("");
    await expect(restoredInspector.getByLabel("质量")).toHaveValue("high");
    await expect(restoredInspector.getByLabel("画面比例")).toHaveValue("9:16");
  });

  test("生成中再次运行创建独立结果，后发任务先完成且刷新不覆盖前一任务", async ({ page, request }) => {
    const sourceId = "e2e-parallel-image";
    const canvas = await getJson<CanvasResponse>(request, "/api/canvas");
    expect((await request.put(`/api/canvas/${canvas.id}`, { data: { graph: generatedLifecycleGraph(sourceId, "async", 1) } })).ok()).toBeTruthy();
    let firstId: string | undefined;
    let holdFirst = true;
    const requestIds: string[] = [];
    const freezeFirst = (snapshot: RunResponse) => {
      if (!holdFirst || snapshot.run.id !== firstId) return snapshot;
      return { ...snapshot, run: { ...snapshot.run, status: "running" }, nodes: snapshot.nodes.map(n => ({ ...n, status: "running", outputAssetIds: [] })) };
    };
    await page.route("**/api/runs", async route => {
      if (route.request().method() !== "POST") return route.continue();
      requestIds.push(route.request().postDataJSON().clientRequestId);
      const response = await route.fetch();
      const snapshot = await response.json() as RunResponse;
      firstId ??= snapshot.run.id;
      await route.fulfill({ response, json: freezeFirst(snapshot) });
    });
    await page.route(/\/api\/runs(?:\/[^/?]+)?(?:\?.*)?$/u, async route => {
      if (route.request().method() !== "GET") return route.fallback();
      const response = await route.fetch();
      const payload = await response.json();
      await route.fulfill({ response, json: Array.isArray(payload) ? payload.map(freezeFirst) : freezeFirst(payload) });
    });
    await gotoCanvasPage(page);
    const node = page.locator(`.react-flow__node[data-id="${sourceId}"]`);
    const button = node.getByRole("button", { name: "运行 E2E 异步图片生成 节点" });
    const firstResponse = page.waitForResponse(r => r.url().endsWith("/api/runs") && r.request().method() === "POST");
    await button.click();
    expect((await firstResponse).status()).toBe(201);
    await expect(button).toHaveText("再生成一张");
    await expect(button).toBeEnabled();
    const secondResponse = page.waitForResponse(r => r.url().endsWith("/api/runs") && r.request().method() === "POST");
    await button.click();
    const second = await (await secondResponse).json() as RunResponse;
    expect(second.run.id).not.toBe(firstId);
    expect(new Set(requestIds).size).toBe(2);
    const results = page.locator(".generated-result-node");
    await expect(results).toHaveCount(2);
    await expect.poll(async () => (await savedCanvas(page)).graph.nodes.filter(n => n.data.generatedResult).map(n => n.data.generatedStatus).sort()).toEqual(["running", "succeeded"]);
    await expect(button).toHaveText("再生成一张");
    await page.reload();
    await expect(results).toHaveCount(2);
    await expect(button).toBeEnabled();
    holdFirst = false;
    await expect.poll(async () => (await savedCanvas(page)).graph.nodes.filter(n => n.data.generatedResult).map(n => n.data.generatedStatus), { timeout: 20000 }).toEqual(["succeeded", "succeeded"]);
    const finished = (await savedCanvas(page)).graph.nodes.filter(n => n.data.generatedResult);
    expect(new Set(finished.map(n => n.data.generatedFromRunId)).size).toBe(2);
    expect(new Set(finished.map(n => n.data.assetId)).size).toBe(2);
    expect(requestIds).toHaveLength(2);
  });

  test("提交生成后立即创建多个占位框，并在原位显示成功结果且刷新不重复", async ({
    page,
    request,
  }) => {
    const sourceNodeId = "e2e-pending-image";
    const canvas = await getJson<CanvasResponse>(request, "/api/canvas");
    const saved = await request.put(`/api/canvas/${canvas.id}`, {
      data: {
        title: "E2E 生成中结果",
        graph: generatedLifecycleGraph(sourceNodeId, "async", 2),
      },
    });
    expect(saved.ok()).toBeTruthy();

    await gotoCanvasPage(page);
    const sourceNode = page.locator(
      `.react-flow__node[data-id="${sourceNodeId}"]`,
    );
    await expect(sourceNode).toBeVisible();

    const heldRun = await holdRunCreationResponse(page);
    try {
      const browserResponse = page.waitForResponse(
        (response) =>
          response.url().endsWith("/api/runs") &&
          response.request().method() === "POST",
      );
      await sourceNode
        .getByRole("button", { name: "运行 E2E 异步图片生成 节点" })
        .click();
      await heldRun.requested;

      // The request has not reached the API yet. These frames must be created
      // optimistically from n, before a run or generated asset exists.
      await page.getByRole("button", { name: "Fit View" }).click();
      const resultNodes = page.locator(
        ".react-flow__node:has(.generated-result-node)",
      );
      await expect(resultNodes).toHaveCount(2);
      await expect(
        resultNodes.locator('.generated-result-state.pending[role="status"]'),
      ).toContainText(["等待开始", "等待开始"]);
      await expect(
        resultNodes.locator(".generated-result-spinner"),
      ).toHaveCount(2);
      const pendingStatuses = await resultNodes
        .locator(".generated-result-node")
        .evaluateAll((nodes) =>
          nodes.map((node) => node.getAttribute("data-generated-status")),
        );
      expect(
        pendingStatuses.every((status) =>
          ["queued", "submitting", "running", "archiving"].includes(
            status ?? "",
          ),
        ),
      ).toBe(true);
      const pendingNodeIds = (
        await resultNodes.evaluateAll((nodes) =>
          nodes.map((node) => node.getAttribute("data-id")),
        )
      )
        .filter((nodeId): nodeId is string => nodeId !== null)
        .sort();
      expect(pendingNodeIds).toHaveLength(2);
      expect(new Set(pendingNodeIds).size).toBe(2);
      const pendingEdges = page.locator(
        '.react-flow__edge[data-id^="edge-generated-"]',
      );
      await expect(pendingEdges).toHaveCount(2);
      for (const resultNodeId of pendingNodeIds) {
        const edge = page.locator(
          `.react-flow__edge[data-id="edge-generated-${resultNodeId}"]`,
        );
        await expect(edge).toHaveCount(1);
        await expect(edge.locator(".studio-edge-light")).toHaveCount(1);

        const resultNode = page.locator(
          `.react-flow__node[data-id="${resultNodeId}"]`,
        );
        await expect(
          resultNode.getByLabel("输入 生成来源（image）"),
        ).toHaveCount(1);
        await expect(resultNode.getByLabel("输出 图片（image）")).toHaveCount(
          1,
        );
      }
      await expect(sourceNode.getByLabel("输出 图片（image）")).toHaveCount(1);
      const sourceBounds = await sourceNode.boundingBox();
      expect(sourceBounds).not.toBeNull();
      for (let index = 0; index < 2; index += 1) {
        const resultBounds = await resultNodes.nth(index).boundingBox();
        expect(resultBounds).not.toBeNull();
        expect(resultBounds!.x).toBeGreaterThan(
          sourceBounds!.x + sourceBounds!.width,
        );
      }

      heldRun.release();
      const initial = await heldRun.captured;
      expect(initial.run.id).toBeTruthy();
      await browserResponse;
      await expect
        .poll(
          async () =>
            (
              await getJson<RunResponse>(
                page.request,
                `/api/runs/${initial.run.id}`,
              )
            ).run.status,
          { timeout: 20_000 },
        )
        .toBe("succeeded");

      await expect(
        resultNodes.locator(
          '.generated-result-node[data-generated-status="succeeded"]',
        ),
      ).toHaveCount(2);
      await expect(
        resultNodes.locator(".generated-result-state.pending"),
      ).toHaveCount(0);
      const succeededNodeIds = (
        await resultNodes.evaluateAll((nodes) =>
          nodes.map((node) => node.getAttribute("data-id")),
        )
      )
        .filter((nodeId): nodeId is string => nodeId !== null)
        .sort();
      expect(succeededNodeIds).toEqual(pendingNodeIds);
      await expect(pendingEdges).toHaveCount(2);
      for (const resultNodeId of succeededNodeIds) {
        const edge = page.locator(
          `.react-flow__edge[data-id="edge-generated-${resultNodeId}"]`,
        );
        await expect(edge).toHaveCount(1);
        await expect(edge).not.toHaveClass(/\banimated\b/u);
      }

      const completed = await getJson<RunResponse>(
        page.request,
        `/api/runs/${initial.run.id}`,
      );
      const outputAssetIds = completed.nodes.find(
        (node) => node.nodeId === sourceNodeId,
      )?.outputAssetIds;
      expect(outputAssetIds).toHaveLength(2);

      await expect
        .poll(async () => {
          const current = await savedCanvas(page);
          return generatedResultsFor(current, sourceNodeId, initial.run.id).map(
            (node) => ({
              id: node.id,
              outputIndex: node.data.generatedOutputIndex,
              assetId: node.data.assetId,
              status: node.data.generatedStatus,
            }),
          );
        })
        .toEqual([
          {
            id: pendingNodeIds[0],
            outputIndex: 0,
            assetId: outputAssetIds![0],
            status: "succeeded",
          },
          {
            id: pendingNodeIds[1],
            outputIndex: 1,
            assetId: outputAssetIds![1],
            status: "succeeded",
          },
        ]);

      const completedCanvas = await savedCanvas(page);
      const completedResults = generatedResultsFor(
        completedCanvas,
        sourceNodeId,
        initial.run.id,
      );
      const completedSource = completedCanvas.graph.nodes.find(
        (node) => node.id === sourceNodeId,
      );
      expect(completedResults[0]?.position.x).toBeGreaterThan(
        (completedSource?.position.x ?? 0) + 300,
      );
      const firstResultWidth = Number.parseFloat(
        String(completedResults[0]?.style?.width),
      );
      const firstResultHeight = Number.parseFloat(
        String(completedResults[0]?.style?.height),
      );
      const secondResultWidth = Number.parseFloat(
        String(completedResults[1]?.style?.width),
      );
      const secondResultHeight = Number.parseFloat(
        String(completedResults[1]?.style?.height),
      );
      const firstPosition = completedResults[0]!.position;
      const secondPosition = completedResults[1]!.position;
      const separatedHorizontally =
        firstPosition.x + firstResultWidth <= secondPosition.x ||
        secondPosition.x + secondResultWidth <= firstPosition.x;
      const separatedVertically =
        firstPosition.y + firstResultHeight <= secondPosition.y ||
        secondPosition.y + secondResultHeight <= firstPosition.y;
      expect(separatedHorizontally || separatedVertically).toBe(true);
      const completedEdges = generatedResultEdgesFor(
        completedCanvas,
        sourceNodeId,
        completedResults.map((node) => node.id),
      );
      expect(completedEdges).toHaveLength(2);
      expect(new Set(completedEdges.map((edge) => edge.id)).size).toBe(2);
      for (const result of completedResults) {
        expect(result.data.inputs).toEqual([
          expect.objectContaining({
            id: "generated",
            kind: "image",
          }),
        ]);
        expect(result.data.outputs).toEqual([
          expect.objectContaining({ id: "asset", kind: "image" }),
        ]);
        expect(
          completedEdges.filter((edge) => edge.target === result.id),
        ).toEqual([
          expect.objectContaining({
            id: `edge-generated-${result.id}`,
            source: sourceNodeId,
            sourceHandle: "images",
            target: result.id,
            targetHandle: "generated",
            type: "smoothstep",
            animated: false,
          }),
        ]);
      }

      const beforeReload = generatedResultsFor(
        await savedCanvas(page),
        sourceNodeId,
        initial.run.id,
      ).map((node) => [
        node.id,
        node.data.generatedOutputIndex,
        node.data.assetId,
        node.data.generatedStatus,
      ]);
      await page.reload();
      await page.getByRole("button", { name: "Fit View" }).click();
      await expect(
        page.locator(".react-flow__node:has(.generated-result-node)"),
      ).toHaveCount(2);
      const restoredEdges = page.locator(
        '.react-flow__edge[data-id^="edge-generated-"]',
      );
      await expect(restoredEdges).toHaveCount(2);
      await expect(
        page.locator('.react-flow__edge[data-id^="edge-generated-"].animated'),
      ).toHaveCount(0);
      for (const resultNodeId of succeededNodeIds) {
        await expect(
          page.locator(
            `.react-flow__edge[data-id="edge-generated-${resultNodeId}"]`,
          ),
        ).toHaveCount(1);
        await expect(
          page
            .locator(`.react-flow__node[data-id="${resultNodeId}"]`)
            .getByLabel("输出 图片（image）"),
        ).toHaveCount(1);
      }
      await page.waitForTimeout(900);
      await expect
        .poll(async () =>
          generatedResultsFor(
            await savedCanvas(page),
            sourceNodeId,
            initial.run.id,
          ).map((node) => [
            node.id,
            node.data.generatedOutputIndex,
            node.data.assetId,
            node.data.generatedStatus,
          ]),
        )
        .toEqual(beforeReload);
      const reloadedCanvas = await savedCanvas(page);
      expect(
        generatedResultEdgesFor(reloadedCanvas, sourceNodeId, succeededNodeIds),
      ).toHaveLength(2);
    } finally {
      heldRun.release();
      await heldRun.dispose();
    }
  });

  test("生成失败会在同一个结果框内返回失败状态", async ({ page, request }) => {
    const sourceNodeId = "e2e-failing-image";
    const canvas = await getJson<CanvasResponse>(request, "/api/canvas");
    const saved = await request.put(`/api/canvas/${canvas.id}`, {
      data: {
        title: "E2E 生成失败结果",
        graph: generatedLifecycleGraph(sourceNodeId, "fail", 1),
      },
    });
    expect(saved.ok()).toBeTruthy();

    await gotoCanvasPage(page);
    const sourceNode = page.locator(
      `.react-flow__node[data-id="${sourceNodeId}"]`,
    );
    await expect(sourceNode).toBeVisible();

    const heldRun = await holdRunCreationResponse(page);
    try {
      const browserResponse = page.waitForResponse(
        (response) =>
          response.url().endsWith("/api/runs") &&
          response.request().method() === "POST",
      );
      await sourceNode
        .getByRole("button", { name: "运行 E2E 失败图片生成 节点" })
        .click();
      await heldRun.requested;
      await page.getByRole("button", { name: "Fit View" }).click();
      const resultNode = page.locator(
        ".react-flow__node:has(.generated-result-node)",
      );
      await expect(resultNode).toHaveCount(1);
      await expect(
        resultNode.locator('.generated-result-state.pending[role="status"]'),
      ).toContainText("等待开始");
      await expect(
        resultNode.locator(".generated-result-spinner"),
      ).toBeVisible();
      const pendingNodeId = await resultNode.getAttribute("data-id");
      expect(pendingNodeId).toBeTruthy();
      const resultEdge = page.locator(
        `.react-flow__edge[data-id="edge-generated-${pendingNodeId}"]`,
      );
      await expect(resultEdge).toHaveCount(1);
      await expect(resultEdge.locator(".studio-edge-light")).toHaveCount(1);
      await expect(resultNode.getByLabel("输入 生成来源（image）")).toHaveCount(
        1,
      );
      await expect(resultNode.getByLabel("输出 图片（image）")).toHaveCount(1);

      heldRun.release();
      const initial = await heldRun.captured;
      await browserResponse;
      await expect
        .poll(
          async () =>
            (
              await getJson<RunResponse>(
                page.request,
                `/api/runs/${initial.run.id}`,
              )
            ).run.status,
          { timeout: 20_000 },
        )
        .toBe("failed");

      await expect(
        resultNode.locator(
          '.generated-result-node[data-generated-status="failed"]',
        ),
      ).toHaveCount(1);
      const failedState = resultNode.locator(
        '.generated-result-state.failed[role="status"]',
      );
      await expect(failedState).toContainText("生成失败");
      await expect(failedState).toContainText(
        "模拟供应商按测试场景返回了生成失败",
      );
      await expect(failedState).toContainText("错误类型：模拟测试错误");
      const failedLayout = await failedState.evaluate((element) => {
        const childRects = Array.from(element.children)
          .filter((child) => getComputedStyle(child).display !== "none")
          .map((child) => {
            const rect = child.getBoundingClientRect();
            return { top: rect.top, bottom: rect.bottom, height: rect.height };
          });
        return {
          wrapperHeight:
            (element.closest(".react-flow__node-workflow") as HTMLElement | null)?.offsetHeight ?? 0,
          overflowY: getComputedStyle(element).overflowY,
          collapsedChildren: childRects.filter((rect) => rect.height <= 0)
            .length,
          overlaps: childRects.slice(1).filter((rect, index) => {
            const previous = childRects[index];
            return previous.bottom > rect.top + 0.5;
          }).length,
        };
      });
      expect(failedLayout.wrapperHeight).toBeGreaterThanOrEqual(279);
      expect(failedLayout.overflowY).toBe("auto");
      expect(failedLayout.collapsedChildren).toBe(0);
      expect(failedLayout.overlaps).toBe(0);
      await expect(resultNode.locator(".generated-result-spinner")).toHaveCount(
        0,
      );
      expect(await resultNode.getAttribute("data-id")).toBe(pendingNodeId);
      await expect(resultEdge).toHaveCount(1);
      await expect(resultEdge).not.toHaveClass(/\banimated\b/u);

      await expect
        .poll(async () => {
          const current = await savedCanvas(page);
          const [failedResult] = generatedResultsFor(
            current,
            sourceNodeId,
            initial.run.id,
          );
          return failedResult
            ? {
                id: failedResult.id,
                outputIndex: failedResult.data.generatedOutputIndex,
                status: failedResult.data.generatedStatus,
                error: failedResult.data.generatedError,
              }
            : null;
        })
        .toEqual({
          id: pendingNodeId,
          outputIndex: 0,
          status: "failed",
          error: {
            message: "模拟供应商按测试场景返回了生成失败。",
            type: "模拟测试错误",
            code: "fake_provider_failure",
            api: "本地模拟 API",
          },
        });

      const failedCanvas = await savedCanvas(page);
      const [failedResult] = generatedResultsFor(
        failedCanvas,
        sourceNodeId,
        initial.run.id,
      );
      expect(failedResult).toBeDefined();
      expect(
        generatedResultEdgesFor(failedCanvas, sourceNodeId, [failedResult!.id]),
      ).toEqual([
        expect.objectContaining({
          id: `edge-generated-${failedResult!.id}`,
          source: sourceNodeId,
          sourceHandle: "images",
          target: failedResult!.id,
          targetHandle: "generated",
          type: "smoothstep",
          animated: false,
        }),
      ]);
      expect(failedResult!.data.outputs).toEqual([
        expect.objectContaining({ id: "asset", kind: "image" }),
      ]);

      await page.reload();
      await page.getByRole("button", { name: "Fit View" }).click();
      await expect(
        page.locator(
          `.react-flow__edge[data-id="edge-generated-${failedResult!.id}"]`,
        ),
      ).toHaveCount(1);
      await expect(
        page
          .locator(`.react-flow__node[data-id="${failedResult!.id}"]`)
          .getByLabel("输出 图片（image）"),
      ).toHaveCount(1);
      const reloadedFailedCanvas = await savedCanvas(page);
      expect(
        generatedResultEdgesFor(reloadedFailedCanvas, sourceNodeId, [
          failedResult!.id,
        ]),
      ).toHaveLength(1);

      await heldRun.dispose();
      const retryRoutePattern = "**/api/runs";
      let releaseRetryRequest!: () => void;
      const retryGate = new Promise<void>((resolve) => {
        releaseRetryRequest = resolve;
      });
      let retryPostData: JsonRecord | null = null;
      const retryHandler = async (route: Route) => {
        if (route.request().method() !== "POST") {
          await route.continue();
          return;
        }
        retryPostData = route.request().postDataJSON() as JsonRecord;
        await retryGate;
        await route.continue();
      };
      await page.route(retryRoutePattern, retryHandler);
      try {
        const reloadedResultNode = page.locator(
          `.react-flow__node[data-id="${failedResult!.id}"]`,
        );
        await reloadedResultNode
          .getByRole("button", {
            name: "再次运行 生成图片 1，原地替换失败结果",
          })
          .click();
        await expect.poll(() => retryPostData).not.toBeNull();
        expect(retryPostData).toMatchObject({
          nodeId: sourceNodeId,
          scope: "node",
        });
        await expect(
          reloadedResultNode.locator(
            '.generated-result-state.pending[role="status"]',
          ),
        ).toContainText("等待开始");
        await expect(
          page.locator(".react-flow__node:has(.generated-result-node)"),
        ).toHaveCount(1);
        await expect(
          reloadedResultNode.locator(
            '.generated-result-node[data-generated-status="failed"]',
          ),
        ).toHaveCount(0);

        releaseRetryRequest();
        await expect
          .poll(async () => {
            const current = await savedCanvas(page);
            const retries = generatedResultsFor(current, sourceNodeId);
            return {
              count: retries.length,
              status: retries[0]?.data.generatedStatus,
              id: retries[0]?.id,
            };
          })
          .toEqual({ count: 1, status: "failed", id: failedResult!.id });
        expect(await reloadedResultNode.getAttribute("data-id")).toBe(
          failedResult!.id,
        );
      } finally {
        releaseRetryRequest();
        await page.unroute(retryRoutePattern, retryHandler);
      }
    } finally {
      heldRun.release();
      await heldRun.dispose();
    }
  });

  test("生成图片框支持节点内缩放和双击打开原图预览", async ({
    page,
    request,
  }) => {
    await createOfflineImageModelFixture(request);
    await openWorkspace(page);
    const asset = await uploadImageAsset(request);
    const canvas = await savedCanvas(page);
    const zoomNodeId = "e2e-zoom-result";
    const zoomNode: CanvasGraphNode = {
      id: zoomNodeId,
      type: "workflow",
      position: { x: 560, y: 180 },
      style: { width: 320, height: 320 },
      data: {
        nodeType: "asset-input",
        label: "E2E 可缩放图片",
        assetId: asset.id,
        assetKind: "image",
        generatedResult: true,
        generatedStatus: "succeeded",
        generatedFromNodeId: "e2e-zoom-source",
        generatedFromRunId: "e2e-zoom-run",
        generatedOutputIndex: 0,
        generatedPromptParts: [{ type: "text", text: "E2E 原始生成提示词" }],
        generatedConnectionName: "全模型-无claude/gpt",
        generatedModel: "gpt-image-2-4k",
        generatedParameters: { aspect_ratio: "16:9", quality: "high" },
        generatedCreatedAt: "2026-08-02T01:52:00.000Z",
        mediaAspectRatio: 1,
        outputs: [{ id: "asset", kind: "image", label: "图片" }],
      },
    };
    const savedFixture = await request.put(`/api/canvas/${canvas.id}`, {
      data: {
        title: "E2E 图片缩放",
        graph: {
          schemaVersion: 1,
          nodes: [zoomNode],
          edges: [],
          viewport: { x: 80, y: 50, zoom: 0.9 },
        },
      },
    });
    expect(savedFixture.ok()).toBeTruthy();

    await page.reload();
    const resultNode = page.locator(
      `.react-flow__node[data-id="${zoomNodeId}"]`,
    );
    await expect(resultNode).toBeVisible();
    const card = resultNode.locator(".generated-result-node");
    await expect(card).toHaveAttribute("data-generated-status", "succeeded");
    await expect(card).toHaveAttribute("data-media-zoom", "1");
    await expect(
      resultNode.getByRole("img", { name: REFERENCE_ASSET_NAME }),
    ).toBeVisible();

    await expect(page.getByRole("button", { name: "智能体面板", exact: true })).toHaveAttribute("aria-expanded", "true");
    const inspector = page.locator(".inspector");
    const resizeHandle = page.getByRole("separator", {
      name: "调整右侧面板宽度",
    });
    const inspectorBeforeResize = await inspector.boundingBox();
    const resizeHandleBounds = await resizeHandle.boundingBox();
    expect(inspectorBeforeResize).not.toBeNull();
    expect(resizeHandleBounds).not.toBeNull();
    await page.mouse.move(
      resizeHandleBounds!.x + resizeHandleBounds!.width / 2,
      resizeHandleBounds!.y + 180,
    );
    await page.mouse.down();
    await page.mouse.move(
      resizeHandleBounds!.x - 120,
      resizeHandleBounds!.y + 180,
      { steps: 5 },
    );
    await page.mouse.up();
    const inspectorAfterResize = await inspector.boundingBox();
    expect(inspectorAfterResize).not.toBeNull();
    expect(inspectorAfterResize!.width).toBeGreaterThan(
      inspectorBeforeResize!.width + 100,
    );

    await page.reload();
    await expect(page.getByRole("button", { name: "智能体面板", exact: true })).toHaveAttribute("aria-expanded", "true");
    await page.getByRole("button", { name: "Fit View" }).click();
    const inspectorAfterReload = await inspector.boundingBox();
    expect(inspectorAfterReload).not.toBeNull();
    expect(inspectorAfterReload!.width).toBeCloseTo(
      inspectorAfterResize!.width,
      1,
    );

    await card.click();
    const resultActions = page.getByRole("toolbar", {
      name: "生成结果操作",
    });
    await expect(resultActions).toBeVisible();
    const selectedCardBounds = await card.boundingBox();
    const resultActionsBounds = await resultActions.boundingBox();
    expect(selectedCardBounds).not.toBeNull();
    expect(resultActionsBounds).not.toBeNull();
    expect(resultActionsBounds!.y).toBeGreaterThanOrEqual(64);
    expect(resultActionsBounds!.y + resultActionsBounds!.height).toBeLessThan(650);
    const provenanceBadge = card.locator(
      ".generated-result-provenance-overlay",
    );
    await provenanceBadge.click();
    await expect(page.getByRole("dialog", {name:"结果来源与参数"})).toContainText("gpt-image-2-4k");
    await page.getByRole("button", {name:"关闭来源详情"}).click();
    const provenanceBounds = await provenanceBadge.boundingBox();
    expect(provenanceBounds).not.toBeNull();
    expect(provenanceBounds!.width).toBeLessThan(
      selectedCardBounds!.width * 0.3,
    );
    await expect(
      resultActions.getByRole("link", { name: "下载 E2E 可缩放图片" }),
    ).toHaveAttribute(
      "href",
      new RegExp(`/api/assets/${asset.id}/content\\?download=1$`),
    );
    await resultActions
      .getByRole("button", { name: "查看 E2E 可缩放图片 原提示词" })
      .click();
    await expect(page.getByRole("note")).toContainText("E2E 原始生成提示词");
    await resultActions
      .getByRole("button", { name: "反推 E2E 可缩放图片 提示词" })
      .click();
    await expect(
      page.getByRole("textbox", { name: "创作任务要求" }),
    ).toHaveValue(/反推一份可复现画面主体/u);
    const agentComposer = page.locator('aside.inspector [aria-label="通用创作智能体"]');
    await expect(agentComposer.getByLabel("智能体 API 供应商")).toBeVisible();
    await expect(agentComposer.getByLabel("智能体模型群组")).toBeVisible();
    await expect(agentComposer.getByLabel("智能体模型", { exact: true })).toBeVisible();
    const zoomToolbar = resultActions.getByRole("group", {
      name: "图片缩放",
    });
    await expect(zoomToolbar).toBeVisible();
    const zoomToolbarBounds = await zoomToolbar.boundingBox();
    expect(zoomToolbarBounds).not.toBeNull();
    expect(zoomToolbarBounds!.x).toBeGreaterThanOrEqual(resultActionsBounds!.x);
    expect(zoomToolbarBounds!.x + zoomToolbarBounds!.width).toBeLessThanOrEqual(
      resultActionsBounds!.x + resultActionsBounds!.width,
    );
    const before = await resultNode.boundingBox();
    expect(before).not.toBeNull();

    await zoomToolbar.getByRole("button", { name: "放大图片" }).click();
    await expect(card).toHaveAttribute("data-media-zoom", "1.25");
    await zoomToolbar.getByRole("button", { name: "放大图片" }).click();
    await expect(card).toHaveAttribute("data-media-zoom", "1.5");
    await expect(
      resultNode.locator(".generated-result-viewport img"),
    ).toHaveCSS("transform", "matrix(1.5, 0, 0, 1.5, 0, 0)");

    await zoomToolbar.getByRole("button", { name: "缩小图片" }).click();
    await expect(card).toHaveAttribute("data-media-zoom", "1.25");
    await zoomToolbar.getByRole("button", { name: "还原图片缩放" }).click();
    await expect(card).toHaveAttribute("data-media-zoom", "1");
    await zoomToolbar.getByRole("button", { name: "缩小图片" }).click();
    await expect(card).toHaveAttribute("data-media-zoom", "0.75");
    await zoomToolbar.getByRole("button", { name: "缩小图片" }).click();
    await expect(card).toHaveAttribute("data-media-zoom", "0.5");
    await expect(
      zoomToolbar.getByRole("button", { name: "缩小图片" }),
    ).toBeDisabled();
    await zoomToolbar.getByRole("button", { name: "还原图片缩放" }).click();
    await expect(card).toHaveAttribute("data-media-zoom", "1");

    const after = await resultNode.boundingBox();
    expect(after).not.toBeNull();
    expect(after!.width).toBeCloseTo(before!.width, 1);
    expect(after!.height).toBeCloseTo(before!.height, 1);

    await resultNode.locator(".generated-result-viewport").dblclick();
    const previewDialog = page.getByRole("dialog", { name: "素材预览" });
    await expect(previewDialog).toBeVisible();
    await expect(previewDialog.locator(".asset-zoom-level")).toHaveText("100%");
    const imageStage = previewDialog.locator(".image-zoom-stage");
    await imageStage.dispatchEvent("wheel", {
      deltaY: -100,
      clientX: 320,
      clientY: 240,
    });
    await expect(previewDialog.locator(".asset-zoom-level")).toHaveText("115%");
    await expect(imageStage).toHaveClass(/can-pan/);
    const stageBounds = await imageStage.boundingBox();
    expect(stageBounds).not.toBeNull();
    const scrollBeforeDrag = await imageStage.evaluate(
      (element) => element.scrollLeft,
    );
    await page.mouse.move(
      stageBounds!.x + stageBounds!.width / 2,
      stageBounds!.y + stageBounds!.height / 2,
    );
    await page.mouse.down();
    await expect(imageStage).toHaveClass(/is-dragging/);
    await page.mouse.move(
      stageBounds!.x + stageBounds!.width / 2 - 80,
      stageBounds!.y + stageBounds!.height / 2,
      { steps: 4 },
    );
    await page.mouse.up();
    await expect(imageStage).not.toHaveClass(/is-dragging/);
    expect(
      await imageStage.evaluate((element) => element.scrollLeft),
    ).toBeGreaterThan(scrollBeforeDrag);
    await previewDialog.getByRole("button", { name: "关闭" }).click();
    await expect(previewDialog).toBeHidden();
  });

  test("再次运行多结果批次会原地复用全部失败卡片", async ({
    page,
    request,
  }, testInfo) => {
    const sourceNodeId = "e2e-queued-retries";
    const canvas = await getJson<CanvasResponse>(request, "/api/canvas");
    const saved = await request.put(`/api/canvas/${canvas.id}`, {
      data: {
        title: "E2E 连续重新生成",
        graph: generatedLifecycleGraph(sourceNodeId, "fail", 2),
      },
    });
    expect(saved.ok()).toBeTruthy();

    await gotoCanvasPage(page);
    const sourceNode = page.locator(
      `.react-flow__node[data-id="${sourceNodeId}"]`,
    );
    const initialResponse = page.waitForResponse(
      (response) =>
        response.url().endsWith("/api/runs") &&
        response.request().method() === "POST",
    );
    await sourceNode
      .getByRole("button", { name: "运行 E2E 失败图片生成 节点" })
      .click();
    const initial = (await (await initialResponse).json()) as RunResponse;
    await expect
      .poll(
        async () =>
          (await getJson<RunResponse>(request, `/api/runs/${initial.run.id}`))
            .run.status,
        { timeout: 20_000 },
      )
      .toBe("failed");

    await page.getByRole("button", { name: "Fit View" }).click();
    const resultNodes = page.locator(
      ".react-flow__node:has(.generated-result-node)",
    );
    await expect(resultNodes).toHaveCount(2);
    const firstResult = resultNodes.nth(0);
    const secondResult = resultNodes.nth(1);
    await expect(resultNodes.locator('.generated-result-node[data-generated-status="failed"]')).toHaveCount(2);
    await expect(
      firstResult.getByRole("button", {
        name: "再次运行 生成图片 1，原地替换失败结果",
      }),
    ).toBeVisible();
    await expect(
      secondResult.getByRole("button", {
        name: "再次运行 生成图片 2，原地替换失败结果",
      }),
    ).toBeVisible();
    await expect.poll(async () => {
      const first = await firstResult.boundingBox();
      const second = await secondResult.boundingBox();
      if (!first || !second) return true;
      return first.x < second.x + second.width && first.x + first.width > second.x &&
        first.y < second.y + second.height && first.y + first.height > second.y;
    }, { message: "失败结果卡必须保留独立空间，不能遮挡相邻卡的重试按钮" }).toBe(false);
    await expect.poll(async () => generatedResultsFor(await savedCanvas(page), sourceNodeId)
      .map(node => node.data.generatedStatus)).toEqual(["failed", "failed"]);
    const originalResults = generatedResultsFor(await savedCanvas(page), sourceNodeId);
    const firstSize = await firstResult.evaluate(element => ({
      width: (element as HTMLElement).offsetWidth,
      height: (element as HTMLElement).offsetHeight,
    }));
    await firstResult.locator(".result-error-details summary").click();
    await expect(firstResult.locator(".result-error-details")).toHaveJSProperty("open", true);
    // Selection can restart the card's translate/scale animation. Measure its
    // settled footprint rather than an in-flight transform against the wrapper.
    await expect.poll(() => firstResult.locator(".generated-result-node").evaluate(element =>
      element.getAnimations().some(animation => animation.playState === "running")))
      .toBe(false);
    const expandedLayout = await firstResult.locator(".generated-result-state.failed").evaluate(element => {
      const state = element.getBoundingClientRect();
      const wrapper = element.closest(".react-flow__node")!.getBoundingClientRect();
      return {
        overflowY: getComputedStyle(element).overflowY,
        scrollable: element.scrollHeight > element.clientHeight,
        insideWrapper: state.top >= wrapper.top - 1 && state.bottom <= wrapper.bottom + 1,
        stateBounds: { top: state.top, bottom: state.bottom, height: state.height },
        wrapperBounds: { top: wrapper.top, bottom: wrapper.bottom, height: wrapper.height },
        cardTransform: getComputedStyle(element.closest(".generated-result-node")!).transform,
      };
    });
    expect(await firstResult.evaluate(element => ({
      width: (element as HTMLElement).offsetWidth,
      height: (element as HTMLElement).offsetHeight,
    }))).toEqual(firstSize);
    expect(firstSize.height).toBeGreaterThanOrEqual(280);
    await testInfo.attach("failed-result-layout", {
      body: Buffer.from(JSON.stringify({
        firstBounds: await firstResult.boundingBox(),
        secondBounds: await secondResult.boundingBox(),
        firstSize,
        expandedLayout,
        resultPositions: originalResults.map(node => ({ id: node.id, position: node.position })),
      }, null, 2)),
      contentType: "application/json",
    });
    expect(expandedLayout).toMatchObject({ overflowY: "auto", scrollable: true, insideWrapper: true });

    let retryPostCount = 0;
    let continuedRetryPostCount = 0;
    const retryRoutePattern = "**/api/runs";
    let releaseRetryRequests!: () => void;
    const retryGate = new Promise<void>((resolve) => {
      releaseRetryRequests = resolve;
    });
    const retryHandler = async (route: Route) => {
      if (route.request().method() !== "POST") {
        await route.continue();
        return;
      }
      retryPostCount += 1;
      await retryGate;
      await route.continue();
      continuedRetryPostCount += 1;
    };
    await page.route(retryRoutePattern, retryHandler);
    let retryAssertionFailed = false;
    try {
      await firstResult
        .getByRole("button", {
          name: "再次运行 生成图片 1，原地替换失败结果",
        })
        .click();
      await expect.poll(() => retryPostCount).toBe(1);
      await expect(resultNodes).toHaveCount(2);
      await expect(
        resultNodes.locator('.generated-result-state.pending[role="status"]'),
      ).toHaveCount(2);

      releaseRetryRequests();
      await expect.poll(() => continuedRetryPostCount).toBe(1);
      await expect
        .poll(async () => {
          const current = await savedCanvas(page);
          return generatedResultsFor(current, sourceNodeId).map((node) => ({
            id: node.id,
            status: node.data.generatedStatus,
          }));
        })
        .toEqual(originalResults.map(node => ({ id: node.id, status: "failed" })));
      expect(generatedResultsFor(await savedCanvas(page), sourceNodeId).map(node => ({
        id: node.id, position: node.position,
      }))).toEqual(originalResults.map(node => ({ id: node.id, position: node.position })));
      await expect(resultNodes.locator('.generated-result-node[data-generated-status="failed"]')).toHaveCount(2);
      await secondResult.getByRole("button", {
        name: "再次运行 生成图片 2，原地替换失败结果",
      }).click();
      await expect.poll(() => retryPostCount).toBe(2);
      await expect.poll(() => continuedRetryPostCount).toBe(2);
      await expect.poll(async () => generatedResultsFor(await savedCanvas(page), sourceNodeId)
        .map(node => ({ id: node.id, status: node.data.generatedStatus, position: node.position })))
        .toEqual(originalResults.map(node => ({ id: node.id, status: "failed", position: node.position })));
    } catch (error) {
      retryAssertionFailed = true;
      throw error;
    } finally {
      releaseRetryRequests();
      if (!page.isClosed()) {
        try {
          await expect.poll(() => continuedRetryPostCount).toBe(retryPostCount);
          await page.unroute(retryRoutePattern, retryHandler);
        } catch (error) {
          if (!retryAssertionFailed && !page.isClosed()) throw error;
        }
      }
    }
  });

  test("生成节点按类型编号并显示直接连接的素材缩略图", async ({
    page,
    request,
  }, testInfo) => {
    await openWorkspace(page);
    await openLibrary(page);
    await page.locator('.upload-label input[type="file"]').setInputFiles({
      name: REFERENCE_ASSET_NAME,
      mimeType: "image/png",
      buffer: PNG_1X1,
    });
    const asset = await uploadedAsset(page);
    const canvas = await savedCanvas(page);
    const sourceId = "e2e-linked-image";
    const targetId = "e2e-linked-generation";
    const savedFixture = await request.put(`/api/canvas/${canvas.id}`, {
      data: {
        title: "E2E 连接素材预览",
        graph: {
          schemaVersion: 1,
          nodes: [
            {
              id: sourceId,
              type: "workflow",
              position: { x: 100, y: 180 },
              data: {
                nodeType: "asset-input",
                label: "E2E 参考图片",
                assetId: asset.id,
                assetKind: "image",
                outputs: [{ id: "asset", kind: "image", label: "图片" }],
              },
            },
            {
              id: targetId,
              type: "workflow",
              position: { x: 480, y: 130 },
              style: { width: 420, height: 270 },
              data: {
                nodeType: "image-generation",
                label: "E2E 图片生成",
                provider: "fake",
                connectionId: "fake-default",
                model: "fake-image-v1",
                parts: [{ type: "text", text: "保留参考图构图" }],
                inputs: [
                  { id: "prompt", kind: "text", label: "Prompt" },
                  {
                    id: "references",
                    kind: "image[]",
                    label: "参考图",
                    multiple: true,
                  },
                ],
                outputs: [{ id: "images", kind: "image", label: "图片" }],
                parameters: { size: "1024x1024", quality: "auto" },
              },
            },
          ],
          edges: [],
          viewport: { x: 80, y: 70, zoom: 0.9 },
        },
      },
    });
    expect(savedFixture.ok()).toBeTruthy();

    await page.reload();
    const source = page.locator(`.react-flow__node[data-id="${sourceId}"]`);
    const target = page.locator(`.react-flow__node[data-id="${targetId}"]`);
    await expect(target).toBeVisible();
    const sourceHandle = source.locator(
      '.react-flow__handle.source[data-port-kind="image"]',
    );
    const targetHandle = target.locator(
      '.react-flow__handle.target[data-port-kind="image[]"]',
    );
    const sourceBox = await sourceHandle.boundingBox();
    const targetBox = await targetHandle.boundingBox();
    expect(sourceBox).not.toBeNull();
    expect(targetBox).not.toBeNull();
    await page.mouse.move(
      sourceBox!.x + sourceBox!.width / 2,
      sourceBox!.y + sourceBox!.height / 2,
    );
    await page.mouse.down();
    await page.mouse.move(
      sourceBox!.x + sourceBox!.width / 2 + 2,
      sourceBox!.y + sourceBox!.height / 2,
    );
    await expect(target.locator(".node-card")).toHaveAttribute(
      "data-connection-highlight",
      "compatible",
    );
    await page.mouse.move(
      targetBox!.x + targetBox!.width / 2,
      targetBox!.y + targetBox!.height / 2,
      { steps: 10 },
    );
    await page.mouse.up();
    await expect(page.locator(".react-flow__edge")).toHaveCount(1);
    await expect(target.getByText("图片 1", { exact: true })).toBeVisible();
    await expect(
      target.locator(".node-linked-asset-preview img"),
    ).toBeVisible();
    await expect(target.locator(".node-linked-asset-copy small")).toHaveText(
      REFERENCE_ASSET_NAME,
    );
    const editor = target.locator(".tiptap-prompt");
    await editor.fill("");
    await editor.type("@");
    const mentionMenu = page.locator(".mention-floating-menu");
    await expect(mentionMenu).toBeVisible();
    await expect(
      mentionMenu.locator(".mention-asset-thumbnail img"),
    ).toBeVisible();
    await editor.press("Enter");
    await editor.type("这个帅哥@");
    await expect(mentionMenu).toBeVisible();
    await editor.press("Enter");
    await expect(editor.locator(".mention-chip")).toHaveCount(2);
    expect(
      await target
        .locator(".node-linked-assets")
        .evaluate((element) => element.scrollWidth <= element.clientWidth),
    ).toBe(true);
    await target.screenshot({
      path: testInfo.outputPath("linked-media-preview.png"),
    });
    await target
      .getByRole("button", {
        name: `移除素材 ${REFERENCE_ASSET_NAME} 并断开连线`,
      })
      .click();
    await expect(page.locator(".react-flow__edge")).toHaveCount(0);
    await expect(target.locator(".node-linked-asset")).toHaveCount(0);
    await expect(editor.locator(".mention-chip")).toHaveCount(0);
    await expect
      .poll(async () => {
        const saved = await savedCanvas(page);
        const savedTarget = saved.graph.nodes.find(
          (savedNode) => savedNode.id === targetId,
        );
        const savedParts = Array.isArray(savedTarget?.data.parts)
          ? (savedTarget.data.parts as JsonRecord[])
          : [];
        return {
          connected: saved.graph.edges.some(
            (edge) => edge.source === sourceId && edge.target === targetId,
          ),
          mentions: savedParts.filter(
            (part) => part.type === "asset" && part.assetId === asset.id,
          ).length,
        };
      })
      .toEqual({ connected: false, mentions: 0 });
  });

  test("模型文档不支持视频输入时在节点内提示并阻止请求", async ({
    page,
    request,
  }, testInfo) => {
    await openWorkspace(page);
    await openLibrary(page);
    const videoName = "e2e unsupported reference.mp4";
    await page.locator('.upload-label input[type="file"]').setInputFiles({
      name: videoName,
      mimeType: "video/mp4",
      buffer: Buffer.concat([
        Buffer.from([0, 0, 0, 24]),
        Buffer.from("ftypisom"),
        Buffer.alloc(12),
      ]),
    });
    const video = await uploadedAsset(page, videoName);
    const connector = {
      ...structuredClone(CANGYUAN_IMAGE_CONNECTOR),
      models: [
        {
          id: "e2e-text-video-only",
          name: "E2E 纯文生视频",
          operations: ["video.generate"],
          inputKinds: ["text", "image"],
          outputKinds: ["video"],
          limits: { maxInputImages: 1, maxInputVideos: 0 },
        },
      ],
    };
    const providerResponse = await request.post("/api/providers", {
      data: {
        name: "E2E 视频限制 API",
        provider: "rest",
        apiKey: "e2e-video-limit-secret",
        config: {
          baseUrl: "https://ai.cangyuansuanli.cn",
          defaultModel: "e2e-text-video-only",
          connector,
        },
      },
    });
    expect(providerResponse.status()).toBe(201);
    const provider =
      (await providerResponse.json()) as ProviderConnectionResponse;
    const canvas = await savedCanvas(page);
    const sourceId = "e2e-unsupported-video";
    const targetId = "e2e-video-limit-generation";
    const savedFixture = await request.put(`/api/canvas/${canvas.id}`, {
      data: {
        title: "E2E 视频输入限制",
        graph: {
          schemaVersion: 1,
          nodes: [
            {
              id: sourceId,
              type: "workflow",
              position: { x: 90, y: 180 },
              data: {
                nodeType: "asset-input",
                label: "E2E 参考视频",
                assetId: video.id,
                assetKind: "video",
                outputs: [{ id: "asset", kind: "video", label: "视频" }],
              },
            },
            {
              id: targetId,
              type: "workflow",
              position: { x: 470, y: 120 },
              style: { width: 430, height: 300 },
              data: {
                nodeType: "video-generation",
                label: "E2E 视频生成",
                provider: "rest",
                connectionId: provider.id,
                model: "e2e-text-video-only",
                parts: [{ type: "text", text: "生成一段视频" }],
                inputs: [
                  { id: "prompt", kind: "text", label: "Prompt" },
                  {
                    id: "referenceVideos",
                    kind: "video[]",
                    label: "参考视频",
                    multiple: true,
                  },
                ],
                outputs: [{ id: "video", kind: "video", label: "视频" }],
                parameters: { duration: 5 },
              },
            },
          ],
          edges: [
            {
              id: "e2e-unsupported-video-edge",
              source: sourceId,
              sourceHandle: "asset",
              target: targetId,
              targetHandle: "referenceVideos",
              type: "smoothstep",
            },
          ],
          viewport: { x: 80, y: 70, zoom: 0.9 },
        },
      },
    });
    expect(savedFixture.ok()).toBeTruthy();

    await page.reload();
    const target = page.locator(`.react-flow__node[data-id="${targetId}"]`);
    await expect(target.getByText("视频 1", { exact: true })).toBeVisible();
    await expect(target.getByText("当前模型不支持视频输入")).toBeVisible();
    await expect(
      target.getByText(
        "模型“E2E 纯文生视频”不支持输入视频，请删除视频连线或更换模型",
      ),
    ).toBeVisible();
    expect(
      await target.locator(".node-linked-warning").evaluate((element) => ({
        clientWidth: element.clientWidth,
        scrollWidth: element.scrollWidth,
        fits: element.scrollWidth <= element.clientWidth,
        spanWidth: element.querySelector("span")?.getBoundingClientRect().width,
        whiteSpace: element.querySelector("span")
          ? getComputedStyle(element.querySelector("span")!).whiteSpace
          : null,
      })),
    ).toEqual({
      clientWidth: expect.any(Number),
      scrollWidth: expect.any(Number),
      fits: true,
      spanWidth: expect.any(Number),
      whiteSpace: "normal",
    });

    // The negative test must never reach an external generation API, even on regression.
    await page.route("**/api/runs", async (route) => {
      if (route.request().method() === "POST") await route.fulfill({ status: 422, json: { error: "E2E 禁止提交生成：输入校验应当在浏览器阻止请求" } });
      else await route.continue();
    });
    let runRequests = 0;
    page.on("request", (outgoing) => {
      if (
        outgoing.method() === "POST" &&
        new URL(outgoing.url()).pathname === "/api/runs"
      )
        runRequests += 1;
    });
    await target
      .getByRole("button", { name: "运行 E2E 视频生成 节点" })
      .click();
    await expect(
      page.getByText(/E2E 视频生成：模型“E2E 纯文生视频”不支持输入视频/),
    ).toBeVisible();
    await page.waitForTimeout(250);
    expect(runRequests).toBe(0);
    await target.screenshot({
      path: testInfo.outputPath("unsupported-video-warning.png"),
    });
  });

  test("新建图片节点可在自动保存触发前直接运行最新设置", async ({
    page,
    request,
  }) => {
    const connection = await createOfflineImageModelFixture(request);
    await openWorkspace(page);
    await page.locator(".react-flow__pane").click({
      button: "right",
      position: { x: 470, y: 520 },
    });
    await page
      .getByRole("menu", { name: "新建节点" })
      .getByRole("menuitem", { name: "图片节点" })
      .click();

    const imageNodes = page.locator(
      '.react-flow__node:has(.node-card[data-node-type="image-generation"])',
    );
    await expect(imageNodes).toHaveCount(2);
    await page.getByRole("button", { name: "Fit View", exact: true }).click();
    const createdNode = imageNodes.last();
    const createdId = await createdNode.getAttribute("data-id");
    expect(createdId).toBeTruthy();

    const editor = createdNode.locator(".tiptap-prompt");
    await editor.pressSequentially("一张可以立即运行的霓虹街景", { delay: 5 });
    const inspector = await openNodeParameters(createdNode, connection);
    await inspector.getByLabel("精确尺寸", { exact: true }).fill("1536x1024");
    await inspector.getByLabel("质量").selectOption("high");
    await inspector.getByLabel("数量").fill("2");
    await inspector.getByRole("button", { name: "关闭模型与参数面板" }).click();

    const runResponsePromise = page.waitForResponse(
      (response) =>
        response.url().endsWith("/api/runs") &&
        response.request().method() === "POST",
    );
    await createdNode
      .getByRole("button", { name: /^运行 .* 节点$/u })
      .click();
    const runResponse = await runResponsePromise;
    expect(runResponse.status()).toBe(201);
    const snapshot = (await runResponse.json()) as {
      run: { id: string; status: string };
    };

    await expect
      .poll(
        async () => {
          const response = await page.request.get(
            `/api/runs/${snapshot.run.id}`,
          );
          return ((await response.json()) as { run: { status: string } }).run
            .status;
        },
        { timeout: 20_000 },
      )
      .toBe("succeeded");

    const completedRun = await getJson<{
      run: { id: string; status: string };
      nodes: Array<{
        nodeId: string;
        status: string;
        outputAssetIds: string[];
      }>;
    }>(page.request, `/api/runs/${snapshot.run.id}`);
    const sourceRun = completedRun.nodes.find(
      (node) => node.nodeId === createdId,
    );
    expect(sourceRun?.outputAssetIds).toHaveLength(2);
    const outputAssetIds = sourceRun!.outputAssetIds;
    expect(new Set(outputAssetIds).size).toBe(2);

    await expect
      .poll(async () => {
        const canvas = await savedCanvas(page);
        return generatedResultsFor(
          canvas,
          String(createdId),
          snapshot.run.id,
        ).map((node) => [node.data.generatedOutputIndex, node.data.assetId]);
      })
      .toEqual([
        [0, outputAssetIds[0]],
        [1, outputAssetIds[1]],
      ]);

    const persisted = await savedCanvas(page);
    const savedNode = persisted.graph.nodes.find(
      (node) => node.id === createdId,
    );
    expect(savedNode?.data).toMatchObject({
      provider: "fake",
      connectionId: connection.id,
      model: "fake-image-v1",
      parts: [{ type: "text", text: "一张可以立即运行的霓虹街景" }],
      parameters: { size: "1536x1024", quality: "high", n: 2 },
    });
    const generatedResults = generatedResultsFor(
      persisted,
      String(createdId),
      snapshot.run.id,
    );
    expect(generatedResults).toHaveLength(2);
    await page.getByRole("button", { name: "Fit View" }).click();
    await expect(
      page.locator('.node-card[data-generated-result="true"]'),
    ).toHaveCount(2);
    expect(new Set(generatedResults.map((node) => node.id)).size).toBe(2);
    expect(
      new Set(generatedResults.map((node) => node.data.assetId)).size,
    ).toBe(2);
    for (const result of generatedResults) {
      expect(result.data).toMatchObject({
        generatedResult: true,
        generatedFromNodeId: createdId,
        generatedFromRunId: snapshot.run.id,
      });
      expect(persistedStyleAspectRatio(result)).toBeCloseTo(1536 / 1024, 2);
    }
    await expect(createdNode.locator(".node-generation-preview")).toHaveCount(
      0,
    );

    const generatedNodeIds = generatedResults.map((node) => node.id).sort();
    const resultSignatures = generatedResults
      .map((node) => [
        node.id,
        node.data.assetId,
        node.data.generatedOutputIndex,
      ])
      .sort((left, right) => String(left[0]).localeCompare(String(right[0])));

    const runsReloaded = page.waitForResponse(
      (response) =>
        response.url().includes("/api/runs?canvasId=") &&
        response.request().method() === "GET",
    );
    await page.reload();
    await runsReloaded;
    await page
      .getByRole("button", { name: "打开项目菜单", exact: true })
      .click();
    await page.getByRole("menuitem", { name: "运行历史", exact: true }).click();
    const reloadedHistory = page.getByRole("dialog", { name: "运行历史" });
    await expect(reloadedHistory.locator(".history-row").first()).toContainText(
      "已完成",
    );
    await reloadedHistory.getByRole("button", { name: "关闭" }).click();
    // Result materialization is persisted through the same 650ms save queue as
    // normal canvas edits. Waiting past it makes a reload-duplication bug
    // observable in the stored graph instead of only checking the initial load.
    await page.waitForTimeout(900);
    const restored = page.locator(
      `.react-flow__node[data-id="${String(createdId)}"]`,
    );
    await expect(restored.locator(".tiptap-prompt")).toContainText(
      "一张可以立即运行的霓虹街景",
    );
    await expect(restored).toContainText("1536x1024");
    await expect(restored).toContainText("high");
    await expect(restored.locator(".node-generation-preview")).toHaveCount(0);
    await page.getByRole("button", { name: "Fit View" }).click();
    await expect(
      page.locator('.node-card[data-generated-result="true"]'),
    ).toHaveCount(2);
    for (const resultId of generatedNodeIds) {
      await expect(
        page.locator(`.react-flow__node[data-id="${resultId}"]`),
      ).toBeVisible();
    }
    await expect
      .poll(async () => {
        const canvas = await savedCanvas(page);
        return generatedResultsFor(canvas, String(createdId), snapshot.run.id)
          .map((node) => [
            node.id,
            node.data.assetId,
            node.data.generatedOutputIndex,
          ])
          .sort((left, right) =>
            String(left[0]).localeCompare(String(right[0])),
          );
      })
      .toEqual(resultSignatures);
  });

  test("图片画面比例和视频比例会传递到独立结果节点", async ({
    page,
    request,
  }) => {
    const canvas = await getJson<CanvasResponse>(request, "/api/canvas");
    const saved = await request.put(`/api/canvas/${canvas.id}`, {
      data: { title: "E2E 结果比例", graph: resultAspectGraph() },
    });
    expect(saved.ok()).toBeTruthy();

    await gotoCanvasPage(page);
    const imageSource = page.locator(
      '.react-flow__node[data-id="e2e-aspect-image"]',
    );
    const videoSource = page.locator(
      '.react-flow__node[data-id="e2e-aspect-video"]',
    );
    await expect(imageSource).toBeVisible();
    await expect(videoSource).toBeVisible();
    await expect(imageSource.locator(".node-generation-preview")).toHaveCount(
      0,
    );
    await expect(videoSource.locator(".node-generation-preview")).toHaveCount(
      0,
    );

    const videoRun = await runNodeAndWait(
      page,
      "e2e-aspect-video",
      "竖版比例视频",
    );
    const imageRun = await runNodeAndWait(
      page,
      "e2e-aspect-image",
      "竖版比例图片",
    );
    const videoOutputIds = videoRun.nodes.find(
      (node) => node.nodeId === "e2e-aspect-video",
    )?.outputAssetIds;
    const imageOutputIds = imageRun.nodes.find(
      (node) => node.nodeId === "e2e-aspect-image",
    )?.outputAssetIds;
    expect(videoOutputIds).toHaveLength(1);
    expect(imageOutputIds).toHaveLength(1);

    await expect
      .poll(async () => {
        const current = await savedCanvas(page);
        return {
          image: generatedResultsFor(
            current,
            "e2e-aspect-image",
            imageRun.run.id,
          ).map((node) => node.data.assetId),
          video: generatedResultsFor(
            current,
            "e2e-aspect-video",
            videoRun.run.id,
          ).map((node) => node.data.assetId),
        };
      })
      .toEqual({ image: imageOutputIds, video: videoOutputIds });

    const persisted = await savedCanvas(page);
    const imageResult = generatedResultsFor(
      persisted,
      "e2e-aspect-image",
      imageRun.run.id,
    )[0]!;
    const videoResult = generatedResultsFor(
      persisted,
      "e2e-aspect-video",
      videoRun.run.id,
    )[0]!;
    expect(imageResult.data).toMatchObject({
      assetId: imageOutputIds![0],
      assetKind: "image",
      generatedResult: true,
      generatedFromNodeId: "e2e-aspect-image",
      generatedFromRunId: imageRun.run.id,
      generatedOutputIndex: 0,
    });
    expect(videoResult.data).toMatchObject({
      assetId: videoOutputIds![0],
      assetKind: "video",
      generatedResult: true,
      generatedFromNodeId: "e2e-aspect-video",
      generatedFromRunId: videoRun.run.id,
      generatedOutputIndex: 0,
    });
    expect(imageResult.id).not.toBe(videoResult.id);
    expect(imageResult.data.assetId).not.toBe(videoResult.data.assetId);
    expect(persistedStyleAspectRatio(imageResult)).toBeCloseTo(9 / 16, 2);
    expect(persistedStyleAspectRatio(videoResult)).toBeCloseTo(720 / 1280, 2);
    await page.getByRole("button", { name: "Fit View" }).click();
    await expect(
      page.locator('.node-card[data-generated-result="true"]'),
    ).toHaveCount(2);
  });

  test("把本地图片拖到画布会上传并创建可复用素材节点", async ({ page }) => {
    await openWorkspace(page);

    await page.locator(".react-flow__pane").evaluate(
      (pane, input) => {
        const bytes = Uint8Array.from(atob(input.base64), (value) =>
          value.charCodeAt(0),
        );
        const transfer = new DataTransfer();
        transfer.items.add(
          new File([bytes], input.name, { type: "image/png" }),
        );
        const bounds = pane.getBoundingClientRect();
        const options = {
          bubbles: true,
          cancelable: true,
          dataTransfer: transfer,
          clientX: bounds.left + 420,
          clientY: bounds.top + 420,
        };
        pane.dispatchEvent(new DragEvent("dragover", options));
        pane.dispatchEvent(new DragEvent("drop", options));
      },
      {
        base64: PNG_1X1.toString("base64"),
        name: "dragged-reference.png",
      },
    );

    await openLibrary(page);
    await expect(
      page.locator(".asset-name", { hasText: "dragged-reference.png" }),
    ).toBeVisible();
    await expect
      .poll(async () => {
        const canvas = await savedCanvas(page);
        return canvas.graph.nodes.find(
          (node) =>
            node.data.nodeType === "asset-input" &&
            node.data.label === "dragged-reference.png",
        )?.data;
      })
      .toMatchObject({ assetKind: "image" });
    await expect(
      page.locator('.node-card[data-pending-import="true"]', {
        hasText: "dragged-reference.png",
      }),
    ).toHaveCount(0);
  });

  test("大图片拖入画布时上传稳定", async ({ page }) => {
    await openWorkspace(page);
    const uploadResponsePromise = page.waitForResponse(
      (response) =>
        response.url().includes("/api/assets/upload") &&
        response.request().method() === "POST",
    );

    await page.locator(".react-flow__pane").evaluate(
      (pane, input) => {
        const header = Uint8Array.from(atob(input.base64), (value) =>
          value.charCodeAt(0),
        );
        const bytes = new Uint8Array(input.size);
        bytes.set(header);
        const transfer = new DataTransfer();
        transfer.items.add(
          new File([bytes], input.name, { type: "image/png" }),
        );
        const bounds = pane.getBoundingClientRect();
        const options = {
          bubbles: true,
          cancelable: true,
          dataTransfer: transfer,
          clientX: bounds.left + 420,
          clientY: bounds.top + 420,
        };
        pane.dispatchEvent(new DragEvent("dragover", options));
        pane.dispatchEvent(new DragEvent("drop", options));
      },
      {
        base64: PNG_1X1.toString("base64"),
        name: "large-dragged-reference.png",
        size: 15 * 1024 * 1024,
      },
    );

    const uploadResponse = await uploadResponsePromise;
    const uploadResponseBody = await uploadResponse.text();
    expect(uploadResponse.status(), uploadResponseBody).toBe(201);

    await openLibrary(page);
    await expect(
      page.locator(".asset-name", { hasText: "large-dragged-reference.png" }),
    ).toBeVisible({ timeout: 30_000 });
    await expect
      .poll(async () => {
        const canvas = await savedCanvas(page);
        return canvas.graph.nodes.find(
          (node) =>
            node.data.nodeType === "asset-input" &&
            node.data.label === "large-dragged-reference.png",
        )?.data;
      })
      .toMatchObject({ assetKind: "image" });
  });

  test("粘贴图片时立即显示本地预览并在后台完成导入", async ({ page }) => {
    await openWorkspace(page);
    await page.route("**/api/assets/upload*", async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 600));
      await route.continue();
    });

    await page.evaluate(
      (input) => {
        const bytes = Uint8Array.from(atob(input.base64), (value) =>
          value.charCodeAt(0),
        );
        const transfer = new DataTransfer();
        transfer.items.add(
          new File([bytes], input.name, { type: "image/png" }),
        );
        window.dispatchEvent(
          new ClipboardEvent("paste", {
            bubbles: true,
            cancelable: true,
            clipboardData: transfer,
          }),
        );
      },
      {
        base64: PNG_1X1.toString("base64"),
        name: "pasted-reference.png",
      },
    );

    await expect(
      page.locator('.node-card[data-pending-import="true"]', {
        hasText: "pasted-reference.png",
      }),
    ).toBeVisible();
    await expect
      .poll(async () => {
        const canvas = await savedCanvas(page);
        return canvas.graph.nodes.find(
          (node) =>
            node.data.nodeType === "asset-input" &&
            node.data.label === "pasted-reference.png",
        )?.data;
      })
      .toMatchObject({ assetKind: "image" });
    await expect(
      page.locator('.node-card[data-pending-import="true"]', {
        hasText: "pasted-reference.png",
      }),
    ).toHaveCount(0);
  });

  test("节点可自由缩放并在刷新后保留尺寸", async ({ page }) => {
    await openWorkspace(page);
    const node = page.locator('.react-flow__node[data-id="e2e-image"]');
    await node.click();
    const before = await node.boundingBox();
    expect(before).not.toBeNull();

    const handle = node.locator(
      ".react-flow__resize-control.handle.bottom.right",
    );
    await expect(handle).toBeVisible();
    const handleBox = await handle.boundingBox();
    expect(handleBox).not.toBeNull();
    await page.mouse.move(
      handleBox!.x + handleBox!.width / 2,
      handleBox!.y + handleBox!.height / 2,
    );
    await page.mouse.down();
    await page.mouse.move(handleBox!.x + 90, handleBox!.y + 70, { steps: 8 });
    await page.mouse.up();

    await expect
      .poll(async () => {
        const resized = await node.boundingBox();
        return resized ? [resized.width, resized.height] : [0, 0];
      })
      .toEqual([expect.any(Number), expect.any(Number)]);
    const after = await node.boundingBox();
    expect(after!.width).toBeGreaterThan(before!.width + 40);
    expect(after!.height).toBeGreaterThan(before!.height + 30);

    await expect
      .poll(async () => {
        const canvas = await savedCanvas(page);
        const saved = canvas.graph.nodes.find(
          (item) => item.id === "e2e-image",
        );
        return Number(saved?.width ?? saved?.style?.width ?? 0);
      })
      .toBeGreaterThan(before!.width + 40);

    await page.reload();
    const restored = page.locator('.react-flow__node[data-id="e2e-image"]');
    const restoredBox = await restored.boundingBox();
    expect(restoredBox!.width).toBeGreaterThan(before!.width + 40);
  });

  test("上传素材、保存结构化 @引用，并跑通 Fake 生图到生视频", async ({
    page,
  }) => {
    await openWorkspace(page);
    await openLibrary(page);

    await page.locator('.upload-label input[type="file"]').setInputFiles({
      name: REFERENCE_ASSET_NAME,
      mimeType: "image/png",
      buffer: PNG_1X1,
    });
    await expect(
      page.getByText(REFERENCE_ASSET_NAME, { exact: true }),
    ).toBeVisible();
    const asset = await uploadedAsset(page);

    const canvas = await savedCanvas(page);
    const linkedAssetNodeId = "e2e-mention-asset";
    canvas.graph.nodes.push({
      id: linkedAssetNodeId,
      type: "workflow",
      position: { x: 30, y: 430 },
      data: {
        nodeType: "asset-input",
        label: "E2E @引用素材",
        assetId: asset.id,
        assetKind: "image",
        outputs: [{ id: "asset", kind: "image", label: "图片" }],
      },
    });
    canvas.graph.edges.push({
      id: "e2e-mention-asset-image",
      source: linkedAssetNodeId,
      sourceHandle: "asset",
      target: "e2e-image",
      targetHandle: "references",
      type: "smoothstep",
    });
    const linkedFixture = await page.request.put(`/api/canvas/${canvas.id}`, {
      data: { title: canvas.title, graph: canvas.graph },
    });
    expect(linkedFixture.ok()).toBeTruthy();
    await page.reload();
    await openLibrary(page);
    await expect(
      page.locator(".asset-name").getByText(REFERENCE_ASSET_NAME, {
        exact: true,
      }),
    ).toBeVisible();
    await page
      .locator("aside.sidebar")
      .getByRole("button", { name: "关闭素材库" })
      .click();

    const promptNode = page.locator('.react-flow__node[data-id="e2e-image"]');
    await promptNode.click();
    const editor = promptNode.locator(".tiptap-prompt");
    await expect(editor).toBeVisible();
    await editor.fill("保留建筑轮廓，生成雨夜电影镜头 ");
    await editor.press("End");
    await editor.type("@");

    const mentionMenu = page.locator(".mention-floating-menu");
    await expect(mentionMenu).toBeVisible();
    await expect(mentionMenu.locator("button")).toContainText(
      REFERENCE_ASSET_NAME,
    );
    await editor.press("Enter");
    await page.getByRole("button", { name: "运行全部" }).focus();

    await expect(editor.locator('.mention-chip')).toContainText(REFERENCE_ASSET_NAME);

    await expect
      .poll(
        async () => {
          const canvas = await savedCanvas(page);
          const prompt = canvas.graph.nodes.find(
            (node) => node.id === "e2e-image",
          );
          return (prompt?.data.parts as Array<JsonRecord> | undefined)?.find(
            (part) => part.type === "asset",
          );
        },
        { timeout: 10_000 },
      )
      .toMatchObject({
        type: "asset",
        assetId: asset.id,
        role: "reference",
      });

    const runResponsePromise = page.waitForResponse(
      (response) =>
        response.url().endsWith("/api/runs") &&
        response.request().method() === "POST",
    );
    await page.getByRole("button", { name: "运行全部" }).click();
    const runResponse = await runResponsePromise;
    expect(runResponse.status()).toBe(201);
    const initialRun = (await runResponse.json()) as {
      run: { id: string; status: string };
    };

    await expect
      .poll(
        async () => {
          const response = await page.request.get(
            `/api/runs/${initialRun.run.id}`,
          );
          const snapshot = (await response.json()) as {
            run: { status: string };
          };
          return snapshot.run.status;
        },
        { timeout: 20_000 },
      )
      .toBe("succeeded");

    await expect
      .poll(
        async () => {
          const assets = await getJson<AssetResponse[]>(
            page.request,
            "/api/assets",
          );
          return assets
            .filter((item) => item.metadata.runId === initialRun.run.id)
            .map((item) => item.kind)
            .sort();
        },
        { timeout: 10_000 },
      )
      .toEqual(["image", "video"]);

    await page
      .getByRole("button", { name: "打开项目菜单", exact: true })
      .click();
    await page.getByRole("menuitem", { name: "运行历史", exact: true }).click();
    const history = page.getByRole("dialog", { name: "运行历史" });
    await expect(history.locator(".history-row").first()).toContainText(
      "整张画布",
    );
    await expect(history.locator(".history-row").first()).toContainText(
      "已完成",
    );
    await history.getByRole("button", { name: "关闭" }).click();

    await page.reload();
    await openLibrary(page);
    await expect(
      page.locator(".asset-name").getByText(REFERENCE_ASSET_NAME, {
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      page.locator('.react-flow__node[data-id="e2e-video"]'),
    ).toContainText("E2E 视频生成");
    const restored = await savedCanvas(page);
    expect(
      (
        restored.graph.nodes.find((node) => node.id === "e2e-video")?.data
          .lastOutputAssetIds as string[] | undefined
      )?.length,
    ).toBeGreaterThan(0);

    const restoredAssets = await getJson<AssetResponse[]>(
      page.request,
      "/api/assets",
    );
    const generatedImage = restoredAssets.find(
      (item) =>
        item.kind === "image" && item.metadata.runId === initialRun.run.id,
    );
    const generatedVideo = restoredAssets.find(
      (item) =>
        item.kind === "video" && item.metadata.runId === initialRun.run.id,
    );
    expect(generatedImage).toBeDefined();
    expect(generatedVideo).toBeDefined();
    await expect(page.locator(".asset-row")).toHaveCount(3);

    await page
      .locator(".asset-row")
      .filter({ hasText: generatedVideo!.name })
      .click();
    await expect
      .poll(async () => {
        const canvas = await savedCanvas(page);
        return canvas.graph.nodes.some(
          (node) =>
            node.data.nodeType === "asset-input" &&
            node.data.assetId === generatedVideo!.id,
        );
      })
      .toBe(true);

    await openLibrary(page);
    await page
      .locator(".asset-row")
      .filter({ hasText: generatedImage!.name })
      .click();
    await expect
      .poll(async () => {
        const canvas = await savedCanvas(page);
        return canvas.graph.nodes.some(
          (node) =>
            node.data.nodeType === "asset-input" &&
            node.data.assetId === generatedImage!.id,
        );
      })
      .toBe(true);
  });

  test("运行失败时由结果节点显示错误且不再出现底部状态栏", async ({
    page,
    request,
  }) => {
    await configureFakeScenario(request, "fail");
    await openWorkspace(page);

    await page.getByRole("button", { name: "运行全部", exact: true }).click();
    const failedResult = page.locator(
      '.generated-result-node[data-generated-status="failed"]',
    );
    await expect(failedResult).toBeVisible({ timeout: 20_000 });
    await expect(page.locator(".bottom-panel")).toHaveCount(0);
    await expect(page.locator("#run-error-panel")).toHaveCount(0);
  });

  test("统一设置移除旧版入口，已有连接和密钥保持可用", async ({ page }) => {
    const savedResponse = await page.request.post("/api/providers", { data: { name: "E2E Fake 连接", provider: "fake", apiKey: "e2e-secret-value", config: {defaultModel: "fake-image-v1"} } });
    expect(savedResponse.status()).toBe(201);
    const saved = await savedResponse.json();
    expect(saved.apiKeySet).toBe(true);
    expect(JSON.stringify(saved)).not.toContain("e2e-secret-value");
    await openWorkspace(page);
    await page.getByRole("button", { name: "API 设置", exact: true }).click();
    const dialog = page.getByRole("dialog", {name: "供应商与模型设置", exact: true});
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("button", {name: "高级连接与旧版配置"})).toHaveCount(0);
    await expect(dialog.getByRole("tab", {name: "供应商与模型", exact: true})).toBeVisible();
    await dialog.getByRole("button", {name: "关闭设置"}).click();
    const after = await getJson<Array<{id: string; apiKeySet: boolean}>>(page.request, "/api/providers");
    expect(after.find(item => item.id === saved.id)?.apiKeySet).toBe(true);
    const tested = await page.request.post(`/api/providers/${saved.id}/test`);
    expect(tested.ok()).toBeTruthy();
  });
  test("沧元算力预设按供应分组隔离模型", async ({ page }) => {
    await mockCangyuanBackupCatalog(page);
    await openWorkspace(page);
    const created = await page.request.post("/api/providers", { data: {
      name: `沧元 ${CANGYUAN_BACKUP_IMAGE_GROUP}`, provider: "rest", apiKey: "cangyuan-test-secret",
      config: { preset: "cangyuan-gpt-image-2", baseUrl: "https://ai.cangyuansuanli.cn", modelGroup: CANGYUAN_BACKUP_IMAGE_GROUP, defaultModel: "codex-gpt-image-2-1k", connector: cangyuanImageConnectorForGroup(CANGYUAN_BACKUP_IMAGE_GROUP) },
    } });
    expect(created.status()).toBe(201);
    await page.reload();
    const connections = await getJson<
      Array<{
        id: string;
        provider: string;
        config: JsonRecord;
      }>
    >(page.request, "/api/providers");
    const connection = connections.find(
      (item) => item.config.preset === "cangyuan-gpt-image-2",
    );
    expect(connection).toMatchObject({
      provider: "rest",
      config: {
        baseUrl: "https://ai.cangyuansuanli.cn",
        modelGroup: CANGYUAN_BACKUP_IMAGE_GROUP,
        defaultModel: "codex-gpt-image-2-1k",
      },
    });
    const models = await getJson<Array<{ id: string }>>(
      page.request,
      `/api/providers/${connection!.id}/models`,
    );
    expect(models.map((model) => model.id)).toEqual([
      "codex-gpt-image-2-1k",
      "gemini-banana-2.0",
      "gemini-banana-pro-4k",
    ]);


    const canvas = await savedCanvas(page);
    const image = canvas.graph.nodes.find(node => node.id === "e2e-image")!;
    Object.assign(image.data, { provider: "rest", connectionId: connection!.id, model: "codex-gpt-image-2-1k", parameters: { size: "auto", quality: "medium", n: 1 } });
    expect((await page.request.put(`/api/canvas/${canvas.id}`, { data: { graph: canvas.graph } })).ok()).toBeTruthy();
    await page.reload();
    await page.getByRole("button", { name: "打开 E2E 图片生成 模型与参数", exact: true }).click();
    const panel = page.getByRole("dialog", { name: "E2E 图片生成 模型与参数", exact: true });
    await expect(panel.getByRole("combobox", { name: "E2E 图片生成 模型群组", exact: true })).toContainText(CANGYUAN_BACKUP_IMAGE_GROUP);
    await expect(panel.getByRole("combobox", { name: "E2E 图片生成 模型", exact: true })).toContainText("codex-gpt-image-2-1k");
    await expect(panel.getByLabel("画面比例", { exact: true })).toHaveValue("auto");
    await expect(panel.getByLabel("分辨率", { exact: true })).toHaveValue("medium");
    await expect(panel.getByLabel("生成张数", { exact: true })).toHaveValue("1");
    await expect
      .poll(async () => {
        const canvas = await savedCanvas(page);
        return canvas.graph.nodes.find((node) => node.id === "e2e-image")?.data
          .parameters;
      })
      .toEqual({ size: "auto", quality: "medium", n: 1 });
  });

  test("项目 JSON 可导出并重新导入", async ({ page }) => {
    await openWorkspace(page);

    const downloadPromise = page.waitForEvent("download");
    await page
      .getByRole("button", { name: "打开项目菜单", exact: true })
      .click();
    await page
      .getByRole("menuitem", { name: "导出结构 JSON", exact: true })
      .click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/\.canvas\.json$/);
    const downloadPath = await download.path();
    expect(downloadPath).not.toBeNull();
    const exported = JSON.parse(await readFile(downloadPath!, "utf8")) as {
      format: string;
      version: number;
      title: string;
      graph: CanvasResponse["graph"];
    };
    expect(exported.format).toBe("super-canvas-project-json");
    expect(exported.version).toBe(1);
    expect(exported.title).toBe("E2E 验收画布");
    expect(
      exported.graph.nodes
        .filter((node) => node.data.generatedResult !== true)
        .map((node) => node.id)
        .sort(),
    ).toEqual(["e2e-image", "e2e-preview", "e2e-prompt", "e2e-video"]);

    const importedGraph: CanvasResponse["graph"] = {
      schemaVersion: 1,
      nodes: [
        {
          id: "imported-prompt",
          type: "workflow",
          position: { x: 120, y: 140 },
          data: {
            nodeType: "prompt",
            label: "导入后的 Prompt",
            parts: [{ type: "text", text: "来自导入文件" }],
            outputs: [{ id: "prompt", kind: "text", label: "提示词" }],
          },
        },
      ],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 },
    };
    await page.locator('input[type="file"][accept*=".json"]').setInputFiles({
      name: "import.canvas.json",
      mimeType: "application/json",
      buffer: Buffer.from(
        JSON.stringify({ title: "导入验收", graph: importedGraph }),
      ),
    });

    const importDialog = page.getByRole("dialog", {
      name: "确认替换当前画布",
    });
    await expect(importDialog).toBeVisible();
    await expect(importDialog.getByText("导入验收")).toBeVisible();
    await importDialog.getByRole("checkbox").uncheck();
    await importDialog
      .getByRole("button", { name: "替换当前画布", exact: true })
      .click();
    await expect(page.getByText("项目结构已导入并保存")).toBeVisible();
    await expect(
      page.locator('.react-flow__node[data-id="imported-prompt"]'),
    ).toContainText("导入后的 Prompt");
    await expect
      .poll(async () => (await savedCanvas(page)).graph.nodes[0]?.id)
      .toBe("imported-prompt");
  });

  test("导入新画布后立即刷新不会恢复导入前的未保存草稿", async ({ page }) => {
    await openWorkspace(page);
    await expect(page.getByRole("button", { name: "画布自动保存状态" })).toContainText("已保存");
    const canvas = await savedCanvas(page);
    const canvasRoute = `**/api/canvas/${canvas.id}`;
    const failSave = async (route: Route) => {
      if (route.request().method() === "PUT") return route.fulfill({ status: 503, json: { error: "E2E 导入前离线草稿" } });
      await route.continue();
    };
    await page.route(canvasRoute, failSave);
    await page.locator('.react-flow__node[data-id="e2e-prompt"] .tiptap-prompt').fill("不应在导入后恢复的旧草稿");
    await expect(page.getByRole("button", { name: "画布自动保存状态" })).toContainText("保存失败");
    await page.unroute(canvasRoute, failSave);
    const importedGraph: CanvasResponse["graph"] = {
      schemaVersion: 1,
      nodes: [{ id: "import-and-reload", type: "workflow", position: { x: 100, y: 100 }, data: {
        nodeType: "prompt", label: "导入并刷新后的新内容", parts: [{ type: "text", text: "以新导入文件为准" }], outputs: [{ id: "prompt", kind: "text", label: "提示词" }],
      } }],
      edges: [], viewport: { x: 0, y: 0, zoom: 1 },
    };
    await page.locator('input[type="file"][accept*=".json"]').setInputFiles({
      name: "import-and-reload.canvas.json", mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify({ title: "导入立即刷新验收", graph: importedGraph })),
    });
    const dialog = page.getByRole("dialog", { name: "确认替换当前画布" });
    await dialog.getByRole("checkbox").uncheck();
    await dialog.getByRole("button", { name: "替换当前画布", exact: true }).click();
    await expect(page.getByText("项目结构已导入并保存")).toBeVisible();
    await page.reload();
    await expect(page.locator('.react-flow__node[data-id="import-and-reload"]')).toContainText("以新导入文件为准");
    await expect(page.locator('.react-flow__node[data-id="e2e-prompt"]')).toHaveCount(0);
    await expect(page.getByRole("dialog", { name: "画布已在其他窗口更新" })).toHaveCount(0);
    expect((await savedCanvas(page)).graph.nodes.map((node) => node.id)).toEqual(["import-and-reload"]);
  });

  test("桌面端画布控件和缩略图在移除底部状态栏后保持可见", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openWorkspace(page);

    const controls = page.locator(".react-flow__controls");
    const miniMap = page.locator(".react-flow__minimap");
    await expect(controls).toBeVisible();
    await page.getByRole("button", { name: "小地图", exact: true }).click();
    await expect(miniMap).toBeVisible();
    await expect(page.locator(".bottom-panel")).toHaveCount(0);

    const [controlsBounds, miniMapBounds] = await Promise.all([
      controls.boundingBox(),
      miniMap.boundingBox(),
    ]);
    expect(controlsBounds).not.toBeNull();
    expect(miniMapBounds).not.toBeNull();
    expect(controlsBounds!.y + controlsBounds!.height).toBeLessThan(900);
    expect(miniMapBounds!.y + miniMapBounds!.height).toBeLessThan(900);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth === window.innerWidth,
      ),
    ).toBe(true);
  });

  test("768px 顶栏入口可达且画布工具栏由容器约束", async ({ page }) => {
    const viewportWidth = 768;
    await page.setViewportSize({ width: viewportWidth, height: 820 });
    await openWorkspace(page);

    const topbar = page.locator(".topbar");
    await expectInsideViewport(topbar, viewportWidth);
    for (const entry of [
      page.getByRole("button", { name: "打开节点与素材库" }),
      page.getByRole("button", { name: "智能体面板" }),
      page.getByRole("button", { name: "API 设置", exact: true }),
      page.getByRole("button", { name: "打开项目菜单" }),
    ]) {
      await expectInsideViewport(entry, viewportWidth);
    }

    const toolbar = page.locator(".canvas-toolbar");
    const canvas = page.locator(".canvas-wrap");
    const [toolbarBounds, canvasBounds, toolbarMetrics] = await Promise.all([
      toolbar.boundingBox(),
      canvas.boundingBox(),
      toolbar.evaluate((element) => ({
        clientWidth: element.clientWidth,
        scrollWidth: element.scrollWidth,
        overflowX: getComputedStyle(element).overflowX,
      })),
    ]);
    expect(toolbarBounds).not.toBeNull();
    expect(canvasBounds).not.toBeNull();
    expect(toolbarBounds!.x).toBeGreaterThanOrEqual(canvasBounds!.x);
    expect(toolbarBounds!.x + toolbarBounds!.width).toBeLessThanOrEqual(
      canvasBounds!.x + canvasBounds!.width + 0.5,
    );
    expect(toolbarMetrics.overflowX).toBe("auto");
    expect(toolbarMetrics.scrollWidth).toBeGreaterThanOrEqual(
      toolbarMetrics.clientWidth,
    );
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth === window.innerWidth,
      ),
    ).toBe(true);
  });

  test("900px 平板选择节点不打开参数面板，智能体入口可用", async ({ page }) => {
    await page.setViewportSize({ width: 900, height: 820 });
    await openWorkspace(page);

    const inspector = page.locator("aside.inspector");
    await expect(inspector).toBeHidden();
    await page.locator('.react-flow__node[data-id="e2e-prompt"]').click();
    await expect(inspector).toBeHidden();
    await page.getByRole("button", { name: "打开智能体", exact: true }).click();
    await expect(inspector).toBeVisible();
    await expect(inspector.locator(".agent-panel")).toBeVisible();
    await expect(
      page.locator('.react-flow__node[data-id="e2e-prompt"] .tiptap-prompt'),
    ).toBeVisible();

    const bounds = await inspector.boundingBox();
    expect(bounds).not.toBeNull();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(900);
  });

  test("移动端节点库和智能体可操作且不产生页面横向溢出", async ({ page }) => {
    const viewportWidth = 390;
    await page.setViewportSize({ width: viewportWidth, height: 844 });
    await openWorkspace(page);

    const sidebar = page.locator("aside.sidebar");
    const inspector = page.locator("aside.inspector");
    await expect(sidebar).toBeHidden();
    await expect(inspector).toBeHidden();
    await expect(page.locator(".react-flow__minimap")).toBeHidden();

    for (const entry of [
      page.getByRole("button", { name: "打开节点与素材库" }),
      page.getByRole("button", { name: "智能体面板" }),
      page.getByRole("button", { name: "API 设置", exact: true }),
      page.getByRole("button", { name: "打开项目菜单" }),
    ]) {
      await expectInsideViewport(entry, viewportWidth);
    }

    await page.getByRole("button", { name: "画笔模式", exact: true }).click();
    const toolbar = page.locator(".canvas-toolbar");
    const toolbarBounds = await toolbar.boundingBox();
    const toolbarMetrics = await toolbar.evaluate((element) => ({
      clientWidth: element.clientWidth,
      scrollWidth: element.scrollWidth,
      overflowX: getComputedStyle(element).overflowX,
    }));
    expect(toolbarBounds).not.toBeNull();
    expect(toolbarBounds!.x + toolbarBounds!.width).toBeLessThanOrEqual(
      viewportWidth + 0.5,
    );
    expect(toolbarMetrics.overflowX).toBe("auto");
    expect(toolbarMetrics.scrollWidth).toBeGreaterThan(
      toolbarMetrics.clientWidth,
    );
    await toolbar.evaluate((element) => {
      element.scrollLeft = element.scrollWidth;
    });
    await expect
      .poll(() => toolbar.evaluate((element) => element.scrollLeft))
      .toBeGreaterThan(0);
    await page.getByRole("button", { name: "抓手模式", exact: true }).click();

    await page.getByRole("button", { name: "API 设置", exact: true }).click();
    const settings = page.getByRole("dialog", {name: "供应商与模型设置", exact: true});
    await expectInsideViewport(settings, viewportWidth);
    await expect(settings.getByRole("button", {name: "高级连接与旧版配置"})).toHaveCount(0);
    await settings.getByRole("button", {name: "关闭设置"}).click();
    await page.getByRole("button", { name: "打开项目菜单" }).click();
    const projectMenu = page.getByRole("menu", { name: "项目操作" });
    await expect(projectMenu).toBeVisible();
    await expect(
      projectMenu.getByRole("menuitem", { name: "导出结构 JSON" }),
    ).toBeVisible();
    await expect(
      projectMenu.getByRole("menuitem", { name: "导出完整项目包（含素材）" }),
    ).toBeVisible();
    await expect(
      projectMenu.getByRole("menuitem", { name: "导入 JSON / 完整项目包" }),
    ).toBeVisible();
    await projectMenu.getByRole("menuitem", { name: "运行历史" }).click();

    const history = page.getByRole("dialog", { name: "运行历史" });
    await expect(history).toBeVisible();
    await history.getByRole("button", { name: "关闭" }).click();

    await page.getByRole("button", { name: "打开节点与素材库" }).click();
    await expect(sidebar).toBeVisible();
    await expect(sidebar.getByText("节点库")).toBeVisible();
    await sidebar.getByRole("button", { name: /Prompt/ }).click();

    await expect(sidebar).toBeHidden();
    await expect(inspector).toBeHidden();
    await expect(
      page
        .locator(
          '.react-flow__node:has(.node-card[data-node-type="prompt"]) .tiptap-prompt',
        )
        .last(),
    ).toBeVisible();
    await page.getByRole("button", { name: "智能体面板" }).click();
    await expect(inspector).toBeVisible();
    await expect(inspector.getByRole("tab")).toHaveCount(0);
    await expect(inspector.locator(".agent-panel")).toBeVisible();
    const bounds = await inspector.boundingBox();
    expect(bounds).not.toBeNull();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(viewportWidth + 0.5);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    await inspector.getByRole("button", { name: "关闭智能体", exact: true }).click();
    await expect(inspector).toBeHidden();
  });

  test("selected document text is copied instead of the selected canvas node", async ({
    page,
  }) => {
    await openWorkspace(page);
    await page
      .locator('.react-flow__node[data-id="e2e-prompt"] .node-head')
      .click();
    await expect(
      page.locator('.react-flow__node[data-id="e2e-prompt"]'),
    ).toHaveClass(/selected/);

    const copyResult = await page.evaluate(() => {
      const paragraph =
        document.querySelector<HTMLElement>("aside.inspector .agent-panel header strong");
      if (!paragraph) throw new Error("Inspector heading text is missing");
      const selection = window.getSelection();
      if (!selection) throw new Error("Document selection is unavailable");
      const range = document.createRange();
      range.selectNodeContents(paragraph);
      selection.removeAllRanges();
      selection.addRange(range);

      const clipboardData = new DataTransfer();
      const event = new ClipboardEvent("copy", {
        bubbles: true,
        cancelable: true,
        clipboardData,
      });
      paragraph.dispatchEvent(event);
      return {
        defaultPrevented: event.defaultPrevented,
        nodeClipboardMarker: clipboardData.getData(
          "application/x-super-canvas-nodes",
        ),
        selectedText: selection.toString(),
      };
    });

    expect(copyResult.selectedText.length).toBeGreaterThan(0);
    expect(copyResult.defaultPrevented).toBe(false);
    expect(copyResult.nodeClipboardMarker).toBe("");
    await expect(page.getByText("已复制 1 个节点")).toHaveCount(0);
  });
});


