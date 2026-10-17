import { expect, test, type Page } from "@playwright/test";
import type { AgentPlan, AgentSession } from "../lib/agent-contracts";
import type { AgentModelOption } from "../lib/agent-models";
import type { AssetView } from "../components/types";
import {
  agentModelTrigger,
  agentModelRow,
  openAgentModels,
  closeAgentModels,
  chooseAgentModel,
  chooseAgentReasoning,
  expectAgentModel,
  openAgentSessions,
} from "./helpers/agent-controls";

/** All API traffic is isolated. No user configuration, upstream or paid model is used. */
async function scenario(
  page: Page,
  mode: "text" | "media" | "failure" | "disconnect",
  openAgent = true,
) {
  const canvasId = "agent-e2e";
  const assets: AssetView[] = [];
  const canvas = {
    id: canvasId,
    title: "智能体测试",
    revision: 1,
    graph: {
      schemaVersion: 1,
      nodes: [] as unknown[],
      edges: [] as unknown[],
      viewport: { x: 0, y: 0, zoom: 0.7 },
      drawings: [],
    },
  };
  const session: AgentSession = {
    id: "task-1",
    canvasId,
    title: "测试创作任务",
    messages: [],
    plans: [],
  };
  let created = false;
  let turns = 0;
  let executed = 0;
  let materialized = 0;
  const now = new Date().toISOString();
  const model: AgentModelOption = {
    supplierId: "site-a",
    supplierName: "同名站点",
    group: "创作组",
    connectionId: "brain-a",
    connectionName: "连接 A",
    modelId: "brain",
    modelName: "主模型",
    protocol: "openai-chat-completions",
    available: true,
    capabilities: {
      text: true,
      imageInput: true,
      audioInput: false,
      videoInput: false,
      structuredOutput: false,
      toolCalling: false,
      nativeWebSearch: false,
      reasoning: false,
    },
    source: "manual",
    imageInputStatus: "assumed",
    reasoningOptions: [
      { value: "auto", label: "自动" },
      { value: "high", label: "高" },
    ],
  };
  const plan: AgentPlan = {
    id: "plan-1",
    sessionId: session.id,
    canvasId,
    version: 1,
    status: "awaiting_approval",
    summary: "创建一张产品主视觉",
    baseCanvasRevision: 1,
    proposal: {
      type: "proposal",
      summary: "创建一张产品主视觉",
      assumptions: [],
      texts: [],
      calls: [
        {
          id: "hero",
          label: "产品主视觉",
          prompt: "白色瓶子，蓝色背景",
          requirements: { operation: "image.generate", count: 1 },
          sourceAssetIds: [],
          recommendation: "支持图片生成",
        },
      ],
    },
    calls: [],
    patch: {
      nodes: [],
      edges: [],
      generationNodeIds: ["agent-image"],
      touchedExistingNodeIds: [],
    },
  };
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const method = request.method();
    if (path === "/api/projects")
      return route.fulfill({
        json: {
          projects: [
            {
              id: canvasId,
              title: canvas.title,
              nodeCount: canvas.graph.nodes.length,
              createdAt: now,
              updatedAt: now,
            },
          ],
        },
      });
    if (path === `/api/canvas/${canvasId}`) {
      if (method === "PUT") {
        const body = request.postDataJSON();
        canvas.graph = body.graph;
        canvas.title = body.title;
        canvas.revision++;
      }
      return route.fulfill({ json: canvas });
    }
    if (path === "/api/agent/models")
      return route.fulfill({
        json: [
          model,
          {
            ...model,
            supplierId: "site-b",
            connectionId: "brain-b",
            connectionName: "连接 B",
            modelId: "brain-b",
            modelName: "另一个站点模型",
            capabilities: {
              ...model.capabilities,
              imageInput: false,
              videoInput: false,
              audioInput: false,
            },
            reasoningOptions: [{ value: "auto", label: "自动" }],
          },
        ],
      });
    if (path === "/api/agent/sessions") {
      if (method === "POST") {
        created = true;
        return route.fulfill({ json: session });
      }
      return route.fulfill({
        json: created ? [{ id: session.id, title: session.title }] : [],
      });
    }
    if (path === `/api/agent/sessions/${session.id}`)
      return route.fulfill({ json: session });
    if (path === "/api/agent/turn") {
      turns++;
      const input = request.postDataJSON();
      expect(input.intent).toBe("auto");
      session.messages.push({
        id: `u-${turns}`,
        role: "user",
        content: input.message,
        createdAt: now,
        metadata: {
          requestId: input.requestId,
          intent: input.intent,
          attachmentAssetIds: input.attachmentAssetIds,
        },
      });
      if (mode === "failure" || mode === "disconnect") {
        session.messages.push({
          id: `error-${turns}`,
          role: "assistant",
          content: "模型暂未返回正文，请重新编辑后发送",
          createdAt: now,
          metadata: {
            kind: "error",
            status: "failed",
            requestId: input.requestId,
            retryable: true,
          },
        });
        return route.fulfill({
          contentType: "text/event-stream",
          body:
            mode === "disconnect"
              ? 'data: {"type":"stage","message":"正在读取任务"}\n\n'
              : `data: ${JSON.stringify({ type: "error", message: "模型暂未返回正文" })}\n\ndata: {"type":"done","status":"failed"}\n\n`,
        });
      }
      if (mode === "text") {
        if (turns === 1)
          session.messages.push({
            id: "question",
            role: "assistant",
            content: "需要确认广告时长",
            createdAt: now,
            metadata: {
              kind: "clarify",
              questions: [
                {
                  id: "duration",
                  question: "广告需要多长？",
                  options: ["15 秒", "30 秒"],
                },
              ],
            },
          });
        else
          session.messages.push({
            id: "artifact",
            role: "assistant",
            content: "分镜已整理，可直接编辑",
            createdAt: now,
            metadata: {
              kind: "artifact",
              artifact: {
                kind: "storyboard",
                title: "产品广告分镜",
                content: "",
                totalDuration: 15,
                characters: [],
                shots: [
                  {
                    id: "镜头1",
                    start: 0,
                    end: 15,
                    camera: "产品特写",
                    action: "瓶身转动",
                    dialogue: "",
                    sound: "轻音乐",
                    prompt: "白色瓶子特写",
                    characterIds: [],
                    assetIds: [],
                  },
                ],
              },
            },
          });
      } else {
        plan.baseCanvasRevision = canvas.revision;
        session.plans = [plan];
        session.messages.push({
          id: "plan-message",
          role: "assistant",
          content: "请检查方案，确认后放入画布。",
          createdAt: now,
          metadata: {},
        });
      }
      return route.fulfill({
        contentType: "text/event-stream",
        body: `data: ${JSON.stringify({ type: "session", session })}\n\ndata: {"type":"done"}\n\n`,
      });
    }
    if (path.endsWith("/materialize")) {
      materialized++;
      canvas.revision++;
      plan.status = "awaiting_execution";
      canvas.graph.nodes = [
        {
          id: "agent-image",
          type: "workflow",
          position: { x: 100, y: 100 },
          data: {
            nodeType: "image-generation",
            label: "产品主视觉",
            provider: "fake",
            connectionId: "fake-default",
            model: "fake-image-v1",
            parts: [{ type: "text", text: "白色瓶子，蓝色背景" }],
            inputs: [{ id: "prompt", kind: "text", label: "提示词" }],
            outputs: [{ id: "images", kind: "image", label: "图片" }],
          },
        },
      ];
      return route.fulfill({ json: { plan, canvas } });
    }
    if (path.endsWith("/preflight")) {
      plan.preflight = {
        id: "preflight-1",
        hash: "fixture",
        canvasRevision: canvas.revision,
        expiresAt: new Date(Date.now() + 60000).toISOString(),
        nodeIds: ["agent-image"],
        summary: "产品主视觉 · 测试模型 × 1",
        unknownPrice: true,
      };
      return route.fulfill({ json: plan });
    }
    if (path.endsWith("/execute")) {
      expect(request.postDataJSON()).toMatchObject({
        preflightId: "preflight-1",
        acceptUnknownPrice: true,
      });
      executed++;
      plan.status = "succeeded";
      plan.results = [
        {
          nodeId: "agent-image",
          status: "succeeded",
          assetIds: ["generated-image"],
        },
      ];
      return route.fulfill({ json: { plan, run: null } });
    }
    if (path.startsWith("/api/agent/artifacts/")) {
      const m = session.messages.find((m) => m.id === "artifact")!;
      m.metadata.artifact = request.postDataJSON().artifact;
      return route.fulfill({ json: { saved: true } });
    }
    if (path === "/api/agent/plans" && method === "POST") {
      return route.fulfill({
        json: {
          ...plan,
          proposal: request.postDataJSON().proposal,
          summary: "将成果放入画布",
          calls: [],
        },
      });
    }
    if (path === "/api/assets") return route.fulfill({ json: assets });
    if (path === "/api/providers" || path === "/api/runs")
      return route.fulfill({ json: [] });
    if (path.includes("/models")) return route.fulfill({ json: [] });
    if (path.includes("/chat"))
      return route.fulfill({ json: { messages: [] } });
    return route.fulfill({
      json: { groups: [], items: [], runs: [], drops: [] },
    });
  });
  await page.goto(`/canvas/${canvasId}`);
  if (openAgent) {
    await page.getByRole("button", { name: "打开智能体", exact: true }).click();
    await expectAgentModel(page, "brain-a\nbrain");
  }
  return {
    counts: () => ({ executed, materialized, turns }),
    session,
    model,
    canvas,
    assets,
  };
}

test("智能体首次展开前不请求型号，收起再展开保留未发送草稿", async ({
  page,
}) => {
  await page.addInitScript(() =>
    localStorage.setItem("super-canvas:inspector-open", "false"),
  );
  let modelRequests = 0;
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === "/api/agent/models")
      modelRequests++;
  });
  await scenario(page, "text", false);
  const openAgent = page.getByRole("button", {
    name: "打开智能体",
    exact: true,
  });
  await expect(openAgent).toBeVisible();
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
  await expect(page.getByLabel("创作任务要求")).toHaveCount(0);
  expect(modelRequests).toBe(0);
  await openAgent.click();
  const panel = page.getByLabel("通用创作智能体", { exact: true });
  const input = panel.getByLabel("创作任务要求");
  await expect(input).toBeVisible();
  await expect.poll(() => modelRequests).toBeGreaterThan(0);
  await input.fill("这段创作想法还没有发送，重新展开后继续编辑");
  await panel.getByRole("button", { name: "关闭智能体", exact: true }).click();
  await expect(panel).not.toBeVisible();
  await openAgent.click();
  await expect(input).toHaveValue("这段创作想法还没有发送，重新展开后继续编辑");
});
for (const preference of ["system", "application"] as const) {
  test(`${preference} 减少动态效果时智能体新消息立即滚动，不触发平滑滚动`, async ({
    page,
  }) => {
    if (preference === "system")
      await page.emulateMedia({ reducedMotion: "reduce" });
    else
      await page.addInitScript(() =>
        localStorage.setItem("super-canvas:gentle-motion", "off"),
      );
    await page.addInitScript(() => {
      const scrollTo = Element.prototype.scrollTo;
      const observed = window as typeof window & {
        __agentScroll: Array<ScrollBehavior | undefined>;
      };
      observed.__agentScroll = [];
      Element.prototype.scrollTo = function (
        optionsOrX?: ScrollToOptions | number,
        y?: number,
      ) {
        if (typeof optionsOrX === "object")
          observed.__agentScroll.push(optionsOrX.behavior);
        return Reflect.apply(
          scrollTo,
          this,
          typeof optionsOrX === "number" ? [optionsOrX, y] : [optionsOrX],
        );
      };
    });
    const s = await scenario(page, "text");
    await page.evaluate(() => {
      (window as typeof window & { __agentScroll: unknown[] }).__agentScroll =
        [];
    });
    await page.getByLabel("创作任务要求").fill("给我写一个广告分镜");
    await page.getByRole("button", { name: "发送任务" }).click();
    await expect(
      page.getByRole("button", { name: "15 秒", exact: true }),
    ).toBeVisible();
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            (window as typeof window & { __agentScroll: unknown[] })
              .__agentScroll,
        ),
      )
      .toContain("instant");
    expect(
      await page.evaluate(
        () =>
          (window as typeof window & { __agentScroll: unknown[] })
            .__agentScroll,
      ),
    ).not.toContain("smooth");
    expect(s.counts().executed).toBe(0);
  });
}

test("纯文字分镜任务追问、编辑与刷新恢复，不强制生成节点", async ({ page }) => {
  const s = await scenario(page, "text");
  await page.getByLabel("创作任务要求").fill("给我写一个广告分镜");
  await page.getByRole("button", { name: "发送任务" }).click();
  await page.getByRole("button", { name: "15 秒", exact: true }).click();
  await page.getByRole("button", { name: "发送任务" }).click();
  await expect(page.getByText("产品广告分镜", { exact: true })).toBeVisible();
  expect(s.counts().materialized).toBe(0);
  expect(s.counts().executed).toBe(0);
  const shot = page.locator("summary").filter({
    has: page.getByRole("checkbox", { name: "选择镜头 镜头1", exact: true }),
  });
  await expect(shot).toContainText("镜头1 · 0–15s");
  await expect(shot).toContainText("产品特写");
  await shot.locator("strong").click();
  await page
    .getByRole("textbox", { name: "镜头1 镜头提示词", exact: true })
    .fill("蓝色背景的瓶子特写");
  await page.getByRole("button", { name: "保存成果", exact: true }).click();
  await page.reload();
  await page.getByRole("button", { name: "打开智能体", exact: true }).click();
  await expect(page.getByText("产品广告分镜", { exact: true })).toBeVisible();
  expect(JSON.stringify(s.session)).toContain("蓝色背景的瓶子特写");
});
test("生成方案经过两次确认，第一次确认后刷新仍不运行", async ({ page }) => {
  const s = await scenario(page, "media");

  await page.getByLabel("创作任务要求").fill("给我制作产品主视觉");
  await page.getByRole("button", { name: "发送任务" }).click();
  await expect(page.getByRole("button", { name: "放入画布" })).toBeEnabled();
  expect(s.counts().executed).toBe(0);
  await page.getByRole("button", { name: "放入画布" }).click();
  await expect(page.locator(".react-flow__node")).toHaveCount(1);
  expect(s.counts().executed).toBe(0);
  await page.reload();
  await page.getByRole("button", { name: "打开智能体", exact: true }).click();
  await page.getByRole("button", { name: "估算费用" }).click();
  const execute = page.getByRole("button", { name: /^开始生成（/u });
  await expect(execute).toBeDisabled();
  await page.getByLabel("我已了解价格未知，确认生成").check();
  await execute.click();
  await expect.poll(() => s.counts().executed).toBe(1);
  const result = page
    .getByRole("region", { name: "通用创作智能体" })
    .locator('[class*="resultHeading"]');
  await expect(result).toContainText("产品主视觉");
  await expect(result).toContainText("已完成");
  await expect(result).not.toContainText("agent-image");
  await expect(
    page.getByText("节点 ID：agent-image", { exact: true }),
  ).not.toBeVisible();
  await page.getByText("节点详情", { exact: true }).click();
  await expect(
    page.getByText("节点 ID：agent-image", { exact: true }),
  ).toBeVisible();
});
test("同名供应商分别选择，并适应窄屏键盘输入", async ({ page }) => {
  await page.setViewportSize({ width: 430, height: 900 });
  await scenario(page, "text");
  const models = await openAgentModels(page);
  await expect(models.locator("details[data-supplier-id]")).toHaveCount(2);
  await expect(
    models.locator("details[data-supplier-id] > summary"),
  ).toContainText(["同名站点", "同名站点"]);
  await closeAgentModels(page);
  await chooseAgentModel(page, "brain-b\nbrain-b");
  await expectAgentModel(page, "brain-b\nbrain-b");
  await page.getByLabel("创作任务要求").fill("写一个分镜");
  await page.getByLabel("创作任务要求").press("Enter");
  await expect(page.getByText("需要确认广告时长")).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});

test("统一智能体入口，仅显示模型支持的思考选项，切换后恢复自动", async ({
  page,
}) => {
  const s = await scenario(page, "text");
  await expect(
    page.getByRole("tab", { name: "导演台", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "打开超级导演", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "智能体模型设置", exact: true }),
  ).toHaveCount(0);
  let models = await openAgentModels(page);
  await expect(models.locator("button[data-reasoning]")).toHaveCount(2);
  await closeAgentModels(page);
  await chooseAgentReasoning(page, "high");
  await chooseAgentModel(page, "brain-b\nbrain-b");
  models = await openAgentModels(page);
  await expect(models.locator('button[data-reasoning="auto"]')).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(models.locator("button[data-reasoning]")).toHaveCount(1);
  await expect(models).toContainText("待识别");
  await closeAgentModels(page);
  await chooseAgentModel(page, "brain-a\nbrain");
  models = await openAgentModels(page);
  await expect(models.locator('button[data-reasoning="auto"]')).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(models.getByLabel("模型参考素材支持", { exact: true })).toContainText("图片 ✓");
  await models.getByLabel("模型素材与思考详情", { exact: true }).locator("summary").click();
  await expect(models.getByText("图片支持来自应用默认设置。", { exact: true })).toBeVisible();
  await expect(models.getByText("供应商未注明图片数量。", { exact: true })).toBeVisible();
  s.model.reasoningOptions = [{ value: "auto", label: "自动" }];
  s.model.reasoningSource = "provider-catalog";
  await page.getByRole("button", { name: "刷新模型列表", exact: true }).click();
  await expect(models.locator("button[data-reasoning]")).toHaveCount(1);
  await expect(models).toContainText("无可选档位");
  await closeAgentModels(page);
});

test("自动读取后明确显示思考档位缺项，资料补齐后可选择官网档位", async ({
  page,
}) => {
  const s = await scenario(page, "text");
  s.model.reasoningOptions = [{ value: "auto", label: "自动" }];
  s.model.reasoningSource = "unknown";
  s.model.reasoningNotice = "已查渠道资料，仍缺少思考档位及明确的官方型号映射";
  const models = await openAgentModels(page);
  await models.getByLabel("模型素材与思考详情", { exact: true }).locator("summary").click();
  await expect(
    page.getByText(s.model.reasoningNotice, { exact: true }),
  ).toBeVisible();
  await expect(models).toContainText("资料待补充");
  delete s.model.reasoningNotice;
  s.model.reasoningSource = "official-model";
  s.model.reasoningOptions = [
    "auto",
    "none",
    "low",
    "medium",
    "high",
    "xhigh",
  ].map((value) => ({ value, label: value }));
  await expect(
    page.getByText("官网默认档位，当前渠道未实测", { exact: true }),
  ).toBeVisible();
  for (const value of ["none", "low", "medium", "high", "xhigh", "auto"]) {
    await models.locator(`button[data-reasoning="${value}"]`).click();
    await expect(
      models.locator(`button[data-reasoning="${value}"]`),
    ).toHaveAttribute("aria-pressed", "true");
  }
  await closeAgentModels(page);
  expect(s.counts().turns).toBe(0);
});

test("供应商声明的图片视频音频数量用于上传校验，并明确显示应用总量限制", async ({
  page,
}) => {
  const s = await scenario(page, "text");
  s.model.capabilities = {
    ...s.model.capabilities,
    imageInput: true,
    videoInput: true,
    audioInput: true,
  };
  s.model.imageInputStatus = "supported";
  s.model.inputLimits = {
    maxImages: 1,
    maxVideos: 1,
    maxAudios: 2,
    maxAssets: 3,
  };
  s.model.reasoningSource = "official-model";
  const models = await openAgentModels(page);
  await page.getByRole("button", { name: "刷新模型列表", exact: true }).click();
  const support = models.getByLabel("模型参考素材支持", { exact: true });
  await expect(support).toContainText("图片 ✓ 最多 1 张");
  await expect(support).toContainText("视频 ✓ 最多 1 个");
  await expect(support).toContainText("音频 ✓ 最多 2 个");
  await models.getByLabel("模型素材与思考详情", { exact: true }).locator("summary").click();
  await expect(page.getByText(/供应商每轮最多 3 个附件/u)).toBeVisible();
  await expect(
    page.getByText("官网默认档位，当前渠道未实测", { exact: true }),
  ).toBeVisible();
  s.model.reasoningSource = "live";
  s.model.reasoningFallback = {
    sourceUrl: "https://example.test/model",
    checkedAt: "2026-09-22",
  };
  await page.getByRole("button", { name: "刷新模型列表", exact: true }).click();
  await expect(
    page.getByText("渠道实测＋官网默认（未全部实测）", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText(
      /每轮最多 16 个附件，单个 16 MB，总计 24 MB，含所选节点素材/u,
    ),
  ).toBeVisible();
  await closeAgentModels(page);
  const picker = page.locator(
    'section[aria-label="通用创作智能体"] input[type="file"]',
  );
  await expect(picker).toHaveAttribute("accept", "image/*,video/*,audio/*");
  let uploads = 0;
  await page.route(/\/api\/assets\/upload\?/, (route) => {
    const kind = ["image", "video", "audio"][uploads++];
    return route.fulfill({
      json: {
        id: `upload-${uploads}`,
        name: `reference-${kind}`,
        kind,
        size: 8,
        mimeType: `${kind}/test`,
        metadata: {},
      },
    });
  });
  const file = (name: string, mimeType: string) => ({
    name,
    mimeType,
    buffer: Buffer.from("fixture"),
  });
  await picker.setInputFiles([
    file("one.mp4", "video/mp4"),
    file("two.mp4", "video/mp4"),
  ]);
  await expect(
    page.getByRole("region", { name: "通用创作智能体" }).getByRole("alert"),
  ).toContainText("最多读取 1 个视频");
  await picker.setInputFiles([
    file("one.wav", "audio/wav"),
    file("two.wav", "audio/wav"),
    file("three.wav", "audio/wav"),
  ]);
  await expect(
    page.getByRole("region", { name: "通用创作智能体" }).getByRole("alert"),
  ).toContainText("最多读取 2 个音频");
  expect(uploads).toBe(0);
  await picker.setInputFiles([
    file("one.png", "image/png"),
    file("one.mp4", "video/mp4"),
    file("one.wav", "audio/wav"),
  ]);
  await expect(
    page
      .getByRole("region", { name: "通用创作智能体" })
      .getByLabel("助手能看到")
      .getByText("已附 3 个素材", { exact: true }),
  ).toBeVisible();
  await expect(
    page
      .getByRole("region", { name: "通用创作智能体" })
      .getByRole("button", { name: /^移除 /u }),
  ).toHaveCount(3);
  await picker.setInputFiles(file("two.wav", "audio/wav"));
  await expect(
    page.getByRole("region", { name: "通用创作智能体" }).getByRole("alert"),
  ).toContainText("每轮最多读取 3 个附件");
  expect(uploads).toBe(3);
  expect(s.counts().turns).toBe(0);
});

test("长附件名可查看全文，切换为不支持素材的模型时保留附件，切回后可继续", async ({
  page,
}) => {
  const s = await scenario(page, "text");
  const name =
    "客户春季活动主视觉第二轮修改参考图_保留透明背景与完整中文说明_最终确认版本.png";
  const panel = page.getByRole("region", { name: "通用创作智能体" });
  await expect(
    panel.getByRole("button", { name: "新创作任务", exact: true }),
  ).toHaveAttribute("title", "新对话");
  await expect(
    panel.getByRole("button", { name: "添加参考素材", exact: true }),
  ).toHaveAttribute("title", "添加参考素材");
  await expect(
    panel.getByRole("button", { name: "发送任务", exact: true }),
  ).toHaveAttribute(
    "title",
    "发送消息（Enter 发送；Shift+Enter 换行）。制作方案仍需逐步确认。",
  );
  await page.route("**/api/assets/upload**", (route) =>
    route.fulfill({
      json: {
        id: "switch-image",
        name,
        kind: "image",
        size: 8,
        mimeType: "image/png",
        metadata: {},
      },
    }),
  );
  const picker = page.locator(
    'section[aria-label="通用创作智能体"] input[type="file"]',
  );
  await picker.setInputFiles({
    name,
    mimeType: "image/png",
    buffer: Buffer.from("fixture"),
  });
  const remove = panel.getByRole("button", {
    name: `移除 ${name}`,
    exact: true,
  });
  await expect(remove).toBeVisible();
  await expect(remove).toHaveAttribute("title", `移除参考素材：${name}`);
  const attachmentName = remove.locator("..").locator("small");
  await expect(attachmentName).toHaveAttribute("title", name);
  expect(
    await attachmentName.evaluate(
      (element) => element.scrollWidth > element.clientWidth,
    ),
  ).toBe(true);
  await chooseAgentModel(page, "brain-b\nbrain-b");
  await expect(
    page.getByRole("button", { name: "添加参考素材" }),
  ).toBeDisabled();
  await page.getByLabel("创作任务要求").fill("看看参考图");
  await page.getByRole("button", { name: "发送任务", exact: true }).click();
  await expect(
    page.getByRole("region", { name: "通用创作智能体" }).getByRole("alert"),
  ).toContainText("当前模型暂不可读取图片");
  await expect(remove).toBeVisible();
  const dismissError = panel.getByRole("button", {
    name: "关闭智能体错误",
    exact: true,
  });
  await expect(dismissError).toHaveAttribute("title", "关闭错误提示");
  await dismissError.click();
  await expect(panel.getByRole("alert")).toHaveCount(0);
  await expect(page.getByLabel("创作任务要求")).toHaveValue("看看参考图");
  expect(s.counts().turns).toBe(0);
  await chooseAgentModel(page, "brain-a\nbrain");
  await page.getByRole("button", { name: "发送任务", exact: true }).click();
  await expect.poll(() => s.counts().turns).toBe(1);
});

test("引用节点计入模型图片限额，重复引用同一素材只计一次", async ({ page }) => {
  const s = await scenario(page, "text");
  s.model.inputLimits = { maxImages: 1 };
  s.assets.push({
    id: "canvas-image",
    name: "节点参考图.png",
    kind: "image",
    mimeType: "image/png",
    size: 68,
    storageKey: "fixture",
    createdAt: new Date().toISOString(),
    metadata: {},
  });
  s.canvas.graph.nodes.push({
    id: "reference-node",
    type: "workflow",
    position: { x: 150, y: 150 },
    data: {
      nodeType: "asset-input",
      label: "节点参考图",
      assetId: "canvas-image",
      assetKind: "image",
      outputs: [{ id: "image", kind: "image", label: "图片" }],
    },
  });
  await page.reload();
  await page
    .locator('.react-flow__node[data-id="reference-node"] .node-title')
    .click();
  await page.getByRole("button", { name: "打开智能体", exact: true }).click();
  await expect(
    page.getByTitle("使用所选节点：节点参考图", { exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(
    page.getByTitle("使用所选节点：节点参考图", { exact: true }),
  ).toHaveAttribute("title", "使用所选节点：节点参考图");
  let uploads = 0;
  await page.route("**/api/assets/upload**", (route) => {
    uploads++;
    return route.fulfill({ json: s.assets[0] });
  });
  await page
    .locator('section[aria-label="通用创作智能体"] input[type="file"]')
    .setInputFiles({
      name: "second.png",
      mimeType: "image/png",
      buffer: Buffer.from("fixture"),
    });
  await expect(
    page.getByRole("region", { name: "通用创作智能体" }).getByRole("alert"),
  ).toContainText("最多读取 1 张图片，当前有 2 张（含引用节点素材）");
  expect(uploads).toBe(0);
  const transfer = await page.evaluateHandle(() => {
    const data = new DataTransfer();
    data.setData("application/x-super-canvas-asset", "canvas-image");
    return data;
  });
  await page
    .locator(".agent-composer")
    .dispatchEvent("drop", { dataTransfer: transfer });
  await expect(
    page.getByRole("button", { name: "移除 节点参考图.png" }),
  ).toBeVisible();
  await page.getByLabel("创作任务要求").fill("只分析同一张图");
  await page.getByRole("button", { name: "发送任务", exact: true }).click();
  await expect.poll(() => s.counts().turns).toBe(1);
  expect(
    s.session.messages.find((message) => message.role === "user")?.metadata
      .attachmentAssetIds,
  ).toEqual(["canvas-image"]);
});

for (const mode of ["failure", "disconnect"] as const) {
  test(`${mode} 后退出等待并刷新持久化错误，重新编辑不自动付费重发`, async ({
    page,
  }) => {
    const s = await scenario(page, mode);
    await page.getByLabel("创作任务要求").fill("给我写一个广告分镜");
    await page.getByRole("button", { name: "发送任务", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "停止分析", exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByText("模型暂未返回正文，请重新编辑后发送", { exact: true }),
    ).toBeVisible();
    await page.reload();
    await page.getByRole("button", { name: "打开智能体", exact: true }).click();
    await page.getByRole("button", { name: "重新编辑", exact: true }).click();
    await expect(page.getByLabel("创作任务要求")).toHaveValue(
      "给我写一个广告分镜",
    );
    expect(s.counts().turns).toBe(1);
  });
}

test("旧对话保留本地与项目聊天，不读取旧导演记录", async ({ page }) => {
  const s = await scenario(page, "text");
  let legacyRequests = 0;
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === "/api/agent/legacy")
      legacyRequests++;
  });
  await page.evaluate(() =>
    localStorage.setItem(
      "super-canvas:agent-history:v2:agent-e2e",
      JSON.stringify([{ text: "本地聊天历史" }]),
    ),
  );
  await page.route("**/api/projects/agent-e2e/chat", (route) =>
    route.fulfill({
      json: { messages: [{ role: "assistant", content: "项目聊天历史" }] },
    }),
  );
  const history = await openAgentSessions(page);
  await history
    .getByRole("button", { name: "旧对话（只读）", exact: true })
    .click();
  await expect(page.getByText("本地聊天历史", { exact: true })).toBeVisible();
  await expect(page.getByText("项目聊天历史", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: /^开始生成（/u })).toHaveCount(
    0,
  );
  expect(legacyRequests).toBe(0);
  expect(s.counts().executed).toBe(0);
});

test("刚上传的图片在失败后重新编辑仍保留，并刷新模型能力", async ({ page }) => {
  const s = await scenario(page, "failure");
  let modelRefreshes = 0;
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === "/api/agent/models")
      modelRefreshes++;
  });
  const asset = {
    id: "new-upload",
    name: "reference.png",
    kind: "image",
    mimeType: "image/png",
    size: 68,
    url: "/api/assets/new-upload/content",
    createdAt: new Date().toISOString(),
    metadata: {},
  };
  await page.route("**/api/assets/upload**", (route) =>
    route.fulfill({ json: asset }),
  );
  await page
    .locator('section[aria-label="通用创作智能体"] input[type="file"]')
    .setInputFiles({
      name: "reference.png",
      mimeType: "image/png",
      buffer: Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jF3cAAAAASUVORK5CYII=",
        "base64",
      ),
    });
  await expect(
    page.getByRole("button", { name: "移除 reference.png" }),
  ).toBeVisible();
  await page.getByLabel("创作任务要求").fill("分析这张图");
  await page.getByRole("button", { name: "发送任务", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "重新编辑", exact: true }),
  ).toBeVisible();
  await expect.poll(() => modelRefreshes).toBeGreaterThan(0);
  await page.getByRole("button", { name: "重新编辑", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "移除 reference.png" }),
  ).toBeVisible();
  expect(s.counts().turns).toBe(1);
});

for (const viewport of [
  { width: 1366, height: 768 },
  { width: 1920, height: 1080 },
]) {
  test(`${viewport.width}×${viewport.height}智能体输入区紧凑，全部型号控件直接可见并保留对话空间`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await page.addInitScript(() =>
      localStorage.setItem("super-canvas:agent-model-expanded", "true"),
    );
    let external = 0;
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.route("**/*", (route) => {
      const url = new URL(route.request().url());
      if (
        ["http:", "https:"].includes(url.protocol) &&
        !["localhost", "127.0.0.1"].includes(url.hostname)
      ) {
        external++;
        return route.abort();
      }
      return route.fallback();
    });
    const s = await scenario(page, "text");
    const panel = page.getByRole("region", {
      name: "通用创作智能体",
      exact: true,
    });
    const longName =
      "创作模型完整名称_长上下文与多模态参考资料_保持真实型号全文";
    const notice =
      "当前渠道的思考强度以供应商目录为准；长说明可悬停完整查看，不挤占聊天区域。";
    Object.assign(s.model, {
      supplierName: "隔离创作供应商_完整名称与渠道说明",
      group: "创作分组_长名称与稳定分组说明",
      connectionName: "主创作连接_保留完整连接名称",
      modelName: longName,
      reasoningNotice: notice,
      reasoningSource: "provider-catalog",
      inputLimits: { maxImages: 4, maxAssets: 8 },
    });
    // The full hierarchy and capability evidence move into the model popover;
    // the compact composer keeps the same exact saved model choice.
    await page.route("**/api/agent/models", (route) =>
      route.fulfill({
        json: [
          s.model,
          {
            ...s.model,
            connectionId: "brain-extra",
            connectionName: "备用创作连接_完整名称",
          },
        ],
      }),
    );
    const models = await openAgentModels(page);
    await models
      .getByRole("button", { name: "刷新模型列表", exact: true })
      .click();
    const supplier = models.locator('[data-supplier-id="site-a"]');
    await expect(supplier.locator(":scope > summary")).toContainText(
      "隔离创作供应商_完整名称与渠道说明",
    );
    await expect(
      supplier.locator(
        '[data-model-group="创作分组_长名称与稳定分组说明"] > summary',
      ),
    ).toContainText("创作分组_长名称与稳定分组说明");
    await expect(
      supplier.locator('[data-connection-id="brain-a"]'),
    ).toContainText("主创作连接_保留完整连接名称");
    await expect(
      supplier.locator('[data-connection-id="brain-extra"]'),
    ).toContainText("备用创作连接_完整名称");
    await expect(agentModelRow(models, "brain-a\nbrain")).toContainText(
      longName,
    );
    await expect(models).toContainText(notice);
    await expect(models.locator("button[data-reasoning]")).toHaveCount(2);
    const support = models.getByLabel("模型参考素材支持", { exact: true });
    await expect(support).toContainText("图片 ✓ 最多 4 张");
    await models.getByLabel("模型素材与思考详情", { exact: true }).locator("summary").click();
    await expect(models.getByText("图片支持来自应用默认设置。", { exact: true })).toBeVisible();
    await expect(models).toContainText("供应商每轮最多 8 个附件");
    await expect(models).toContainText("每轮最多 16 个附件");
    await expect
      .poll(() =>
        support.evaluate((element) => getComputedStyle(element).textOverflow),
      )
      .not.toBe("ellipsis");
    await closeAgentModels(page);
    await expectAgentModel(page, "brain-a\nbrain");
    await expect(agentModelTrigger(page)).toBeInViewport({ ratio: 1 });
    await expect(agentModelTrigger(page)).toHaveAttribute(
      "title",
      /brain.*隔离创作供应商/u,
    );
    const composer = panel.locator(".agent-composer");
    const conversation = panel.getByRole("list", {
      name: "智能体对话",
      exact: true,
    });
    await expect
      .poll(async () => (await composer.boundingBox())?.height ?? Infinity)
      .toBeLessThanOrEqual(300);
    await expect
      .poll(async () => (await conversation.boundingBox())?.height ?? 0)
      .toBeGreaterThanOrEqual(250);
    await expect
      .poll(() =>
        composer.evaluate(
          (element) => element.scrollHeight - element.clientHeight,
        ),
      )
      .toBeLessThanOrEqual(1);
    const input = panel.getByRole("textbox", {
      name: "创作任务要求",
      exact: true,
    });
    await expect
      .poll(async () => (await input.boundingBox())?.height ?? 0)
      .toBeGreaterThanOrEqual(36);
    const shortHeight = (await input.boundingBox())!.height;
    await input.fill(
      Array.from(
        { length: 5 },
        (_, index) => `第 ${index + 1} 行保留完整创作要求`,
      ).join("\n"),
    );
    await expect
      .poll(async () => (await input.boundingBox())!.height)
      .toBeGreaterThan(shortHeight);
    await expect
      .poll(async () => (await input.boundingBox())!.height)
      .toBeLessThanOrEqual(176);
    await input.clear();
    await expect
      .poll(async () => (await input.boundingBox())!.height)
      .toBeLessThanOrEqual(shortHeight + 1);
    await expect(
      panel.getByRole("button", { name: "添加参考素材", exact: true }),
    ).toBeInViewport({ ratio: 1 });
    await expect(
      panel.getByRole("button", { name: "发送任务", exact: true }),
    ).toBeInViewport({ ratio: 1 });
    expect({ external, errors, ...s.counts() }).toEqual({
      external: 0,
      errors: [],
      executed: 0,
      materialized: 0,
      turns: 0,
    });
  });
}
