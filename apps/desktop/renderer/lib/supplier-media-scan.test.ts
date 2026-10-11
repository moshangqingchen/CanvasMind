import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRepository, type ProviderConnectionRecord } from "@super-canvas/db";
import type { ModelDescriptor } from "@super-canvas/providers";

const mocks = vi.hoisted(() => ({ repository: undefined as unknown as MemoryRepository,
  discover: vi.fn(), models: vi.fn(), login: vi.fn(), accountKeys: vi.fn() }));
vi.mock("./server", () => ({ get repository() { return mocks.repository; } }));
vi.mock("@super-canvas/providers", async importOriginal => ({
  ...(await importOriginal<typeof import("@super-canvas/providers")>()),
  discoverSupplierCatalog: mocks.discover, loginSupplierSite: mocks.login, readSupplierAccountKeys: mocks.accountKeys,
}));
vi.mock("./provider-model-inventory", () => ({ readProviderModelInventory: mocks.models }));
import { createSupplierRecord, patchSupplierRecord, scanSupplierRecord } from "./supplier-service";
import { encryptSecret } from "@super-canvas/providers";
import { requireServerMasterKey } from "./master-key";

const image: ModelDescriptor = { id: "exact-image", name: "Image", operations: ["image.generate"], outputKinds: ["image"],
  parameters: [{ key: "quality", label: "Quality", control: "select", valueType: "string", options: [{ label: "high", value: "high" }] }],
  metadata: { outputKindsSource: "declared", modelFactsSource: "supplier-catalog", protocol: "openai-images", endpointTypes: ["openai-images"] } };
beforeEach(() => {
  mocks.repository = new MemoryRepository();
  for (const mock of [mocks.discover, mocks.models, mocks.login, mocks.accountKeys]) mock.mockReset();
});
async function fixture(existingAgent = true) {
  const created = await createSupplierRecord({ name: "Exact supplier", siteUrl: "https://supplier.example.test", kind: "sub2api" });
  const supplier = await patchSupplierRecord(created.id, { siteLogin: { username: "fixture-user", password: "fixture-password" } });
  const config = { supplierId: supplier.id, supplierSourceId: supplier.state!.sourceId, baseUrl: supplier.apiUrl,
    usage: "agent", modelGroup: "official", accountKeyGroup: "official", accountKeyGroupId: "10", accountKeyId: "1",
    defaultModel: "text", protocol: "chat-completions", modelScanRequestId: "old" };
  const agent = existingAgent ? await mocks.repository.saveConnection({ id: "agent", name: "Keep agent", provider: "rest", config,
    encryptedSecret: encryptSecret("fixture-key", requireServerMasterKey()) }) : undefined;
  mocks.login.mockResolvedValue({ kind: "sub2api", fetch: vi.fn() });
  mocks.discover.mockResolvedValue({ kind: "sub2api", status: "live", complete: true, checkedAt: new Date().toISOString(),
    groups: [{ id: "official", label: "Official", supplierGroupId: "10", source: "catalog",
      models: [{ id: "text", capability: "chat" }] }] });
  mocks.accountKeys.mockResolvedValue({ keys: [{ id: "1", group: "official", supplierGroupId: "10", apiKey: "fixture-key" }],
    complete: true, skipped: 0, checkedAt: new Date().toISOString() });
  mocks.models.mockImplementation(async (_request: Request, options: { params: Promise<{ id: string }> }) => {
    const connection = (await mocks.repository.getConnection((await options.params).id))!;
    const checkedAt = new Date().toISOString();
    await mocks.repository.saveConnection({ ...connection, config: { ...connection.config,
      defaultModel: connection.config.usage === "agent" ? connection.config.defaultModel ?? "text" : connection.config.defaultModel,
      modelScanRequestId: randomUUID(), modelScanStatus: "live", modelScanAttemptStatus: "live", modelScanComplete: true,
      modelCatalogSource: "live", modelScanCheckedAt: checkedAt, modelScanLastSuccessAt: checkedAt,
      scannedModelIds: ["text", image.id], modelCatalogModels: [{ id: "text", name: "Text", operations: [], outputKinds: ["text"] }, image],
    } });
    return Response.json([image], { headers: { "X-Model-Scan-Status": "live", "X-Model-Scan-Complete": "true", "X-Model-Scan-Source": "live" } });
  });
  return { supplier, agent };
}

describe("supplier scan agent-media second stage", () => {
  it.each([true, false])("supplements an %s existing agent after its first complete Key read and future scans do not duplicate it", async existing => {
    const f = await fixture(existing);
    await scanSupplierRecord(f.supplier.id, undefined, undefined, { verifyCapabilities: false });
    const records = await mocks.repository.listConnections();
    expect(records).toHaveLength(2);
    const agent = records.find(connection => connection.config.usage === "agent")!;
    const canvas = records.find(connection => connection.config.usage === "canvas")!;
    if (f.agent) expect(agent).toMatchObject({ id: f.agent.id, name: f.agent.name, provider: f.agent.provider,
      encryptedSecret: f.agent.encryptedSecret, config: { usage: "agent", defaultModel: "text", accountKeyId: "1" } });
    expect(canvas).toMatchObject({ encryptedSecret: agent.encryptedSecret, provider: "openai",
      config: { supplierMediaSourceConnectionId: agent.id, accountKeyId: "1", accountKeyGroupId: "10", defaultModel: image.id } });
    expect(canvas.config).not.toHaveProperty("supplierVerificationRequestId");
    const ids = records.map(connection => connection.id).sort();
    await scanSupplierRecord(f.supplier.id, undefined, undefined, { verifyCapabilities: false });
    expect((await mocks.repository.listConnections()).map(connection => connection.id).sort()).toEqual(ids);
  });
  it("does not treat a user edit during the account read as an unchanged scan baseline", async () => {
    const f = await fixture();
    mocks.accountKeys.mockImplementationOnce(async () => {
      await mocks.repository.saveConnection({ ...f.agent!, name: "User renamed agent" });
      return { keys: [{ id: "1", group: "official", supplierGroupId: "10", apiKey: "fixture-key" }],
        complete: true, skipped: 0, checkedAt: new Date().toISOString() };
    });
    await scanSupplierRecord(f.supplier.id, undefined, undefined, { verifyCapabilities: false });
    expect(await mocks.repository.listConnections()).toHaveLength(1);
    expect((await mocks.repository.getConnection(f.agent!.id))?.name).toBe("User renamed agent");
  });
  it("retains the local import choice across deletion and a later full scan", async () => {
    const f = await fixture();
    await scanSupplierRecord(f.supplier.id, undefined, undefined, { verifyCapabilities: false });
    const canvas = (await mocks.repository.listConnections()).find(connection => connection.config.usage === "canvas")!;
    expect(canvas).toBeDefined();
    await mocks.repository.deleteConnection(canvas.id);
    const result = await scanSupplierRecord(f.supplier.id, undefined, undefined, { verifyCapabilities: false });
    expect((await mocks.repository.listConnections()).map(connection => connection.id)).toEqual([f.agent!.id]);
    expect(result.state?.agentMediaImports?.[0]?.connectionId).toBe(canvas.id);
  });
  it("honors a same-group canvas deletion during the account read", async () => {
    const f = await fixture();
    const canvas = await mocks.repository.saveConnection({ ...f.agent!, id: "deleted-canvas", config: { ...f.agent!.config, usage: "canvas" } });
    mocks.accountKeys.mockImplementationOnce(async () => {
      await mocks.repository.deleteConnection(canvas.id);
      return { keys: [{ id: "1", group: "official", supplierGroupId: "10", apiKey: "fixture-key" }],
        complete: true, skipped: 0, checkedAt: new Date().toISOString() };
    });
    await scanSupplierRecord(f.supplier.id, undefined, undefined, { verifyCapabilities: false });
    expect((await mocks.repository.listConnections()).map(connection => connection.id)).toEqual([f.agent!.id]);
  });
  it("cannot add an old-source canvas after a source change while the Key response is pending", async () => {
    const f = await fixture();
    const read = mocks.models.getMockImplementation()!;
    mocks.models.mockImplementationOnce(async (...args: [Request, { params: Promise<{ id: string }> }]) => {
      const response = await read(...args);
      await patchSupplierRecord(f.supplier.id, { apiUrl: "https://replacement.example.test/v1" });
      return response;
    });
    await scanSupplierRecord(f.supplier.id, undefined, undefined, { verifyCapabilities: false });
    const records: ProviderConnectionRecord[] = await mocks.repository.listConnections();
    expect(records).toHaveLength(1);
    expect(records[0]!.config.usage).toBe("agent");
    expect(records[0]!.config.supplierArchived).toBe(true);
  });
});
