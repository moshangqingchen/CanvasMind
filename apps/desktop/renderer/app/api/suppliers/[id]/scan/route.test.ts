import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRepository } from "@super-canvas/db";
const mocks = vi.hoisted(() => ({
  repository: undefined as unknown as MemoryRepository,
  discover: vi.fn(),
  login: vi.fn(),
  accountKeys: vi.fn(),
  models: vi.fn(),
  schedule: vi.fn(),
}));
vi.mock("../../../../../lib/server", () => ({
  get repository() { return mocks.repository; },
  jsonError: (error: string, status: number) => Response.json({ error }, { status }),
}));
vi.mock("@super-canvas/providers", async original => ({
  ...await original<typeof import("@super-canvas/providers")>(),
  discoverSupplierCatalog: mocks.discover,
  loginSupplierSite: mocks.login,
  readSupplierAccountKeys: mocks.accountKeys,
}));
vi.mock("../../../../../lib/provider-model-inventory", () => ({ readProviderModelInventory: mocks.models }));
vi.mock("../../../../../lib/supplier-verification", () => ({ scheduleSupplierVerification: mocks.schedule }));
import { createSupplierRecord, patchSupplierRecord } from "../../../../../lib/supplier-service";
import { POST } from "./route";
beforeEach(() => {
  mocks.repository = new MemoryRepository();
  mocks.discover.mockReset();
  mocks.login.mockReset();
  mocks.accountKeys.mockReset();
  mocks.models.mockReset();
  mocks.schedule.mockReset().mockResolvedValue(undefined);
});
describe("supplier directory refresh verification boundary", () => {
  it.each([false, undefined])("propagates read-only preference %s into actual imported Key records, including future restart requests", async verifyCapabilities => {
    const created = await createSupplierRecord({ name: "Mock account", siteUrl: "https://readonly-scan.example.test", kind: "sub2api" });
    const supplier = await patchSupplierRecord(created.id, { siteLogin: { username: "fixture-user", password: "fixture-password" } });
    await mocks.repository.saveConnection({ id: "cleared", name: "Cleared", provider: "openai", encryptedSecret: null, config: {
      supplierId: supplier.id, supplierSourceId: supplier.state!.sourceId, modelGroup: "filled",
      supplierVerificationRequestId: "cleared-key-old-request",
    } });
    await mocks.repository.saveConnection({ id: "keep", name: "Existing", provider: "openai", encryptedSecret: "kept-ciphertext", config: {
      supplierId: supplier.id, supplierSourceId: supplier.state!.sourceId, modelGroup: "kept",
      supplierVerificationRequestId: "existing-key-accepted-request",
    } });
    mocks.login.mockResolvedValue({ kind: "sub2api", fetch: vi.fn() });
    mocks.discover.mockResolvedValue({ groups: [], kind: "sub2api", status: "empty", complete: true, checkedAt: "2026-10-01T00:00:00Z" });
    mocks.accountKeys.mockResolvedValue({ keys: [
      { id: "1", group: "filled", apiKey: "fixture-fill-key", name: "Filled" },
      { id: "2", group: "kept", apiKey: "fixture-unused-key", name: "Kept" },
      { id: "3", group: "created", apiKey: "fixture-new-key", name: "New" },
    ], complete: true, skipped: 0, checkedAt: "2026-10-01T00:00:00Z" });
    mocks.models.mockResolvedValue(Response.json([], { headers: { "X-Model-Scan-Status": "empty" } }));
    const response = await POST(new Request(`http://localhost/api/suppliers/${supplier.id}/scan`, {
      method: "POST", body: JSON.stringify({ expectedRevision: supplier.state!.revision, verifyCapabilities }),
    }), { params: Promise.resolve({ id: supplier.id }) });
    expect(response.status).toBe(200);
    const connections = await mocks.repository.listConnections();
    for (const group of ["filled", "created"]) {
      const connection = connections.find(item => item.config.modelGroup === group)!;
      expect(connection.encryptedSecret).toBeTruthy();
      if (verifyCapabilities === false) expect(connection.config).not.toHaveProperty("supplierVerificationRequestId");
      else expect(connection.config.supplierVerificationRequestId).toEqual(expect.any(String));
    }
    expect(connections.find(item => item.id === "keep")?.config.supplierVerificationRequestId).toBe("existing-key-accepted-request");
    expect(mocks.schedule).toHaveBeenCalledTimes(verifyCapabilities === false ? 0 : 1);
    expect(mocks.models).toHaveBeenCalledTimes(3);
  });
  it.each([
    { verifyCapabilities: false, status: "live", pending: false, scheduled: false },
    { verifyCapabilities: false, status: "empty", pending: true, scheduled: false },
    { verifyCapabilities: false, status: "failed", pending: true, scheduled: false },
    { verifyCapabilities: undefined, status: "live", pending: false, scheduled: true },
    { verifyCapabilities: true, status: "empty", pending: true, scheduled: true },
    { verifyCapabilities: undefined, status: "empty", pending: false, scheduled: false },
  ])("preserves default scheduling while an explicit read-only refresh opts out: %j", async ({ verifyCapabilities, status, pending, scheduled }) => {
    const supplier = await createSupplierRecord({ name: "Mock supplier", siteUrl: "https://supplier-refresh.example.test" });
    if (pending) await mocks.repository.saveConnection({ id: "pending-group", name: "Group", provider: "openai", config: {
      supplierId: supplier.id, supplierSourceId: supplier.state!.sourceId, supplierVerificationRequestId: "pending-verification",
    } });
    mocks.discover.mockResolvedValue({ groups: [], kind: "newapi", status, checkedAt: "2026-10-01T00:00:00Z" });
    const response = await POST(new Request(`http://localhost/api/suppliers/${supplier.id}/scan`, {
      method: "POST", body: JSON.stringify({ expectedRevision: supplier.state!.revision, verifyCapabilities }),
    }), { params: Promise.resolve({ id: supplier.id }) });
    expect(response.status).toBe(200);
    expect((await response.json()).scanStatus).toBe(status);
    expect(mocks.discover).toHaveBeenCalledOnce();
    expect(mocks.schedule).toHaveBeenCalledTimes(scheduled ? 1 : 0);
    if (scheduled) expect(mocks.schedule).toHaveBeenCalledWith(supplier.id);
  });
  it("rejects a string verification flag before performing any scan", async () => {
    const supplier = await createSupplierRecord({ name: "Mock supplier", siteUrl: "https://supplier-invalid-refresh.example.test" });
    const response = await POST(new Request(`http://localhost/api/suppliers/${supplier.id}/scan`, {
      method: "POST", body: JSON.stringify({ expectedRevision: supplier.state!.revision, verifyCapabilities: "false" }),
    }), { params: Promise.resolve({ id: supplier.id }) });
    expect(response.status).toBe(400);
    expect(mocks.discover).not.toHaveBeenCalled();
    expect(mocks.schedule).not.toHaveBeenCalled();
  });
});
