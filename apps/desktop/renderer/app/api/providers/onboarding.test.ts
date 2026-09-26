import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ProviderConnectionRecord } from "@super-canvas/db";

const mocks = vi.hoisted(() => ({ get: vi.fn(), save: vi.fn(), schedule: vi.fn() }));
vi.mock("../../../lib/server", () => ({
  repository: { getConnection: mocks.get },
  saveProviderConnection: mocks.save,
  maskConnection: (connection: ProviderConnectionRecord) => ({ id: connection.id, config: connection.config }),
  jsonError: (error: string, status: number) => Response.json({ error }, { status }),
}));
vi.mock("../../../lib/supplier-service", () => ({
  assertCurrentSupplierConnection: async () => {},
  supplierConfigForConnection: async (input: { config: Record<string, unknown> }) => input.config,
  SupplierServiceError: class extends Error {},
}));
vi.mock("../../../lib/supplier-verification", () => ({ scheduleSupplierVerification: mocks.schedule }));
import { POST } from "./route";

const connection: ProviderConnectionRecord = {
  id: "group", name: "Group", provider: "openai", encryptedSecret: "encrypted",
  config: { supplierId: "supplier", supplierKey: "custom", supplierSourceId: "source", baseUrl: "https://example.com/v1", modelGroup: "image", usage: "canvas" },
  createdAt: "now", updatedAt: "now",
};
beforeEach(() => {
  vi.clearAllMocks();
  mocks.get.mockResolvedValue(connection);
  mocks.schedule.mockResolvedValue(undefined);
  mocks.save.mockImplementation(async input => ({ ...connection, ...input, encryptedSecret: input.apiKey ? "new-encrypted" : connection.encryptedSecret }));
});
const save = (input: Record<string, unknown>) => POST(new Request("http://localhost/api/providers", {
  method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ name: connection.name, provider: connection.provider, config: connection.config, ...input }),
}));

describe("saving a supplier Key automatically starts onboarding", () => {
  it("persists the new connection before scheduling, without waiting for image generation", async () => {
    mocks.schedule.mockImplementation(() => {
      expect(mocks.save).toHaveBeenCalledOnce();
      return new Promise(() => {});
    });
    expect((await save({ apiKey: "test-key" })).status).toBe(201);
    expect(mocks.schedule).toHaveBeenCalledExactlyOnceWith("supplier");
    expect(mocks.save.mock.calls[0]![0].config.supplierVerificationRequestId).toEqual(expect.any(String));
  });
  it("starts again for changed credentials and never for ordinary default or hosting saves", async () => {
    expect((await save({ id: connection.id, apiKey: "changed-key" })).status).toBe(200);
    expect(mocks.schedule).toHaveBeenCalledOnce();
    mocks.schedule.mockClear();
    expect((await save({ id: connection.id, config: { ...connection.config, defaultModel: "image-2", referenceImageHosting: "litterbox-24h" } })).status).toBe(200);
    expect(mocks.schedule).not.toHaveBeenCalled();
  });
  it("does not schedule if storage fails, and includes agent-only connections after saving", async () => {
    mocks.save.mockRejectedValueOnce(new Error("disk full"));
    expect((await save({ apiKey: "test-key" })).status).toBe(500);
    expect(mocks.schedule).not.toHaveBeenCalled();
    expect((await save({ apiKey: "test-key", config: { ...connection.config, usage: "agent" } })).status).toBe(201);
    expect(mocks.schedule).toHaveBeenCalledExactlyOnceWith("supplier");
    expect(mocks.save.mock.calls[1]![0].config.supplierVerificationRequestId).toEqual(expect.any(String));
  });
  it("keeps server-created interface routes for ordinary saves, rejects injected routes and clears them with a changed Key", async () => {
    const routes = { "new-image": { sourceUrl: "https://example.com/openapi.json", connector: { submit: { path: "/draw" } } } };
    mocks.get.mockResolvedValue({ ...connection, config: { ...connection.config, autoModelInterfaces: routes } });
    expect((await save({ id: connection.id, config: { ...connection.config, autoModelInterfaces: { forged: {} } } })).status).toBe(200);
    expect(mocks.save.mock.calls[0]![0].config.autoModelInterfaces).toEqual(routes);
    expect((await save({ id: connection.id, apiKey: "new-group-key", config: { ...connection.config, autoModelInterfaces: routes } })).status).toBe(200);
    expect(mocks.save.mock.calls[1]![0].config.autoModelInterfaces).toBeUndefined();
  });
  it.each(["chentu-openai-images", "cyberafei-api"])("preserves a %s server protocol when saving a default model", async preset => {
    const config = { ...connection.config, preset, connector: { baseUrl: "https://example.com", submit: { path: "/images/generations", method: "POST" } } };
    mocks.get.mockResolvedValue({ ...connection, config });
    const response = await save({ id: connection.id, config: { ...config, defaultModel: "image", connector: { ...config.connector, submit: { path: "/untrusted" } } } });
    expect(response.status).toBe(200);
    expect(mocks.save.mock.calls[0]![0].config.connector).toEqual(config.connector);
    expect(mocks.schedule).not.toHaveBeenCalled();
  });
});
