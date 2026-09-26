import { describe, expect, it } from "vitest";
import type { ProviderConnectionRecord, SupplierRecord } from "@super-canvas/db";
import { planSupplierAccountImport } from "./supplier-account-import";
const supplier = {
  id: "s", supplierKey: "custom-s", name: "怪兽ai", apiUrl: "https://site.example.com", siteUrl: "https://site.example.com",
  catalog: { groups: [{ id: "B1", label: "B1", source: "catalog", models: [] }] },
  state: { sourceId: "source" },
} as unknown as SupplierRecord;
const inventory = {
  keys: [ { id: "1", group: "B1", apiKey: "first-secret", name: "one" }, { id: "2", group: "B1", apiKey: "latest-secret", name: "two" },
    { id: "3", group: "B2", apiKey: "b2-secret", name: "three" } ],
  complete: true, skipped: 0, checkedAt: new Date().toISOString(),
};
const encrypt = (key: string) => `encrypted:${key}`;
function connection(patch: Partial<ProviderConnectionRecord> = {}): ProviderConnectionRecord {
  return { id: "existing", provider: "openai", name: "Original", encryptedSecret: null,
    config: { supplierId: "s", supplierSourceId: "source", modelGroup: "B1", usage: "canvas" },
    createdAt: "before", updatedAt: "before", ...patch };
}
describe("account key import plan", () => {
  it("fills empty groups, keeps exact ownership, and is idempotent on a second scan", () => {
    const plan = planSupplierAccountImport(supplier, [connection()], inventory, encrypt);
    expect(plan.summary).toMatchObject({ imported: 2, preserved: 0, multipleGroups: 1 });
    expect(plan.connections[0]).toMatchObject({ id: "existing", encryptedSecret: encrypt("latest-secret") });
    expect(plan.connections[1]).toMatchObject({ provider: "openai", config: { supplierId: "s", supplierSourceId: "source", modelGroup: "B2", supplierKey: "custom-s" } });
    expect(plan.catalog.groups.map(group => group.id)).toEqual(["B1", "B2"]);
    for (const imported of plan.connections) expect(imported.config.supplierVerificationRequestId).toEqual(expect.any(String));
    const repeat = planSupplierAccountImport(supplier, plan.connections, inventory, encrypt);
    expect(repeat.summary).toMatchObject({ imported: 0, preserved: 2 });
    expect(repeat.connections).toEqual(plan.connections);
    expect(JSON.stringify(plan.summary)).not.toContain("secret");
  });

  it("preserves existing keys and edits made while the scan was in flight", () => {
    const saved = connection({ encryptedSecret: "keep-existing-ciphertext" });
    const plan = planSupplierAccountImport(supplier, [saved], inventory, encrypt);
    expect(plan.connections[0]).toEqual(saved);
    const initial = connection();
    const edited = { ...initial, name: "user changed this", updatedAt: "after" };
    const delayed = planSupplierAccountImport(supplier, [edited], inventory, encrypt, [initial]);
    expect(delayed.connections[0]).toEqual(edited);
    expect(delayed.summary.skipped).toBe(1);
  });

  it("does not reuse another supplier, an archived source, or a disabled connection", () => {
    const old = connection({ id: "old", config: { supplierId: "s", supplierSourceId: "old-source", supplierArchived: true, modelGroup: "B1" }, encryptedSecret: "old" });
    const other = connection({ id: "other", config: { supplierId: "other", supplierSourceId: "source", modelGroup: "B2" } });
    const disabled = connection({ id: "disabled", config: { supplierId: "s", supplierSourceId: "source", modelGroup: "B2", usage: "disabled" } });
    const plan = planSupplierAccountImport(supplier, [old, other, disabled], inventory, encrypt);
    expect(plan.connections.slice(0, 3)).toEqual([old, other, disabled]);
    expect(plan.summary).toMatchObject({ imported: 1, skipped: 1 });
  });
});
