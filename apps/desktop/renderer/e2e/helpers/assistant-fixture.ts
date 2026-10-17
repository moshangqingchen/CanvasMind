import { agentProposalAllowed } from "../../lib/agent-intent";
import { expect, type Page } from "@playwright/test";
import type {
  AgentMessage,
  AgentPlan,
  AgentSession,
  AgentTurnInput,
} from "../../lib/agent-contracts";
import type { AgentModelOption } from "../../lib/agent-models";
import { installNeuralFixture, neuralProjects } from "./neural-fixture";
import type { DirectorCatalogCandidate } from "@super-canvas/director";
import { neuralConnections } from "./neural-fixture";
import { agentCallParameters, agentRequirementsForParameters } from "../../lib/agent-plan-parameters";

export type AssistantFixtureMode =
  "reply" | "slow" | "clarify" | "storyboard" | "durable-disconnect";
const now = "2026-10-16T09:00:00.000Z";
export const assistantCanvasId = "neural-autumn";
export const assistantModelKey =
  "assistant-primary\nfixture.chat.2026-10-full-id";
export const assistantMarkdown =
  "## 秋日视觉方向\n\n> 先把品牌的温度说清楚。\n\n- 留出呼吸感\n- 保留真实素材\n\n| 方向 | 用途 |\n| --- | --- |\n| 月光银 | 产品主视觉 |\n\n```ts\nconst palette = ['silver', 'amber'];\n```\n\n<img src=x onerror=\"window.__assistantUnsafe=true\">\n<script>window.__assistantUnsafe=true</script>";
const assistantCreativeReply =
  "## 秋日视觉方向\n\n> 以月光银衬托产品，让暖金成为记忆点。\n\n- 主视觉留出呼吸感，突出产品轮廓\n- 保留原始素材的质感与品牌识别\n\n| 方向 | 画面安排 |\n| --- | --- |\n| 月光银 | 干净背景与柔和侧光 |\n| 焦糖金 | 标题、细节和局部高光 |\n\n建议先完成一张主视觉，再从同一构图延展海报和封面。你可以继续讨论，也可以把这些方向整理成可检查的画布方案。";
export const assistantModels: AgentModelOption[] = [
  {
    supplierId: "assistant-supplier-a",
    supplierName: "晨星对话",
    group: "文字创作组",
    connectionId: "assistant-primary",
    connectionName: "主创作连接",
    modelId: "fixture.chat.2026-10-full-id",
    modelName: "创作对话 · 完整上下文",
    protocol: "openai-chat-completions",
    available: true,
    source: "manual",
    capabilities: {
      text: true,
      imageInput: true,
      audioInput: true,
      videoInput: true,
      structuredOutput: true,
      toolCalling: true,
      nativeWebSearch: false,
      reasoning: true,
    },
    reasoningOptions: [
      { value: "auto", label: "自动" },
      { value: "medium", label: "中" },
      { value: "high", label: "高" },
    ],
    reasoningSource: "provider-catalog",
    reasoningNotice: "由已保存的供应商目录声明，未触发检测。",
    inputLimits: { maxImages: 4, maxVideos: 1, maxAudios: 2, maxAssets: 6 },
    imageInputStatus: "supported",
    audioInputStatus: "supported",
    videoInputStatus: "supported",
  },
  {
    supplierId: "assistant-supplier-a",
    supplierName: "晨星对话",
    group: "文字创作组",
    connectionId: "assistant-secondary",
    connectionName: "备用创作连接",
    modelId: "fixture.chat.text-only-v2",
    modelName: "轻量文字模型",
    protocol: "openai-chat-completions",
    available: true,
    source: "manual",
    capabilities: {
      text: true,
      imageInput: false,
      audioInput: false,
      videoInput: false,
      structuredOutput: false,
      toolCalling: false,
      nativeWebSearch: false,
      reasoning: false,
    },
    reasoningOptions: [{ value: "auto", label: "自动" }],
  },
  {
    supplierId: "assistant-supplier-b",
    supplierName: "纸月对话",
    group: "推演组",
    connectionId: "assistant-third",
    connectionName: "分镜连接",
    modelId: "fixture.storyboard.reasoning-2026",
    modelName: "分镜推演模型",
    protocol: "openai-chat-completions",
    available: true,
    source: "manual",
    capabilities: {
      text: true,
      imageInput: true,
      audioInput: false,
      videoInput: false,
      structuredOutput: true,
      toolCalling: false,
      nativeWebSearch: false,
      reasoning: true,
    },
    reasoningOptions: [
      { value: "auto", label: "自动" },
      { value: "high", label: "高" },
    ],
    imageInputStatus: "assumed",
  },
];

type PreparedTurn = {
  initial: AgentSession;
  chunks: string[];
  interval: number;
  turnId: string;
  disconnectAfterCommit: boolean;
};
type FixtureWindow = Window & {
  __assistantFixtureMode: AssistantFixtureMode;
  __assistantFixturePrepare: (
    input: AgentTurnInput,
    mode: AssistantFixtureMode,
  ) => Promise<PreparedTurn>;
  __assistantFixtureFinish: (turnId: string) => Promise<AgentSession>;
  __assistantFixtureCancel: (turnId: string) => Promise<void>;
};

/** Timed, real ReadableStream events; every service and execution stays in memory. */
export async function installAssistantFixture(
  page: Page,
  options: {
    theme?: "dark" | "light";
    motion?: boolean;
    populated?: boolean;
    markdownProbe?: boolean;
    chatStreamDurationMs?: number;
    channelParameters?: boolean;
  } = {},
) {
  const parameterCandidates: DirectorCatalogCandidate[] = ["a", "b"].map((key, index) => ({
    connectionId: `assistant-image-${key}`, connectionName: `测试图片渠道 ${key.toUpperCase()}`, supplier: `fixture-image-${key}`,
    provider: "rest", group: index ? "标准组" : "高质量组", authoritative: true, connectionActive: true, credentialUsable: true,
    model: { id: `fixture.image.full-id-${key}`, name: `图片模型 ${key.toUpperCase()}`, operations: ["image.generate", "image.edit"], inputKinds: ["text", "image"], outputKinds: ["image"],
      parameters: [
        { key: "aspect_ratio", label: "画面比例", control: "select", valueType: "string", default: "1:1", options: [{ label: "方形 1:1", value: "1:1" }, { label: "竖向 9:16", value: "9:16" }] },
        { key: "resolution", label: "分辨率", control: "select", valueType: "string", default: index ? "2K" : "4K", options: index ? [{ label: "2K", value: "2K" }] : [{ label: "2K", value: "2K" }, { label: "4K", value: "4K" }] },
        { key: "quality", label: "质量", control: "select", valueType: "string", default: index ? "standard" : "high", options: [{ label: index ? "标准" : "高", value: index ? "standard" : "high" }] },
        { key: "seed", label: "种子", control: "number", valueType: "integer", min: 0, max: 999, default: 42 },
      ],
    },
  }));
  const parameterConnections = parameterCandidates.map(candidate => ({
    id: candidate.connectionId, name: candidate.connectionName, provider: candidate.provider, apiKey: "", apiKeySet: true, apiKeyUsable: true,
    config: { usage: "canvas", supplierId: candidate.supplier, supplierName: candidate.connectionName, supplierKey: candidate.supplier, modelGroup: candidate.group, modelScanStatus: "live", scannedModelIds: [candidate.model.id], modelCatalogModels: [candidate.model] },
  }));
  const base = await installNeuralFixture(page, {
    theme: options.theme,
    motion: options.motion,
    ...(options.channelParameters ? { connections: [...neuralConnections, ...parameterConnections] } : {}),
    projects: neuralProjects.map((project) =>
      project.id === assistantCanvasId ? { ...project, nodeCount: 2 } : project,
    ),
  });
  const calls: Array<{ action: string; body: unknown }> = [];
  const replyMarkdown = options.markdownProbe
    ? assistantMarkdown
    : assistantCreativeReply;
  const turns: AgentTurnInput[] = [];
  const cancelled: string[] = [];
  const pending = new Map<
    string,
    { session: AgentSession; reply: AgentMessage; plan?: AgentPlan }
  >();
  let sequence = 0,
    modelReads = 0;
  const canvas = {
    id: assistantCanvasId,
    title: "秋日品牌视觉",
    revision: 1,
    graph: {
      schemaVersion: 1,
      viewport: { x: 0, y: 0, zoom: 0.85 },
      edges: [],
      drawings: [],
      nodes: [
        {
          id: "assistant-prompt",
          type: "workflow",
          position: { x: 160, y: 180 },
          data: {
            nodeType: "prompt",
            label: "活动主视觉方向",
            parts: [{ type: "text", text: "用月光银与暖金建立秋日品牌视觉。" }],
            outputs: [{ id: "prompt", kind: "text", label: "提示词" }],
          },
        },
        {
          id: "assistant-reference",
          type: "workflow",
          position: { x: 160, y: 420 },
          data: {
            nodeType: "asset-input",
            label: "产品参考图",
            assetId: "assistant-reference-image",
            assetKind: "image",
            outputs: [{ id: "image", kind: "image", label: "图片" }],
          },
        },
      ] as unknown[],
    },
  };
  const asset = {
    id: "assistant-reference-image",
    name: "产品原始参考.png",
    kind: "image",
    mimeType: "image/png",
    size: 68,
    storageKey: "fixture-only",
    createdAt: now,
    metadata: { width: 1, height: 1 },
  };
  const assets = [asset];
  let assetReads = 0;
  const canvases = new Map([[canvas.id, canvas]]);
  const main: AgentSession = {
    id: "assistant-session-main",
    canvasId: assistantCanvasId,
    title: "秋日品牌方向",
    messages: [],
    plans: [],
  };
  const previous: AgentSession = {
    id: "assistant-session-previous",
    canvasId: assistantCanvasId,
    title: "月光产品讨论",
    messages: [
      {
        id: "previous-reply",
        role: "assistant",
        content: "上一段对话保留的品牌讨论。",
        createdAt: now,
        metadata: {},
      },
    ],
    plans: [],
  };
  const sessions = new Map([
    [main.id, main],
    [previous.id, previous],
  ]);
  if (options.populated)
    main.messages.push({
      id: "existing-reply",
      role: "assistant",
      content: replyMarkdown,
      createdAt: now,
      metadata: { suggestPlan: true },
    });
  const makePlan = (input: AgentTurnInput): AgentPlan => ({
    id: "assistant-plan",
    sessionId: input.sessionId,
    canvasId: input.canvasId,
    version: 1,
    status: "awaiting_approval",
    summary: "秋日品牌主视觉方案",
    sourceRequestId: input.requestId,
    baseCanvasRevision: canvases.get(input.canvasId)?.revision ?? 1,
    proposal: {
      type: "proposal",
      summary: "秋日品牌主视觉方案",
      assumptions: [],
      texts: [],
      calls: [
        {
          id: "hero",
          label: "秋日主视觉",
          prompt: "保持真实产品，以月光银和暖金建立留白。",
          requirements: { operation: "image.generate", count: 1 },
          ...(options.channelParameters ? { preferredConnectionId: parameterCandidates[0]!.connectionId, preferredModelId: parameterCandidates[0]!.model.id,
            parameters: { aspect_ratio: "9:16", resolution: "4K", quality: "high", seed: 42 } } : {}),
          sourceAssetIds: [],
          recommendation: "仅供离线界面验收",
        },
      ],
    },
    calls: options.channelParameters ? [{ id: "hero", label: "秋日主视觉", prompt: "保持真实产品，以月光银和暖金建立留白。", requirements: { operation: "image.generate", count: 1 },
      parameters: { aspect_ratio: "9:16", resolution: "4K", quality: "high", seed: 42 },
      selected: { candidate: parameterCandidates[0]!, eligible: true, exclusionReasons: [], pricingStatus: "unknown", comparable: false },
      alternatives: parameterCandidates.map(candidate => ({ candidate, eligible: true, exclusionReasons: [], pricingStatus: "unknown", comparable: false })),
    }] : [],
    patch: {
      nodes: [],
      edges: [],
      generationNodeIds: ["assistant-generated"],
      touchedExistingNodeIds: [],
    },
  });
  await page.exposeFunction(
    "__assistantFixturePrepare",
    (input: AgentTurnInput, mode: AssistantFixtureMode): PreparedTurn => {
      turns.push(input);
      calls.push({
        action: `turn:${input.intent ?? "chat"}`,
        body: structuredClone(input),
      });
      const session = sessions.get(input.sessionId)!;
      session.messages.push({
        id: `user-${turns.length}`,
        role: "user",
        content: input.message,
        createdAt: now,
        metadata: {
          requestId: input.requestId,
          intent: input.intent ?? "chat",
          attachmentAssetIds: input.attachmentAssetIds,
        },
      });
      if (!agentProposalAllowed(input.intent ?? "chat", input.message))
        session.plans = session.plans.map((plan) => ({
          ...plan,
          status: "cancelled",
          error: "本次画布任务授权已撤回，请明确发送新的制作请求。",
        }));
      session.messages.push(
        ...["read_canvas", "list_models"].map((tool, index): AgentMessage => ({
          id: `tool-${turns.length}-${index}`,
          role: "assistant",
          content: `已读取离线界面资料 ${index + 1}`,
          createdAt: now,
          metadata: { kind: "tool", tool },
        })),
      );
      const reply: AgentMessage = {
        id: `reply-${turns.length}`,
        role: "assistant",
        content: replyMarkdown,
        createdAt: now,
        metadata: {
          kind: "message",
          suggestPlan: true,
          requestId: input.requestId,
        },
      };
      let plan: AgentPlan | undefined;
      if (agentProposalAllowed(input.intent ?? "chat", input.message)) {
        plan = makePlan(input);
        reply.content = "方案已整理，请先检查再决定是否放入画布。";
        reply.metadata = { kind: "proposal", requestId: input.requestId };
      } else if (mode === "clarify") {
        reply.content = "先确认两个选择，再继续细化。";
        reply.metadata = {
          kind: "clarify",
          requestId: input.requestId,
          questions: [
            {
              id: "tone",
              question: "你希望画面是什么气质？",
              options: ["安静克制", "温暖明亮"],
            },
            {
              id: "format",
              question: "首先使用在哪种物料？",
              options: ["活动海报", "产品封面"],
            },
          ],
        };
      } else if (mode === "durable-disconnect") {
        reply.content = "断流后的完整回复已保存，只显示一次。";
        reply.metadata = { kind: "message", requestId: input.requestId };
      } else if (mode === "storyboard") {
        reply.content = "两段镜头已整理，选中需要继续的部分。";
        reply.metadata = {
          kind: "artifact",
          requestId: input.requestId,
          artifact: {
            kind: "storyboard",
            title: "秋日产品分镜",
            content: "",
            totalDuration: 6,
            characters: [],
            shots: [
              {
                id: "镜头1",
                start: 0,
                end: 3,
                camera: "产品特写",
                action: "瓶身进入月光",
                dialogue: "",
                sound: "轻音乐",
                prompt: "月光银背景中的真实产品特写",
                characterIds: [],
                assetIds: [],
              },
              {
                id: "镜头2",
                start: 3,
                end: 6,
                camera: "缓慢拉远",
                action: "金色余光映照品牌字样",
                dialogue: "",
                sound: "轻音乐",
                prompt: "保留真实产品，缓慢拉远的暖金构图",
                characterIds: [],
                assetIds: [],
              },
            ],
          },
        };
      }
      const chunks =
        mode === "slow"
          ? Array.from(
              { length: 40 },
              (_, index) => `逐步整理第${index + 1}段。`,
            )
          : (reply.content.match(/[\s\S]{1,42}/gu) ?? [reply.content]);
      pending.set(input.requestId, { session, reply, plan });
      return {
        initial: structuredClone(session),
        chunks,
        interval:
          mode === "slow"
            ? 220
            : input.intent !== "canvas-plan" && options.chatStreamDurationMs
              ? Math.max(
                  150,
                  Math.ceil(options.chatStreamDurationMs / chunks.length),
                )
              : 150,
        turnId: input.requestId,
        disconnectAfterCommit: mode === "durable-disconnect",
      };
    },
  );
  await page.exposeFunction("__assistantFixtureFinish", (turnId: string) => {
    const entry = pending.get(turnId)!;
    entry.session.messages.push(entry.reply);
    if (entry.plan) entry.session.plans = [entry.plan];
    pending.delete(turnId);
    return structuredClone(entry.session);
  });
  await page.exposeFunction("__assistantFixtureCancel", (turnId: string) => {
    const entry = pending.get(turnId);
    if (!entry) return;
    cancelled.push(turnId);
    entry.session.messages.push({
      id: `cancelled-${turnId}`,
      role: "assistant",
      content: "分析已停止。可以编辑后手动继续。",
      createdAt: now,
      metadata: { kind: "status", status: "cancelled", requestId: turnId },
    });
    pending.delete(turnId);
  });
  await page.addInitScript(() => {
    const state = window as unknown as FixtureWindow;
    state.__assistantFixtureMode = "reply";
    const fetch = window.fetch.bind(window);
    window.fetch = async (input, init) => {
      const url = new URL(
        input instanceof Request ? input.url : String(input),
        location.href,
      );
      if (
        url.pathname !== "/api/agent/turn" ||
        init?.method?.toUpperCase() !== "POST"
      )
        return fetch(input, init);
      const request = JSON.parse(String(init.body)) as AgentTurnInput;
      const prepared = await state.__assistantFixturePrepare(
        request,
        state.__assistantFixtureMode,
      );
      const encoder = new TextEncoder();
      let stopped = false;
      const timers: number[] = [];
      const signal = init.signal;
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          const emit = (event: unknown) => {
            if (!stopped)
              controller.enqueue(
                encoder.encode(`data: ${JSON.stringify(event)}\n\n`),
              );
          };
          const cleanup = () => {
            for (const timer of timers) clearTimeout(timer);
            signal?.removeEventListener("abort", abort);
          };
          const abort = () => {
            if (stopped) return;
            stopped = true;
            cleanup();
            void state.__assistantFixtureCancel(prepared.turnId);
            controller.error(new DOMException("Aborted", "AbortError"));
          };
          signal?.addEventListener("abort", abort, { once: true });
          if (signal?.aborted) return abort();
          emit({ type: "session", session: prepared.initial });
          emit({ type: "stage", message: "正在整理创作方向" });
          prepared.chunks.forEach((text, index) =>
            timers.push(
              window.setTimeout(
                () =>
                  emit({
                    type: "delta",
                    turnId: prepared.turnId,
                    text,
                    reset: index === 0,
                  }),
                200 + index * prepared.interval,
              ),
            ),
          );
          timers.push(
            window.setTimeout(
              async () => {
                if (stopped) return;
                const session = await state.__assistantFixtureFinish(
                  prepared.turnId,
                );
                if (stopped) return;
                if (!prepared.disconnectAfterCommit) {
                  emit({ type: "session", session });
                  emit({ type: "done", status: "succeeded" });
                }
                stopped = true;
                cleanup();
                controller.close();
              },
              200 + prepared.chunks.length * prepared.interval,
            ),
          );
        },
        cancel() {
          stopped = true;
          for (const timer of timers) clearTimeout(timer);
          void state.__assistantFixtureCancel(prepared.turnId);
        },
      });
      return new Response(stream, {
        headers: { "content-type": "text/event-stream" },
      });
    };
    localStorage.setItem(
      "agent-model:neural-autumn",
      "assistant-primary\nfixture.chat.2026-10-full-id",
    );
    localStorage.setItem(
      "super-canvas:agent-history:v2:neural-autumn",
      JSON.stringify([{ text: "仅保留的本地旧对话" }]),
    );
  });
  await page.route("**/api/**", async (route) => {
    const request = route.request(),
      url = new URL(request.url()),
      path = url.pathname,
      method = request.method();
    if (path === "/api/agent/models" && method === "GET") {
      modelReads++;
      return route.fulfill({ json: assistantModels });
    }
    const generationModels = /^\/api\/providers\/(assistant-image-[ab])\/models$/u.exec(path);
    if (options.channelParameters && generationModels && method === "GET") return route.fulfill({ json: parameterCandidates.filter(candidate => candidate.connectionId === generationModels[1]).map(candidate => candidate.model) });
    if (path === "/api/agent/sessions") {
      if (method === "GET")
        return route.fulfill({
          json: [...sessions.values()]
            .filter(
              (session) =>
                !url.searchParams.has("canvasId") ||
                session.canvasId === url.searchParams.get("canvasId"),
            )
            .map(({ id, title }) => ({ id, title })),
        });
      if (method === "POST") {
        const created: AgentSession = {
          id: `assistant-session-new-${++sequence}`,
          canvasId: request.postDataJSON().canvasId,
          title: "新的创作对话",
          messages: [],
          plans: [],
        };
        sessions.set(created.id, created);
        return route.fulfill({ json: created });
      }
    }
    const sessionMatch = /^\/api\/agent\/sessions\/([^/]+)$/u.exec(path);
    if (sessionMatch && ["GET", "POST"].includes(method))
      return route.fulfill({ json: sessions.get(sessionMatch[1]!) });
    if (path === `/api/projects/${assistantCanvasId}/chat` && method === "GET")
      return route.fulfill({
        json: {
          messages: [{ role: "assistant", content: "仅保留的项目旧对话" }],
        },
      });
    if (path.startsWith("/api/canvas/")) {
      const id = decodeURIComponent(path.split("/")[3]!);
      if (!canvases.has(id)) {
        const project = base.projects().find((project) => project.id === id);
        if (!project) return route.fallback();
        canvases.set(id, {
          id,
          title: project.title,
          revision: 1,
          graph: {
            schemaVersion: 1,
            viewport: { x: 0, y: 0, zoom: 1 },
            nodes: [],
            edges: [],
            drawings: [],
          },
        });
      }
      const targetCanvas = canvases.get(id)!;
      if (method === "PUT") {
        targetCanvas.graph = request.postDataJSON().graph;
        targetCanvas.revision++;
      }
      return route.fulfill({ json: targetCanvas });
    }
    if (path === "/api/assets" && method === "GET") {
      assetReads++;
      return route.fulfill({ json: assets });
    }
    if (path === "/api/assets/upload" && method === "POST")
      return route.fulfill({ json: asset });
    if (path === `/api/assets/${asset.id}/content` && method === "GET")
      return route.fulfill({
        contentType: "image/png",
        body: Buffer.from(
          "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
          "base64",
        ),
      });
    const planMatch =
      /^\/api\/agent\/plans\/([^/]+)(?:\/(materialize|preflight|execute))?$/u.exec(
        path,
      );
    if (planMatch && method !== "GET") {
      const action =
          method === "DELETE" ? "cancel" : (planMatch[2] ?? "update"),
        body = request.postDataJSON();
      calls.push({ action, body });
      const plan = [...sessions.values()]
        .flatMap((session) => session.plans)
        .find((plan) => plan.id === planMatch[1]);
      expect(plan, "只能操作本次显式创建的方案").toBeDefined();
      const targetCanvas = canvases.get(plan!.canvasId)!;
      if (action === "cancel") {
        plan!.status = "cancelled";
        return route.fulfill({ json: plan });
      }
      if (action === "update") {
        plan!.proposal = body.proposal;
        if (options.channelParameters) plan!.calls = plan!.proposal.calls.map(call => {
          const candidate = parameterCandidates.find(candidate => candidate.connectionId === call.preferredConnectionId && candidate.model.id === call.preferredModelId)!;
          const parameters = agentCallParameters(call.requirements, candidate, call.parameters);
          return { ...call, requirements: agentRequirementsForParameters(call.requirements, parameters, candidate.model), parameters,
            selected: { candidate, eligible: true, exclusionReasons: [], pricingStatus: "unknown", comparable: false },
            alternatives: parameterCandidates.map(candidate => ({ candidate, eligible: true, exclusionReasons: [], pricingStatus: "unknown", comparable: false })) };
        });
        plan!.version++;
        return route.fulfill({ json: plan });
      }
      if (action === "materialize") {
        expect(body).toMatchObject({
          version: plan!.version,
          canvasRevision: targetCanvas.revision,
        });
        targetCanvas.graph.nodes.push({
          id: "assistant-generated",
          type: "workflow",
          position: { x: 560, y: 180 },
          data: {
            nodeType: "image-generation",
            label: "秋日主视觉",
            provider: "fake",
            connectionId: "fake-only",
            model: "fake-image",
            ...(options.channelParameters ? { provider: plan!.calls[0]!.selected!.candidate.provider,
              connectionId: plan!.proposal.calls[0]!.preferredConnectionId, model: plan!.proposal.calls[0]!.preferredModelId,
              parameters: structuredClone(plan!.proposal.calls[0]!.parameters) } : {}),
            parts: [{ type: "text", text: plan!.proposal.calls[0]!.prompt }],
            inputs: [],
            outputs: [{ id: "images", kind: "image", label: "图片" }],
          },
        });
        targetCanvas.revision++;
        plan!.status = "awaiting_execution";
        return route.fulfill({ json: { plan, canvas: targetCanvas } });
      }
      if (action === "preflight") {
        expect(calls.some((call) => call.action === "materialize")).toBe(true);
        plan!.preflight = {
          id: "assistant-preflight",
          hash: "in-memory-only",
          expiresAt: new Date(Date.now() + 60000).toISOString(),
          canvasRevision: targetCanvas.revision,
          nodeIds: ["assistant-generated"],
          summary: "秋日主视觉 × 1 · 测试目录没有价格",
          unknownPrice: true,
        };
        return route.fulfill({ json: plan });
      }
      expect(body).toMatchObject({
        preflightId: "assistant-preflight",
        acceptUnknownPrice: true,
      });
      expect(calls.slice(-3).map((call) => call.action)).toEqual([
        "materialize",
        "preflight",
        "execute",
      ]);
      plan!.status = "succeeded";
      plan!.results = [
        { nodeId: "assistant-generated", status: "succeeded", assetIds: [] },
      ];
      return route.fulfill({ json: { plan, run: null } });
    }
    if (path.startsWith("/api/agent/artifacts/") && method !== "GET") {
      calls.push({ action: "save-artifact", body: request.postDataJSON() });
      return route.fulfill({ json: { saved: true } });
    }
    return route.fallback();
  });
  return {
    ...base,
    calls,
    turns,
    cancelled,
    sessions,
    canvas,
    assets,
    assetReads: () => assetReads,
    modelReads: () => modelReads,
    setMode: (mode: AssistantFixtureMode) =>
      page.evaluate((mode) => {
        (window as unknown as FixtureWindow).__assistantFixtureMode = mode;
      }, mode),
    assertSafe() {
      base.assertSafe();
      expect(
        turns.every((turn) => turn.connectionId.startsWith("assistant-")),
      ).toBe(true);
    },
  };
}
