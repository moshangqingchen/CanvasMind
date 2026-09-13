import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRepository } from "@super-canvas/db";
import { RunService } from "@super-canvas/runtime";
import type { DirectorCatalogCandidate } from "@super-canvas/director";
const mocks = vi.hoisted(() => ({
  repository: null as unknown as MemoryRepository,
  complete: vi.fn(),
  prepareRun: vi.fn(),
  createRunFromPrepared: vi.fn(),
  catalog: [] as DirectorCatalogCandidate[],
  models: [] as unknown[],
  getRun: vi.fn(),
}));
vi.mock("./server", () => ({
  get repository() {
    return mocks.repository;
  },
  storage: {
    head: async () => ({ size: 1 }),
    get: async () => ({ bytes: new Uint8Array([0]), mimeType: "image/png" }),
  },
  runService: {
    prepareRun: mocks.prepareRun,
    createRunFromPrepared: mocks.createRunFromPrepared,
    getRun: mocks.getRun,
  },
  publicRunSnapshot: (v: unknown) => v,
}));
vi.mock("./agent-catalog", () => ({
  loadAgentCatalog: async () => mocks.catalog,
}));
vi.mock("./agent-models", () => ({
  loadAgentModels: async () => mocks.models,
  resolveAgentModel: async (id: string, model: string) => ({
    id,
    model,
    protocol: "openai-chat-completions",
    capabilities: {
      text: true,
      imageInput: id === "vision",
      audioInput: false,
      videoInput: false,
    },
  }),
}));
vi.mock("./director-adapters", () => ({
  directorAdapterRegistry: { get: () => ({ complete: mocks.complete }) },
}));
import {
  createAgentSession,
  createAgentPlan,
  materializeAgentPlan,
  preflightAgentPlan,
  executeAgentPlan,
  reviseAgentPlan,
  runAgentTurn,
  getAgentSession,
  stopAgentTurn,
  listAgentSessions,
} from "./agent-service";
import { AgentArtifactSchema, AgentDecisionSchema } from "./agent-contracts";
import { POST as materializePOST } from "../app/api/agent/plans/[id]/materialize/route";
import { POST as preflightPOST } from "../app/api/agent/plans/[id]/preflight/route";
import { POST as executePOST } from "../app/api/agent/plans/[id]/execute/route";
import { POST as legacyApprovePOST } from "../app/api/director/proposals/[id]/approve/route";
import { POST as turnPOST } from "../app/api/agent/turn/route";

const graph = () => ({
  schemaVersion: 1,
  nodes: [],
  edges: [],
  viewport: { x: 0, y: 0, zoom: 1 },
});
function proposal(edit = false) {
  return {
    type: "proposal",
    summary: "创作测试",
    assumptions: [],
    texts: [],
    calls: [
      {
        id: "hero",
        label: "主视觉",
        prompt: "修改图片背景为蓝色",
        requirements: {
          operation: edit ? "image.edit" : "image.generate",
          count: 1,
          ...(edit ? { inputKinds: ["image"], inputCounts: { image: 1 } } : {}),
        },
        sourceAssetIds: edit ? ["image-1"] : [],
        recommendation: "支持参考图编辑",
      },
    ],
  };
}
beforeEach(async () => {
  vi.clearAllMocks();
  mocks.repository = new MemoryRepository();
  await mocks.repository.saveCanvas({
    id: "canvas",
    title: "Test",
    graph: graph(),
  });
  await mocks.repository.saveConnection({
    id: "image",
    name: "Image",
    provider: "openai",
    encryptedSecret: "encrypted",
    config: {
      usage: "canvas",
      baseUrl: "https://example.com",
      modelScanStatus: "live",
      scannedModelIds: ["image-model"],
    },
  });
  await mocks.repository.saveAsset({
    id: "image-1",
    name: "source.png",
    kind: "image",
    size: 1,
    mimeType: "image/png",
    storageKey: "image-1",
    metadata: {},
    deleted: false,
  });
  mocks.catalog = [
    {
      connectionId: "image",
      connectionName: "Image",
      supplier: "test",
      provider: "openai",
      authoritative: true,
      connectionActive: true,
      credentialUsable: true,
      model: {
        id: "image-model",
        name: "Image Model",
        operations: ["image.generate", "image.edit"],
        inputKinds: ["text", "image"],
        outputKinds: ["image"],
        limits: { maxOutputImages: 4 },
        parameters: [
          { key: "n", label: "数量", control: "number", min: 1, max: 4 },
        ],
      },
    },
  ];
  mocks.models = [
    {
      connectionId: "vision",
      modelId: "vision-model",
      modelName: "视觉助手",
      available: true,
      capabilities: { imageInput: true },
    },
  ];
  mocks.prepareRun.mockImplementation(async (input) => {
    const canvas = await mocks.repository.getCanvas(input.canvasId);
    return {
      ...input,
      canvasRevision: canvas!.revision,
      revisionGraph: canvas!.graph,
    };
  });
  mocks.createRunFromPrepared.mockImplementation(
    async (prepared, clientRequestId) =>
      mocks.repository.createRun({
        id: "run-1",
        canvasId: prepared.canvasId,
        clientRequestId,
        scope: "selection",
        nodeIds: prepared.nodeIds,
        status: "queued",
        revisionGraph: prepared.revisionGraph,
      }),
  );
  mocks.getRun.mockImplementation(async (id) => {
    const run = await mocks.repository.getRun(id);
    return run ? { run, nodes: [] } : null;
  });
});
async function applied(edit = false) {
  const s = await createAgentSession("canvas");
  const p = await createAgentPlan(s.id, proposal(edit));
  const result = await materializeAgentPlan(
    p.id,
    p.version,
    p.baseCanvasRevision,
  );
  return { s, p, result };
}
describe("agent approvals and recovery", () => {
  it("returns partial results and specific errors to the originating task", async () => {
    const { p, s } = await applied();
    await mocks.repository.updateDirectorProposal(p.id, { status: "running", workflowRunId: "partial" });
    mocks.getRun.mockResolvedValueOnce({ run: { id: "partial", canvasId: "canvas", status: "needs_attention" }, nodes: [{ nodeId: "ok", status: "succeeded", outputAssetIds: ["image-1"], errorJson: null }, { nodeId: "bad", status: "failed", outputAssetIds: [], errorJson: { message: "模型拒绝参考图格式" } }] });
    const task = await getAgentSession(s.id);
    expect(task.plans[0].status).toBe("failed");
    expect(task.plans[0].results).toEqual(expect.arrayContaining([expect.objectContaining({ assetIds: ["image-1"] }), expect.objectContaining({ error: "模型拒绝参考图格式" })]));
    expect(mocks.createRunFromPrepared).not.toHaveBeenCalled();
  });
  it("preflights a real runtime snapshot containing frozen credentials and source inputs without exposing them", async () => {
    const { p, result } = await applied(true);
    const runtime = new RunService({
      repository: mocks.repository,
      storage: { put: async () => {}, get: async () => null },
      executionMode: "queue",
      enqueueRun: async () => {},
    });
    mocks.prepareRun.mockImplementation((input) => runtime.prepareRun(input));
    const ready = await preflightAgentPlan(p.id, 1, result.canvas.revision);
    const stored = await mocks.repository.getDirectorProposal(p.id);
    expect(JSON.stringify(stored!.plan.prepared)).toContain(
      "__preparedHistoricalInputs",
    );
    expect(JSON.stringify(stored!.plan.prepared)).toContain("image-1");
    expect(JSON.stringify(stored!.plan.prepared)).toContain("encryptedSecret");
    expect(JSON.stringify(ready)).not.toContain("encryptedSecret");
    expect(JSON.stringify(ready)).not.toContain("__runtimeConnection");
    expect(ready.preflight?.summary).toContain("参考素材 1 个");
  });
  it("compiles a composite image-to-video task with an actual dependency", async () => {
    mocks.catalog.push({
      ...mocks.catalog[0],
      model: {
        id: "video-model",
        name: "Video",
        operations: ["video.image-to-video"],
        inputKinds: ["image"],
        outputKinds: ["video"],
      },
    });
    const s = await createAgentSession("canvas");
    const draft = proposal();
    const p = await createAgentPlan(s.id, {
      ...draft,
      calls: [
        ...draft.calls,
        {
          id: "video",
          label: "视频",
          prompt: "推进镜头",
          requirements: {
            operation: "video.image-to-video",
            count: 1,
            inputKinds: ["image"],
            inputCounts: { image: 1 },
          },
          dependsOn: ["hero"],
        },
      ],
    });
    const image = p.patch!.nodes.find(
      (n) => n.data.nodeType === "image-generation",
    )!;
    const video = p.patch!.nodes.find(
      (n) => n.data.nodeType === "video-generation",
    )!;
    expect(p.patch!.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: image.id,
          target: video.id,
          targetHandle: "firstFrame",
        }),
      ]),
    );
    expect(mocks.createRunFromPrepared).not.toHaveBeenCalled();
  });
  it("recovers a save that succeeded before the final state write failed", async () => {
    const s = await createAgentSession("canvas");
    const p = await createAgentPlan(s.id, proposal());
    const original = mocks.repository.updateDirectorProposal.bind(
      mocks.repository,
    );
    const update = vi
      .spyOn(mocks.repository, "updateDirectorProposal")
      .mockImplementation(async (id, patch, options) => {
        if (patch.status === "awaiting_execution")
          throw new Error("interrupted");
        return original(id, patch, options);
      });
    await expect(
      materializeAgentPlan(p.id, 1, p.baseCanvasRevision),
    ).rejects.toThrow("interrupted");
    const saved = await mocks.repository.getCanvas("canvas");
    update.mockRestore();
    const recovered = await materializeAgentPlan(p.id, 1, saved!.revision);
    expect(recovered.plan.status).toBe("awaiting_execution");
    expect(recovered.canvas.revision).toBe(saved!.revision);
    expect(mocks.createRunFromPrepared).not.toHaveBeenCalled();
  });
  it("does not accept matching node IDs with modified contents as a recovered patch", async () => {
    const { p, result } = await applied();
    await mocks.repository.updateDirectorProposal(p.id, {
      status: "materializing",
    });
    const altered = JSON.parse(JSON.stringify(result.canvas.graph));
    altered.nodes[0].data.parts = [{ type: "text", text: "human edit" }];
    const saved = await mocks.repository.saveCanvas({
      id: "canvas",
      title: "Test",
      graph: altered,
    });
    await expect(materializeAgentPlan(p.id, 1, saved.revision)).rejects.toThrow(
      "内容与方案不一致",
    );
    expect((await mocks.repository.getCanvas("canvas"))!.graph).toEqual(
      altered,
    );
    expect((await mocks.repository.getDirectorProposal(p.id))!.status).toBe(
      "failed",
    );
  });
  it("rejects an old execution snapshot if a concurrent preflight replaces it during confirmation", async () => {
    const { p, result } = await applied();
    const ready = await preflightAgentPlan(p.id, 1, result.canvas.revision);
    const original = mocks.repository.updateDirectorProposal.bind(
      mocks.repository,
    );
    vi.spyOn(mocks.repository, "updateDirectorProposal").mockImplementation(
      async (id, patch, options) => {
        if (patch.status === "approved") {
          const latest = await mocks.repository.getDirectorProposal(id);
          await original(id, {
            plan: { ...latest!.plan, preflight: { id: "new-preflight" } },
          });
        }
        return original(id, patch, options);
      },
    );
    await expect(
      executeAgentPlan(p.id, 1, ready.preflight!.id, true),
    ).rejects.toThrow("刷新");
    expect(mocks.createRunFromPrepared).not.toHaveBeenCalled();
  });
  it("rejects a deleted source before any materialization", async () => {
    const s = await createAgentSession("canvas");
    const p = await createAgentPlan(s.id, proposal(true));
    const asset = await mocks.repository.getAsset("image-1");
    await mocks.repository.saveAsset({ ...asset!, deleted: true });
    await expect(
      materializeAgentPlan(p.id, 1, p.baseCanvasRevision),
    ).rejects.toThrow("已被删除");
    expect((await mocks.repository.getCanvas("canvas"))!.graph.nodes).toEqual(
      [],
    );
  });
  it("creates a plan without touching the canvas or starting generation", async () => {
    const s = await createAgentSession("canvas");
    await createAgentPlan(s.id, proposal());
    expect((await mocks.repository.getCanvas("canvas"))!.graph.nodes).toEqual(
      [],
    );
    expect(mocks.createRunFromPrepared).not.toHaveBeenCalled();
  });
  it("first approval creates prompts, source references and edit nodes without running", async () => {
    const { result } = await applied(true);
    const nodes = result.canvas.graph.nodes as Array<{
      data: { nodeType: string; assetId?: string };
    }>;
    expect(nodes.map((n) => n.data.nodeType)).toEqual(
      expect.arrayContaining(["prompt", "image-generation", "asset-input"]),
    );
    expect(
      nodes.find((n) => n.data.nodeType === "asset-input")?.data.assetId,
    ).toBe("image-1");
    expect(result.plan.status).toBe("awaiting_execution");
    expect(mocks.createRunFromPrepared).not.toHaveBeenCalled();
  });
  it("retries materialization idempotently", async () => {
    const { p, result } = await applied();
    const retry = await materializeAgentPlan(
      p.id,
      p.version,
      p.baseCanvasRevision,
    );
    expect(retry.canvas.revision).toBe(result.canvas.revision);
    expect(retry.canvas.graph).toEqual(result.canvas.graph);
  });
  it("requires first approval before preflight", async () => {
    const s = await createAgentSession("canvas");
    const p = await createAgentPlan(s.id, proposal());
    await expect(
      preflightAgentPlan(p.id, 1, p.baseCanvasRevision),
    ).rejects.toThrow("请先确认");
  });
  it("requires explicit unknown price acceptance and deduplicates execution", async () => {
    const { p, result } = await applied();
    const ready = await preflightAgentPlan(p.id, 1, result.canvas.revision);
    expect(ready.preflight?.unknownPrice).toBe(true);
    expect(JSON.stringify(ready)).not.toContain("encryptedSecret");
    expect(JSON.stringify(ready)).not.toContain("revisionGraph");
    await expect(
      executeAgentPlan(p.id, 1, ready.preflight!.id, false),
    ).rejects.toThrow("价格未知");
    const a = await executeAgentPlan(p.id, 1, ready.preflight!.id, true);
    const b = await executeAgentPlan(p.id, 1, ready.preflight!.id, true);
    expect(a.run?.run.id).toBe(b.run?.run.id);
    expect(mocks.createRunFromPrepared).toHaveBeenCalledTimes(1);
  });
  it("invalidates preflight when the user changes a prompt", async () => {
    const { p, result } = await applied();
    const ready = await preflightAgentPlan(p.id, 1, result.canvas.revision);
    await mocks.repository.saveCanvas({
      id: "canvas",
      title: "changed",
      graph: result.canvas.graph,
    });
    await expect(
      executeAgentPlan(p.id, 1, ready.preflight!.id, true),
    ).rejects.toThrow("画布发生改变");
    expect(mocks.createRunFromPrepared).not.toHaveBeenCalled();
  });
  it("invalidates preflight when credentials change", async () => {
    const { p, result } = await applied();
    const ready = await preflightAgentPlan(p.id, 1, result.canvas.revision);
    const c = await mocks.repository.getConnection("image");
    await mocks.repository.saveConnection({
      ...c!,
      encryptedSecret: "changed",
    });
    await expect(
      executeAgentPlan(p.id, 1, ready.preflight!.id, true),
    ).rejects.toThrow("已改变");
  });
  it("rejects canvas conflicts before applying a patch", async () => {
    const s = await createAgentSession("canvas");
    const p = await createAgentPlan(s.id, proposal());
    await mocks.repository.saveCanvas({
      id: "canvas",
      title: "Changed",
      graph: graph(),
    });
    await expect(
      materializeAgentPlan(p.id, 1, p.baseCanvasRevision),
    ).rejects.toThrow("画布已改变");
  });
  it("requires current plan version and repairs the preview through revision", async () => {
    const s = await createAgentSession("canvas");
    const p = await createAgentPlan(s.id, proposal());
    const next = await reviseAgentPlan(p.id, 1, proposal());
    expect(next.version).toBe(2);
    await expect(
      materializeAgentPlan(p.id, 1, p.baseCanvasRevision),
    ).rejects.toThrow("方案已更新");
  });
  it("preserves materialized nodes when revising a plan", async () => {
    const { p, result } = await applied();
    const next = await reviseAgentPlan(p.id, 1, proposal());
    expect(next.id).not.toBe(p.id);
    expect((await mocks.repository.getCanvas("canvas"))!.graph).toEqual(
      result.canvas.graph,
    );
    expect(next.status).toBe("awaiting_approval");
  });
  it("text artifacts can be placed without creating a paid run", async () => {
    const s = await createAgentSession("canvas");
    const p = await createAgentPlan(s.id, {
      type: "proposal",
      summary: "文案",
      texts: [{ id: "copy", title: "标题", content: "新的广告文案" }],
    });
    const result = await materializeAgentPlan(p.id, 1, p.baseCanvasRevision);
    expect(result.plan.status).toBe("succeeded");
    expect(mocks.createRunFromPrepared).not.toHaveBeenCalled();
  });
  it("does not permit changing an unselected existing node", async () => {
    const s = await createAgentSession("canvas");
    await expect(
      createAgentPlan(s.id, {
        type: "proposal",
        summary: "替换",
        texts: [
          { id: "a", title: "x", content: "y", targetNodeId: "someone-else" },
        ],
      }),
    ).rejects.toThrow("明确选中");
  });
  it("keeps legacy director sessions out of new task lists", async () => {
    await mocks.repository.createDirectorSession({
      id: "legacy",
      canvasId: "canvas",
      title: "Legacy",
      metadata: { conversationType: "project-chat" },
    });
    await createAgentSession("canvas");
    expect(await listAgentSessions("canvas")).toHaveLength(1);
  });
});
describe("agent orchestration", () => {
  const input = (sessionId: string) => ({
    sessionId,
    canvasId: "canvas",
    requestId: "request-1",
    connectionId: "brain",
    modelId: "text-model",
    message: "帮我写分镜",
    attachmentAssetIds: [],
    selectedNodeIds: [],
  });
  it("reads tools before delivering a text artifact and survives reload", async () => {
    const s = await createAgentSession("canvas");
    mocks.complete
      .mockResolvedValueOnce({
        output: { type: "tool", tool: "read_canvas", message: "查看画布" },
      })
      .mockResolvedValueOnce({
        output: {
          type: "artifact",
          message: "文案已完成",
          artifact: { kind: "text", title: "文案", content: "新的文案" },
        },
      });
    await runAgentTurn(input(s.id), () => {});
    const restored = await getAgentSession(s.id);
    expect(restored.messages.some((m) => m.metadata.artifact)).toBe(true);
    expect(restored.plans).toHaveLength(0);
    expect(mocks.complete).toHaveBeenCalledTimes(2);
  });
  it("publishes structured clarification questions", async () => {
    const s = await createAgentSession("canvas");
    mocks.complete.mockResolvedValue({
      output: {
        type: "clarify",
        message: "确认时长",
        questions: [
          {
            id: "length",
            question: "广告需要多长？",
            options: ["15秒", "30秒"],
          },
        ],
      },
    });
    await runAgentTurn(input(s.id), () => {});
    expect(
      (await getAgentSession(s.id)).messages.at(-1)?.metadata.questions,
    ).toHaveLength(1);
  });
  it("asks for visual helper approval without sending images to another model", async () => {
    const s = await createAgentSession("canvas");
    await runAgentTurn(
      { ...input(s.id), attachmentAssetIds: ["image-1"] },
      () => {},
    );
    expect(mocks.complete).not.toHaveBeenCalled();
    expect((await getAgentSession(s.id)).messages.at(-1)?.metadata.kind).toBe(
      "helper",
    );
  });
  it("keeps original asset IDs across helper analysis and later questions", async () => {
    const s = await createAgentSession("canvas");
    await runAgentTurn(
      { ...input(s.id), attachmentAssetIds: ["image-1"] },
      () => {},
    );
    mocks.complete.mockResolvedValue({
      output: { type: "reply", message: "识别了原图中的主体" },
    });
    await runAgentTurn(
      {
        ...input(s.id),
        requestId: "request-2",
        helper: {
          connectionId: "vision",
          modelId: "vision-model",
          assetIds: ["image-1"],
        },
      },
      () => {},
    );
    expect(mocks.complete.mock.calls[0][1].attachments).toHaveLength(1);
    expect(mocks.complete.mock.calls[1][1].system).toContain("image-1");
    await runAgentTurn(
      { ...input(s.id), requestId: "request-3", message: "主体保持不变" },
      () => {},
    );
    expect(mocks.complete).toHaveBeenCalledTimes(3);
    expect(mocks.complete.mock.calls[2][1].messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          content: expect.stringContaining("复用已确认的视觉观察"),
        }),
      ]),
    );
  });
  it("continues from text descriptions without a vision model and keeps the reference", async () => {
    const s = await createAgentSession("canvas");
    mocks.models = [];
    mocks.complete.mockResolvedValue({
      output: { type: "reply", message: "根据文字制定方案" },
    });
    await runAgentTurn(
      {
        ...input(s.id),
        attachmentAssetIds: ["image-1"],
        skipVisualAnalysis: true,
      },
      () => {},
    );
    await runAgentTurn({ ...input(s.id), requestId: "next" }, () => {});
    expect(mocks.complete).toHaveBeenCalledTimes(2);
    expect(mocks.complete.mock.calls[1][1].attachments).toEqual([]);
    expect(mocks.complete.mock.calls[1][1].system).toContain("image-1");
  });
  it("carries confirmed requirements in task memory into later turns", async () => {
    const s = await createAgentSession("canvas");
    mocks.complete
      .mockResolvedValueOnce({
        output: {
          type: "reply",
          message: "已记录",
          taskMemory: {
            goal: "广告",
            requirements: ["背景保留", "只做前三张"],
            completedSteps: [],
            openQuestions: [],
          },
        },
      })
      .mockResolvedValueOnce({ output: { type: "reply", message: "继续" } });
    await runAgentTurn(input(s.id), () => {});
    await runAgentTurn(
      { ...input(s.id), requestId: "next", message: "第二张改成近景" },
      () => {},
    );
    expect(mocks.complete.mock.calls[1][1].system).toContain("只做前三张");
    expect(mocks.complete.mock.calls[1][1].system).toContain("背景保留");
  });
  it("discards a response after the model connection changes", async () => {
    const s = await createAgentSession("canvas");
    let release!: (v: unknown) => void;
    mocks.complete.mockImplementation(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    const task = runAgentTurn(input(s.id), () => {});
    await vi.waitFor(() => expect(release).toBeDefined());
    await mocks.repository.saveConnection({
      id: "brain",
      provider: "openai",
      name: "New",
      config: { usage: "agent" },
      encryptedSecret: "changed",
    });
    release({ output: { type: "reply", message: "stale" } });
    await expect(task).rejects.toThrow("模型连接已改变");
    expect(
      (await getAgentSession(s.id)).messages.some((m) => m.content === "stale"),
    ).toBe(false);
  });
  it("caps a tool loop at eight calls", async () => {
    const s = await createAgentSession("canvas");
    mocks.complete.mockResolvedValue({
      output: { type: "tool", tool: "read_canvas", message: "读取" },
    });
    await runAgentTurn(input(s.id), () => {});
    expect(mocks.complete).toHaveBeenCalledTimes(8);
  });
  it("repairs malformed output only once and never creates nodes", async () => {
    const s = await createAgentSession("canvas");
    mocks.complete.mockResolvedValue({
      output: { type: "execute", confirmed: true },
    });
    await runAgentTurn(input(s.id), () => {});
    expect(mocks.complete).toHaveBeenCalledTimes(2);
    expect((await getAgentSession(s.id)).plans).toHaveLength(0);
  });
  it("ignores a late model response after stop", async () => {
    const s = await createAgentSession("canvas");
    let release!: (value: unknown) => void;
    mocks.complete.mockImplementation(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    const running = runAgentTurn(input(s.id), () => {});
    await vi.waitFor(() => expect(release).toBeDefined());
    await stopAgentTurn(s.id);
    release({ output: { type: "reply", message: "late" } });
    await expect(running).rejects.toThrow("停止");
    expect(
      (await getAgentSession(s.id)).messages.some((m) => m.content === "late"),
    ).toBe(false);
  });
  it("discards an unapproved plan if stop arrives while catalog compilation is finishing", async () => {
    const s = await createAgentSession("canvas");
    mocks.complete.mockResolvedValue({ output: proposal() });
    const create = mocks.repository.createDirectorProposal.bind(
      mocks.repository,
    );
    vi.spyOn(mocks.repository, "createDirectorProposal").mockImplementation(
      async (value) => {
        await stopAgentTurn(s.id);
        return create(value);
      },
    );
    await expect(runAgentTurn(input(s.id), () => {})).rejects.toThrow("停止");
    expect((await getAgentSession(s.id)).plans).toEqual([]);
    expect((await mocks.repository.getCanvas("canvas"))!.graph.nodes).toEqual(
      [],
    );
  });
  it("does not send an identical request twice", async () => {
    const s = await createAgentSession("canvas");
    mocks.complete.mockResolvedValue({
      output: { type: "reply", message: "完成" },
    });
    await runAgentTurn(input(s.id), () => {});
    await runAgentTurn(input(s.id), () => {});
    expect(mocks.complete).toHaveBeenCalledTimes(1);
  });
});
describe("structured artifacts", () => {
  it("rejects invalid storyboard timing and unknown characters", () => {
    expect(
      AgentArtifactSchema.safeParse({
        kind: "storyboard",
        title: "test",
        totalDuration: 15,
        shots: [
          {
            id: "1",
            start: 10,
            end: 4,
            camera: "特写",
            action: "站立",
            prompt: "人物",
            characterIds: ["unknown"],
          },
        ],
      }).success,
    ).toBe(false);
  });
  it("rejects executable instructions disguised as a reply", () => {
    expect(
      AgentDecisionSchema.safeParse({
        type: "reply",
        message: "开始",
        execute: true,
      }).success,
    ).toBe(false);
  });
});

describe("agent HTTP integration with isolated adapters", () => {
  const request = (body: unknown) =>
    new Request("http://localhost/api/agent/test", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  it("enforces the separate request schemas and blocks the legacy approval endpoint", async () => {
    const s = await createAgentSession("canvas");
    const p = await createAgentPlan(s.id, proposal());
    const ctx = { params: Promise.resolve({ id: p.id }) };
    expect(
      (await executePOST(request({ version: 1, confirmed: true }), ctx)).status,
    ).toBe(400);
    const legacy = await legacyApprovePOST(
      request({ version: 1, canvasRevision: p.baseCanvasRevision }),
      ctx,
    );
    expect(legacy.status).toBe(409);
    expect(await legacy.json()).toMatchObject({
      error: expect.stringContaining("分别确认"),
    });
    expect(
      (
        await preflightPOST(
          request({ version: 1, canvasRevision: p.baseCanvasRevision }),
          ctx,
        )
      ).status,
    ).toBe(409);
    const first = await materializePOST(
      request({ version: 1, canvasRevision: p.baseCanvasRevision }),
      ctx,
    );
    expect(first.status).toBe(200);
    const applied = await first.json();
    expect(mocks.createRunFromPrepared).not.toHaveBeenCalled();
    const prepared = await preflightPOST(
      request({ version: 1, canvasRevision: applied.canvas.revision }),
      ctx,
    );
    expect(prepared.status).toBe(200);
    const ready = await prepared.json();
    const body = {
      version: 1,
      preflightId: ready.preflight.id,
      acceptUnknownPrice: true,
    };
    expect((await executePOST(request(body), ctx)).status).toBe(200);
    expect((await executePOST(request(body), ctx)).status).toBe(200);
    expect(mocks.createRunFromPrepared).toHaveBeenCalledTimes(1);
  });
  it("streams artifacts and reports wrong-canvas requests without calling a model", async () => {
    const s = await createAgentSession("canvas");
    const body = {
      sessionId: s.id,
      canvasId: "canvas",
      requestId: "http-turn",
      connectionId: "brain",
      modelId: "text",
      message: "写文案",
    };
    mocks.complete.mockResolvedValue({
      output: {
        type: "artifact",
        message: "完成",
        artifact: { kind: "text", title: "文案", content: "内容" },
      },
    });
    const reply = await turnPOST(request(body));
    expect(reply.headers.get("content-type")).toBe("text/event-stream");
    expect(await reply.text()).toContain('"kind":"artifact"');
    const invalid = await turnPOST(
      request({ ...body, requestId: "wrong-canvas", canvasId: "other" }),
    );
    expect(await invalid.text()).toContain('"type":"error"');
    expect(mocks.complete).toHaveBeenCalledTimes(1);
  });
});
