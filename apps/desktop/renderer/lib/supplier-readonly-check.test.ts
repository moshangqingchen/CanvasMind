import { describe, expect, it, vi } from "vitest";
import { MemoryRepository, type ProviderConnectionRecord, type SupplierRecord } from "@super-canvas/db";
import { checkSupplierReadOnly } from "./supplier-readonly-check";
import type { CatalogReadItemSpec } from "./catalog-read-contracts";

vi.mock("@super-canvas/providers", async original => ({ ...await original<typeof import("@super-canvas/providers")>(),
  assertSafeProviderEndpoint: vi.fn(async () => undefined) }));

const checkedAt = "2026-10-22T11:00:00.000Z", before = "2026-10-21T11:00:00.000Z";
const supplier: SupplierRecord = { id: "account-a", supplierKey: "custom", name: "个人账号 A", siteUrl: "https://fixture.invalid",
  apiUrl: "https://fixture.invalid/v1", kind: "newapi", catalog: { groups: [] }, scanStatus: "unscanned", createdAt: before, updatedAt: before,
  state: { version: 1, revision: 1, visibility: "visible", sourceId: "source-a", fingerprint: "fixture", history: [] } };
const connection: ProviderConnectionRecord = { id: "key-a", name: "组 7", provider: "openai", encryptedSecret: "opaque-secret",
  config: { supplierId: supplier.id, supplierSourceId: "source-a", baseUrl: supplier.apiUrl, accountKeyGroupId: "7",
    modelScanCheckedAt: before, modelScanLastSuccessAt: before, modelScanComplete: true,
    modelCatalogModels: [{ id: "old", name: "Old", operations: [] }] }, createdAt: before, updatedAt: before };
function repositoryFor(rows = [connection], record = supplier) {
  const snapshot = new MemoryRepository().exportSnapshot();
  snapshot.suppliers = [structuredClone(record)]; snapshot.connections = structuredClone(rows);
  return new MemoryRepository(snapshot);
}
function readersFor(ids: string[], source?: (spec: CatalogReadItemSpec) => Response) {
  return vi.fn(async () => ({ apiKey: "fixture-secret-must-not-leak", fetchFor: (spec: CatalogReadItemSpec) => vi.fn<typeof fetch>(async (_input, init) => {
    expect(init?.method ?? "GET").toBe("GET");
    return spec.entryId === "key-models" ? Response.json({ data: ids.map(id => ({ id })) }) : source?.(spec) ?? new Response(null, { status: 503 });
  }) }));
}

describe("explicit supplier read-only checks", () => {
  it("compares exact Key membership without saving application data, observations or caches", async () => {
    const repository = repositoryFor(), snapshot = repository.exportSnapshot();
    const saves = [vi.spyOn(repository, "saveConnection"), vi.spyOn(repository, "saveSupplier"),
      vi.spyOn(repository, "setApplicationSetting"), vi.spyOn(repository, "commitCatalogObservation")];
    const report = await checkSupplierReadOnly(supplier.id, { repository, readers: readersFor(["new"]), now: () => checkedAt });
    expect(report).toMatchObject({ supplierId: supplier.id, readOnly: true, status: "partial", connections: [{
      connectionId: "key-a", groupIdentity: "site-id:7", hasBaseline: true, membershipComplete: true,
      currentModelCount: 1, addedModelIds: ["new"], missingModelIds: ["old"], firstDiscoveredModelIds: [],
    }] });
    expect(report.sources.some(source => source.status === "failed")).toBe(true);
    expect(report.limitations.join(" ")).toContain("不代表已完整阅读");
    expect(JSON.stringify(report)).not.toMatch(/fixture-secret-must-not-leak|opaque-secret|credentialEpoch|encryptedSecret/);
    expect(repository.exportSnapshot()).toEqual(snapshot);
    for (const save of saves) expect(save).not.toHaveBeenCalled();
  });

  it("separates first discovery from additions when no complete saved baseline exists", async () => {
    const row = structuredClone(connection); delete row.config.modelScanComplete;
    const report = await checkSupplierReadOnly(supplier.id, { repository: repositoryFor([row]), readers: readersFor(["new"]) });
    expect(report.connections[0]).toMatchObject({ hasBaseline: false, addedModelIds: [], missingModelIds: [], firstDiscoveredModelIds: ["new"] });
  });

  it("does not turn a successful empty directory into mass deletions", async () => {
    const report = await checkSupplierReadOnly(supplier.id, { repository: repositoryFor(), readers: readersFor([]) });
    expect(report.connections[0]).toMatchObject({ membershipComplete: true, currentModelCount: 0, missingModelIds: [] });
  });

  it("keeps partial and failed Key reads from proving removals", async () => {
    const readers = vi.fn(async () => ({ apiKey: "fixture", fetchFor: (spec: CatalogReadItemSpec) => async () => spec.entryId === "key-models"
      ? Response.json({ data: [{ id: "new" }], has_more: true }) : new Response(null, { status: 503 }) }));
    const report = await checkSupplierReadOnly(supplier.id, { repository: repositoryFor(), readers });
    expect(report.connections[0]).toMatchObject({ membershipComplete: false, missingModelIds: [] });
  });

  it("never borrows same-domain Keys from another account, stale source, archive or unbound legacy connection", async () => {
    const other = { ...connection, id: "other", config: { ...connection.config, supplierId: "account-b" } };
    const stale = { ...connection, id: "stale", config: { ...connection.config, supplierSourceId: "source-old" } };
    const archived = { ...connection, id: "archived", config: { ...connection.config, supplierArchived: true } };
    const unbound = { ...connection, id: "unbound", config: { baseUrl: supplier.apiUrl } };
    const oldAddress = { ...connection, id: "legacy-old-address", config: { supplierId: supplier.id, baseUrl: "https://previous.invalid/v1" } };
    const readers = readersFor(["new"]);
    const report = await checkSupplierReadOnly(supplier.id, { repository: repositoryFor([connection, other, stale, archived, unbound, oldAddress]), readers });
    expect(report.connections.map(row => row.connectionId)).toEqual(["key-a"]);
    expect(readers).toHaveBeenCalledTimes(1);
  });

  it("rejects late results if a personal account, Key or saved baseline changed during the check", async () => {
    const repository = repositoryFor(), original = repository.getSupplier.bind(repository);
    let calls = 0;
    vi.spyOn(repository, "getSupplier").mockImplementation(async id => {
      const value = await original(id); return ++calls === 1 ? value : { ...value!, name: "changed while reading" };
    });
    await expect(checkSupplierReadOnly(supplier.id, { repository, readers: readersFor(["new"]) })).rejects.toMatchObject({ status: 409 });
  });

  it("reads a directory-only account without creating any Key or connection", async () => {
    const repository = repositoryFor([]), snapshot = repository.exportSnapshot();
    const report = await checkSupplierReadOnly(supplier.id, { repository, readers: async () => ({ apiKey: "", fetchFor: spec =>
      spec.authScope.kind === "connection-key" ? undefined : async () => Response.json({ success: true, data: [] }) }) });
    expect(report.connections).toEqual([]);
    expect(report.limitations.join(" ")).toContain("不按同域名借用");
    expect(repository.exportSnapshot()).toEqual(snapshot);
  });

  it("compares an official group rename and price only against its stable identity", async () => {
    const saved: SupplierRecord = { ...supplier, kind: "sub2api", scanStatus: "live", scannedAt: before, scanComplete: true, catalog: { groups: [{
      id: "old-name", supplierGroupId: "7", label: "旧名称", source: "catalog", models: [{ id: "image", capability: "image", name: "image", priceLabel: "旧价格" }],
    }] } };
    const readers = readersFor(["image"], spec => spec.entryId === "supplier:plaza:anonymous" ? Response.json({ data: { groups: [
      { id: 7, name: "新名称", models: [{ name: "image", capability: "image", pricing: { billing_mode: "per_request", per_request_price: 2 } }] },
    ] } }) : new Response(null, { status: 503 }));
    const report = await checkSupplierReadOnly(supplier.id, { repository: repositoryFor([connection], saved), readers });
    expect(report.catalogChanges).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "group-renamed", groupIdentity: "site-id:7", before: "旧名称", after: "新名称" }),
      expect.objectContaining({ kind: "price", modelId: "image", before: "旧价格", after: "2/请求（币种未注明）" }),
    ]));
    const ambiguous = { ...saved, catalog: { groups: [...saved.catalog.groups, { ...saved.catalog.groups[0]!, id: "duplicate" }] } };
    const unknown = await checkSupplierReadOnly(supplier.id, { repository: repositoryFor([connection], ambiguous), readers });
    expect(unknown.catalogChanges.some(change => ["group-renamed", "price"].includes(change.kind))).toBe(false);
    const incomplete = await checkSupplierReadOnly(supplier.id, { repository: repositoryFor([connection], { ...saved, scanComplete: false }), readers });
    expect(incomplete.catalogChanges.some(change => ["group-added", "model-added", "group-renamed", "price"].includes(change.kind))).toBe(false);
    expect(incomplete.catalogChanges.some(change => change.kind === "model-discovered")).toBe(true);
  });

  it("scrubs credentials even if a provider reflects the exact Key as a model ID", async () => {
    const report = await checkSupplierReadOnly(supplier.id, { repository: repositoryFor(), readers: readersFor(["fixture-secret-must-not-leak"]) });
    expect(JSON.stringify(report)).not.toContain("fixture-secret-must-not-leak");
  });
});
