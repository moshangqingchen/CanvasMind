import { readFile } from "node:fs/promises";
import {
  expect,
  test,
  type APIRequestContext,
  type Page,
  type Route,
} from "@playwright/test";
import { CANGYUAN_IMAGE_CONNECTOR } from "../lib/provider-presets";

const REFERENCE_ASSET_NAME = "e2e reference asset.png";
const PNG_1X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

type JsonRecord = Record<string, unknown>;

interface CanvasResponse {
  id: string;
  title: string;
  graph: {
    schemaVersion: number;
    nodes: Array<{
      id: string;
      type: string;
      position: { x: number; y: number };
      width?: number;
      height?: number;
      style?: JsonRecord;
      data: JsonRecord;
    }>;
    edges: Array<JsonRecord>;
    viewport?: { x: number; y: number; zoom: number };
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
  captured: Promise<RunResponse>;
  release: () => void;
  dispose: () => Promise<void>;
}

async function holdRunCreationResponse(page: Page): Promise<HeldRunCreation> {
  const routePattern = "**/api/runs";
  let released = false;
  let releaseResponse!: () => void;
  const responseGate = new Promise<void>((resolve) => {
    releaseResponse = resolve;
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
      const response = await route.fetch();
      resolveCaptured((await response.json()) as RunResponse);
      await responseGate;
      await route.fulfill({ response });
    } catch (error) {
      rejectCaptured(error);
    }
  };
  await page.route(routePattern, handler);
  return {
    captured,
    release: () => {
      if (released) return;
      released = true;
      releaseResponse();
    },
    dispose: async () => {
      if (!released) releaseResponse();
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

async function openWorkspace(page: Page): Promise<void> {
  await page.goto("/");
  await expect(page.getByText("超级画布").first()).toBeVisible();
  await expect(
    page.locator('.react-flow__node[data-id="e2e-prompt"]'),
  ).toBeVisible();
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
  ).toHaveAccessibleName("状态：succeeded");
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

  test("画布渲染固定工作流，并可新增和自动保存 Prompt", async ({ page }) => {
    await openWorkspace(page);

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

  test("复制粘贴节点时紧邻源节点并向下避让", async ({ page, request }) => {
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
                inputs: [
                  { id: "prompt", kind: "text", label: "Prompt" },
                ],
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

    await page.goto("/");
    const source = page.locator(
      '.react-flow__node[data-id="paste-source"]',
    );
    await expect(source).toBeVisible();
    await source.locator(".node-head").click();
    await page.keyboard.press("ControlOrMeta+C");
    await page.keyboard.press("ControlOrMeta+V");
    await expect(page.locator(".react-flow__node")).toHaveCount(2);
    await page.keyboard.press("ControlOrMeta+V");
    await expect(page.locator(".react-flow__node")).toHaveCount(3);

    await expect
      .poll(async () => {
        const saved = await savedCanvas(page);
        return saved.graph.nodes
          .filter((node) => node.id !== "paste-source")
          .map((node) => node.position)
          .sort((left, right) => left.y - right.y);
      })
      .toEqual([
        { x: 544, y: 180 },
        { x: 544, y: 406 },
      ]);
  });

  test("空白处右键新建图片节点，并可视化调整生成参数", async ({
    page,
    request,
  }) => {
    await createImageModelFixture(request);
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
    const inspector = page.locator("aside.inspector");
    await inspector.getByLabel("尺寸").fill("1536x1024");
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

  test("图片和视频节点内可编辑提示词，右侧统一配置并保存参数", async ({
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

    const inspector = page.locator("aside.inspector");
    const connectionSelect = inspector.getByLabel("API 连接");
    await connectionSelect.selectOption(connection.id);
    const modelInput = inspector.getByLabel("模型");
    await expect(modelInput).toBeVisible();
    await modelInput.fill("e2e-image-cinematic");
    await inspector.getByLabel("尺寸").fill("2160x3840");
    const imageConfigButton = imageNode.getByRole("button", {
      name: /打开 E2E 图片生成 模型与参数/u,
    });
    await imageConfigButton.click();
    const imageConfigPopover = page.getByRole("dialog", {
      name: "E2E 图片生成 模型与参数",
    });
    await expect(imageConfigPopover).toBeVisible();
    await expect(
      imageConfigPopover.getByLabel("E2E 图片生成 模型"),
    ).toHaveValue("e2e-image-cinematic");
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
    await expect(inspector.getByLabel("API 连接")).toHaveValue("fake-default");
    await expect(inspector.getByLabel("模型")).toHaveValue("fake-video-v1");
    await inspector.getByLabel("时长（秒）").fill("8");
    await inspector.getByLabel("画面比例").fill("720:1280");

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
    const restoredInspector = page.locator("aside.inspector");
    await expect(restoredInspector.getByLabel("API 连接")).toHaveValue(
      connection.id,
    );
    await expect(restoredInspector.getByLabel("模型")).toHaveValue(
      "e2e-image-cinematic",
    );
    await expect(restoredInspector.getByLabel("尺寸")).toHaveValue("2160x3840");
    await expect(restoredInspector.getByLabel("质量")).toHaveValue("high");
    await expect(restoredInspector.getByLabel("画面比例")).toHaveValue("9:16");
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

    await page.goto("/");
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
      const initial = await heldRun.captured;
      expect(initial.run.id).toBeTruthy();

      // The API response is still held here. These frames must be created
      // optimistically from n, before any generated asset exists.
      await page.getByRole("button", { name: "Fit View" }).click();
      const resultNodes = page.locator(
        ".react-flow__node:has(.generated-result-node)",
      );
      await expect(resultNodes).toHaveCount(2);
      await expect(
        resultNodes.locator('.generated-result-state.pending[role="status"]'),
      ).toHaveText(["正在生成", "正在生成"]);
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
        await expect(edge).toHaveClass(/\banimated\b/u);

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
      expect(completedResults.map((node) => node.position.x)).toEqual([
        90 + 420 + 24,
        90 + 420 + 24,
      ]);
      expect(completedResults[0]?.position.y).toBe(180);
      const firstResultHeight = Number.parseFloat(
        String(completedResults[0]?.style?.height),
      );
      expect(
        completedResults[1]!.position.y -
          (completedResults[0]!.position.y + firstResultHeight),
      ).toBeCloseTo(16);
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

    await page.goto("/");
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
      const initial = await heldRun.captured;
      await page.getByRole("button", { name: "Fit View" }).click();
      const resultNode = page.locator(
        ".react-flow__node:has(.generated-result-node)",
      );
      await expect(resultNode).toHaveCount(1);
      await expect(
        resultNode.locator('.generated-result-state.pending[role="status"]'),
      ).toContainText("正在生成");
      await expect(
        resultNode.locator(".generated-result-spinner"),
      ).toBeVisible();
      const pendingNodeId = await resultNode.getAttribute("data-id");
      expect(pendingNodeId).toBeTruthy();
      const resultEdge = page.locator(
        `.react-flow__edge[data-id="edge-generated-${pendingNodeId}"]`,
      );
      await expect(resultEdge).toHaveCount(1);
      await expect(resultEdge).toHaveClass(/\banimated\b/u);
      await expect(resultNode.getByLabel("输入 生成来源（image）")).toHaveCount(
        1,
      );
      await expect(resultNode.getByLabel("输出 图片（image）")).toHaveCount(1);

      heldRun.release();
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
      const retriedRun = await holdRunCreationResponse(page);
      try {
        const retryResponse = page.waitForResponse(
          (response) =>
            response.url().endsWith("/api/runs") &&
            response.request().method() === "POST",
        );
        const reloadedResultNode = page.locator(
          `.react-flow__node[data-id="${failedResult!.id}"]`,
        );
        await reloadedResultNode
          .getByRole("button", { name: "重新生成 生成图片 1" })
          .click();
        const retriedSnapshot = await retriedRun.captured;
        await expect(
          reloadedResultNode.locator(
            '.generated-result-node[data-generated-status="queued"]',
          ),
        ).toHaveCount(1);
        await expect(
          reloadedResultNode.locator(
            '.generated-result-state.pending[role="status"]',
          ),
        ).toContainText("正在生成");
        await expect(
          page.locator(".react-flow__node:has(.generated-result-node)"),
        ).toHaveCount(1);

        retriedRun.release();
        const completedRetryResponse = await retryResponse;
        expect(completedRetryResponse.request().postDataJSON()).toMatchObject({
          nodeId: sourceNodeId,
          scope: "node",
        });
        await expect
          .poll(
            async () =>
              (
                await getJson<RunResponse>(
                  page.request,
                  `/api/runs/${retriedSnapshot.run.id}`,
                )
              ).run.status,
            { timeout: 20_000 },
          )
          .toBe("failed");
        await expect(
          reloadedResultNode.getByRole("button", {
            name: "重新生成 生成图片 1",
          }),
        ).toBeVisible();
        expect(await reloadedResultNode.getAttribute("data-id")).toBe(
          failedResult!.id,
        );
      } finally {
        retriedRun.release();
        await retriedRun.dispose();
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

    const inspector = page.locator(".inspector");
    const resizeHandle = page.getByRole("separator", {
      name: "调整智能体面板宽度",
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
    await expect(
      resultActions.getByRole("link", { name: "下载 E2E 可缩放图片" }),
    ).toHaveAttribute("href", new RegExp(`/api/assets/${asset.id}/content$`));
    await resultActions
      .getByRole("button", { name: "查看 E2E 可缩放图片 原提示词" })
      .click();
    await expect(page.getByRole("note")).toContainText("E2E 原始生成提示词");
    await resultActions
      .getByRole("button", { name: "反推 E2E 可缩放图片 提示词" })
      .click();
    await expect(page.getByRole("textbox", { name: "智能体消息" })).toHaveValue(
      /反推一份可复现画面主体/u,
    );
    const agentComposer = page.locator(".agent-composer");
    await expect(agentComposer.getByLabel("智能体 API 供应商")).toHaveValue(
      "fake",
    );
    await expect(agentComposer.getByLabel("智能体模型群组")).toHaveValue(
      "默认群组",
    );
    await expect(agentComposer.getByLabel("智能体连接详情")).toHaveValue(/.+/u);
    await expect(agentComposer.getByLabel("智能体模型")).toHaveValue(
      "fake-image-v1",
    );
    await expect(page.locator(".agent-controls")).toHaveCount(0);
    const zoomToolbar = resultNode.getByRole("toolbar", {
      name: "图片缩放",
    });
    await expect(zoomToolbar).toBeVisible();
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

  test("连续点击两个重新生成会立即并行提交并显示各自状态", async ({
    page,
    request,
  }) => {
    const sourceNodeId = "e2e-queued-retries";
    const canvas = await getJson<CanvasResponse>(request, "/api/canvas");
    const saved = await request.put(`/api/canvas/${canvas.id}`, {
      data: {
        title: "E2E 连续重新生成",
        graph: generatedLifecycleGraph(sourceNodeId, "fail", 2),
      },
    });
    expect(saved.ok()).toBeTruthy();

    await page.goto("/");
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
    await expect(
      firstResult.getByRole("button", { name: "重新生成 生成图片 1" }),
    ).toBeVisible();
    await expect(
      secondResult.getByRole("button", { name: "重新生成 生成图片 2" }),
    ).toBeVisible();

    let retryPostCount = 0;
    const countRetryPost = (request: { method(): string; url(): string }) => {
      if (request.method() === "POST" && request.url().endsWith("/api/runs"))
        retryPostCount += 1;
    };
    page.on("request", countRetryPost);
    const heldRun = await holdRunCreationResponse(page);
    try {
      await firstResult
        .getByRole("button", { name: "重新生成 生成图片 1" })
        .click();
      await heldRun.captured;
      await expect(
        firstResult.locator('.generated-result-state.pending[role="status"]'),
      ).toContainText("正在生成");

      await secondResult
        .getByRole("button", { name: "重新生成 生成图片 2" })
        .click();
      await expect(
        secondResult.locator('.generated-result-state.pending[role="status"]'),
      ).toContainText("正在生成");
      await expect.poll(() => retryPostCount).toBe(2);

      heldRun.release();
    } finally {
      heldRun.release();
      await heldRun.dispose();
      page.off("request", countRetryPost);
    }
  });

  test("生成节点按类型编号并显示直接连接的素材缩略图", async ({
    page,
    request,
  }, testInfo) => {
    await openWorkspace(page);
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
  });

  test("模型文档不支持视频输入时在节点内提示并阻止请求", async ({
    page,
    request,
  }, testInfo) => {
    await openWorkspace(page);
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
    const createdNode = imageNodes.last();
    const createdId = await createdNode.getAttribute("data-id");
    expect(createdId).toBeTruthy();

    const editor = createdNode.locator(".tiptap-prompt");
    await editor.pressSequentially("一张可以立即运行的霓虹街景", { delay: 5 });
    const inspector = page.locator("aside.inspector");
    await inspector.getByLabel("API 连接").selectOption(connection.id);
    await inspector.getByLabel("模型").fill("fake-image-v1");
    await inspector.getByLabel("尺寸").fill("1536x1024");
    await inspector.getByLabel("质量").selectOption("high");
    await inspector.getByLabel("数量").fill("2");

    const runResponsePromise = page.waitForResponse(
      (response) =>
        response.url().endsWith("/api/runs") &&
        response.request().method() === "POST",
    );
    await createdNode
      .getByRole("button", { name: "运行 图片生成 节点" })
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
    await expect(page.locator(".run-summary")).toContainText("已完成");
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

    await page.goto("/");
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
          ).length,
          video: generatedResultsFor(
            current,
            "e2e-aspect-video",
            videoRun.run.id,
          ).length,
        };
      })
      .toEqual({ image: 1, video: 1 });

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

    const promptNode = page.locator('.react-flow__node[data-id="e2e-image"]');
    await promptNode.click();
    const inspector = page.locator("aside.inspector");
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

    const roleRow = inspector.locator(".mention-role-row");
    await expect(roleRow).toContainText(`@${REFERENCE_ASSET_NAME}`);
    await roleRow.locator("select").selectOption("reference");

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

    await expect(page.locator(".run-summary")).toContainText(
      "最近运行 已完成",
      { timeout: 10_000 },
    );
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

    await page.getByRole("button", { name: "历史" }).click();
    const history = page.getByRole("dialog", { name: "运行历史" });
    await expect(history.locator(".history-row").first()).toContainText(
      "整张画布",
    );
    await expect(history.locator(".history-row").first()).toContainText(
      "succeeded",
    );
    await history.getByRole("button", { name: "关闭" }).click();

    await page.reload();
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
    const assetPreview = page.getByRole("dialog", { name: "素材预览" });
    await expect(assetPreview).toContainText(generatedVideo!.name);
    await assetPreview.getByRole("button", { name: "关闭" }).click();

    await page
      .getByRole("button", { name: /素材输入/ })
      .first()
      .click();
    const reuseInspector = page.locator("aside.inspector");
    await reuseInspector
      .locator(".field")
      .filter({ hasText: "选择素材" })
      .locator("select")
      .selectOption(generatedImage!.id);
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

    await page.locator(".canvas-toolbar .button.primary").click();
    const failedResult = page.locator(
      '.generated-result-node[data-generated-status="failed"]',
    );
    await expect(failedResult).toBeVisible({ timeout: 20_000 });
    await expect(page.locator(".bottom-panel")).toHaveCount(0);
    await expect(page.locator("#run-error-panel")).toHaveCount(0);
  });

  test("供应商设置可保存、掩码返回并测试 Fake 连接", async ({ page }) => {
    await openWorkspace(page);
    await page.getByRole("button", { name: "API 设置", exact: true }).click();

    const dialog = page.getByRole("dialog", { name: "供应商设置" });
    await expect(dialog).toBeVisible();
    await dialog
      .locator(".field")
      .filter({ hasText: "连接名称" })
      .locator("input")
      .fill("E2E Fake 连接");
    await dialog
      .locator(".field")
      .filter({ hasText: "供应商" })
      .locator("select")
      .selectOption("fake");
    await dialog.locator('input[type="password"]').fill("e2e-secret-value");
    await dialog.getByRole("button", { name: "保存连接" }).click();
    await expect(dialog.getByText("连接已加密保存")).toBeVisible();

    const connections = await getJson<
      Array<{
        id: string;
        name: string;
        apiKeySet: boolean;
        apiKey: string;
      }>
    >(page.request, "/api/providers");
    const saved = connections.find(
      (connection) => connection.name === "E2E Fake 连接",
    );
    expect(saved).toMatchObject({ apiKeySet: true });
    expect(saved?.apiKey).not.toContain("e2e-secret-value");

    await dialog.getByRole("button", { name: "测试连接" }).click();
    await expect(dialog.getByText("连接测试成功")).toBeVisible();
  });

  test("沧元算力预设按供应分组隔离模型", async ({ page }) => {
    await openWorkspace(page);
    await page.getByRole("button", { name: "API 设置", exact: true }).click();

    const dialog = page.getByRole("dialog", { name: "供应商设置" });
    await dialog
      .locator(".field")
      .filter({ hasText: "供应商" })
      .locator("select")
      .selectOption("cangyuan-gpt-image-2");
    await expect(dialog.getByLabel("API Base URL")).toHaveValue(
      "https://ai.cangyuansuanli.cn",
    );
    await expect(dialog.getByLabel("模型分组")).toHaveValue("IMAGE");
    await expect(dialog.getByLabel("默认模型")).toHaveValue("gpt-image-2");
    await expect(dialog.getByLabel("默认模型").locator("option")).toHaveCount(
      9,
    );
    await expect(dialog.getByText("IMAGE · 当前可用 9 个模型")).toBeVisible();

    await dialog.getByLabel("模型分组").selectOption("备用image线路");
    await expect(dialog.getByLabel("默认模型")).toHaveValue(
      "codex-gpt-image-2-1k",
    );
    await expect(dialog.getByLabel("默认模型").locator("option")).toHaveCount(
      3,
    );
    await expect(
      dialog.getByText("备用image线路 · 当前可用 3 个模型"),
    ).toBeVisible();
    await dialog.getByLabel("API Key").fill("cangyuan-test-secret");
    await dialog.getByRole("button", { name: "保存连接" }).click();
    await expect(dialog.getByText("连接已加密保存")).toBeVisible();

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
        modelGroup: "备用image线路",
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

    await dialog.getByRole("button", { name: "关闭" }).click();
    await page.locator('.react-flow__node[data-id="e2e-image"]').click();
    const inspector = page.locator("aside.inspector");
    await inspector.getByLabel("API 连接").selectOption(connection!.id);
    await expect(inspector.getByLabel("API 连接")).toContainText(
      "备用image线路",
    );
    await expect(inspector.getByLabel("模型")).toHaveValue(
      "codex-gpt-image-2-1k",
    );
    await expect(inspector.getByLabel("画面比例")).toHaveValue("1:1");
    await expect(inspector.getByLabel("分辨率")).toHaveValue("low");
    await expect(inspector.getByLabel("生成张数")).toHaveValue("1");
    await expect
      .poll(async () => {
        const canvas = await savedCanvas(page);
        return canvas.graph.nodes.find((node) => node.id === "e2e-image")?.data
          .parameters;
      })
      .toEqual({ size: "1:1", quality: "low", n: 1 });
  });

  test("项目 JSON 可导出并重新导入", async ({ page }) => {
    await openWorkspace(page);

    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("button", { name: "导出" }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/\.canvas\.json$/);
    const downloadPath = await download.path();
    expect(downloadPath).not.toBeNull();
    const exported = JSON.parse(await readFile(downloadPath!, "utf8")) as {
      title: string;
      graph: CanvasResponse["graph"];
    };
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
    await page
      .locator('input[type="file"][accept="application/json,.json"]')
      .setInputFiles({
        name: "import.canvas.json",
        mimeType: "application/json",
        buffer: Buffer.from(
          JSON.stringify({ title: "导入验收", graph: importedGraph }),
        ),
      });

    await expect(page.getByText("项目已导入并保存")).toBeVisible();
    await expect(
      page.locator('.react-flow__node[data-id="imported-prompt"]'),
    ).toContainText("导入后的 Prompt");
    await expect
      .poll(async () => (await savedCanvas(page)).graph.nodes[0]?.id)
      .toBe("imported-prompt");
  });

  test("桌面端画布控件和缩略图在移除底部状态栏后保持可见", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openWorkspace(page);

    const controls = page.locator(".react-flow__controls");
    const miniMap = page.locator(".react-flow__minimap");
    await expect(controls).toBeVisible();
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
  });

  test("900px 平板选择节点后显示参数面板", async ({ page }) => {
    await page.setViewportSize({ width: 900, height: 820 });
    await openWorkspace(page);

    const inspector = page.locator("aside.inspector");
    await expect(inspector).toBeHidden();
    await page.locator('.react-flow__node[data-id="e2e-prompt"]').click();
    await expect(inspector).toBeVisible();
    await expect(inspector.getByLabel("节点名称")).toHaveValue("E2E Prompt");
    await expect(
      page.locator('.react-flow__node[data-id="e2e-prompt"] .tiptap-prompt'),
    ).toBeVisible();

    const bounds = await inspector.boundingBox();
    expect(bounds).not.toBeNull();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(900);
  });

  test("移动端节点库和参数面板可操作且不产生页面横向溢出", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openWorkspace(page);

    const sidebar = page.locator("aside.sidebar");
    const inspector = page.locator("aside.inspector");
    await expect(sidebar).toBeHidden();
    await expect(inspector).toBeHidden();
    await expect(page.locator(".react-flow__minimap")).toBeHidden();

    await page.getByRole("button", { name: "打开项目菜单" }).click();
    const projectMenu = page.getByRole("menu", { name: "项目操作" });
    await expect(projectMenu).toBeVisible();
    await expect(
      projectMenu.getByRole("menuitem", { name: "导出项目" }),
    ).toBeVisible();
    await expect(
      projectMenu.getByRole("menuitem", { name: "导入项目" }),
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
    await expect(inspector).toBeVisible();
    await expect(inspector.getByLabel("节点名称")).toHaveValue("Prompt");
    await expect(
      page
        .locator(
          '.react-flow__node:has(.node-card[data-node-type="prompt"]) .tiptap-prompt',
        )
        .last(),
    ).toBeVisible();
    await inspector.getByRole("button", { name: "关闭" }).click();
    await expect(inspector).toBeHidden();

    await page.getByRole("button", { name: "打开节点参数" }).click();
    await expect(inspector).toBeVisible();
    const bounds = await inspector.boundingBox();
    expect(bounds).not.toBeNull();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
  });
});
