import { expectCompactPromptLine } from "./helpers/lod-expectations";
import {
  expect,
  test,
  type APIRequestContext,
  type Page,
} from "@playwright/test";
import type { CanvasDocument, CanvasNode, RunSnapshot } from "../components/types";
import { clickBlankCanvas, setCanvasZoomWithWheel } from "./canvas-test-actions";

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

test("旧连线省略端口时保留图片颜色与首端口连接数，保存刷新不改原数据", async ({ page, request }) => {
  const value = graph();
  value.nodes = [
    { id: "source", type: "workflow", position: { x: 100, y: 160 }, style: { width: 300, height: 220 },
      data: { nodeType: "asset-input", label: "旧图片来源", assetKind: "image", inputs: [],
        outputs: [{ id: "image", kind: "image", label: "图片" }] } },
    { id: "target", type: "workflow", position: { x: 650, y: 160 }, style: { width: 300, height: 220 },
      data: { nodeType: "asset-input", label: "旧图片接收", assetKind: "image", outputs: [],
        inputs: [{ id: "images", kind: "image[]", label: "参考图" }] } },
    { id: "unused", type: "workflow", position: { x: 100, y: 470 }, style: { width: 300, height: 220 },
      data: { nodeType: "asset-input", label: "未连接的其它端口", assetKind: "image",
        inputs: [{ id: "images", kind: "image[]", label: "参考图" }, { id: "text-in", kind: "text", label: "文字" }],
        outputs: [{ id: "image", kind: "image", label: "图片" }, { id: "text-out", kind: "text", label: "文字" }] } },
  ];
  // The API accepts omitted handles only for an unambiguous single port.
  // Multi-port legacy display fallback is covered by the presentation unit test.
  value.edges = [{ id: "legacy-image-link", source: "source", target: "target", type: "smoothstep", data: { retained: "legacy" } }];
  let submissions = 0;
  await page.route(/\/api\/(?:runs|agent\/turn)(?:\?|\/|$)/u, async route => {
    if (route.request().method() === "GET") await route.continue();
    else { submissions++; await route.abort(); }
  });
  const canvas = await create(request, value);
  const assertPorts = async () => {
    await expect(page.locator('.react-flow__edge[data-id="legacy-image-link"] .studio-edge')).toHaveAttribute("data-port-kind", "image");
    await expect(page.locator('.react-flow__node[data-id="source"] .react-flow__handle.source[data-handleid="image"]')).toHaveAttribute("title", "图片 · image · 1 个连接");
    await expect(page.locator('.react-flow__node[data-id="target"] .react-flow__handle.target[data-handleid="images"]')).toHaveAttribute("title", "参考图 · image[] · 1 个连接");
    for (const id of ["text-in", "text-out"]) await expect(page.locator(`.react-flow__node[data-id="unused"] .react-flow__handle[data-handleid="${id}"]`)).toHaveAttribute("title", "文字 · text · 0 个连接");
  };
  const assertSaved = async () => {
    const persisted: CanvasDocument = await saved(request, canvas.id);
    expect(persisted.edges).toEqual(value.edges);
    expect(persisted.edges[0]).not.toHaveProperty("sourceHandle");
    expect(persisted.edges[0]).not.toHaveProperty("targetHandle");
    expect(persisted.nodes.map(node => node.data)).toEqual(value.nodes.map(node => node.data));
  };
  await open(page, canvas.id);
  await assertPorts();
  const savedResponse = page.waitForResponse(response => response.url().endsWith(`/api/canvas/${canvas.id}`) && response.request().method() === "PUT" && response.ok());
  await page.keyboard.press("Control+s");
  await savedResponse;
  await assertSaved();
  await page.reload();
  await assertPorts();
  await assertSaved();
  expect(submissions).toBe(0);
});

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

test("低缩放提示词按需进入编辑，点击后可立即输入并保存", async ({ page, request }) => {
  const value = graph(); value.viewport.zoom = .4;
  value.nodes[0]!.data.parts = [{ type: "text", text: "低缩放保留的第一行\n第二行不应在概览中绘制" }];
  const canvas = await create(request, value); await open(page, canvas.id);
  const source = page.locator('.react-flow__node[data-id="source"]');
  const viewport = page.locator(".react-flow__viewport");
  const overview = source.locator(".prompt-overview");
  await expect(viewport).toHaveClass(/canvas-lod-compact/);
  await expect(source.locator(".node-body")).toHaveCSS("visibility", "visible");
  await expect(overview).toBeVisible();
  await expect(overview).toContainText("低缩放保留的第一行");
  await expectCompactPromptLine(overview);
  await expect(page.locator(".tiptap-prompt")).toHaveCount(0);
  // Compact LOD keeps the title and first text line without mounting editors.
  // Reframe with a real wheel before testing editing at a readable scale.
  await source.locator(".node-head").click();
  await page.getByRole("button", { name: "定位所选节点", exact: true }).click();
  await setCanvasZoomWithWheel(page, .6);
  await expect(viewport).not.toHaveClass(/canvas-lod-compact/);
  await expect(overview).toBeVisible();
  await overview.click(); const editor = source.locator(".tiptap-prompt");
  await expect(editor).toBeVisible(); await expect(editor).toBeFocused();
  await editor.fill("缩小画布后也可以立即编辑"); await editor.press("Control+s");
  await expect.poll(async () => JSON.stringify((await saved(request, canvas.id)).nodes[0].data.parts)).toContain("缩小画布后也可以立即编辑");
});

test("跨缩放阈值不会为未激活节点创建编辑器，激活输入仍立即保存", async ({ page, request }) => {
  const value = graph(); value.viewport.zoom = .65;
  value.nodes = Array.from({ length: 24 }, (_, index) => ({ ...value.nodes[0], id: `lazy-${index}`, position: { x: (index % 6) * 420, y: Math.floor(index / 6) * 260 }, data: { ...value.nodes[0].data, label: `按需编辑 ${index}` } }));
  value.edges = [];
  const canvas = await create(request, value);
  await page.goto(`/canvas/${canvas.id}`);
  await expect(page.locator(".prompt-overview").first()).toBeVisible();
  await expect(page.locator(".tiptap-prompt")).toHaveCount(0);
  for (const zoom of ["Zoom Out", "Zoom Out", "Zoom In", "Zoom In"]) await page.getByRole("button", { name: zoom, exact: true }).click();
  await expect(page.locator(".tiptap-prompt")).toHaveCount(0);
  // Zoom controls pivot around the viewport center and can move the origin
  // node behind the top bar. Reframe the real graph before interacting with it.
  await page.getByRole("button", { name: "Fit View", exact: true }).click();
  const first = page.locator('.react-flow__node[data-id="lazy-0"]');
  await expect(first.locator(".node-head")).toBeInViewport({ ratio: 1 });
  await expect(page.locator(".react-flow__viewport")).toHaveClass(/canvas-lod-compact/);
  await expect(first.locator(".node-body")).toHaveCSS("visibility", "visible");
  await expect(first.locator(".prompt-overview")).toBeVisible();
  await expectCompactPromptLine(first.locator(".prompt-overview"));
  await expect(page.locator(".tiptap-prompt")).toHaveCount(0);
  await first.locator(".node-head").click();
  await expect(first).toHaveClass(/selected/);
  await expect(page.locator(".tiptap-prompt")).toHaveCount(0);
  // The compact body action is intentionally hidden; the visible header
  // opens the same root-owned parameter card without mounting an editor.
  await first.locator(".node-head").dblclick();
  const parameters = page.locator('.canvas-parameter-dock[data-parameter-node-id="lazy-0"]')
    .getByRole("dialog", { name: "按需编辑 0 模型与参数", exact: true });
  await expect(parameters).toBeVisible();
  await expect(page.locator(".tiptap-prompt")).toHaveCount(0);
  await parameters.getByRole("button", { name: "关闭模型与参数面板", exact: true }).click();
  await page.getByRole("button", { name: "定位所选节点", exact: true }).click();
  await setCanvasZoomWithWheel(page, .6);
  await expect(page.locator(".react-flow__viewport")).not.toHaveClass(/canvas-lod-compact/);
  await expect(first.locator(".prompt-overview")).toBeVisible();
  await first.locator(".prompt-overview").click();
  const editor = first.locator(".tiptap-prompt");
  await expect(editor).toBeFocused();
  await expect(page.locator(".tiptap-prompt")).toHaveCount(1);
  await editor.fill("只有当前节点需要编辑器");
  await editor.press("Control+s");
  await expect.poll(async () => JSON.stringify((await saved(request, canvas.id)).nodes[0].data.parts)).toContain("只有当前节点需要编辑器");
  // Switching immediately must flush the old editor before it unmounts.
  await editor.fill("快速切换前的最新内容");
  const second = page.locator('.react-flow__node[data-id="lazy-1"]');
  await second.locator(".prompt-overview").click();
  await expect(first.locator(".tiptap-prompt")).toHaveCount(0);
  const secondEditor = second.locator(".tiptap-prompt");
  await expect(secondEditor).toBeFocused();
  await secondEditor.fill("第二个节点的最新内容");
  await first.locator(".prompt-overview").click();
  await expect(editor).toBeFocused();
  await expect(editor).toHaveText("快速切换前的最新内容");
  await expect(page.locator(".tiptap-prompt")).toHaveCount(1);
  await editor.press("Control+s");
  await expect.poll(async () => {
    const document = await saved(request, canvas.id);
    return document.nodes.slice(0, 2).map((node: CanvasNode) => node.data.parts);
  }).toEqual([[{ type: "text", text: "快速切换前的最新内容" }], [{ type: "text", text: "第二个节点的最新内容" }]]);
  await clickBlankCanvas(page);
  await expect(page.locator(".react-flow__node.selected")).toHaveCount(0);
  await expect(page.locator(".tiptap-prompt")).toHaveCount(0);
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
  await page.locator(".toast").getByRole("button", { name: "撤销", exact: true }).click();
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
  await page.locator('.react-flow__node[data-id="source"] .prompt-overview').click();
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

for (const scenario of [
  {
    shortcut: "Control+Enter",
    scope: "node",
    cursor: "中间",
    lines: ["第一行保留中文与标点：原样提交。", "第二行保留 English 123。"],
    lineBreak: "Enter",
  },
  {
    shortcut: "Control+Enter",
    scope: "node",
    cursor: "末尾",
    lines: ["单行末尾：中文 English 123 原样提交。"],
    lineBreak: "Enter",
  },
  {
    shortcut: "Control+Shift+Enter",
    scope: "downstream",
    cursor: "中间",
    lines: ["单行中间：中文 English 123 原样提交。"],
    lineBreak: "Enter",
  },
  {
    shortcut: "Control+Shift+Enter",
    scope: "downstream",
    cursor: "末尾",
    lines: ["第一行保留中文。", "", "第三行保留空行与 English 123。"],
    lineBreak: "Shift+Enter",
  },
]) {
  test(`${scenario.shortcut} 在${scenario.cursor}运行时逐字保留提示词与换行`, async ({
    page,
    request,
  }) => {
    const canvas = await create(request);
    await open(page, canvas.id);
    await page.locator('.react-flow__node[data-id="source"] .prompt-overview').click();
    const editor = page.locator(
      '.react-flow__node[data-id="source"] .tiptap-prompt',
    );
    await editor.fill(scenario.lines[0]);
    for (const line of scenario.lines.slice(1)) {
      await editor.press(scenario.lineBreak);
      if (line) await page.keyboard.insertText(line);
    }
    // Locate a real DOM caret rather than relying on platform navigation keys.
    // Let selectionchange reach ProseMirror before pressing the run shortcut.
    await editor.evaluate(async (element, middle) => {
      const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
      const textNodes: Text[] = [];
      while (walker.nextNode()) textNodes.push(walker.currentNode as Text);
      const target = middle ? textNodes[0] : textNodes.at(-1);
      if (!target) throw new Error("提示词编辑器没有文本节点");
      const range = document.createRange();
      range.setStart(target, middle ? 2 : target.length);
      range.collapse(true);
      const selection = window.getSelection();
      if (!selection) throw new Error("无法定位提示词光标");
      selection.removeAllRanges();
      selection.addRange(range);
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    }, scenario.cursor === "中间");
    expect(await editor.evaluate(() => window.getSelection()?.anchorOffset)).toBe(
      scenario.cursor === "中间" ? 2 : scenario.lines.at(-1)!.length,
    );

    const submitted = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === "/api/runs" &&
        response.request().method() === "POST",
    );
    await editor.press(scenario.shortcut);
    const response = await submitted;
    expect(response.ok()).toBeTruthy();
    expect(response.request().postDataJSON().scope).toBe(scenario.scope);
    const snapshot = (await response.json()) as RunSnapshot;
    const expectedPrompt = scenario.lines.join("\n");
    // The detailed run contains the normalized request actually sent to Fake,
    // so this checks submission text as well as the editor's saved document.
    await expect.poll(async () => {
      const detailed = (await (
        await request.get(`/api/runs/${snapshot.run.id}?details=1`)
      ).json()) as RunSnapshot;
      const source = detailed.nodes.find((node) => node.nodeId === "source");
      return {
        provider: source?.request?.provider,
        prompt: source?.request?.prompt,
      };
    }).toEqual({ provider: "fake", prompt: expectedPrompt });
    expect(
      (await saved(request, canvas.id)).nodes.find(
        (node: CanvasNode) => node.id === "source",
      ).data.parts,
    ).toEqual([{ type: "text", text: expectedPrompt }]);
  });
}

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
  const island = page.locator("[data-dynamic-island]");
  await expect(island).toHaveAttribute("data-status", "running");
  fail = true;
  await page.locator('.react-flow__node[data-id="source"] .prompt-overview').click();
  const editor = page.locator(".tiptap-prompt").first();
  await editor.fill("任务仍运行，修改不能丢失");
  await editor.press("Control+s");
  const status = page.getByRole("button", {
    name: "画布自动保存状态",
    exact: true,
  });
  await expect(status).toContainText("保存失败", { timeout: 20000 });
  await expect(status).toBeEnabled();
  await expect(island).toHaveAttribute("data-status", "save-error");
  await expect(page.locator('.react-flow__node[data-id="source"]').getByRole("status")).toContainText("运行中");
  fail = false;
  await status.click();
  await expect(status).toContainText("已保存");
  await expect(island).toHaveAttribute("data-status", "running");
});

test("画布无装饰鼠标轨迹，空白移动不重绘节点，动效偏好跨项目保存并遵循系统reduce", async ({
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
  await expect(trail).toHaveCount(0);
  await page.waitForTimeout(250);
  expect(
    (await page.evaluate(() => (window as MeasuredWindow).__canvasRenderMetrics)).nodes,
  ).toBe(before.nodes);
  await page.locator('.react-flow__node[data-id="source"] .node-head').click();
  await page.locator('.react-flow__node[data-id="source"] .prompt-overview').click();
  await page.locator(".tiptap-prompt").hover();
  await expect(trail).toHaveCount(0);
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
  await expect(trail).toHaveCount(0);
});

test("Ctrl 连线增选、取消选择与批量删除保持一致", async ({ page, request }, testInfo) => {
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
  if (process.env.EDGE_INIT_EVIDENCE === "1") {
    page.on("console", (message) => {
      if (message.text().startsWith("EDGE_INIT_SNAPSHOT:")) {
        void testInfo.attach(`flow-store-${Date.now()}.json`, {
          body: message.text().slice("EDGE_INIT_SNAPSHOT:".length),
          contentType: "application/json",
        });
      }
    });
    const snapshot = await page.evaluate(() => {
      type HandleBounds = { source?: { id: string }[]; target?: { id: string }[] };
      type FlowNode = { hidden?: boolean; measured?: { width?: number; height?: number }; width?: number; height?: number; initialWidth?: number; initialHeight?: number; position?: unknown; handles?: { id: string; type: string }[]; internals: { positionAbsolute: { x: number; y: number }; handleBounds?: HandleBounds } };
      type FlowState = { width: number; height: number; transform: number[]; nodesInitialized: boolean; edges: { id: string; source: string; target: string; sourceHandle?: string | null; targetHandle?: string | null; hidden?: boolean }[]; nodeLookup: Map<string, FlowNode>; edgeLookup: Map<string, unknown> };
      type Fiber = { return?: Fiber; memoizedProps?: { value?: { getState?: () => FlowState } } };
      const element = document.querySelector(".react-flow__node") as (HTMLElement & Record<string, unknown>) | null;
      let fiber = element ? element[Object.keys(element).find(key => key.startsWith("__reactFiber$")) ?? ""] as Fiber | undefined : undefined;
      let store: { getState?: () => FlowState } | undefined;
      while (fiber) {
        const candidate = fiber.memoizedProps?.value;
        if (candidate?.getState?.()?.nodeLookup instanceof Map) { store = candidate; break; }
        fiber = fiber.return;
      }
      const capture = () => {
        const state = store?.getState?.();
        const initialized = (node: FlowNode | undefined) => Boolean(node &&
          (node.internals.handleBounds || node.handles?.length) && (node.measured?.width || node.width || node.initialWidth));
        const hasHandle = (node: FlowNode | undefined, type: "source" | "target", id: string | null | undefined) => {
          const handles = node?.internals.handleBounds?.[type] ?? node?.handles?.filter(handle => handle.type === type);
          return Boolean(id ? handles?.some(handle => handle.id === id) : handles?.[0]);
        };
        const visible = (source: FlowNode | undefined, target: FlowNode | undefined) => {
          if (!state?.width || !state.height || !source || !target) return false;
          const dimensions = (node: FlowNode) => ({ width: node.measured?.width ?? node.width ?? node.initialWidth ?? 0,
            height: node.measured?.height ?? node.height ?? node.initialHeight ?? 0 });
          const a = source.internals.positionAbsolute, b = target.internals.positionAbsolute;
          const ad = dimensions(source), bd = dimensions(target), [tx, ty, zoom] = state.transform;
          const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
          let right = Math.max(a.x + ad.width, b.x + bd.width), bottom = Math.max(a.y + ad.height, b.y + bd.height);
          if (right === x) right++;
          if (bottom === y) bottom++;
          return Math.min(right, (state.width - tx!) / zoom!) > Math.max(x, -tx! / zoom!) &&
            Math.min(bottom, (state.height - ty!) / zoom!) > Math.max(y, -ty! / zoom!);
        };
        return {
          at: performance.now(), foundStore: Boolean(state), width: state?.width, height: state?.height,
          transform: state?.transform, nodesInitialized: state?.nodesInitialized, edges: state?.edges, edgeLookup: state ? [...state.edgeLookup] : null,
          edgeReadiness: state?.edges.map(edge => {
            const source = state.nodeLookup.get(edge.source), target = state.nodeLookup.get(edge.target);
            return { id: edge.id, predictedVisible: visible(source, target), hidden: Boolean(edge.hidden),
              sourcePresent: Boolean(source), targetPresent: Boolean(target), sourceInitialized: initialized(source), targetInitialized: initialized(target),
              sourceHandleFound: hasHandle(source, "source", edge.sourceHandle), targetHandleFound: hasHandle(target, "target", edge.targetHandle),
              wrapperMounted: Boolean(document.querySelector(`.react-flow__edge[data-id="${CSS.escape(edge.id)}"]`)) };
          }),
          nodes: state ? [...state.nodeLookup].map(([id, node]) => ({ id, measured: node.measured, width: node.width, height: node.height,
            position: node.position, handles: node.handles, positionAbsolute: node.internals.positionAbsolute, handleBounds: node.internals.handleBounds })) : null,
          domNodes: [...document.querySelectorAll<HTMLElement>(".react-flow__node")].map(node => ({ id: node.dataset.id, rect: node.getBoundingClientRect().toJSON(),
            handles: [...node.querySelectorAll<HTMLElement>(".react-flow__handle")].map(handle => ({ id: handle.dataset.handleid, type: handle.classList.contains("source") ? "source" : "target", rect: handle.getBoundingClientRect().toJSON() })) })),
          domEdgeIds: [...document.querySelectorAll<HTMLElement>(".react-flow__edge")].map(edge => edge.dataset.id),
        };
      };
      for (const delay of [1000, 30000]) window.setTimeout(() => console.log(`EDGE_INIT_SNAPSHOT:${JSON.stringify(capture())}`), delay);
      return capture();
    });
    await testInfo.attach("flow-store-before-click.json", { body: JSON.stringify(snapshot, null, 2), contentType: "application/json" });
  }
  const clickEdge = async (id: string) => {
    const path = page.locator(
      `.react-flow__edge[data-id="${id}"] .react-flow__edge-interaction`,
    );
    // Locator clicks wait for Fit View's animation to settle before hitting
    // the curve; raw screen coordinates can become stale during that motion.
    await path.click();
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
  const disconnected = page.locator(".toast").filter({ hasText: "已断开 2 条连线" });
  await disconnected.getByRole("button", { name: "撤销", exact: true }).click();
  await expect(page.locator(".react-flow__edge")).toHaveCount(2);
  await expect.poll(async () => (await saved(request, canvas.id)).edges.map((edge: CanvasDocument["edges"][number]) => edge.id).sort())
    .toEqual(["edge-a", "edge-b"]);
  // Toast undo uses the same history step as Ctrl+Z; redo remains available.
  await page.keyboard.press("Control+Shift+z");
  await expect(page.locator(".react-flow__edge")).toHaveCount(0);
  await expect.poll(async () => (await saved(request, canvas.id)).edges.length).toBe(0);
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
  await page.locator(".toast").getByRole("button", { name: "撤销", exact: true }).click();
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
  await page.locator('.react-flow__node[data-id="source"] .readable-name').focus();
  await expect(page.getByRole("tooltip")).toHaveText(longName);
  const info = page.getByRole("button", {
    name: "查看 原图结果 来源",
    exact: true,
  });
  // At 40% the result artwork stays painted while its small action is hidden.
  await expect(page.locator('.react-flow__node[data-id="result"] img')).toBeVisible();
  await expect(page.locator('.react-flow__node[data-id="result"] .node-body')).toHaveCSS("visibility", "visible");
  await expect(info).toBeHidden();
  await setCanvasZoomWithWheel(page, 1);
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
