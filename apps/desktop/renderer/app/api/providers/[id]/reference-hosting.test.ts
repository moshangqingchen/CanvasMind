import { beforeEach, describe, expect, it, vi } from "vitest";
import { SupplierConflictError } from "@super-canvas/db";

const mocks = vi.hoisted(() => ({
  getConnection: vi.fn(),
  saveConnection: vi.fn(),
  assertCurrent: vi.fn(),
}));
vi.mock("../../../../lib/server", () => ({
  repository: { getConnection: mocks.getConnection, saveConnection: mocks.saveConnection },
  jsonError: (error: string, status: number) => Response.json({ error }, { status }),
  maskConnection: (connection: Record<string, unknown>) => {
    const record = { ...connection };
    delete record.encryptedSecret;
    return record;
  },
}));
vi.mock("../../../../lib/supplier-service", () => ({
  assertCurrentSupplierConnection: mocks.assertCurrent,
  SupplierServiceError: class extends Error { status = 409; },
}));
import { PATCH } from "./route";
import { SafeJsonObjectSchema } from "../../../../lib/api-validation";

const patch = (body: unknown) => PATCH(new Request("http://localhost/api/providers/cangyuan", {
  method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
}), { params: Promise.resolve({ id: "cangyuan" }) });

beforeEach(() => {
  vi.resetAllMocks();
  mocks.saveConnection.mockImplementation(async record => record);
});

describe("reference hosting settings", () => {
  it("updates a large stored catalog without submitting or modifying it, credentials, or scan state", async () => {
    const config = { usage: "canvas", defaultModel: "gpt-image-2", modelScanStatus: "live", modelScanRequestId: "current-scan",
      modelCatalogModels: Array.from({ length: 700 }, (_, i) => Object.fromEntries(Array.from({ length: 22 }, (_, j) => [`field${j}`, `${i}-${j}`]))),
    };
    expect(SafeJsonObjectSchema.safeParse(config).success).toBe(false);
    const connection = { id: "cangyuan", name: "沧元", provider: "rest", encryptedSecret: "encrypted-fixture", config };
    mocks.getConnection.mockResolvedValue(connection);
    for (const mode of ["litterbox-24h", "disabled"]) {
      const response = await patch({ referenceImageHosting: mode });
      expect(response.status).toBe(200);
      expect(await response.json()).not.toHaveProperty("encryptedSecret");
      expect(mocks.saveConnection).toHaveBeenLastCalledWith({ ...connection, config: { ...config, referenceImageHosting: mode } }, { expected: connection });
    }
    expect(connection.config).not.toHaveProperty("referenceImageHosting");
  });

  it.each([
    { referenceImageHosting: "unknown" },
    { referenceImageHosting: "litterbox-24h", apiKey: "unexpected" },
    { referenceImageHosting: "litterbox-24h", config: { baseUrl: "https://example.com" } },
  ])("rejects unrelated fields or unsupported modes", async body => {
    expect((await patch(body)).status).toBe(400);
    expect(mocks.saveConnection).not.toHaveBeenCalled();
  });

  it("does not recreate a missing connection", async () => {
    mocks.getConnection.mockResolvedValue(null);
    expect((await patch({ referenceImageHosting: "disabled" })).status).toBe(404);
    expect(mocks.saveConnection).not.toHaveBeenCalled();
  });

  it.each([{ provider: "openai", config: { usage: "canvas" } }, { provider: "rest", config: { usage: "agent" } }])("rejects unsupported connections", async connection => {
    mocks.getConnection.mockResolvedValue(connection);
    expect((await patch({ referenceImageHosting: "litterbox-24h" })).status).toBe(400);
    expect(mocks.saveConnection).not.toHaveBeenCalled();
  });

  it("reports concurrent edits without overwriting the new connection", async () => {
    mocks.getConnection.mockResolvedValue({ provider: "rest", config: { usage: "canvas" } });
    mocks.saveConnection.mockRejectedValue(new SupplierConflictError());
    expect((await patch({ referenceImageHosting: "disabled" })).status).toBe(409);
  });
});
