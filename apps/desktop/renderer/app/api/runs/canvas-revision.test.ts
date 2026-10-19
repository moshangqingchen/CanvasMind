import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRepository, type JsonObject } from "@super-canvas/db";
import { FakeProviderAdapter } from "@super-canvas/providers";
import { RunService } from "@super-canvas/runtime";
import { runFingerprint, type RunFingerprintScope, type RunScope } from "@super-canvas/core";

const state = vi.hoisted(() => ({
  repository: undefined as unknown as MemoryRepository,
  service: undefined as unknown as RunService,
  preflight: vi.fn(),
}));
vi.mock("../../../lib/server", () => ({
  get repository() { return state.repository; },
  get runService() { return state.service; },
  publicRunSnapshot: (value: unknown) => value,
  jsonError: (error: string, status: number) => Response.json({ error }, { status }),
}));
vi.mock("../../../lib/supplier-service", () => ({ assertCurrentSupplierConnection: state.preflight }));
vi.mock("../../../lib/supplier-template-source", () => ({ matchesSupplierTemplate: () => false }));
import { POST } from "./route";

function graph(version: "P1" | "P2"): JsonObject {
  return { schemaVersion: 1, nodes: [{ id: "image", type: "workflow", data: {
    nodeType: "image-generation", provider: "fake", connectionId: "preflight-fixture", model: "fake-image",
    parts: [{ type: "text", text: version }], parameters: { size: version === "P1" ? "1024x1024" : "2048x2048" },
    outputs: [{ id: "images", kind: "image" }],
  } }], edges: [] };
}

beforeEach(async () => {
  vi.stubEnv("SUPERCANVAS_DESKTOP", "true");
  vi.stubEnv("SUPERCANVAS_DRAIN_FILE", "");
  state.repository = new MemoryRepository();
  await state.repository.saveConnection({ id: "preflight-fixture", name: "Mock", provider: "fake", encryptedSecret: null, config: {} });
  state.service = new RunService({ repository: state.repository,
    storage: { put: async () => {}, get: async () => null }, pollIntervalMs: 0 });
  state.preflight.mockReset();
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

const request = (revision: number, scope: "node" | "downstream" | "all") => new Request("http://localhost/api/runs", {
  method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ canvasId: "canvas", clientRequestId: "click", expectedRevision: revision, scope,
    ...(scope !== "all" ? { nodeId: "image" } : {}) }),
});

type FingerprintGraph = {
  schemaVersion: number;
  viewport: { x: number; y: number; zoom: number };
  drawings: JsonObject[];
  nodes: { id: string; type: string; position: { x: number; y: number }; data: JsonObject }[];
  edges: { id: string; source: string; sourceHandle: string; target: string; targetHandle: string }[];
};
type GraphChange = (graph: FingerprintGraph) => void;

function fingerprintGraph(): FingerprintGraph {
  const promptNode = (id: string, text: string) => ({ id, type: "workflow", position: { x: 0, y: 0 }, data: {
    nodeType: "prompt", parts: [{ type: "text", text }], outputs: [{ id: "prompt", kind: "text" }],
  } });
  return { schemaVersion: 1, viewport: { x: 0, y: 0, zoom: 1 }, drawings: [], nodes: [
    promptNode("prompt", "clicked upstream prompt"),
    promptNode("extra-prompt", "spare prompt"),
    { id: "image", type: "workflow", position: { x: 350, y: 0 }, data: {
      nodeType: "image-generation", provider: "fake", connectionId: "preflight-fixture", model: "fake-image-v1",
      parts: [{ type: "text", text: "clicked image prompt" }], parameters: { size: "1024x1024", quality: "high" },
      inputs: [{ id: "prompt", kind: "text", multiple: true }], outputs: [{ id: "images", kind: "image" }],
    } },
    promptNode("unrelated", "another node's prompt"),
  ], edges: [{ id: "prompt-image", source: "prompt", sourceHandle: "prompt", target: "image", targetHandle: "prompt" }] };
}

function fingerprintScope(scope: RunScope): RunFingerprintScope {
  return scope === "all" ? { scope } : scope === "selection" ? { scope, nodeIds: ["image"] } : {
    scope, nodeId: scope === "downstream" ? "prompt" : "image",
  };
}

function dataFor(graph: FingerprintGraph, nodeId: string): JsonObject {
  return graph.nodes.find(node => node.id === nodeId)!.data;
}

const presentationChanges: readonly [string, GraphChange][] = [
  ["viewport pan and zoom", graph => { graph.viewport = { x: 125, y: -80, zoom: 1.5 }; }],
  ["node position", graph => { graph.nodes.find(node => node.id === "image")!.position = { x: 900, y: 700 }; }],
  ["drawing", graph => { graph.drawings.push({ id: "brush", points: [{ x: 1, y: 2 }, { x: 3, y: 4 }] }); }],
];
const unrelatedResultChange: GraphChange = graph => {
  dataFor(graph, "unrelated").parts = [{ type: "text", text: "another node changed while generating" }];
  dataFor(graph, "unrelated").lastRunId = "parallel-run";
  graph.nodes.push({ id: "unrelated-result", type: "workflow", position: { x: 900, y: 300 }, data: {
    nodeType: "prompt", generatedResult: true, generatedFromNodeId: "unrelated", generatedFromRunId: "parallel-run",
    parts: [{ type: "text", text: "parallel result" }], inputs: [{ id: "prompt", kind: "text" }],
    outputs: [{ id: "prompt", kind: "text" }],
  } });
  graph.edges.push({ id: "parallel-result-feedback", source: "unrelated", sourceHandle: "prompt",
    target: "unrelated-result", targetHandle: "prompt" });
};
const executionChanges: readonly [string, GraphChange][] = [
  ["model", graph => { dataFor(graph, "image").model = "fake-image-v2"; }],
  ["quality", graph => { dataFor(graph, "image").parameters = { size: "1024x1024", quality: "low" }; }],
  ["inline prompt", graph => { dataFor(graph, "image").parts = [{ type: "text", text: "edited image prompt" }]; }],
  ["upstream prompt", graph => { dataFor(graph, "prompt").parts = [{ type: "text", text: "edited upstream prompt" }]; }],
  ["added incoming edge", graph => { graph.edges.push({ id: "extra-image", source: "extra-prompt", sourceHandle: "prompt",
    target: "image", targetHandle: "prompt" }); }],
  ["removed incoming edge", graph => { graph.edges.splice(0, 1); }],
];

async function changeDuringFingerprintPreflight(scope: RunScope, change: GraphChange) {
  const clickedGraph = fingerprintGraph();
  const p1 = await state.repository.saveCanvas({ id: "canvas", graph: clickedGraph });
  const selection = fingerprintScope(scope);
  let release!: () => void;
  let entered!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; });
  state.preflight.mockImplementation(() => { entered(); return new Promise<void>(resolve => { release = resolve; }); });
  const submit = vi.spyOn(FakeProviderAdapter.prototype, "submit");
  const pending = POST(new Request("http://localhost/api/runs", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ canvasId: "canvas", clientRequestId: "click", expectedRevision: p1.revision,
      runFingerprint: runFingerprint(clickedGraph, selection), ...selection }),
  }));
  await started;
  const latestGraph = structuredClone(clickedGraph);
  change(latestGraph);
  const p2 = await state.repository.saveCanvas({ id: "canvas", graph: latestGraph, expectedRevision: p1.revision });
  release();
  return { response: await pending, submit, p1, p2, latestGraph };
}

async function expectClickedParametersSubmitted(result: Awaited<ReturnType<typeof changeDuringFingerprintPreflight>>) {
  expect(result.response.status).toBe(201);
  const snapshot = await result.response.json();
  // A changed revision executes the graph from that atomic read, with the
  // original request data and the user's newer presentation/unrelated edits.
  expect(snapshot.run.revisionGraph.viewport).toEqual(result.latestGraph.viewport);
  expect(snapshot.run.revisionGraph.nodes.find((node: { id: string }) => node.id === "image").position)
    .toEqual(result.latestGraph.nodes.find(node => node.id === "image")!.position);
  await vi.waitFor(async () => expect((await state.service.getRun(snapshot.run.id))?.run.status).toBe("succeeded"));
  expect(result.submit).toHaveBeenCalledOnce();
  expect(result.submit.mock.calls[0]![0]).toMatchObject({
    model: "fake-image-v1", prompt: "clicked image prompt", parameters: { size: "1024x1024", quality: "high" },
  });
}

async function expectFingerprintNotSubmitted(result: Awaited<ReturnType<typeof changeDuringFingerprintPreflight>>) {
  expect(result.response.status).toBe(409);
  expect(await result.response.json()).toMatchObject({ submissionPhase: "not_started", code: "CANVAS_REVISION_CONFLICT",
    expectedRevision: result.p1.revision, currentRevision: result.p2.revision,
    error: expect.stringContaining("本次未提交、未产生费用") });
  expect(result.submit).not.toHaveBeenCalled();
  expect(await state.repository.listRuns("canvas")).toHaveLength(0);
}

describe("canvas identity across asynchronous run preflight", () => {
  it.each(["node", "downstream", "all"] as const)("rejects P2 saved during %s preflight before any provider submission", async scope => {
    const p1 = await state.repository.saveCanvas({ id: "canvas", graph: graph("P1") });
    let release!: () => void;
    let entered!: () => void;
    const started = new Promise<void>(resolve => { entered = resolve; });
    state.preflight.mockImplementation(() => { entered(); return new Promise<void>(resolve => { release = resolve; }); });
    const submit = vi.spyOn(FakeProviderAdapter.prototype, "submit");
    const response = POST(request(p1.revision, scope));
    await started;
    const p2 = await state.repository.saveCanvas({ id: "canvas", graph: graph("P2"), expectedRevision: p1.revision });
    release();
    const rejected = await response;
    expect(rejected.status).toBe(409);
    expect(await rejected.json()).toMatchObject({ submissionPhase: "not_started", code: "CANVAS_REVISION_CONFLICT",
      expectedRevision: p1.revision, currentRevision: p2.revision, error: expect.stringContaining("本次未提交、未产生费用") });
    expect(submit).not.toHaveBeenCalled();
    expect(await state.repository.listRuns("canvas")).toHaveLength(0);
  });

  it("submits P1 normally when its revision still matches, and replays the original identity after later edits", async () => {
    const p1 = await state.repository.saveCanvas({ id: "canvas", graph: graph("P1") });
    state.preflight.mockResolvedValue(undefined);
    const submit = vi.spyOn(FakeProviderAdapter.prototype, "submit");
    const response = await POST(request(p1.revision, "all"));
    expect(response.status).toBe(201);
    const snapshot = await response.json();
    await vi.waitFor(() => expect(submit).toHaveBeenCalledOnce());
    expect(submit.mock.calls[0]![0]).toMatchObject({ model: "fake-image", parameters: expect.objectContaining({ size: "1024x1024" }) });
    expect(JSON.stringify(snapshot.run.revisionGraph)).toContain("P1");
    expect(JSON.stringify(snapshot.run.revisionGraph)).not.toContain("P2");
    await state.repository.saveCanvas({ id: "canvas", graph: graph("P2"), expectedRevision: p1.revision });
    const replay = await POST(request(p1.revision, "all"));
    expect(replay.status).toBe(201);
    expect((await replay.json()).run.id).toBe(snapshot.run.id);
    expect(submit).toHaveBeenCalledOnce();
    await vi.waitFor(async () => expect((await state.service.getRun(snapshot.run.id))?.run.status).toBe("succeeded"));
  });
});

describe("run fingerprints across asynchronous preflight", () => {
  it.each(presentationChanges)("allows node scope %s changes with the clicked parameters", async (_label, change) => {
    await expectClickedParametersSubmitted(await changeDuringFingerprintPreflight("node", change));
  });

  it("allows an unrelated node edit and parallel result write during node preflight", async () => {
    const result = await changeDuringFingerprintPreflight("node", unrelatedResultChange);
    const snapshot = await result.response.clone().json();
    expect(snapshot.run.revisionGraph.nodes).toContainEqual(expect.objectContaining({ id: "unrelated-result" }));
    await expectClickedParametersSubmitted(result);
  });

  it.each(executionChanges)("rejects a node scope %s change before provider submission", async (_label, change) => {
    await expectFingerprintNotSubmitted(await changeDuringFingerprintPreflight("node", change));
  });

  it.each(["downstream", "selection"] as const)("allows unrelated result writes for %s scope", async scope => {
    await expectClickedParametersSubmitted(await changeDuringFingerprintPreflight(scope, unrelatedResultChange));
  });

  it.each(["downstream", "all", "selection"] as const)("allows presentation-only edits for %s scope", async scope => {
    await expectClickedParametersSubmitted(await changeDuringFingerprintPreflight(scope, graph => {
      for (const [, change] of presentationChanges) change(graph);
    }));
  });

  it.each(["downstream", "all", "selection"] as const)("rejects changed generation parameters for %s scope", async scope => {
    await expectFingerprintNotSubmitted(await changeDuringFingerprintPreflight(scope, executionChanges[1]![1]));
  });

  it.each(["downstream", "all", "selection"] as const)("rejects changed upstream prompts for %s scope", async scope => {
    await expectFingerprintNotSubmitted(await changeDuringFingerprintPreflight(scope, executionChanges[3]![1]));
  });
});
