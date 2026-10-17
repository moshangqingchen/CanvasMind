import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ models: vi.fn(), snapshot: vi.fn() }));
vi.mock("../../../../lib/agent-models", () => ({ loadAgentModels: mocks.models, loadAgentModelCatalogSnapshot: mocks.snapshot }));
import { GET, PATCH } from "./route";

beforeEach(() => { vi.clearAllMocks(); });
describe("automatic agent model catalog", () => {
  it("returns exact connection/model routing, protocol, sources and reasoning choices without caching", async () => {
    const model = { connectionId: "key-a", modelId: "model", protocol: "openai-responses", capabilitySource: "live", reasoningOptions: [{ value: "auto", label: "自动" }] };
    mocks.models.mockResolvedValue([model]);
    const response = await GET();
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.json()).toEqual([model]);
  });
  it("retires manual agent configuration without changing a shared provider connection", async () => {
    const response = await PATCH();
    expect(response.status).toBe(410);
    expect(mocks.models).not.toHaveBeenCalled();
  });
  it("exposes saved directory state on explicit snapshot reads without refreshing", async () => {
    const snapshot = { models: [], connections: [{ connectionId: "image-only", connectionName: "图片分组", status: "unread" }] };
    mocks.snapshot.mockResolvedValue(snapshot);
    const response = await GET(new Request("http://localhost/api/agent/models?cached=1&includeConnections=1"));
    expect(await response.json()).toEqual(snapshot);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(mocks.models).not.toHaveBeenCalled();
    expect(mocks.snapshot).toHaveBeenCalledOnce();
  });
});
