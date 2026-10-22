import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { deflateRawSync } from "node:zlib";
import type { CatalogPipelineState, ProviderConnectionRecord } from "@super-canvas/db";
import type { ModelDescriptor } from "@super-canvas/providers";
import type { CatalogInventoryState } from "./catalog-inventory-policy";
import { compactCatalogTk1688Inventory, hydrateCatalogTk1688Inventory, TK1688_ARCHIVE_LIMITS } from "./catalog-tk1688-state-storage";
import { catalogManualRefreshPatches } from "./catalog-manual-refresh-fence";
import { catalogConnectionScopes, catalogReadItem } from "./catalog-source-plan";

const at = "2026-10-22T05:28:00Z", canonical = (value: unknown) => JSON.parse(JSON.stringify(value));
const model: ModelDescriptor = { id: "gpt-image-2@s1c581", name: "GPT image merchant", operations: ["image.generate", "image.edit"],
  parameters: [{ key: "quality", label: "Quality", control: "select", default: "medium", options: [{ value: "medium", label: "medium" }] }],
  inputKinds: ["text", "image"], outputKinds: ["image"], limits: { maxInputImages: 30 },
  pricing: { kind: "per-image", currency: "CNY", unitAmount: .1200030528, checkedAt: at, confidence: "exact",
    evidence: { sourceKey: "market-source", checkedAt: at, status: "published", sourceUrl: "https://tk1688.com/market" } },
  metadata: { canvasRunnable: false, canvasUnavailableReason: "HTTP 403 当前 Key 权限拒绝", tk1688CatalogStale: true,
    catalogMembershipDerivation: { kind: "tk1688-three-way", rawKeyModel: false, key: { sourceKey: "key-source", dispatchSeq: 1, checkedAt: at } },
    source: "paid-test", measuredPrice: { requestId: "original-request", amount: .12, checkedAt: at } } };
function inventory(models = [model]): CatalogInventoryState {
  return { schemaVersion: 1, connectionId: "tk-key", identityEpoch: "epoch", observedAt: at, visibleModels: structuredClone(models),
    historicalModels: models.map(descriptor => ({ modelId: descriptor.id, descriptor: structuredClone(descriptor), identityEpoch: "old-epoch",
      sourceKeys: ["key-source"], unavailableAt: at, observationCycleId: "old-cycle" })),
    sources: { key: { sourceKey: "key", identity: "identity", acceptedModels: structuredClone(models), lastIdentityEpoch: "epoch",
      lastDispatchSeq: 1, lastObservationCycleId: "cycle", lastObservedAt: at, lastOutcome: "accepted",
      baseline: { modelIds: models.map(row => row.id), fingerprint: "fingerprint", checkedAt: at, observationCycleId: "cycle" },
      candidate: { version: "candidate-version", modelIds: models.map(row => row.id), models: structuredClone(models), fingerprint: "candidate-fingerprint",
        checkedAt: at, observationCycleId: "candidate-cycle", countedCycles: ["one"] } } } };
}
const archiveOf = (value: CatalogInventoryState) => (value as CatalogInventoryState & { tk1688DescriptorArchive: {
  schemaVersion: number; codec: string; originalBytes: number; descriptorCount: number; sha256: string; body: string } }).tk1688DescriptorArchive;

describe("Tk1688 internal descriptor storage", () => {
  it("losslessly roundtrips full visible/source/candidate/history controls, refusals, stale flags and original measured evidence", () => {
    const source = inventory(), before = structuredClone(source), compact = compactCatalogTk1688Inventory(source);
    expect(archiveOf(compact).descriptorCount).toBe(1);
    expect(compact.visibleModels[0]!.metadata).toMatchObject({ canvasRunnable: false, canvasUnavailableReason: "HTTP 403 当前 Key 权限拒绝" });
    expect(compact.visibleModels[0]!.parameters).toBeUndefined();
    expect(hydrateCatalogTk1688Inventory(compact)).toEqual(canonical(source));
    expect(hydrateCatalogTk1688Inventory(compactCatalogTk1688Inventory(compact))).toEqual(canonical(source));
    expect(source).toEqual(before);
    // A legacy refresh can replace a full visible model beside archived source/history.
    const mixed = { ...compact, visibleModels: [{ ...model, metadata: { ...model.metadata, tk1688CatalogStale: false } }] };
    expect(hydrateCatalogTk1688Inventory(compactCatalogTk1688Inventory(mixed))?.visibleModels).toEqual(canonical(mixed.visibleModels));
  });

  it("keeps 1047 full rich descriptors and historical versions below the unchanged physical limit over repeated serialization", () => {
    const models = Array.from({ length: 1047 }, (_, index): ModelDescriptor => ({ ...model, id: `gpt-image-2@s1c${index}`, name: `Merchant ${index}`,
      parameters: Array.from({ length: 20 }, (_, option) => ({ key: `parameter-${option}`, label: `Supplier parameter ${option}`, control: "text", description: "原始供应商参数和条件".repeat(5) })),
      metadata: { ...model.metadata, description: "同一供应商原始公开参数正文".repeat(70), listingId: index } }));
    const source = inventory(models); delete source.sources.key!.candidate;
    const unchangedOtherFacts = "raw-evidence".repeat(1_200_000);
    expect(Buffer.byteLength(JSON.stringify({ membership: source, unchangedOtherFacts }))).toBeGreaterThan(32 * 1024 * 1024);
    let compact = compactCatalogTk1688Inventory(source);
    for (let round = 0; round < 2; round++) {
      expect(Buffer.byteLength(JSON.stringify(compact))).toBeLessThan(4 * 1024 * 1024);
      const hydrated = hydrateCatalogTk1688Inventory(canonical(compact))!;
      expect(hydrated.visibleModels).toHaveLength(1047);
      expect(hydrated.visibleModels[581]).toEqual(canonical(models[581]));
      expect(hydrated.sources.key!.acceptedModels).toEqual(canonical(models));
      expect(hydrated.historicalModels[581]!.descriptor).toEqual(canonical(models[581]));
      compact = compactCatalogTk1688Inventory(hydrated);
    }
  });

  it.each(["missing", "missing-ref", "wrong-id", "wrong-hash", "corrupt-body", "oversized-pool", "oversized-count"])("fails closed on %s archive", scenario => {
    const compact = compactCatalogTk1688Inventory(inventory()), archive = archiveOf(compact);
    if (scenario === "missing") delete (compact as unknown as Record<string, unknown>).tk1688DescriptorArchive;
    if (scenario === "missing-ref") compact.visibleModels[0]!.metadata = { ...compact.visibleModels[0]!.metadata, catalogStoredDescriptor: "f".repeat(64) };
    if (scenario === "wrong-id") compact.visibleModels[0]!.id = "other-exact-id";
    if (scenario === "wrong-hash") archive.sha256 = "f".repeat(64);
    if (scenario === "corrupt-body") archive.body = "not-base64!!!";
    if (scenario === "oversized-pool") archive.originalBytes = TK1688_ARCHIVE_LIMITS.poolBytes + 1;
    if (scenario === "oversized-count") archive.descriptorCount = TK1688_ARCHIVE_LIMITS.references + 1;
    expect(() => hydrateCatalogTk1688Inventory(compact)).toThrow("已停止投影");
  });

  it("bounds references and expanded logical bytes before duplicating archived models", () => {
    const compact = compactCatalogTk1688Inventory(inventory());
    compact.visibleModels = Array.from({ length: TK1688_ARCHIVE_LIMITS.references }, () => compact.visibleModels[0]!);
    expect(() => hydrateCatalogTk1688Inventory(compact)).toThrow("已停止投影");
    const large = { ...model, description: "x".repeat(1024 * 1024) }, json = JSON.stringify(large), ref = createHash("sha256").update(json).digest("hex");
    const encoded = compactCatalogTk1688Inventory(inventory([])), body = Buffer.from(JSON.stringify({ [ref]: large }));
    Object.assign(archiveOf(encoded), { originalBytes: body.length, descriptorCount: 1, sha256: createHash("sha256").update(body).digest("hex"), body: deflateRawSync(body).toString("base64") });
    encoded.visibleModels = Array.from({ length: 33 }, () => ({ id: large.id, name: large.name, operations: large.operations, metadata: { catalogStoredDescriptor: ref } }));
    expect(() => hydrateCatalogTk1688Inventory(encoded)).toThrow("已停止投影");
    expect(() => compactCatalogTk1688Inventory(inventory([{ ...model, description: "x".repeat(TK1688_ARCHIVE_LIMITS.poolBytes) }]))).toThrow("已停止投影");
  });

  it("recompacts a manual refresh without changing its Key fence or saved full menu", () => {
    const connection = { id: "tk-key", name: "Tk", provider: "openai", encryptedSecret: "fixture", createdAt: at, updatedAt: at,
      config: { baseUrl: "https://api.tk1688.com/v1", modelScanCheckedAt: at, modelCatalogModels: [model] } } as ProviderConnectionRecord;
    const scopes = catalogConnectionScopes(connection), spec = catalogReadItem("key-models", "https://api.tk1688.com/v1/models", "key-membership", scopes.key, scopes.apply, true);
    const pipeline = { schemaVersion: 1, supplierId: "supplier", identityEpoch: "epoch", nextDispatchSeq: 9, sources: {},
      entries: { "membership:tk-key": compactCatalogTk1688Inventory(inventory()) } } as unknown as CatalogPipelineState;
    const patches = catalogManualRefreshPatches(pipeline, connection, [spec], "revision", Date.parse(at));
    const stored = patches.find(row => row.key === "membership:tk-key")!.value as unknown as CatalogInventoryState;
    expect(archiveOf(stored)).toBeDefined();
    expect(hydrateCatalogTk1688Inventory(stored)?.visibleModels).toEqual(canonical([model]));
    expect(patches.find(row => row.key === "manual-fence:tk-key")!.value).toMatchObject({ dispatchedThrough: 8, checkedAt: at });
    expect(connection.config.modelCatalogModels).toEqual([model]);
  });
});
