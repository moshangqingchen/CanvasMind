import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRepository } from "@super-canvas/db";
import type { CatalogReadItemSpec } from "../../../../../lib/catalog-read-contracts";

const mocks = vi.hoisted(() => ({ repository: undefined as unknown as MemoryRepository, readers: vi.fn() }));
vi.mock("../../../../../lib/server", () => ({ get repository() { return mocks.repository; },
  jsonError: (error: string, status: number) => Response.json({ error }, { status }) }));
vi.mock("../../../../../lib/supplier-readonly-check-readers", () => ({ createSupplierReadOnlyReaders: () => mocks.readers }));
vi.mock("@super-canvas/providers", async original => ({ ...await original<typeof import("@super-canvas/providers")>(),
  assertSafeProviderEndpoint: vi.fn(async () => undefined) }));
import { legacySupplierId } from "../../../../../lib/supplier-service";
import { POST } from "./route";

beforeEach(() => {
  mocks.repository = new MemoryRepository();
  mocks.readers.mockReset().mockImplementation(async () => ({ apiKey: "fixture-key", fetchFor: (spec: CatalogReadItemSpec) =>
    async () => spec.entryId === "key-models" ? Response.json({ data: [{ id: "fixture-model" }] }) : new Response(null, { status: 503 }) }));
});

describe("read-only checks for projected legacy suppliers", () => {
  it("checks only the exact legacy account without materializing, migrating or borrowing another same-site Key", async () => {
    const legacy = await mocks.repository.saveConnection({ id: "legacy-key", name: "Legacy", provider: "openai",
      encryptedSecret: "opaque-legacy", config: { baseUrl: "https://fixture.invalid/gateway/v1", supplierKey: "custom" } });
    await mocks.repository.saveConnection({ ...legacy, id: "other-account", config: { ...legacy.config, supplierId: "account-b" } });
    await mocks.repository.saveConnection({ ...legacy, id: "other-gateway", config: { ...legacy.config, baseUrl: "https://fixture.invalid/other/v1" } });
    const before = mocks.repository.exportSnapshot();
    const id = legacySupplierId(legacy);
    const response = await POST(new Request(`http://localhost/api/suppliers/${id}/check`, { method: "POST" }), { params: Promise.resolve({ id }) });
    expect(response.status).toBe(200);
    const report = await response.json();
    expect(report).toMatchObject({ supplierId: id, readOnly: true, connections: [{ connectionId: "legacy-key", firstDiscoveredModelIds: ["fixture-model"] }] });
    expect(report.connections).toHaveLength(1);
    expect(mocks.readers).toHaveBeenCalledTimes(1);
    expect(mocks.repository.exportSnapshot()).toEqual(before);
  });

  it("rejects a legacy Key changed after the projected snapshot was read", async () => {
    const legacy = await mocks.repository.saveConnection({ id: "legacy-key", name: "Legacy", provider: "openai",
      encryptedSecret: "opaque-legacy", config: { baseUrl: "https://fixture.invalid/v1", supplierKey: "custom" } });
    const reads = mocks.readers.getMockImplementation()!;
    mocks.readers.mockImplementation(async (...args) => {
      await mocks.repository.saveConnection({ ...legacy, encryptedSecret: "opaque-new-key" });
      return reads(...args);
    });
    const id = legacySupplierId(legacy);
    const response = await POST(new Request(`http://localhost/api/suppliers/${id}/check`, { method: "POST" }), { params: Promise.resolve({ id }) });
    expect(response.status).toBe(409);
    expect(await mocks.repository.listSuppliers()).toEqual([]);
  });
});
