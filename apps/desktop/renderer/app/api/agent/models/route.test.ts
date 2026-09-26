import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ models: vi.fn() }));
vi.mock("../../../../lib/agent-models", () => ({ loadAgentModels: mocks.models }));
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
});
