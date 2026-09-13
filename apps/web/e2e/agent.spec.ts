import { expect, test, type Page } from "@playwright/test";
import type { AgentPlan, AgentSession } from "../lib/agent-contracts";

/** All API traffic is isolated. No user configuration, upstream or paid model is used. */
async function scenario(page: Page, mode: "text" | "media") {
  const canvasId = "agent-e2e";
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
  const model = {
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
      reasoning: false,
    },
    source: "manual",
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
      session.messages.push({
        id: `u-${turns}`,
        role: "user",
        content: input.message,
        createdAt: now,
        metadata: {},
      });
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
    if (
      path === "/api/providers" ||
      path === "/api/assets" ||
      path === "/api/runs"
    )
      return route.fulfill({ json: [] });
    if (path.includes("/models")) return route.fulfill({ json: [] });
    if (path.includes("/chat"))
      return route.fulfill({ json: { messages: [] } });
    return route.fulfill({
      json: { groups: [], items: [], runs: [], drops: [] },
    });
  });
  await page.goto(`/canvas/${canvasId}`);
  await page.getByRole("button", { name: "打开智能体", exact: true }).click();
  await expect(page.getByLabel("智能体模型", { exact: true })).toHaveValue(
    "brain-a\nbrain",
  );
  return { counts: () => ({ executed, materialized, turns }), session };
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
  await page.getByText("镜头1 · 0–15s · 产品特写", { exact: false }).click();
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
  await expect(
    page.getByRole("button", { name: "第一次确认：放入画布" }),
  ).toBeEnabled();
  expect(s.counts().executed).toBe(0);
  await page.getByRole("button", { name: "第一次确认：放入画布" }).click();
  await expect(page.locator(".react-flow__node")).toHaveCount(1);
  expect(s.counts().executed).toBe(0);
  await page.reload();
  await page.getByRole("button", { name: "打开智能体", exact: true }).click();
  await page.getByRole("button", { name: "我已检查节点，进行预检" }).click();
  const execute = page.getByRole("button", { name: "第二次确认：开始生成" });
  await expect(execute).toBeDisabled();
  await page.getByLabel("我已了解价格未知，确认生成").check();
  await execute.click();
  await expect.poll(() => s.counts().executed).toBe(1);
});
test("同名供应商分别选择，并适应窄屏键盘输入", async ({ page }) => {
  await page.setViewportSize({ width: 430, height: 900 });
  await scenario(page, "text");
  await expect(
    page.getByLabel("智能体 API 供应商").locator("option"),
  ).toHaveCount(3);
  await page.getByLabel("智能体 API 供应商").selectOption("site-b");
  await expect(page.getByLabel("智能体模型", { exact: true })).toHaveValue(
    "brain-b\nbrain-b",
  );
  await page.getByLabel("创作任务要求").fill("写一个分镜");
  await page.getByLabel("创作任务要求").press("Enter");
  await expect(page.getByText("需要确认广告时长")).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});
