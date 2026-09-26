import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRepository } from "@super-canvas/db";
const mocks = vi.hoisted(() => ({ repository: null as unknown as MemoryRepository, complete: vi.fn(), probe: vi.fn() }));
vi.mock("./server", () => ({
  get repository() { return mocks.repository; }, runService: {}, storage: {}, publicRunSnapshot: (v: unknown) => v,
}));
vi.mock("./director-connections", () => ({
  getDirectorProfile: async () => ({ id: "default", brainConnectionId: "brain", brainModelId: "model", config: {} }),
  resolveDirectorConnection: async () => ({ id: "brain", model: "model", protocol: "openai-chat-completions", capabilities: { probeSource: "live", probedAt: new Date().toISOString() } }),
}));
vi.mock("./director-adapters", () => ({ directorAdapterRegistry: { get: () => ({ complete: mocks.complete, probeCapabilities: mocks.probe }) } }));
vi.mock("./director-catalog", () => ({ loadDirectorCatalog: vi.fn() }));
import { getDirectorConversation, runDirectorTurn } from "./director-service";
import { DirectorAdapterError } from "./director-adapters/shared";

beforeEach(async () => {
  vi.clearAllMocks();
  mocks.repository = new MemoryRepository();
  await mocks.repository.saveCanvas({ id: "canvas", title: "Test", graph: { schemaVersion: 1, nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 } } });
});
describe("director cancellation and usage", () => {
  it("does not retry or persist an assistant reply after cancellation", async () => {
    const abort = new AbortController();
    mocks.complete.mockImplementation(async (_connection, input) => {
      expect(input.signal).toBe(abort.signal);
      abort.abort();
      throw new DirectorAdapterError("invalid_response", "incomplete");
    });
    await expect(runDirectorTurn({ canvasId: "canvas", message: "设计海报" }, () => {}, abort.signal)).rejects.toThrow();
    expect(mocks.complete).toHaveBeenCalledTimes(1);
    const sessions = await mocks.repository.listDirectorSessions("canvas");
    const messages = await mocks.repository.listDirectorMessages(sessions[0]!.id);
    expect(messages.filter(m => m.role === "assistant")).toHaveLength(0);
    expect(messages.some(m => m.role === "user" && m.content === "设计海报")).toBe(true);
    expect(messages.find(m => m.metadata.kind === "model_call")?.metadata.status).toBe("cancelled");
  });
  it("discards a successful late response when its signal was aborted", async () => {
    const abort = new AbortController();
    mocks.complete.mockImplementation(async () => {
      abort.abort();
      return { output: { type: "reply", message: "late" }, usage: { inputTokens: 3, outputTokens: 5 } };
    });
    await expect(runDirectorTurn({ canvasId: "canvas", message: "设计海报" }, () => {}, abort.signal)).rejects.toThrow();
    const sessions = await mocks.repository.listDirectorSessions("canvas");
    const conversation = await getDirectorConversation(sessions[0]!.id);
    expect(conversation.messages).toHaveLength(1);
    const metrics = (await mocks.repository.listDirectorMessages(sessions[0]!.id)).filter(m => m.metadata.kind === "model_call");
    expect(metrics[0]?.metadata).toMatchObject({ status: "cancelled", usage: { inputTokens: 3, outputTokens: 5 } });
  });
  it("does not begin work with an already cancelled signal", async () => {
    const abort = new AbortController();
    abort.abort();
    await expect(runDirectorTurn({ canvasId: "canvas", message: "设计海报" }, () => {}, abort.signal)).rejects.toThrow();
    expect(mocks.complete).not.toHaveBeenCalled();
    expect(await mocks.repository.listDirectorSessions("canvas")).toHaveLength(0);
  });
});
