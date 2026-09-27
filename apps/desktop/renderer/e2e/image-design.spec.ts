import { randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { unzipSync, strFromU8 } from "fflate";
import {
  expect,
  test as base,
  type APIRequestContext,
  type Locator,
  type Page,
} from "@playwright/test";

type JsonRecord = Record<string, unknown>;

interface DesignReview {
  status: "unreviewed" | "candidate" | "approved" | "rejected";
  note: string;
  revision: number;
  updatedAt: string;
}

interface DesignAsset {
  id: string;
  name: string;
  kind: string;
  metadata: JsonRecord & { imageDesignReview?: DesignReview };
}

interface CanvasNode {
  id: string;
  type: string;
  position: { x: number; y: number };
  data: JsonRecord;
}

interface DesignCanvas {
  id: string;
  title: string;
  revision: number;
  graph: {
    schemaVersion: number;
    nodes: CanvasNode[];
    edges: JsonRecord[];
    viewport: { x: number; y: number; zoom: number };
  };
}

interface DesignFixture {
  canvas: DesignCanvas;
  images: [DesignAsset, DesignAsset];
  runId: string;
  connectionId: string;
  browserRunSubmissions: string[];
}

async function getJson<T>(
  request: APIRequestContext,
  path: string,
): Promise<T> {
  const response = await request.get(path);
  expect(response.ok(), `${path} should succeed`).toBeTruthy();
  return response.json() as Promise<T>;
}

const test = base.extend<{ designFixture: DesignFixture }>({
  designFixture: async ({ request, page }, runTest) => {
    const fixtureId = `image-design-${randomUUID()}`;
    const connectionResponse = await request.post("/api/providers", {
      data: {
        name: `${fixtureId}-offline`,
        provider: "fake",
        apiKey: "e2e-offline-image-design",
        config: {
          defaultModel: "fake-image-v1",
          connector: {
            auth: { type: "none" },
            models: [
              {
                id: "fake-image-v1",
                name: "Offline Image Design",
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
                    control: "text",
                    valueType: "string",
                    default: "high",
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
    // Reuse the checked-in icon. No generated or locally composed image fixture.
    const imageBytes = await readFile(
      new URL("../../assets/icon.png", import.meta.url),
    );
    const upload = await request.post("/api/assets/upload", {
      multipart: {
        file: {
          name: `${fixtureId}-reference.png`,
          mimeType: "image/png",
          buffer: imageBytes,
        },
      },
    });
    expect(upload.status()).toBe(201);
    const reference = (await upload.json()) as DesignAsset;
    const graph: DesignCanvas["graph"] = {
      schemaVersion: 1,
      nodes: [
        {
          id: `${fixtureId}-reference`,
          type: "workflow",
          position: { x: 40, y: 100 },
          data: {
            nodeType: "asset-input",
            label: "已有商品参考图",
            assetId: reference.id,
            assetKind: "image",
            outputs: [{ id: "asset", kind: "image", label: "图片" }],
          },
        },
        {
          id: `${fixtureId}-image`,
          type: "workflow",
          position: { x: 400, y: 100 },
          data: {
            nodeType: "image-generation",
            label: "图片设计验收",
            provider: "fake",
            connectionId: connection.id,
            model: "fake-image-v1",
            fakeScenario: "sync",
            parts: [{ type: "text", text: "保持商品轮廓，将背景改为暖白色。" }],
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
            parameters: { size: "1024x1024", quality: "high", n: 2 },
          },
        },
      ],
      edges: [
        {
          id: `${fixtureId}-reference-edge`,
          source: `${fixtureId}-reference`,
          sourceHandle: "asset",
          target: `${fixtureId}-image`,
          targetHandle: "references",
          type: "smoothstep",
        },
      ],
      viewport: { x: 0, y: 0, zoom: 0.8 },
    };
    const created = await request.post("/api/canvas", {
      data: { id: fixtureId, title: fixtureId, graph },
    });
    expect(created.status()).toBe(201);
    const canvas = (await created.json()) as DesignCanvas;
    const runResponse = await request.post("/api/runs", {
      data: {
        canvasId: canvas.id,
        clientRequestId: `${fixtureId}-run`,
        scope: "node",
        nodeId: `${fixtureId}-image`,
      },
    });
    expect(runResponse.status()).toBe(201);
    const { run } = (await runResponse.json()) as { run: { id: string } };
    await expect
      .poll(
        async () => {
          const result = await getJson<{ run: { status: string } }>(
            request,
            `/api/runs/${run.id}`,
          );
          return result.run.status;
        },
        { timeout: 20_000 },
      )
      .toBe("succeeded");
    const images = (
      await getJson<DesignAsset[]>(request, "/api/assets")
    ).filter(
      (asset) => asset.kind === "image" && asset.metadata.runId === run.id,
    );
    expect(images).toHaveLength(2);

    // FakeProvider emits placeholder PNG headers. Only its image bytes are
    // replaced for browser rendering; asset/review/run APIs remain real.
    const imageIds = new Set(images.map((image) => image.id));
    await page.route("**/api/assets/**", async (route) => {
      const pathname = new URL(route.request().url()).pathname;
      const match = pathname.match(
        /^\/api\/assets\/([^/]+)\/(content|preview)$/u,
      );
      if (match && imageIds.has(decodeURIComponent(match[1]!))) {
        return route.fulfill({ contentType: "image/png", body: imageBytes });
      }
      return route.fallback();
    });
    const browserRunSubmissions: string[] = [];
    await page.route("**/api/runs", async (route) => {
      if (route.request().method() !== "POST") return route.fallback();
      browserRunSubmissions.push(route.request().postData() ?? "");
      return route.fulfill({
        status: 422,
        json: { error: "图片评审验收不允许自动提交生成" },
      });
    });

    await runTest({
      canvas,
      images: images as [DesignAsset, DesignAsset],
      runId: run.id,
      connectionId: connection.id,
      browserRunSubmissions,
    });

    // Only dispose of assets created by this fixture, never reset a workspace.
    await page.close();
    await Promise.all([
      ...[reference, ...images].map((asset) =>
        request.delete(`/api/assets/${asset.id}`),
      ),
      request.delete(`/api/projects/${canvas.id}`),
      request.delete(`/api/providers/${connection.id}`),
    ]);
  },
});

async function openHistory(
  page: Page,
  fixture: DesignFixture,
): Promise<Locator> {
  await page.goto(`/canvas/${encodeURIComponent(fixture.canvas.id)}`);
  await page.getByRole("button", { name: "历史生成", exact: true }).click();
  const history = page.getByRole("dialog", { name: "历史生成", exact: true });
  await expect(history).toBeVisible();
  return history;
}

function historyCard(history: Locator, asset: DesignAsset): Locator {
  return history.locator(".generation-history-card").filter({
    has: history.page().locator(`img[src*="/api/assets/${asset.id}/"]`),
  });
}

function reviewCard(history: Locator, asset: DesignAsset): Locator {
  return history.locator(`[data-asset-id="${asset.id}"]`);
}

async function openSingleReview(
  history: Locator,
  asset: DesignAsset,
): Promise<Locator> {
  await historyCard(history, asset)
    .getByRole("button", { name: `查看详情 ${asset.name}` })
    .click();
  await history.getByRole("button", { name: "放大评审" }).click();
  const card = reviewCard(history, asset);
  await expect(card).toBeVisible();
  return card;
}

async function savedReview(request: APIRequestContext, asset: DesignAsset) {
  return (await getJson<DesignAsset>(request, `/api/assets/${asset.id}`))
    .metadata.imageDesignReview;
}

test.describe("图片设计比稿与定稿", () => {
  test("比稿遮罩、返回和 Escape 均保护未保存评审", async ({ page, designFixture }) => {
    const history = await openHistory(page, designFixture);
    const card = await openSingleReview(history, designFixture.images[0]);
    const note = "遮罩关闭前必须保留的评审草稿";
    await card.getByRole("textbox").fill(note);
    const leavePrompt = history.getByText("还有 1 张图片的评审未保存", { exact: true });
    const backdrop = page.locator(".generation-history-backdrop");

    await backdrop.click({ position: { x: 2, y: 2 } });
    await expect(leavePrompt).toBeVisible();
    await history.getByRole("button", { name: "继续编辑评审", exact: true }).click();
    await expect(card.getByRole("textbox")).toHaveValue(note);

    await history.getByRole("button", { name: "返回图片列表", exact: true }).click();
    await expect(leavePrompt).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(leavePrompt).toHaveCount(0);
    await expect(card.getByRole("textbox")).toHaveValue(note);
    await page.keyboard.press("Escape");
    await expect(leavePrompt).toBeVisible();
    await history.getByRole("button", { name: "继续编辑评审", exact: true }).click();

    await backdrop.click({ position: { x: 2, y: 2 } });
    await history.getByRole("button", { name: "丢弃更改并继续", exact: true }).click();
    await expect(history).toHaveCount(0);
    await page.getByRole("button", { name: "历史生成", exact: true }).click();
    await expect(history.getByRole("heading", { name: "项目成果", exact: true })).toBeVisible();
  });

  test("比稿保存过程中遮罩不能关闭窗口", async ({ page, request, designFixture }) => {
    const asset = designFixture.images[0];
    const history = await openHistory(page, designFixture);
    const card = await openSingleReview(history, asset);
    await card.getByRole("textbox").fill("保存完成前不能关闭");
    let releaseSave!: () => void;
    const saving = new Promise<void>((resolve) => { releaseSave = resolve; });
    await page.route(`**/api/assets/${asset.id}/design-review`, async (route) => {
      await saving;
      await route.fallback();
    }, { times: 1 });
    try {
      await card.getByRole("button", { name: "保存评审", exact: true }).click();
      await expect(card.getByRole("button", { name: "保存中…", exact: true })).toBeDisabled();
      await expect(history.getByRole("button", { name: "返回图片列表", exact: true })).toBeDisabled();
      await page.locator(".generation-history-backdrop").click({ position: { x: 2, y: 2 } });
      await page.keyboard.press("Escape");
      await expect(card.getByRole("textbox")).toHaveValue("保存完成前不能关闭");
      await expect(history.getByText("还有 1 张图片的评审未保存", { exact: true })).toHaveCount(0);
    } finally {
      releaseSave();
    }
    await expect.poll(() => savedReview(request, asset)).toMatchObject({ note: "保存完成前不能关闭" });
    await expect(card.getByRole("button", { name: "保存评审", exact: true })).toBeDisabled();
    await page.locator(".generation-history-backdrop").click({ position: { x: 2, y: 2 } });
    await expect(history).toHaveCount(0);
  });

  test("两图同步缩放，定稿和备注保存后重载仍可筛选", async ({
    page,
    request,
    designFixture,
  }) => {
    const [first, second] = designFixture.images;
    let history = await openHistory(page, designFixture);
    await historyCard(history, first).getByRole("checkbox").click();
    await historyCard(history, second).getByRole("checkbox").click();
    await history
      .getByRole("button", { name: "并排比稿", exact: true })
      .click();
    const firstCard = reviewCard(history, first);
    const secondCard = reviewCard(history, second);
    await expect(firstCard).toBeVisible();
    await expect(secondCard).toBeVisible();

    await expect(firstCard.locator("img")).toBeVisible();
    await expect(secondCard.locator("img")).toBeVisible();
    await history.getByRole("button", { name: "150%", exact: true }).click();
    for (const card of [firstCard, secondCard]) {
      await expect
        .poll(() =>
          card
            .locator("img")
            .evaluate(
              (image: HTMLImageElement) =>
                image.getBoundingClientRect().width / image.naturalWidth,
            ),
        )
        .toBeCloseTo(1.5);
    }
    const imageTransform = (card: Locator) =>
      card
        .locator("img")
        .evaluate((image) => getComputedStyle(image).transform);
    const centered = await imageTransform(firstCard);
    await firstCard.getByRole("group").press("ArrowRight");
    await expect.poll(() => imageTransform(firstCard)).not.toBe(centered);
    expect(await imageTransform(firstCard)).toBe(
      await imageTransform(secondCard),
    );

    const note = `保留当前构图，商品文字已核对 ${designFixture.canvas.id}`;
    await firstCard.getByRole("combobox").selectOption("approved");
    await firstCard.getByRole("textbox").fill(note);
    await firstCard
      .getByRole("button", { name: "保存评审", exact: true })
      .click();
    await expect
      .poll(() => savedReview(request, first))
      .toMatchObject({
        status: "approved",
        note,
        revision: 1,
      });
    await secondCard.getByRole("combobox").selectOption("candidate");
    await secondCard
      .getByRole("button", { name: "保存评审", exact: true })
      .click();
    await expect
      .poll(() => savedReview(request, second))
      .toMatchObject({
        status: "candidate",
        revision: 1,
      });
    await history.getByRole("button", { name: "适合", exact: true }).click();
    await firstCard.getByRole("heading", { level: 3 }).scrollIntoViewIfNeeded();
    await history.screenshot({
      path: test.info().outputPath("image-design-compare.png"),
    });

    history = await openHistory(page, designFixture);
    await history.getByLabel("筛选评审状态").selectOption("approved");
    await history.getByLabel("搜索图片").fill(note);
    await expect(historyCard(history, first)).toBeVisible();
    await expect(historyCard(history, second)).toHaveCount(0);
    const restored = await openSingleReview(history, first);
    await expect(restored.getByRole("combobox")).toHaveValue("approved");
    await expect(restored.getByRole("textbox")).toHaveValue(note);
    expect(designFixture.browserRunSubmissions).toEqual([]);
  });

  test("定稿图片退出候选筛选后仅操作可见选择，删除候选不会误删定稿", async ({
    page,
    request,
    designFixture,
  }) => {
    const [approved, candidate] = designFixture.images;
    for (const asset of [approved, candidate]) {
      const response = await request.patch(
        `/api/assets/${asset.id}/design-review`,
        {
          data: { status: "candidate", note: "等待比稿", expectedRevision: 0 },
        },
      );
      expect(response.status()).toBe(200);
    }
    const history = await openHistory(page, designFixture);
    await history.getByLabel("筛选评审状态").selectOption("candidate");
    await historyCard(history, approved).getByRole("checkbox").click();
    await historyCard(history, candidate).getByRole("checkbox").click();
    await history
      .getByRole("button", { name: "并排比稿", exact: true })
      .click();

    const card = reviewCard(history, approved);
    const note = "这一版已定稿，后续删除候选时必须保留";
    await card.getByRole("combobox").selectOption("approved");
    await card.getByRole("textbox").fill(note);
    await card.getByRole("button", { name: "保存评审", exact: true }).click();
    await expect
      .poll(() => savedReview(request, approved))
      .toMatchObject({
        status: "approved",
        note,
        revision: 2,
      });
    await history
      .getByRole("button", { name: "返回图片列表", exact: true })
      .click();
    await expect(history.getByLabel("筛选评审状态")).toHaveValue("candidate");
    await expect(historyCard(history, approved)).toHaveCount(0);
    await expect(historyCard(history, candidate)).toBeVisible();
    await expect(history.getByRole("checkbox", { checked: true })).toHaveCount(1);
    await expect(history.getByRole("button", { name: "删除所选", exact: true })).toBeEnabled();
    await history
      .getByRole("button", { name: "删除所选", exact: true })
      .click();
    await expect(
      history.getByText("确认永久删除 1 张？", { exact: true }),
    ).toBeVisible();
    const deleted = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        new URL(response.url()).pathname === "/api/assets/bulk-delete",
    );
    await history
      .getByRole("button", { name: "确认删除", exact: true })
      .click();
    const deletedResponse = await deleted;
    expect(deletedResponse.status()).toBe(200);
    expect(deletedResponse.request().postDataJSON()).toEqual({
      assetIds: [candidate.id],
    });
    await expect(historyCard(history, candidate)).toHaveCount(0);
    expect((await request.get(`/api/assets/${candidate.id}`)).status()).toBe(
      404,
    );
    expect(await savedReview(request, approved)).toMatchObject({
      status: "approved",
      note,
      revision: 2,
    });
    expect(designFixture.browserRunSubmissions).toEqual([]);
  });

  test("保存失败保留草稿，取消离开后可以重试保存", async ({
    page,
    request,
    designFixture,
  }) => {
    const [asset] = designFixture.images;
    const history = await openHistory(page, designFixture);
    const card = await openSingleReview(history, asset);
    const note = "尚未保存：标题下移，保留商品外观";
    const badgeColors: string[] = [];
    for (const status of ["unreviewed", "candidate", "approved", "rejected"] as const) {
      await card.getByRole("combobox").selectOption(status);
      const badge = card.locator(`span[data-status="${status}"]`);
      await expect(badge).toBeVisible();
      await expect(badge).toHaveText({ unreviewed: "未标记", candidate: "候选", approved: "定稿", rejected: "淘汰" }[status]);
      await expect(badge.locator('svg[aria-hidden="true"]')).toHaveCount(1);
      await expect(badge).toHaveCSS("font-size", "12px");
      badgeColors.push(await badge.evaluate(element => getComputedStyle(element).color));
    }
    expect(new Set(badgeColors).size).toBe(4);
    await card.getByRole("combobox").selectOption("candidate");
    await card.getByRole("textbox").fill(note);
    await page.route(
      `**/api/assets/${asset.id}/design-review`,
      async (route) => {
        return route.fulfill({
          status: 503,
          json: { error: "测试保存暂时失败" },
        });
      },
      { times: 1 },
    );
    await card.getByRole("button", { name: "保存评审", exact: true }).click();
    await expect(card).toContainText("测试保存暂时失败");
    await expect(card.getByRole("textbox")).toHaveValue(note);
    expect(await savedReview(request, asset)).toBeUndefined();

    for (const closeMethod of ["backdrop", "escape"] as const) {
      if (closeMethod === "backdrop")
        await page.locator(".generation-history-backdrop").click({ position: { x: 2, y: 2 } });
      else await page.keyboard.press("Escape");
      await expect(history.getByText("还有 1 张图片的评审未保存", { exact: true })).toBeVisible();
      await history.getByRole("button", { name: "继续编辑评审", exact: true }).click();
      await expect(card.getByRole("textbox")).toHaveValue(note);
      await expect(card).toContainText("测试保存暂时失败");
    }

    await history
      .getByRole("button", { name: "返回图片列表", exact: true })
      .click();
    await expect(
      history.getByText("还有 1 张图片的评审未保存", { exact: true }),
    ).toBeVisible();
    await history
      .getByRole("button", { name: "继续编辑评审", exact: true })
      .click();
    await expect(card.getByRole("textbox")).toHaveValue(note);
    await card.getByRole("button", { name: "重试保存", exact: true }).click();
    await expect
      .poll(() => savedReview(request, asset))
      .toMatchObject({
        status: "candidate",
        note,
        revision: 1,
      });
    await history
      .getByRole("button", { name: "返回图片列表", exact: true })
      .click();
    await expect(historyCard(history, asset)).toBeVisible();
    expect(designFixture.browserRunSubmissions).toEqual([]);
  });

  test("其他窗口更新时报告版本冲突并保留本地备注", async ({
    page,
    request,
    designFixture,
  }) => {
    const [asset] = designFixture.images;
    const history = await openHistory(page, designFixture);
    const card = await openSingleReview(history, asset);
    const localNote = "当前窗口草稿：保留标题排版";
    await card.getByRole("combobox").selectOption("approved");
    await card.getByRole("textbox").fill(localNote);

    const remoteNote = "另一个窗口已选为候选";
    const remoteSave = await request.patch(
      `/api/assets/${asset.id}/design-review`,
      {
        data: { status: "candidate", note: remoteNote, expectedRevision: 0 },
      },
    );
    expect(remoteSave.status()).toBe(200);
    const conflict = page.waitForResponse(
      (response) =>
        response.request().method() === "PATCH" &&
        new URL(response.url()).pathname ===
          `/api/assets/${asset.id}/design-review`,
    );
    await card.getByRole("button", { name: "保存评审", exact: true }).click();
    expect((await conflict).status()).toBe(409);
    await expect(card.getByRole("alert")).toBeVisible();
    await expect(card.getByRole("textbox")).toHaveValue(localNote);
    expect(await savedReview(request, asset)).toMatchObject({
      status: "candidate",
      note: remoteNote,
      revision: 1,
    });
    await history
      .getByRole("button", { name: "返回图片列表", exact: true })
      .click();
    await history
      .getByRole("button", { name: "丢弃更改并继续", exact: true })
      .click();
    await expect(historyCard(history, asset)).toBeVisible();
    expect(designFixture.browserRunSubmissions).toEqual([]);
  });

  test("从选定版本继续修改保留原图和节点，且不自动提交生成", async ({
    page,
    request,
    designFixture,
  }) => {
    const [asset] = designFixture.images;
    const history = await openHistory(page, designFixture);
    const card = await openSingleReview(history, asset);
    const before = await getJson<DesignCanvas>(
      request,
      `/api/canvas/${designFixture.canvas.id}`,
    );
    await card
      .getByRole("button", { name: "从这版继续修改", exact: true })
      .click();

    await expect
      .poll(async () => {
        const saved = await getJson<DesignCanvas>(
          request,
          `/api/canvas/${designFixture.canvas.id}`,
        );
        return saved.graph.nodes.length;
      })
      .toBe(before.graph.nodes.length + 2);
    const saved = await getJson<DesignCanvas>(
      request,
      `/api/canvas/${designFixture.canvas.id}`,
    );
    for (const original of before.graph.nodes) {
      expect(
        saved.graph.nodes.find((node) => node.id === original.id)?.data,
      ).toMatchObject(original.data);
    }
    const oldIds = new Set(before.graph.nodes.map((node) => node.id));
    const added = saved.graph.nodes.filter((node) => !oldIds.has(node.id));
    const fixedInput = added.find(
      (node) => node.data.nodeType === "asset-input",
    );
    const imageNode = added.find(
      (node) => node.data.nodeType === "image-generation",
    );
    expect(fixedInput?.data).toMatchObject({
      assetId: asset.id,
      assetKind: "image",
    });
    expect(imageNode?.data).toMatchObject({
      provider: "fake",
      connectionId: designFixture.connectionId,
      model: "fake-image-v1",
      parameters: { size: "1024x1024", quality: "high", n: 1 },
    });
    expect(saved.graph.edges).toContainEqual(
      expect.objectContaining({
        source: fixedInput!.id,
        sourceHandle: "asset",
        target: imageNode!.id,
        targetHandle: "references",
      }),
    );
    expect(
      (await getJson<DesignAsset>(request, `/api/assets/${asset.id}`)).id,
    ).toBe(asset.id);
    expect(designFixture.browserRunSubmissions).toEqual([]);
  });

  test("原始模型信息缺失时明确提示并保持画布不变", async ({
    page,
    request,
    designFixture,
  }) => {
    const [asset] = designFixture.images;
    const history = await openHistory(page, designFixture);
    const card = await openSingleReview(history, asset);
    const before = await getJson<DesignCanvas>(
      request,
      `/api/canvas/${designFixture.canvas.id}`,
    );
    await page.route(`**/api/runs/${designFixture.runId}`, async (route) => {
      const response = await route.fetch();
      const snapshot = (await response.json()) as {
        nodes: Array<{ request?: unknown }>;
      };
      for (const node of snapshot.nodes) delete node.request;
      return route.fulfill({ response, json: snapshot });
    });
    await card
      .getByRole("button", { name: "从这版继续修改", exact: true })
      .click();
    await expect(
      page.getByText(
        "无法读取这张图片的原始生成配置，请将图片放入画布后手动选择编辑模型",
        { exact: true },
      ),
    ).toBeVisible();
    await expect(card).toBeVisible();
    const after = await getJson<DesignCanvas>(
      request,
      `/api/canvas/${designFixture.canvas.id}`,
    );
    expect(after.graph.nodes.map((node) => node.id)).toEqual(
      before.graph.nodes.map((node) => node.id),
    );
    for (const original of before.graph.nodes) {
      expect(
        after.graph.nodes.find((node) => node.id === original.id)?.data,
      ).toMatchObject(original.data);
    }
    expect(after.graph.edges).toEqual(before.graph.edges);
    expect(designFixture.browserRunSubmissions).toEqual([]);
  });
});


test("图片库保存评审期间保护输入，备注长度与服务端一致", async ({ page, request, designFixture }) => {
  const asset = designFixture.images[0];
  const history = await openHistory(page, designFixture);
  await historyCard(history, asset).getByRole("button", { name: `查看详情 ${asset.name}` }).click();
  const note = history.getByRole("textbox", { name: "评审备注", exact: true });
  const status = history.getByRole("combobox", { name: "评审状态", exact: true });
  await expect(note).toHaveAttribute("maxlength", "2000");
  await note.fill("已提交保存的评审");

  let releaseSave = () => {};
  const saveGate = new Promise<void>(resolve => { releaseSave = resolve; });
  await page.route(`**/api/assets/${asset.id}/design-review`, async route => {
    await saveGate;
    await route.fallback();
  });
  try {
    await history.getByRole("button", { name: "保存评审", exact: true }).click();
    await expect(note).toBeDisabled();
    await expect(status).toBeDisabled();
    await page.keyboard.press("Escape");
    await expect(history).toBeVisible();
    releaseSave();
    await expect.poll(() => savedReview(request, asset)).toMatchObject({ note: "已提交保存的评审", revision: 1 });
    await expect(note).toBeEnabled();
    await note.fill("保存完成后继续编辑的草稿");
    await history.getByRole("button", { name: "保存评审", exact: true }).click();
    await expect.poll(() => savedReview(request, asset)).toMatchObject({ note: "保存完成后继续编辑的草稿", revision: 2 });
  } finally {
    releaseSave();
  }
});

test("定稿交付包保留原图字节、实际尺寸和已确认评审", async ({page, request, designFixture}) => {
  const assetId = String(designFixture.canvas.graph.nodes[0]!.data.assetId);
  expect((await request.patch(`/api/assets/${assetId}/design-review`, { data: { status: "approved", note: "已确认最终版本", expectedRevision: 0 } })).ok()).toBeTruthy();
  const history = await openHistory(page, designFixture);
  const original = await getJson<DesignAsset>(request, `/api/assets/${assetId}`);
  await historyCard(history, original).getByRole("button", { name: `查看详情 ${original.name}` }).click();
  const details = history.getByRole("complementary", { name: "作品详情" });
  await details.getByText("交付检查与导出", { exact: true }).click();
  const exportButton = details.getByRole("button", { name: "导出定稿交付包" });
  await expect(exportButton).toBeDisabled();
  for (const label of ["标题、日期、电话、地址与价格已逐项核对", "客户要求的文字、标志和主体完整，无遗漏", "实际像素、比例和安全范围符合交付要求", "这张图片是本次确认交付的最终版本"]) {
    await details.getByRole("checkbox", { name: label, exact: true }).check();
  }
  await expect(exportButton).toBeEnabled();
  const download = page.waitForEvent("download");
  await exportButton.click();
  const archive = unzipSync(new Uint8Array(await readFile((await (await download).path())!)));
  expect(Buffer.from(archive["final.png"]!)).toEqual(await readFile(new URL("../../assets/icon.png", import.meta.url)));
  const record = JSON.parse(strFromU8(archive["delivery.json"]!));
  expect(record.review).toMatchObject({status: "approved", note: "已确认最终版本"});
  expect(record.image.width).toBeGreaterThan(0);
  expect(record.image.height).toBeGreaterThan(0);
  expect(record.checks).toHaveLength(4);
  expect(designFixture.browserRunSubmissions).toEqual([]);
});

test("任务中心展示当前项目状态并导出不含提示词的诊断", async ({page, designFixture}, testInfo) => {
  await page.goto(`/canvas/${encodeURIComponent(designFixture.canvas.id)}`);
  await page.getByRole("button", {name: "打开项目菜单"}).click();
  await page.getByRole("menuitem", {name: "运行历史"}).click();
  const center = page.getByRole("dialog", {name: "运行历史", exact: true});
  await expect(center.getByRole("heading", {name: "任务中心"})).toBeVisible();
  await center.getByLabel("筛选任务状态").selectOption("succeeded");
  await expect(center.getByText("已完成", {exact: true}).last()).toBeVisible();
  await center.getByText("查看任务进度", {exact: true}).click();
  const downloaded = page.waitForEvent("download");
  await center.getByRole("button", {name: "导出诊断信息"}).click();
  const file = await downloaded;
  const output = JSON.parse(await readFile((await file.path())!, "utf8"));
  expect(output.run.id).toBe(designFixture.runId);
  expect(JSON.stringify(output)).not.toContain("保持商品轮廓");
  expect(JSON.stringify(output)).not.toContain("e2e-offline-image-design");
  await page.screenshot({path: testInfo.outputPath("task-center.png"), fullPage: true});
});

test("项目成果隔离、版本查看与评审意见带入修改节点", async ({ page, request, designFixture }, testInfo) => {
  const [asset] = designFixture.images;
  const note = "日期调整为10月1日，保持其他内容";
  const reviewed = await request.patch(`/api/assets/${asset.id}/design-review`, {data: {status: "approved", note, expectedRevision: 0}});
  expect(reviewed.ok()).toBeTruthy();
  await page.route("**/api/assets", async route => {
    const response = await route.fetch(); const assets = await response.json();
    await route.fulfill({json: [...assets, {...asset, id: "foreign-project-image", name: "其他项目图片", metadata: {runId: "other-run", nodeId: "other-node"}}]});
  });
  const history = await openHistory(page, designFixture);
  await expect(history.getByLabel("作品范围")).toHaveValue("project");
  await expect(history.locator(".library-card")).toHaveCount(2);
  await history.getByLabel("作品范围").selectOption("all");
  await expect(history.getByText("其他项目图片", {exact: true})).toBeVisible();
  await history.getByLabel("作品范围").selectOption("project");
  await expect(history.getByText("其他项目图片", {exact: true})).toHaveCount(0);
  await historyCard(history, asset).getByRole("button", {name: `查看详情 ${asset.name}`}).click();
  const details = history.getByRole("complementary", {name: "作品详情"});
  await expect(details.getByRole("navigation", {name: "作品版本"}).getByRole("button")).toHaveCount(2);
  await details.getByText("交付检查与导出", {exact: true}).click();
  await expect(details.getByRole("button", {name: "导出定稿交付包"})).toBeDisabled();
  await page.screenshot({path: testInfo.outputPath("project-results.png"), fullPage: true});
  await details.getByRole("button", {name: "继续创作", exact: true}).click();
  await expect(history).toBeHidden();
  await expect.poll(async () => {
    const response = await request.get(`/api/canvas/${designFixture.canvas.id}`); const canvas = await response.json();
    return canvas.graph.nodes.find((node: CanvasNode) => node.data.designSourceAssetId === asset.id)?.data.parts;
  }).toEqual([{type: "text", text: note}]);
  expect(designFixture.browserRunSubmissions).toEqual([]);
});

test.describe("大图库滚动性能", () => {
// Recording every DOM snapshot changes the memory and frame cost of this
// thousand-asset fixture. Keep assertions, screenshots and page-error checks.
test.use({ trace: "off" });
test("新版图片库保留浏览、侧边评审草稿并限制大图库的 DOM 数量", async ({ page, designFixture }) => {
  test.setTimeout(90000);
  const pageErrors: string[] = [];
  page.on("pageerror", error => pageErrors.push(error.message));
  const icons = await readFile(new URL("../../assets/icon.png", import.meta.url));
  const base = designFixture.images[0];
  const gallery = Array.from({ length: 1000 }, (_, index) => ({ ...base, id: `virtual-image-${index}`, metadata: { runId: `virtual-history-${index}` }, name: `城市建筑与自然光影的探索作品 ${String(index).padStart(4, "0")}`, createdAt: new Date(2026, 8, 21, 12, 0, index).toISOString() }));
  await page.route("**/api/assets", route => route.fulfill({ json: gallery }));
  await page.route("**/api/assets/virtual-image-*/preview?*", route => route.fulfill({ contentType: "image/png", body: icons }));
  const history = await openHistory(page, designFixture);
  await history.getByLabel("作品范围").selectOption("all");
  await expect(history.getByText("1000 张作品", { exact: true })).toBeVisible();
  expect(await history.locator(".library-card").count()).toBeLessThan(40);
  const scroller = history.locator(".library-scroll");
  await expect(scroller).toHaveCSS("overflow-anchor", "none");
  await scroller.evaluate(element => { element.scrollTop = 2900; });
  const visiblePreviewName = () => history.locator(".generation-history-preview").evaluateAll(elements => {
    const viewport = document.querySelector(".library-scroll")?.getBoundingClientRect();
    if (!viewport) return "";
    return elements.find(element => {
      const rect = element.getBoundingClientRect();
      return rect.top >= viewport.top && rect.bottom <= viewport.bottom;
    })?.getAttribute("aria-label") ?? "";
  });
  // The first mounted card belongs to the offscreen overscan row. Clicking it
  // makes Playwright scroll before the inspector opens, invalidating the saved
  // position assertion. Use a card the user can already see and reopen that
  // same asset after the inspector is closed.
  await expect.poll(visiblePreviewName).not.toBe("");
  const previewName = await visiblePreviewName();
  const before = await scroller.evaluate(element => element.scrollTop);
  await history.getByRole("button", { name: previewName, exact: true }).click();
  await expect(history.getByRole("complementary", { name: "作品详情" })).toBeVisible();
  await history.getByRole("textbox", { name: "评审备注", exact: true }).fill("侧栏草稿仍然保留");
  await history.getByRole("button", { name: "收起作品详情" }).click();
  await expect.poll(() => scroller.evaluate(element => element.scrollTop)).toBe(before);
  await history.getByRole("button", { name: previewName, exact: true }).click();
  await expect(history.getByRole("textbox", { name: "评审备注", exact: true })).toHaveValue("侧栏草稿仍然保留");
  await expect(history.locator(".library-inspector")).toHaveCSS("opacity", "1");
  await page.screenshot({ path: "../../../.codex-temp/redesign-gallery-desktop.png" });
  for (const width of [960, 640, 390]) {
    await page.setViewportSize({ width, height: 820 });
    const bounds = await history.boundingBox();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
    const inspector = await history.locator(".library-inspector").boundingBox();
    expect(inspector!.x).toBeGreaterThanOrEqual(0);
    expect(inspector!.x + inspector!.width).toBeLessThanOrEqual(width);
  }
  await page.screenshot({ path: "../../../.codex-temp/redesign-gallery-narrow.png" });
  await page.emulateMedia({ reducedMotion: "reduce" });
  expect(await history.locator(".library-inspector").evaluate(element => getComputedStyle(element).animationName)).toBe("none");
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.setViewportSize({width:1280,height:820});
  const frames = await scroller.evaluate(async element => {
    const samples:number[]=[];let last=performance.now();
    for(let i=0;i<100;i++){await new Promise(requestAnimationFrame);const now=performance.now();if(i)samples.push(now-last);last=now;element.scrollTop=i*45;}
    samples.sort((a,b)=>a-b);
    return {images:1000,samples:samples.length,p50:samples[Math.floor(samples.length*.5)],p95:samples[Math.floor(samples.length*.95)],max:samples.at(-1),mountedCards:document.querySelectorAll('.library-card').length};
  });
  await writeFile(new URL("../../../../.codex-temp/redesign-gallery-1000-performance.json",import.meta.url),JSON.stringify(frames,null,2));
  expect(pageErrors).toEqual([]);
});
});
