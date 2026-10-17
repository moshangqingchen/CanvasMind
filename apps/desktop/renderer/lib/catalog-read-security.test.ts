import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRepository, type ProviderConnectionRecord, type SupplierRecord } from "@super-canvas/db";
import { catalogConnectionManifest, type CatalogReadItemSpec, type CatalogReadObservation } from "./catalog-read-contracts";
import { catalogReadPreviewEnabled, catalogSourcePlan } from "./catalog-source-plan";
import { previewCatalogUpgradeReads } from "./catalog-upgrade-preview";

const timestamp = "2026-10-17T12:00:00Z";
const connection = (baseUrl = "https://ai.cangyuansuanli.cn/v1"): ProviderConnectionRecord => ({ id: "fixture-key", name: "Fixture Key", provider: "openai",
  encryptedSecret: "opaque-fixture-secret", config: { baseUrl, supplierId: "fixture-supplier", supplierSourceId: "fixture-source", accountKeyGroupId: "7" },
  createdAt: timestamp, updatedAt: timestamp });
const supplier = (): SupplierRecord => ({ id: "fixture-supplier", name: "Fixture supplier", supplierKey: "fixture",
  siteUrl: "https://ai.cangyuansuanli.cn", apiUrl: "https://ai.cangyuansuanli.cn/v1", kind: "newapi", scanStatus: "unscanned", catalog: { groups: [] },
  state: { version: 1, revision: 1, sourceId: "fixture-source", visibility: "visible", fingerprint: "fixture", history: [] }, createdAt: timestamp, updatedAt: timestamp });
const context = { runId: "fixture-run", observationCycleId: "fixture-cycle", identityEpoch: "fixture-epoch", dispatchSeq: 1 };
const observation = (spec: CatalogReadItemSpec): CatalogReadObservation => ({ receipt: { spec, context, status: "succeeded", complete: true,
  freshness: "live", checkedAt: timestamp }, facts: { models: [] } });
afterEach(() => { vi.unstubAllGlobals(); });

describe("catalog read identity and preview security", () => {
  const mutations: Array<[string, (spec: CatalogReadItemSpec) => void]> = [
    ["auth kind", spec => { spec.authScope.kind = "anonymous"; }],
    ["credential principal", spec => { spec.authScope.principalRef = "different-key"; }],
    ["credential epoch", spec => { spec.authScope.credentialEpoch = "different-epoch"; }],
    ["role", spec => { spec.role = "catalog-offer"; }],
    ["supplier", spec => { spec.applyScope.supplierId = "other-supplier"; }],
    ["source", spec => { spec.applyScope.supplierSourceId = "other-source"; }],
    ["group namespace", spec => { spec.applyScope.groupIdentity = "name:7"; }],
    ["connection", spec => { spec.applyScope.connectionIds = ["another-key"]; }],
    ["exact endpoint", spec => { spec.sourceUrl = "https://ai.cangyuansuanli.cn/another/models"; }],
    ["parser", spec => { spec.parserVersion = "different-parser"; }],
    ["required flag", spec => { spec.requiredForMembership = false; }],
  ];
  it.each(mutations)("a copied sourceKey cannot let a different %s satisfy Key membership", (_name, mutate) => {
    const row = connection(), plan = catalogSourcePlan(row, supplier()), required = plan.find(spec => spec.entryId === "key-models")!;
    const forged = structuredClone(required); mutate(forged);
    expect(forged.sourceKey).toBe(required.sourceKey);
    expect(catalogConnectionManifest(row.id, context.observationCycleId, [observation(forged)], plan).complete).toBe(false);
    expect(catalogConnectionManifest(row.id, context.observationCycleId, [observation(forged), observation(required)], plan).complete).toBe(true);
  });
  it("neither a cached/unread receipt nor a different cycle proves a fresh successful required read", () => {
    const row = connection(), plan = catalogSourcePlan(row, supplier()), required = plan.find(spec => spec.entryId === "key-models")!;
    const unread = observation(required); unread.receipt.freshness = "unread";
    const oldCycle = observation(required); oldCycle.receipt.context = { ...context, observationCycleId: "previous-cycle" };
    expect(catalogConnectionManifest(row.id, context.observationCycleId, [unread, oldCycle], plan).complete).toBe(false);
  });
  it.each(["ai.cangyuansuanli.cn", "tu.988236.xyz", "asian-acc.we-token.cc", "api.tk1688.com", "api.miaowuai.store", "api.mikoto.vip"])
    ("a custom port on %s cannot borrow fixed official 443 sources", host => {
      const plan = catalogSourcePlan(connection(`https://${host}:8443/v1`));
      expect(plan.map(spec => spec.entryId)).toEqual(["key-models"]);
      expect(plan[0]?.sourceUrl).toBe(`https://${host}:8443/v1/models`);
    });
  it("rejects base query URLs instead of appending a path inside their query", () => {
    expect(() => catalogSourcePlan(connection("https://supplier.invalid/v1?group=fixture"))).toThrow();
  });
  it.each([{}, { SUPERCANVAS_CATALOG_READ_PREVIEW: "1" }, { USE_MEMORY_STORE: "ephemeral" },
    { SUPERCANVAS_CATALOG_READ_PREVIEW: "0", USE_MEMORY_STORE: "ephemeral" }])("unreachable preview guards run before any profile/repository/credential access: %j", async environment => {
    const inaccessible = vi.fn(() => { throw new Error("Profile must not be accessed"); });
    const readers = vi.fn();
    const repository = { getConnection: inaccessible, getSupplier: inaccessible, getApplicationSetting: inaccessible };
    expect(catalogReadPreviewEnabled(environment)).toBe(false);
    expect((await previewCatalogUpgradeReads("fixture-key", { environment, repository, readers })).status).toBe(404);
    expect(inaccessible).not.toHaveBeenCalled(); expect(readers).not.toHaveBeenCalled();
  });
  it.each(["missing-parent", "deleted-parent", "source-mismatch", "archived-key"])("invalid %s is rejected before resolving credentials or transport", async variant => {
    const repository = new MemoryRepository(), parent = supplier(), row = connection();
    if (variant === "deleted-parent") parent.state!.visibility = "deleted";
    if (variant === "source-mismatch") row.config.supplierSourceId = "old-source";
    if (variant === "archived-key") row.config.supplierArchived = true;
    // Imported legacy snapshots may contain stale or archived rows; don't use
    // a normal save API to bypass its own source/archive validation.
    const seed = repository.exportSnapshot(); seed.suppliers = variant === "missing-parent" ? [] : [parent]; seed.connections = [row];
    const isolated = new MemoryRepository(seed), readers = vi.fn(), network = vi.fn(() => { throw new Error("Unexpected request"); });
    vi.stubGlobal("fetch", network);
    const response = await previewCatalogUpgradeReads(row.id, { environment: { USE_MEMORY_STORE: "ephemeral", SUPERCANVAS_CATALOG_READ_PREVIEW: "1" }, repository: isolated, readers });
    expect(response.status).toBe(409); expect(readers).not.toHaveBeenCalled(); expect(network).not.toHaveBeenCalled();
    expect(isolated.exportSnapshot()).toEqual(seed);
  });
});
