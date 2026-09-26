import {
  expect,
  test,
  type APIRequestContext,
  type Page,
} from "@playwright/test";
import type { CanvasDocument, CanvasNode, RunSnapshot } from "../components/types";

interface MeasuredFiber {
  memoizedProps?: { data?: { nodeType?: string } };
  type?: unknown;
  flags: number;
  child?: MeasuredFiber | null;
  sibling?: MeasuredFiber | null;
}
type MeasuredWindow = typeof window & {
  __canvasRenderMetrics: { commits: number; nodes: number };
  __REACT_DEVTOOLS_GLOBAL_HOOK__: {
    supportsFiber: boolean;
    renderers: Map<number, unknown>;
    inject(renderer: unknown): number;
    onCommitFiberUnmount(): void;
    onPostCommitFiberRoot(): void;
    onCommitFiberRoot(id: number, root: { current: MeasuredFiber }): void;
  };
};

function graph(): CanvasDocument & { viewport: { x: number; y: number; zoom: number } } {
  return {
    schemaVersion: 1,
    viewport: { x: 30, y: 40, zoom: 0.85 },
    edges: [],
    nodes: [
      {
        id: "source",
        type: "workflow",
        position: { x: 100, y: 160 },
        style: { width: 420, height: 210 },
        data: {
          nodeType: "image-generation",
          label: "回归生成",
          provider: "fake",
          connectionId: "fake-default",
          model: "fake-image-v1",
          fakeScenario: "async",
          parts: [{ type: "text", text: "模拟供应商回归测试" }],
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
          parameters: { size: "1536x1024", quality: "high", n: 1 },
        },
      },
    ],
  };
}
async function create(request: APIRequestContext, value: object = graph()) {
  const response = await request.post("/api/canvas", {
    data: { title: "隔离回归画布", graph: value },
  });
  expect(response.ok()).toBeTruthy();
  return response.json();
}
async function open(page: Page, id: string) {
  await page.goto(`/canvas/${id}`);
  await expect(
    page.locator('.react-flow__node[data-id="source"]'),
  ).toBeVisible();
}
const run = (page: Page) =>
  page.getByRole("button", { name: "运行 回归生成 节点", exact: true }).click();
const saved = async (request: APIRequestContext, id: string) =>
  (await (await request.get(`/api/canvas/${id}`)).json()).graph;
function running(snapshot: RunSnapshot) {
  return {
    ...snapshot,
    run: { ...snapshot.run, status: "running" },
    nodes: snapshot.nodes.map((node) => ({
      ...node,
      status: "running",
      outputAssetIds: [],
    })),
  };
}

test("低缩放提示词按需进入编辑，点击后可立即输入并保存", async ({page,request}) => {
  const value=graph();value.viewport.zoom=.4;
  const canvas=await create(request,value);await open(page,canvas.id);
  const overview=page.locator(".prompt-overview");await expect(overview).toBeVisible();
  await overview.click();const editor=page.locator(".tiptap-prompt");await expect(editor).toBeVisible();await expect(editor).toBeFocused();
  await editor.fill("缩小画布后也可以立即编辑");await editor.press("Control+s");
  await expect.poll(async()=>JSON.stringify((await saved(request,canvas.id)).nodes[0].data.parts)).toContain("缩小画布后也可以立即编辑");
});

test("提交响应丢失并关闭页面后按原编号找回，生成 POST 始终为一次", async ({
  page,
  context,
  request,
}) => {
  const canvas = await create(request);
  let submissions = 0,
    requestId = "",
    runId = "",
    allowRead = false;
  await context.route(/\/api\/runs(?:\/[^/?]+)?(?:\?.*)?$/u, async (route) => {
    if (route.request().method() === "POST") {
      submissions++;
      requestId = route.request().postDataJSON().clientRequestId;
      const response = await route.fetch();
      runId = (await response.json()).run.id;
      await route.abort("connectionreset");
      return;
    }
    if (!allowRead) return route.abort("internetdisconnected");
    await route.continue();
  });
  await page.route(`**/api/canvas/${canvas.id}`, (route) =>
    route.request().method() === "PUT" && submissions > 0
      ? route.abort("internetdisconnected")
      : route.continue(),
  );
  await open(page, canvas.id);
  await run(page);
  await expect(
    page.getByRole("button", { name: "核对任务", exact: true }),
  ).toBeVisible();
  expect(submissions).toBe(1);
  expect(
    await page.evaluate(
      (id) =>
        JSON.parse(
          localStorage.getItem(`super-canvas:submissions:v1:${id}`) ?? "[]",
        )[0]?.requestId,
      canvas.id,
    ),
  ).toBe(requestId);
  await page.close();
  allowRead = true;
  const reopened = await context.newPage();
  await open(reopened, canvas.id);
  await expect(
    reopened.locator(
      '.generated-result-node[data-generated-status="succeeded"]',
    ),
  ).toHaveCount(1, { timeout: 20000 });
  await expect
    .poll(
      async () =>
        (await saved(request, canvas.id)).nodes.find(
          (n: CanvasNode) => n.data.generatedResult,
        )?.data.generatedFromRunId,
    )
    .toBe(runId);
  await reopened.reload();
  await expect(reopened.locator(".generated-result-node")).toHaveCount(1);
  expect(submissions).toBe(1);
  const original = await (await request.get(`/api/runs/${runId}`)).json();
  expect(original.run.clientRequestId).toBe(requestId);
  expect(original.run.status).toBe("succeeded");
});

test("移出生成卡片后刷新不复活，原任务完成并保留素材；普通移出可以撤销", async ({
  page,
  request,
}) => {
  const canvas = await create(request);
  let runId = "",
    freeze = true,
    submissions = 0;
  await page.route(/\/api\/runs(?:\/[^/?]+)?(?:\?.*)?$/u, async (route) => {
    const response = await route.fetch(),
      payload = await response.json();
    if (route.request().method() === "POST") {
      submissions++;
      runId = payload.run.id;
    }
    await route.fulfill({
      response,
      json: freeze
        ? Array.isArray(payload)
          ? payload.map(running)
          : running(payload)
        : payload,
    });
  });
  await open(page, canvas.id);
  await run(page);
  await expect(
    page.getByRole("button", { name: "取消任务", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "删除 生成图片 1 节点", exact: true })
  .click();


  await expect(page.locator(".generated-result-node")).toHaveCount(0);
  await page.getByRole("button", { name: "撤销", exact: true }).click();
  await expect(page.locator(".generated-result-node")).toHaveCount(1);
  await page
    .getByRole("button", { name: "删除 生成图片 1 节点", exact: true })
    .click();
  await expect
    .poll(
      async () =>
        (await saved(request, canvas.id)).nodes.find(
          (n: CanvasNode) => n.id === "source",
        ).data.hiddenGeneratedResults?.length,
    )
    .toBe(1);
  freeze = false;
  await page.evaluate(() =>
    window.dispatchEvent(new Event("canvas-reconcile-tasks")),
  );
  await page.reload();
  await expect(page.locator(".generated-result-node")).toHaveCount(0);
  await page.waitForTimeout(5500);
  await expect(page.locator(".generated-result-node")).toHaveCount(0);
  const original = await (await request.get(`/api/runs/${runId}`)).json();
  expect(original.run.status).toBe("succeeded");
  expect(original.nodes[0].outputAssetIds).toHaveLength(1);
  expect(
    (
      await request.get(`/api/assets/${original.nodes[0].outputAssetIds[0]}`)
    ).ok(),
  ).toBeTruthy();
  expect(submissions).toBe(1);
});

test("输入框保存最新内容、组合输入不生成、两个运行快捷键作用域正确", async ({
  page,
  request,
}) => {
  const canvas = await create(request);
  await open(page, canvas.id);
  const editor = page.locator(
    '.react-flow__node[data-id="source"] .tiptap-prompt',
  );
  const scopes: string[] = [];
  await page.route("**/api/runs", async (route) => {
    if (route.request().method() === "POST")
      scopes.push(route.request().postDataJSON().scope);
    await route.continue();
  });
  await editor.fill("刚刚输入的中文提示词");
  await editor.press("Control+s");
  await expect
    .poll(async () =>
      JSON.stringify((await saved(request, canvas.id)).nodes[0].data.parts),
    )
    .toContain("刚刚输入的中文提示词");
  await editor.dispatchEvent("keydown", {
    key: "Enter",
    code: "Enter",
    ctrlKey: true,
    isComposing: true,
  });
  await page.waitForTimeout(200);
  expect(scopes).toEqual([]);
  await editor.press("Control+Shift+Enter");
  await expect.poll(() => scopes).toEqual(["downstream"]);
  await expect(
    page.locator('.generated-result-node[data-generated-status="succeeded"]'),
  ).toHaveCount(1, { timeout: 20000 });
  await editor.press("Control+Enter");
  await expect.poll(() => scopes).toEqual(["downstream", "node"]);
});

test("任务运行期间保存失败始终可见，点击入口可重试保存", async ({
  page,
  request,
}) => {
  const canvas = await create(request);
  let fail = false;
  await page.route(/\/api\/runs(?:\/[^/?]+)?(?:\?.*)?$/u, async (route) => {
    const response = await route.fetch(),
      payload = await response.json();
    await route.fulfill({
      response,
      json: Array.isArray(payload) ? payload.map(running) : running(payload),
    });
  });
  await page.route(`**/api/canvas/${canvas.id}`, (route) =>
    fail && route.request().method() === "PUT"
      ? route.fulfill({ status: 503, json: { error: "模拟保存失败" } })
      : route.continue(),
  );
  await open(page, canvas.id);
  await run(page);
  await expect(page.locator(".task-state")).toContainText("任务运行中");
  fail = true;
  const editor = page.locator(".tiptap-prompt").first();
  await editor.fill("任务仍运行，修改不能丢失");
  await editor.press("Control+s");
  const status = page.getByRole("button", {
    name: "画布自动保存状态",
    exact: true,
  });
  await expect(status).toContainText("保存失败", { timeout: 20000 });
  await expect(status).toBeEnabled();
  await expect(page.locator(".task-state")).toContainText("任务运行中");
  fail = false;
  await status.click();
  await expect(status).toContainText("已保存");
});

test("连续尾光空白处按需启动，停下淡出，关闭后跨项目记忆，减少动态时停用", async ({
  page,
  request,
}) => {
  await page.addInitScript(() => {
    const w = window as MeasuredWindow;
    w.__canvasRenderMetrics = { commits: 0, nodes: 0 };
    w.__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
      supportsFiber: true,
      renderers: new Map(),
      inject(renderer: unknown) {
        this.renderers.set(1, renderer);
        return 1;
      },
      onCommitFiberUnmount() {},
      onPostCommitFiberRoot() {},
      onCommitFiberRoot(_id: number, root: { current: MeasuredFiber }) {
        w.__canvasRenderMetrics.commits++;
        const visit = (fiber: MeasuredFiber | null | undefined) => {
          if (!fiber) return;
          if (
            fiber.memoizedProps?.data?.nodeType &&
            typeof fiber.type === "function" &&
            fiber.flags & 1
          )
            w.__canvasRenderMetrics.nodes++;
          visit(fiber.child);
          visit(fiber.sibling);
        };
        visit(root.current);
      },
    };
  });
  const canvas = await create(request);
  await open(page, canvas.id);
  await page.waitForTimeout(1000);
  const trail = page.locator(".canvas-pointer-trail"),
    toggle = page.getByRole("button", { name: "画布动效", exact: true });
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
  const blank = await page.locator(".react-flow__pane").boundingBox();
  expect(blank).not.toBeNull();
  const x = blank!.x + blank!.width * 0.6,
    y = blank!.y + 60;
  const before = await page.evaluate(
    () => (window as MeasuredWindow).__canvasRenderMetrics,
  );
  expect(before.commits).toBeGreaterThan(0);
  expect(before.nodes).toBeGreaterThan(0);
  await page.mouse.move(x, y);
  await page.mouse.move(x + 60, y + 8, { steps: 10 });
  await expect(trail).toHaveAttribute("data-active", "true");
  await expect(trail).toHaveAttribute("data-active", "false", {
    timeout: 2000,
  });
  expect(
    (await page.evaluate(() => (window as MeasuredWindow).__canvasRenderMetrics)).nodes,
  ).toBe(before.nodes);
  await page.locator(".tiptap-prompt").hover();
  await expect(trail).toHaveAttribute("data-active", "false");
  await toggle.click();
  await page.reload();
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
  const other = await create(request);
  await open(page, other.id);
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
  await toggle.click();
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
  await page.mouse.move(x, y);
  await page.mouse.move(x + 60, y + 8, { steps: 10 });
  await expect(trail).toHaveAttribute("data-active", "false");
});

test("Ctrl 连线增选、取消选择与批量删除保持一致", async ({ page, request }) => {
  const value: CanvasDocument = graph();
  value.nodes = [0, 1, 2].map((i) => ({
    id: i === 0 ? "source" : `p${i}`,
    type: "workflow",
    position: { x: 70 + i * 330, y: 150 + i * 60 },
    data: {
      nodeType: "prompt",
      label: `提示 ${i}`,
      parts: [{ type: "text", text: "连线测试" }],
      inputs: [{ id: "in", kind: "text", label: "输入" }],
      outputs: [{ id: "out", kind: "text", label: "输出" }],
    },
  }));
  value.edges = [
    {
      id: "edge-a",
      source: "source",
      sourceHandle: "out",
      target: "p1",
      targetHandle: "in",
    },
    {
      id: "edge-b",
      source: "p1",
      sourceHandle: "out",
      target: "p2",
      targetHandle: "in",
    },
  ];
  const canvas = await create(request, value);
  await open(page, canvas.id);
  await page.getByRole("button", { name: "Fit View", exact: true }).click();
  const clickEdge = async (id: string) => {
    const path = page.locator(
      `.react-flow__edge[data-id="${id}"] .react-flow__edge-interaction`,
    );
    const point = await path.evaluate((element) => {
      const path = element as SVGPathElement,
        p = path.getPointAtLength(path.getTotalLength() / 2);
      const q = new DOMPoint(p.x, p.y).matrixTransform(path.getScreenCTM()!);
      return { x: q.x, y: q.y };
    });
    await page.mouse.click(point.x, point.y);
  };
  await clickEdge("edge-a");
  await expect(page.locator(".react-flow__edge.selected")).toHaveCount(1);
  await page.keyboard.down("Control");
  await clickEdge("edge-b");
  await expect(page.locator(".react-flow__edge.selected")).toHaveCount(2);
  await clickEdge("edge-a");
  await expect(page.locator(".react-flow__edge.selected")).toHaveCount(1);
  await clickEdge("edge-a");
  await page.keyboard.up("Control");
  await page.keyboard.press("Delete");
  await expect(page.locator(".react-flow__edge")).toHaveCount(0);
  await expect
    .poll(async () => (await saved(request, canvas.id)).edges.length)
    .toBe(0);
});

test("永久删除历史结果后撤销重做均不能恢复失效素材", async ({
  page,
  request,
}) => {
  const canvas = await create(request);
  await open(page, canvas.id);
  await run(page);
  await expect(
    page.locator('.generated-result-node[data-generated-status="succeeded"]'),
  ).toHaveCount(1, { timeout: 20000 });
  await expect
    .poll(
      async () =>
        (await saved(request, canvas.id)).nodes.find(
          (n: CanvasNode) => n.data.generatedResult,
        )?.data.assetId,
    )
    .toBeTruthy();
  const result = (await saved(request, canvas.id)).nodes.find(
      (n: CanvasNode) => n.data.generatedResult,
    ),
    asset = await (
      await request.get(`/api/assets/${result.data.assetId}`)
    ).json();
  // Populate both history directions before deleting the asset permanently.
  await page
    .getByRole("button", { name: "删除 生成图片 1 节点", exact: true })
    .click();
  await page.getByRole("button", { name: "撤销", exact: true }).click();
  await page
    .getByRole("button", { name: "历史生成", exact: true })
    .first()
    .click();
  const modal = page.locator(".generation-history-modal");
  await expect(modal).toBeVisible();
  await modal
    .getByRole("checkbox", { name: `选择 ${asset.name}`, exact: true })
    .click();
  await modal.getByRole("button", { name: "删除所选", exact: true }).click();
  await modal.getByRole("button", { name: "确认删除", exact: true }).click();
  await expect
    .poll(async () => (await request.get(`/api/assets/${asset.id}`)).status())
    .toBe(404);
  await modal.getByRole("button", { name: "关闭历史生成", exact: true }).click();
  await page.getByRole("button", { name: "重做", exact: true }).click();
  await page.getByRole("button", { name: "撤销", exact: true }).click();
  await expect(page.locator(".generated-result-node")).toHaveCount(0);
  await expect
    .poll(async () => JSON.stringify((await saved(request, canvas.id)).nodes))
    .not.toContain(asset.id);
});

test("低缩放与窄窗口能用键盘读取完整中文名称、来源与实际尺寸", async ({
  page,
  request,
}, testInfo) => {
  const image = await request.post("/api/assets/upload", {
    multipart: {
      file: {
        name: "原图尺寸测试.png",
        mimeType: "image/png",
        buffer: Buffer.from(
          "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
          "base64",
        ),
      },
    },
  });
  expect(image.ok()).toBeTruthy();
  const asset = await image.json();
  const value: CanvasDocument = graph(),
    longName = "用于检查窄窗口与低缩放下完整名称可读性的中文生成节点";
  value.nodes[0]!.data.label = longName;
  value.viewport = { x: 80, y: 100, zoom: 0.4 };
  value.nodes.push({
    id: "result",
    type: "workflow",
    position: { x: 580, y: 160 },
    data: {
      nodeType: "asset-input",
      label: "原图结果",
      generatedResult: true,
      generatedFromNodeId: "source",
      generatedFromRunId: "readability-test",
      generatedStatus: "succeeded",
      generatedOutputIndex: 0,
      generatedModel: "GPT-image-2-超长模型名称-原生高质量完整参数验证",
      generatedConnectionName: "测试供应商 · 原生图片分组",
      generatedCreatedAt: new Date().toISOString(),
      generatedParameters: { size: "2160x3840", quality: "high" },
      assetId: asset.id,
      assetKind: "image",
      inputs: [{ id: "source", kind: "image", label: "来源" }],
      outputs: [{ id: "image", kind: "image", label: "图片" }],
    },
  });
  const canvas = await create(request, value);
  await page.setViewportSize({ width: 650, height: 780 });
  await open(page, canvas.id);
  await page.locator(".readable-name").first().focus();
  await expect(page.getByRole("tooltip")).toHaveText(longName);
  const info = page.getByRole("button", {
    name: "查看 原图结果 来源",
    exact: true,
  });
  await info.focus();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", {
    name: "结果来源与参数",
    exact: true,
  });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("1 × 1 像素");
  await expect(dialog).toContainText("2160x3840");
  await expect(dialog).toContainText(value.nodes[1]!.data.generatedModel!);
  const box = await dialog.boundingBox();
  expect(box!.width).toBeGreaterThan(400);
  expect(box!.x + box!.width).toBeLessThanOrEqual(650);
  await page.screenshot({path: testInfo.outputPath("result-information-dark.png")});
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(info).toBeFocused();
});
