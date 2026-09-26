import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import {
  expect,
  test as base,
  type APIRequestContext,
  type Locator,
  type Page,
} from "@playwright/test";

type JsonRecord = Record<string, unknown>;

interface GraphicAsset {
  id: string;
  name: string;
  metadata: JsonRecord;
}

interface GraphicNode {
  id: string;
  type: string;
  position: { x: number; y: number };
  data: JsonRecord;
}

interface GraphicCanvas {
  id: string;
  graph: {
    schemaVersion: number;
    nodes: GraphicNode[];
    edges: JsonRecord[];
    viewport: { x: number; y: number; zoom: number };
  };
}

interface GraphicRun {
  run: { id: string; status: string; scope: string };
  nodes: Array<{
    nodeId: string;
    outputAssetIds: string[];
    request?: {
      model: string;
      connectionId: string;
      operation: string;
      assets?: Array<{ id: string }>;
      parameters: JsonRecord;
    };
  }>;
}

interface GraphicFixture {
  canvas: GraphicCanvas;
  reference: GraphicAsset;
  connectionId: string;
  browserRunSubmissions: JsonRecord[];
}

async function getJson<T>(
  request: APIRequestContext,
  path: string,
): Promise<T> {
  const response = await request.get(path);
  expect(response.ok(), `${path} should succeed`).toBeTruthy();
  return response.json() as Promise<T>;
}

const test = base.extend<{ graphicFixture: GraphicFixture }>({
  graphicFixture: async ({ request, page }, runTest) => {
    const fixtureId = `graphic-design-${randomUUID()}`;
    const connectionResponse = await request.post("/api/providers", {
      data: {
        name: `${fixtureId}-offline`,
        provider: "fake",
        apiKey: "e2e-offline-graphic-design",
        config: {
          defaultModel: "fake-image-v1",
          connector: {
            auth: { type: "none" },
            models: [
              {
                id: "fake-image-v1",
                name: "Offline Graphic Design",
                isDefault: true,
                operations: ["image.generate", "image.edit"],
                parameters: [
                  {
                    key: "size",
                    label: "尺寸",
                    control: "select",
                    valueType: "string",
                    default: "1024x1024",
                    options: [
                      { label: "方形", value: "1024x1024" },
                      { label: "横向", value: "1536x1024" },
                      { label: "竖向", value: "1024x1536" },
                    ],
                  },
                  {
                    key: "quality",
                    label: "质量",
                    control: "select",
                    valueType: "string",
                    default: "high",
                    options: [{ label: "高", value: "high" }],
                  },
                  {
                    key: "n",
                    label: "数量",
                    control: "number",
                    valueType: "integer",
                    default: 1,
                    min: 1,
                    max: 10,
                  },
                ],
              },
            ],
          },
        },
      },
    });
    expect(connectionResponse.status()).toBe(201);
    const connection = (await connectionResponse.json()) as { id: string };
    // The existing app icon is a fixture, not locally generated artwork.
    const imageBytes = await readFile(
      new URL("../../assets/icon.png", import.meta.url),
    );
    const uploadResponse = await request.post("/api/assets/upload", {
      multipart: {
        file: {
          name: `${fixtureId}-reference.png`,
          mimeType: "image/png",
          buffer: imageBytes,
        },
      },
    });
    expect(uploadResponse.status()).toBe(201);
    const reference = (await uploadResponse.json()) as GraphicAsset;
    const graph: GraphicCanvas["graph"] = {
      schemaVersion: 1,
      nodes: [
        {
          id: `${fixtureId}-reference`,
          type: "workflow",
          position: { x: 40, y: 100 },
          data: {
            nodeType: "asset-input",
            label: "原有品牌素材",
            assetId: reference.id,
            assetKind: "image",
            outputs: [{ id: "asset", kind: "image", label: "图片" }],
          },
        },
        {
          id: `${fixtureId}-existing-image`,
          type: "workflow",
          position: { x: 400, y: 100 },
          data: {
            nodeType: "image-generation",
            label: "原有设计不参与本次生成",
            provider: "fake",
            connectionId: connection.id,
            model: "fake-image-v1",
            fakeScenario: "sync",
            parts: [{ type: "text", text: "这是原有画布，请保持原样。" }],
            inputs: [
              { id: "prompt", kind: "text", label: "提示词" },
              {
                id: "references",
                kind: "image[]",
                label: "参考图",
                multiple: true,
              },
            ],
            outputs: [{ id: "images", kind: "image", label: "图片" }],
            parameters: { size: "1024x1024", quality: "high", n: 1 },
          },
        },
      ],
      edges: [
        {
          id: `${fixtureId}-existing-edge`,
          source: `${fixtureId}-reference`,
          sourceHandle: "asset",
          target: `${fixtureId}-existing-image`,
          targetHandle: "references",
          type: "smoothstep",
        },
      ],
      viewport: { x: 0, y: 0, zoom: 0.8 },
    };
    const canvasResponse = await request.post("/api/canvas", {
      data: { id: fixtureId, title: fixtureId, graph },
    });
    expect(canvasResponse.status()).toBe(201);
    const canvas = (await canvasResponse.json()) as GraphicCanvas;
    const browserRunSubmissions: JsonRecord[] = [];
    page.on("request", (requestEvent) => {
      if (
        requestEvent.method() === "POST" &&
        new URL(requestEvent.url()).pathname === "/api/runs"
      ) {
        browserRunSubmissions.push(requestEvent.postDataJSON() as JsonRecord);
      }
    });
    // FakeProvider returns a PNG header. Replace only browser image bytes with
    // the existing icon; creation, generation, storage and graph APIs stay real.
    await page.route("**/api/assets/**", async (route) => {
      if (
        /^\/api\/assets\/[^/]+\/(content|preview)$/u.test(
          new URL(route.request().url()).pathname,
        )
      ) {
        return route.fulfill({ contentType: "image/png", body: imageBytes });
      }
      return route.fallback();
    });

    try {
      await runTest({
        canvas,
        reference,
        connectionId: connection.id,
        browserRunSubmissions,
      });
    } finally {
      await page.close();
      const runs = await getJson<GraphicRun[]>(
        request,
        `/api/runs?canvasId=${canvas.id}`,
      );
      await Promise.all(
        runs
          .filter(
            (snapshot) =>
              !["succeeded", "failed", "cancelled"].includes(
                snapshot.run.status,
              ),
          )
          .map((snapshot) =>
            request.post(`/api/runs/${snapshot.run.id}/cancel`),
          ),
      );
      const runIds = new Set(runs.map((snapshot) => snapshot.run.id));
      const assets = await getJson<GraphicAsset[]>(request, "/api/assets");
      const ownedAssets = assets.filter(
        (asset) =>
          asset.id === reference.id || runIds.has(String(asset.metadata.runId)),
      );
      await Promise.all(
        ownedAssets.map((asset) => request.delete(`/api/assets/${asset.id}`)),
      );
      await request.delete(`/api/projects/${canvas.id}`);
      await request.delete(`/api/providers/${connection.id}`);
    }
  },
});

test("客户原话完整进入自定义比例设计，草稿与安全距离保留", async ({
  page,
  request,
  graphicFixture,
}) => {
  await page.route("**/api/agent/models", (route) =>
    route.fulfill({ json: [] }),
  );
  let studio = await openStudio(page, graphicFixture);
  await chooseModel(studio, graphicFixture);
  const original =
    "  请制作活动海报，全部条款不能少。\n活动：秋日市集\n时间：2026年10月1日 14:00\n电话：021-12345678\n儿童须由成人陪同。\n儿童须由成人陪同。  ";
  await studio.getByLabel("客户原文", { exact: true }).fill(original);
  await studio
    .getByRole("checkbox", { name: "自定义画面比例", exact: true })
    .check();
  await studio.getByLabel("画面宽度", { exact: true }).fill("210");
  await studio.getByLabel("画面高度", { exact: true }).fill("289");
  await studio.getByLabel("安全距离", { exact: true }).fill("7");
  await expect(studio).toContainText("203:282");
  await page.keyboard.press("Escape");
  studio = await openStudio(page, graphicFixture);
  await expect(studio.getByLabel("客户原文", { exact: true })).toHaveValue(
    original,
  );
  await expect(studio.getByLabel("安全距离", { exact: true })).toHaveValue("7");
  await studio.getByLabel("安全距离", { exact: true }).fill("210");
  await studio.getByRole("button", { name: "放入画布", exact: true }).click();
  await expect(studio.getByRole("alert")).toContainText("安全距离");
  expect(
    imageNodes(await savedCanvas(request, graphicFixture), graphicFixture),
  ).toHaveLength(0);
  await studio.getByLabel("安全距离", { exact: true }).fill("7");
  await studio.getByLabel("画面宽度", { exact: true }).scrollIntoViewIfNeeded();
  await studio.screenshot({
    path: test.info().outputPath("customer-layout.png"),
  });
  await studio.getByRole("button", { name: "放入画布", exact: true }).click();
  await expect(studio).not.toBeVisible();
  await expect
    .poll(
      async () =>
        imageNodes(await savedCanvas(request, graphicFixture), graphicFixture)
          .length,
    )
    .toBe(1);
  const node = imageNodes(
    await savedCanvas(request, graphicFixture),
    graphicFixture,
  )[0]!;
  expect(promptFor(node)).toContain(original);
  expect(promptFor(node)).toContain(
    "画面比例为 210:289。主要元素以及文字必须在居中的 203:282 范围之内",
  );
  expect(node.data.graphicDesignBrief).toMatchObject({
    customerText: original,
    layout: { enabled: true, width: "210", height: "289", safety: "7" },
  });
  expect(node.data.parameters).toMatchObject({ size: "1024x1024" });
  expect(graphicFixture.browserRunSubmissions).toEqual([]);
});

test("客户图片提取后必须核对，完整转录存档且不自动变成风格参考", async ({
  page,
  request,
  graphicFixture,
}) => {
  await page.route("**/api/agent/models", (route) =>
    route.fulfill({
      json: [
        {
          connectionId: "offline-extractor",
          modelId: "offline-vision",
          modelName: "离线提取测试",
          connectionName: "测试连接",
          supplierName: "测试",
          available: true,
          capabilities: { imageInput: true },
        },
      ],
    }),
  );
  const original = "  客户要求所有小字保留。\n联络电话不能省略。  ";
  const transcript =
    "秋日市集\n限量80席\n电话：021-12345678\n条款1：儿童须由成人陪同。\n条款2：儿童须由成人陪同。";
  let submitted: JsonRecord | undefined;
  await page.route("**/api/graphic-design/extract", async (route) => {
    submitted = route.request().postDataJSON() as JsonRecord;
    await route.fulfill({
      json: {
        sourceText: original,
        images: [
          {
            assetId: graphicFixture.reference.id,
            text: transcript,
            warnings: ["核对小字"],
          },
        ],
        fields: {
          headline: "自动标题",
          subheadline: "",
          body: "自动整理正文",
          eventDate: "",
          location: "",
          callToAction: "",
          brandName: "",
          constraints: "",
        },
        warnings: ["请核对全部文字"],
      },
    });
  });
  const studio = await openStudio(page, graphicFixture);
  await chooseModel(studio, graphicFixture);
  await studio.getByLabel("客户原文", { exact: true }).fill(original);
  await studio.getByLabel("主标题", { exact: true }).fill("手写标题保留");
  await studio
    .getByLabel("客户图片", { exact: true })
    .selectOption(graphicFixture.reference.id);
  await studio
    .getByRole("button", { name: "添加客户图片", exact: true })
    .click();
  await studio
    .getByRole("button", { name: "自动提取客户内容", exact: true })
    .click();
  const transcription = studio.getByLabel(
    `图片转录 ${graphicFixture.reference.name}`,
    { exact: true },
  );
  await expect(transcription).toHaveValue(transcript);
  expect(submitted).toMatchObject({
    text: original,
    imageAssetIds: [graphicFixture.reference.id],
    connectionId: "offline-extractor",
    modelId: "offline-vision",
  });
  await expect(studio.getByLabel("主标题", { exact: true })).toHaveValue(
    "手写标题保留",
  );
  await expect(studio.getByLabel("正文", { exact: true })).toHaveValue(
    "自动整理正文",
  );
  await studio.getByRole("button", { name: "放入画布", exact: true }).click();
  await expect(studio.getByRole("alert")).toContainText("核对");
  const confirmation = studio.getByRole("checkbox", {
    name: "我已对照原图逐字核对，确认全部文字完整无遗漏",
    exact: true,
  });
  await confirmation.check();
  const corrected = `${transcript}\n补充小字：不含停车费。`;
  await transcription.fill(corrected);
  await expect(confirmation).not.toBeChecked();
  await confirmation.check();
  await transcription.scrollIntoViewIfNeeded();
  await studio.screenshot({
    path: test.info().outputPath("customer-transcript.png"),
  });
  await studio.getByRole("button", { name: "放入画布", exact: true }).click();
  await expect(studio).not.toBeVisible();
  await expect
    .poll(
      async () =>
        imageNodes(await savedCanvas(request, graphicFixture), graphicFixture)
          .length,
    )
    .toBe(1);
  const canvas = await savedCanvas(request, graphicFixture);
  const node = imageNodes(canvas, graphicFixture)[0]!;
  expect(promptFor(node)).toContain(original);
  expect(promptFor(node)).toContain(corrected);
  expect(node.data.graphicDesignBrief).toMatchObject({
    customerImages: [{ assetId: graphicFixture.reference.id, text: corrected }],
    customerConfirmed: true,
    references: [],
  });
  const archived = addedNodes(canvas, graphicFixture).find(
    (item) => item.data.graphicDesignCustomerSource,
  );
  expect(archived?.data.assetId).toBe(graphicFixture.reference.id);
  expect(canvas.graph.edges.filter((edge) => edge.target === node.id)).toEqual(
    [],
  );
  expect(graphicFixture.browserRunSubmissions).toEqual([]);
});

async function openStudio(
  page: Page,
  fixture: GraphicFixture,
): Promise<Locator> {
  await page.goto(`/canvas/${encodeURIComponent(fixture.canvas.id)}`);
  await page.getByRole("button", { name: "打开平面设计", exact: true }).click();
  const studio = page.getByRole("dialog", { name: "平面设计", exact: true });
  await expect(studio).toBeVisible();
  return studio;
}

test("超长客户原文不被截断，提取失败保留手填内容", async ({
  page,
  request,
  graphicFixture,
}) => {
  await page.route("**/api/agent/models", (route) =>
    route.fulfill({
      json: [
        {
          connectionId: "offline-extractor",
          modelId: "offline-text",
          modelName: "离线文字测试",
          connectionName: "测试连接",
          supplierName: "测试",
          available: true,
          capabilities: { imageInput: false },
        },
      ],
    }),
  );
  let attempts = 0;
  await page.route("**/api/graphic-design/extract", async (route) => {
    attempts += 1;
    await route.fulfill({
      status: 502,
      json: { error: "提取模型请求失败或返回不完整，请重试；原文未改动" },
    });
  });
  const studio = await openStudio(page, graphicFixture);
  await chooseModel(studio, graphicFixture);
  const tooLong = "客".repeat(60001);
  await studio.getByLabel("客户原文", { exact: true }).fill(tooLong);
  await expect(studio.getByLabel("客户原文", { exact: true })).toHaveValue(
    tooLong,
  );
  await studio.getByRole("button", { name: "放入画布", exact: true }).click();
  await expect(studio.getByRole("alert")).toContainText("60000");
  expect(attempts).toBe(0);
  expect(
    imageNodes(await savedCanvas(request, graphicFixture), graphicFixture),
  ).toHaveLength(0);
  const original = "  失败时也保留此段原文\n票价 ¥128，咨询 021-12345678。  ";
  await studio.getByLabel("客户原文", { exact: true }).fill(original);
  await studio.getByLabel("主标题", { exact: true }).fill("我填写的标题");
  await studio
    .getByRole("button", { name: "自动提取客户内容", exact: true })
    .click();
  await expect(studio.getByRole("alert")).toContainText("原文未改动");
  await expect(studio.getByLabel("客户原文", { exact: true })).toHaveValue(
    original,
  );
  await expect(studio.getByLabel("主标题", { exact: true })).toHaveValue(
    "我填写的标题",
  );
  expect(attempts).toBe(1);
  expect(graphicFixture.browserRunSubmissions).toEqual([]);
});

async function savedCanvas(
  request: APIRequestContext,
  fixture: GraphicFixture,
) {
  return getJson<GraphicCanvas>(request, `/api/canvas/${fixture.canvas.id}`);
}

function addedNodes(canvas: GraphicCanvas, fixture: GraphicFixture) {
  const oldIds = new Set(fixture.canvas.graph.nodes.map((node) => node.id));
  return canvas.graph.nodes.filter((node) => !oldIds.has(node.id));
}

function imageNodes(canvas: GraphicCanvas, fixture: GraphicFixture) {
  return addedNodes(canvas, fixture).filter(
    (node) => node.data.nodeType === "image-generation",
  );
}

function promptFor(node: GraphicNode) {
  return (node.data.parts as Array<{ type: string; text?: string }>)
    .map((part) => part.text ?? "")
    .join("\n");
}

function expectOriginalGraphUnchanged(
  canvas: GraphicCanvas,
  fixture: GraphicFixture,
) {
  for (const original of fixture.canvas.graph.nodes) {
    expect(
      canvas.graph.nodes.find((node) => node.id === original.id)?.data,
    ).toMatchObject(original.data);
  }
  for (const edge of fixture.canvas.graph.edges)
    expect(canvas.graph.edges).toContainEqual(edge);
}

async function chooseModel(studio: Locator, fixture: GraphicFixture) {
  await studio
    .getByLabel("生成模型", { exact: true })
    .selectOption(`${fixture.connectionId}::fake-image-v1`);
}

async function fillEvent(studio: Locator) {
  await studio.getByRole("radio", { name: "新建设计", exact: true }).check();
  await studio.getByRole("radio", { name: /^活动海报/u }).check();
  await studio.getByLabel("主标题", { exact: true }).fill("秋日创意市集 2026");
  await studio
    .getByLabel("副标题", { exact: true })
    .fill("周末相聚，把灵感带回家");
  await studio
    .getByLabel("正文", { exact: true })
    .fill("手作展售 · 现场音乐\n限量 80 席，免费入场");
  await studio
    .getByLabel("活动时间", { exact: true })
    .fill("2026 年 10 月 1 日 14:00–20:00");
  await studio
    .getByLabel("活动地点", { exact: true })
    .fill("上海 · 滨江创意园 A 区");
  await studio
    .getByLabel("行动文案", { exact: true })
    .fill("立即预约，共度秋日");
}

async function addReference(
  studio: Locator,
  fixture: GraphicFixture,
  role: string,
) {
  await studio
    .getByLabel("参考素材", { exact: true })
    .selectOption(fixture.reference.id);
  await studio.getByRole("button", { name: "添加参考图", exact: true }).click();
  await studio
    .getByLabel(`素材用途 ${fixture.reference.name}`, { exact: true })
    .selectOption(role);
}

test.describe("平面设计工作台", () => {
  test("活动文案和品牌生成四个独立尺寸方案，放入画布不提交生成", async ({
    page,
    request,
    graphicFixture,
  }) => {
    await page.setViewportSize({ width: 1600, height: 1050 });
    const studio = await openStudio(page, graphicFixture);
    await chooseModel(studio, graphicFixture);
    await fillEvent(studio);
    await studio
      .locator("summary")
      .filter({ hasText: "品牌与更多要求" })
      .click();
    await studio.getByLabel("品牌名称", { exact: true }).fill("秋日实验室");
    await studio
      .getByLabel("品牌颜色", { exact: true })
      .fill("奶油白 #FFF8E7、松绿色 #245447");
    await studio.getByLabel("风格", { exact: true }).selectOption("现代简约");
    await studio
      .getByLabel("补充要求", { exact: true })
      .fill("活动时间和地点置于底部，保留足够安全边距。");
    await studio
      .getByRole("checkbox", { name: "模型默认尺寸", exact: true })
      .uncheck();
    await studio.getByRole("checkbox", { name: /方形/u }).check();
    await studio.getByRole("checkbox", { name: /竖向/u }).check();
    await studio
      .getByLabel("每种尺寸方案数", { exact: true })
      .selectOption("2");
    await studio
      .getByRole("heading", { name: "平面设计", exact: true })
      .scrollIntoViewIfNeeded();
    await studio.getByLabel("主标题", { exact: true }).scrollIntoViewIfNeeded();
    await studio.screenshot({
      path: test.info().outputPath("graphic-design-studio.png"),
    });
    await studio.getByRole("button", { name: "放入画布", exact: true }).click();
    await expect(studio).not.toBeVisible();
    await expect
      .poll(
        async () =>
          imageNodes(await savedCanvas(request, graphicFixture), graphicFixture)
            .length,
      )
      .toBe(4);
    const canvas = await savedCanvas(request, graphicFixture);
    const designs = imageNodes(canvas, graphicFixture);
    expect(addedNodes(canvas, graphicFixture)).toHaveLength(4);
    expectOriginalGraphUnchanged(canvas, graphicFixture);
    expect(new Set(designs.map((node) => node.id)).size).toBe(4);
    expect(
      new Set(designs.map((node) => node.data.graphicDesignBatchId)).size,
    ).toBe(1);
    expect(
      designs
        .map(
          (node) =>
            `${(node.data.parameters as JsonRecord).size}:${node.data.graphicDesignVariant}`,
        )
        .sort(),
    ).toEqual(["1024x1024:1", "1024x1024:2", "1024x1536:1", "1024x1536:2"]);
    for (const node of designs) {
      expect(node.data).toMatchObject({
        provider: "fake",
        connectionId: graphicFixture.connectionId,
        model: "fake-image-v1",
        parameters: { quality: "high", n: 1 },
      });
      const prompt = promptFor(node);
      for (const exactCopy of [
        "秋日创意市集 2026",
        "周末相聚，把灵感带回家",
        "手作展售 · 现场音乐\n限量 80 席，免费入场",
        "2026 年 10 月 1 日 14:00–20:00",
        "上海 · 滨江创意园 A 区",
        "立即预约，共度秋日",
        "秋日实验室",
        "奶油白 #FFF8E7、松绿色 #245447",
      ])
        expect(prompt).toContain(exactCopy);
      expect(prompt).toContain("不得虚构日期");
      expect(prompt).toContain("由当前图像模型直接生成");
    }
    expect(graphicFixture.browserRunSubmissions).toEqual([]);
    expect(
      await getJson<GraphicRun[]>(request, `/api/runs?canvasId=${canvas.id}`),
    ).toEqual([]);
  });

  test("生成设计只运行本次新增方案并保存真实生成结果", async ({
    page,
    request,
    graphicFixture,
  }) => {
    const studio = await openStudio(page, graphicFixture);
    await chooseModel(studio, graphicFixture);
    await studio.getByRole("radio", { name: "新建设计", exact: true }).check();
    await studio.getByRole("radio", { name: /^宣传图/u }).check();
    await studio
      .getByLabel("主标题", { exact: true })
      .fill("新店开幕 · 来见新意");
    await studio
      .getByLabel("每种尺寸方案数", { exact: true })
      .selectOption("2");
    await studio.getByRole("button", { name: "生成设计", exact: true }).click();
    await expect
      .poll(() => graphicFixture.browserRunSubmissions.length)
      .toBe(2);
    await expect
      .poll(
        async () => {
          const runs = await getJson<GraphicRun[]>(
            request,
            `/api/runs?canvasId=${graphicFixture.canvas.id}`,
          );
          return runs.map((snapshot) => snapshot.run.status).sort();
        },
        { timeout: 25_000 },
      )
      .toEqual(["succeeded", "succeeded"]);
    const canvas = await savedCanvas(request, graphicFixture);
    const designs = imageNodes(canvas, graphicFixture);
    expect(designs).toHaveLength(2);
    expectOriginalGraphUnchanged(canvas, graphicFixture);
    const generatedIds = new Set(designs.map((node) => node.id));
    for (const submission of graphicFixture.browserRunSubmissions) {
      expect(submission).toMatchObject({
        canvasId: graphicFixture.canvas.id,
        scope: "node",
      });
      expect(generatedIds.has(String(submission.nodeId))).toBe(true);
    }
    const runs = await getJson<GraphicRun[]>(
      request,
      `/api/runs?canvasId=${canvas.id}`,
    );
    const outputs = runs.flatMap((snapshot) =>
      snapshot.nodes.flatMap((node) => node.outputAssetIds),
    );
    expect(new Set(outputs).size).toBe(2);
    for (const snapshot of runs) {
      const generated = snapshot.nodes.find((node) =>
        generatedIds.has(node.nodeId),
      );
      expect(generated?.request).toMatchObject({
        model: "fake-image-v1",
        connectionId: graphicFixture.connectionId,
        operation: "image.generate",
        parameters: { n: 1 },
      });
      // Public run snapshots intentionally omit prompts. Check the saved source
      // associated with the successful node while keeping its API config strict.
      expect(
        promptFor(designs.find((node) => node.id === generated?.nodeId)!),
      ).toContain("新店开幕 · 来见新意");
    }
    for (const assetId of outputs)
      expect((await request.get(`/api/assets/${assetId}`)).status()).toBe(200);
  });

  test("修改已有图保留固定素材引用和修改范围，不运行原有节点", async ({
    page,
    request,
    graphicFixture,
  }) => {
    const studio = await openStudio(page, graphicFixture);
    await chooseModel(studio, graphicFixture);
    await studio
      .getByRole("radio", { name: "修改已有图", exact: true })
      .check();
    await studio
      .getByLabel("修改要求", { exact: true })
      .fill("只把活动时间改成 2026 年 10 月 2 日，保留构图、标志和其他文字。");
    await addReference(studio, graphicFixture, "source");
    await studio.getByRole("button", { name: "放入画布", exact: true }).click();
    await expect(studio).not.toBeVisible();
    await expect
      .poll(
        async () =>
          imageNodes(await savedCanvas(request, graphicFixture), graphicFixture)
            .length,
      )
      .toBe(1);
    const canvas = await savedCanvas(request, graphicFixture);
    const added = addedNodes(canvas, graphicFixture);
    expect(added).toHaveLength(2);
    const source = added.find((node) => node.data.nodeType === "asset-input")!;
    const design = imageNodes(canvas, graphicFixture)[0]!;
    expect(source.data).toMatchObject({
      assetId: graphicFixture.reference.id,
      assetKind: "image",
    });
    expect(source.id).not.toBe(graphicFixture.canvas.graph.nodes[0]!.id);
    expect(design.data.graphicDesignBrief).toMatchObject({
      mode: "revise",
      references: [{ assetId: graphicFixture.reference.id, role: "source" }],
    });
    expect(promptFor(design)).toContain("参考图 1（待修改原图）");
    expect(promptFor(design)).toContain(
      "只把活动时间改成 2026 年 10 月 2 日，保留构图、标志和其他文字。",
    );
    expect(promptFor(design)).toContain(
      "除要求变更的部分外，保留原图版面、主体、文字与风格",
    );
    expect(canvas.graph.edges).toContainEqual(
      expect.objectContaining({
        source: source.id,
        sourceHandle: "asset",
        target: design.id,
        targetHandle: "references",
      }),
    );
    expectOriginalGraphUnchanged(canvas, graphicFixture);
    expect(graphicFixture.browserRunSubmissions).toEqual([]);
  });

  test("关闭重开和刷新保留设计草稿，品牌预设可以重新应用", async ({
    page,
    request,
    graphicFixture,
  }) => {
    let studio = await openStudio(page, graphicFixture);
    await chooseModel(studio, graphicFixture);
    await studio.getByRole("radio", { name: "新建设计", exact: true }).check();
    await studio.getByRole("radio", { name: /^活动物料/u }).check();
    await studio.getByLabel("主标题", { exact: true }).fill("伙伴晚宴邀请函");
    await studio
      .getByLabel("活动地点", { exact: true })
      .fill("滨江创意园 · 一层大厅");
    await studio
      .locator("summary")
      .filter({ hasText: "品牌与更多要求" })
      .click();
    await studio.getByLabel("品牌名称", { exact: true }).fill("秋日实验室");
    await studio.getByLabel("品牌颜色", { exact: true }).fill("墨绿与奶油白");
    await studio.getByLabel("风格", { exact: true }).selectOption("东方雅致");
    await studio
      .getByRole("button", { name: "保存品牌预设", exact: true })
      .click();
    await page.keyboard.press("Escape");
    await expect(studio).not.toBeVisible();
    await page
      .getByRole("button", { name: "打开平面设计", exact: true })
      .click();
    studio = page.getByRole("dialog", { name: "平面设计", exact: true });
    await expect(studio.getByLabel("主标题", { exact: true })).toHaveValue(
      "伙伴晚宴邀请函",
    );
    await expect(studio.getByLabel("活动地点", { exact: true })).toHaveValue(
      "滨江创意园 · 一层大厅",
    );
    await expect(
      studio.getByRole("radio", { name: /^活动物料/u }),
    ).toBeChecked();
    await page.keyboard.press("Escape");
    studio = await openStudio(page, graphicFixture);
    await expect(studio.getByLabel("主标题", { exact: true })).toHaveValue(
      "伙伴晚宴邀请函",
    );
    await expect(studio.getByLabel("生成模型", { exact: true })).toHaveValue(
      `${graphicFixture.connectionId}::fake-image-v1`,
    );
    await studio
      .locator("summary")
      .filter({ hasText: "品牌与更多要求" })
      .click();
    await studio.getByLabel("品牌名称", { exact: true }).fill("临时品牌");
    await studio.getByLabel("品牌颜色", { exact: true }).fill("红色");
    await studio.getByLabel("风格", { exact: true }).selectOption("大胆撞色");
    await studio
      .getByLabel("品牌预设", { exact: true })
      .selectOption({ label: "秋日实验室" });
    await studio
      .getByRole("button", { name: "应用品牌预设", exact: true })
      .click();
    await expect(studio.getByLabel("品牌名称", { exact: true })).toHaveValue(
      "秋日实验室",
    );
    await expect(studio.getByLabel("品牌颜色", { exact: true })).toHaveValue(
      "墨绿与奶油白",
    );
    await expect(studio.getByLabel("风格", { exact: true })).toHaveValue(
      "东方雅致",
    );
    expect(
      (await savedCanvas(request, graphicFixture)).graph.nodes.map(
        ({ id }) => id,
      ),
    ).toEqual(graphicFixture.canvas.graph.nodes.map(({ id }) => id));
    expect(graphicFixture.browserRunSubmissions).toEqual([]);
  });

  test("缺少必要文案或原图已删除时不创建无效设计", async ({
    page,
    request,
    graphicFixture,
  }) => {
    const studio = await openStudio(page, graphicFixture);
    await chooseModel(studio, graphicFixture);
    await studio.getByRole("radio", { name: "新建设计", exact: true }).check();
    await studio.getByRole("button", { name: "放入画布", exact: true }).click();
    await expect(studio.getByRole("alert")).toHaveText("请填写主标题。");
    await studio.getByRole("button", { name: "生成设计", exact: true }).click();
    await expect(studio.getByRole("alert")).toHaveText("请填写主标题。");
    await studio
      .getByRole("radio", { name: "修改已有图", exact: true })
      .check();
    await studio
      .getByLabel("修改要求", { exact: true })
      .fill("保留其他元素，只调整标题颜色。");
    await studio.getByRole("button", { name: "放入画布", exact: true }).click();
    await expect(studio.getByRole("alert")).toContainText(
      "请将一张参考图设为改版原图",
    );
    await addReference(studio, graphicFixture, "source");
    const deleted = await request.delete(
      `/api/assets/${graphicFixture.reference.id}`,
    );
    expect(deleted.status()).toBe(200);
    await studio.getByRole("button", { name: "放入画布", exact: true }).click();
    await expect(studio.getByRole("alert")).toContainText("参考图已不可用");
    await expect(studio).toBeVisible();
    await expect(studio.getByLabel("修改要求", { exact: true })).toHaveValue(
      "保留其他元素，只调整标题颜色。",
    );
    const canvas = await savedCanvas(request, graphicFixture);
    expect(canvas.graph.nodes.map(({ id }) => id)).toEqual(
      graphicFixture.canvas.graph.nodes.map(({ id }) => id),
    );
    expect(canvas.graph.edges).toEqual(graphicFixture.canvas.graph.edges);
    expect(graphicFixture.browserRunSubmissions).toEqual([]);
  });
});
