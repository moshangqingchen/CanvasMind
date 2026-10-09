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
  it("reconciles only proven saved Keys during a catalog refresh without filling or importing credentials", () => {
    const currentSupplier = { ...supplier, catalog: { groups: [{ id: "New", label: "New", source: "catalog" as const, supplierGroupId: "115", models: [{ id: "gpt-image-2", capability: "image" as const, priceLabel: "0.07/张" }] }] } };
    const saved = connection({ encryptedSecret: encrypt("same-secret"), config: {
      supplierId: "s", supplierSourceId: "source", accountKeyId: "1548", accountKeyGroup: "Old", modelGroup: "Old", usage: "canvas",
      modelScanStatus: "live", modelScanComplete: true, scannedModelIds: ["gpt-image-2"], supplierVerificationRequestId: "accepted",
    } });
    const cleared = connection({ id: "cleared", config: { supplierId: "s", supplierSourceId: "source", modelGroup: "Empty", usage: "canvas" } });
    const currentKeys = { ...inventory, keys: [
      { id: "1548", group: "New", supplierGroupId: "115", apiKey: "same-secret", name: "saved" },
      { id: "2", group: "Unrelated", supplierGroupId: "116", apiKey: "new-secret", name: "new" },
      { id: "3", group: "Empty", supplierGroupId: "117", apiKey: "cleared-secret", name: "cleared" },
    ] };
    const before = [saved, cleared];
    const plan = planSupplierAccountImport(currentSupplier, before, currentKeys, () => { throw new Error("Unexpected import"); }, before, {
      preserveOnly: true, previousCatalog: { groups: [{ id: "Old", label: "Old", models: [] }] },
      matchesKey: (existing, apiKey) => existing.encryptedSecret === encrypt(apiKey),
    });
    expect(plan.connections).toHaveLength(2);
    expect(plan.connections[0]).toEqual({ ...saved, config: { ...saved.config, modelGroup: "New", accountKeyGroup: "New", accountKeyGroupId: "115" } });
    expect(plan.connections[1]).toEqual(cleared);
    expect(plan.catalog.groups).toEqual([{ ...currentSupplier.catalog.groups[0]!, status: "available" }]);
    expect(plan.summary).toMatchObject({ imported: 0, preserved: 1, skipped: 2 });
  });
  it("keeps the same connection and model evidence when an official group is renamed", () => {
    const oldCatalog = { groups: [{ id: "Old", label: "Old", source: "catalog" as const, supplierGroupId: "115", models: [] }] };
    const currentSupplier = { ...supplier, catalog: { groups: [{ ...oldCatalog.groups[0]!, id: "New", label: "New" }] } };
    const saved = connection({ encryptedSecret: "keep-existing-ciphertext", config: {
      supplierId: "s", supplierSourceId: "source", accountKeyId: "1", accountKeyGroup: "Old", modelGroup: "Old", usage: "canvas",
      modelScanStatus: "live", modelScanComplete: true, modelCatalogModels: [{ id: "gpt-image-2" }], scannedModelIds: ["gpt-image-2"],
      supplierVerificationRequestId: "accepted-request", manualModels: [{ id: "manual" }],
    } });
    const currentKeys = { ...inventory, keys: [{ id: "1", group: "New", supplierGroupId: "115", apiKey: "new-secret", name: "one" }] };
    const plan = planSupplierAccountImport(currentSupplier, [saved], currentKeys, encrypt, [saved], { previousCatalog: oldCatalog });
    expect(plan.connections).toHaveLength(1);
    expect(plan.connections[0]).toEqual({ ...saved, config: { ...saved.config, accountKeyGroupId: "115", accountKeyGroup: "New", modelGroup: "New" } });
    expect(plan.summary).toMatchObject({ imported: 0, preserved: 1 });
  });

  it("prefers the current official group name and models over its merged former record", () => {
    const oldGroup = { id: "Old", label: "Old", source: "catalog" as const, supplierGroupId: "115", models: [{ id: "old", capability: "image" as const }] };
    const newGroup = { id: "New", label: "New", source: "catalog" as const, supplierGroupId: "115", models: [{ id: "new", capability: "image" as const }] };
    const currentSupplier = { ...supplier, catalog: { groups: [oldGroup, newGroup] } };
    const saved = connection({ encryptedSecret: "keep-key", config: { supplierId: "s", supplierSourceId: "source", accountKeyGroupId: "115", accountKeyGroup: "Old", modelGroup: "Old", usage: "canvas" } });
    const currentKeys = { ...inventory, keys: [{ id: "1", group: "New", supplierGroupId: "115", apiKey: "secret", name: "one" }] };
    const plan = planSupplierAccountImport(currentSupplier, [saved], currentKeys, encrypt);
    expect(plan.connections).toHaveLength(1);
    expect(plan.connections[0]?.config).toMatchObject({ accountKeyGroup: "New", modelGroup: "New", accountKeyGroupId: "115" });
    expect(plan.catalog.groups.find(group => group.id === "New")?.models).toEqual(newGroup.models);
    const ambiguous = { ...currentSupplier, catalog: { groups: [oldGroup, { ...newGroup, id: "Other" }] } };
    const refused = planSupplierAccountImport(ambiguous, [saved], currentKeys, encrypt);
    expect(refused.connections).toEqual([saved]);
    expect(refused.summary.skipped).toBe(1);
  });

  it("recovers legacy renamed groups only with the exact imported Key ID and encrypted-secret proof", () => {
    const currentSupplier = { ...supplier, catalog: { groups: [{ id: "New", label: "New", source: "catalog" as const, supplierGroupId: "115", models: [] }] } };
    const saved = connection({ encryptedSecret: encrypt("same-secret"), config: {
      supplierId: "s", supplierSourceId: "source", accountKeyId: "1548", accountKeyGroup: "Old", modelGroup: "Old", usage: "canvas",
      scannedModelIds: ["gpt-image-2"], modelScanStatus: "live", modelScanComplete: true,
    } });
    const currentKeys = { ...inventory, keys: [{ id: "1548", group: "New", supplierGroupId: "115", apiKey: "same-secret", name: "one" }] };
    const options = { previousCatalog: { groups: [{ id: "Old", label: "Old", models: [] }] },
      matchesKey: (existing: ProviderConnectionRecord, apiKey: string) => existing.encryptedSecret === encrypt(apiKey) };
    const plan = planSupplierAccountImport(currentSupplier, [saved], currentKeys, encrypt, [saved], options);
    expect(plan.connections).toHaveLength(1);
    expect(plan.connections[0]?.config).toMatchObject({ accountKeyGroupId: "115", accountKeyGroup: "New", modelGroup: "New", scannedModelIds: ["gpt-image-2"], modelScanStatus: "live" });
    const wrongSecret = { ...saved, encryptedSecret: encrypt("different-secret") };
    const refused = planSupplierAccountImport(currentSupplier, [wrongSecret], currentKeys, encrypt, [wrongSecret], options);
    expect(refused.connections).toHaveLength(2);
    expect(refused.connections[0]).toEqual(wrongSecret);
    const wrongKeyId = { ...saved, config: { ...saved.config, accountKeyId: "1549" } };
    const refusedId = planSupplierAccountImport(currentSupplier, [wrongKeyId], currentKeys, encrypt, [wrongKeyId], options);
    expect(refusedId.connections).toHaveLength(2);
    expect(refusedId.connections[0]).toEqual(wrongKeyId);
  });

  it.each([true, false])("does not rename a reassigned Key whose prior official group ID is known: stored %s", stored => {
    const oldCatalog = { groups: [{ id: "Old", label: "Old", source: "catalog" as const, supplierGroupId: "115", models: [] }] };
    const currentSupplier = { ...supplier, catalog: { groups: [{ id: "New", label: "New", source: "catalog" as const, supplierGroupId: "116", models: [] }] } };
    const saved = connection({ encryptedSecret: encrypt("same-secret"), config: {
      supplierId: "s", supplierSourceId: "source", accountKeyId: "1", accountKeyGroup: "Old", modelGroup: "Old", usage: "canvas",
      ...(stored ? { accountKeyGroupId: "115" } : {}),
    } });
    const currentKeys = { ...inventory, keys: [{ id: "1", group: "New", supplierGroupId: "116", apiKey: "same-secret", name: "one" }] };
    const plan = planSupplierAccountImport(currentSupplier, [saved], currentKeys, encrypt, [saved], {
      previousCatalog: oldCatalog, matchesKey: () => true,
    });
    expect(plan.connections).toHaveLength(2);
    expect(plan.connections[0]).toEqual(saved);
    expect(plan.connections[1]?.config).toMatchObject({ accountKeyGroupId: "116", accountKeyGroup: "New" });
  });

  it("stamps newly imported group IDs and proven same-name imports while preserving manual Keys", () => {
    const currentSupplier = { ...supplier, catalog: { groups: [{ id: "B1", label: "B1", source: "catalog" as const, supplierGroupId: "115", models: [] }] } };
    const currentKeys = { ...inventory, keys: [{ id: "1", group: "B1", supplierGroupId: "115", apiKey: "same-secret", name: "one" }] };
    const fresh = planSupplierAccountImport(currentSupplier, [], currentKeys, encrypt);
    expect(fresh.connections[0]?.config).toMatchObject({ accountKeyId: "1", accountKeyGroupId: "115", modelGroup: "B1" });
    const saved = connection({ encryptedSecret: encrypt("same-secret"), config: { supplierId: "s", supplierSourceId: "source", modelGroup: "B1", accountKeyGroup: "B1", accountKeyId: "1", usage: "canvas" } });
    const options = { previousCatalog: supplier.catalog, matchesKey: (existing: ProviderConnectionRecord, apiKey: string) => existing.encryptedSecret === encrypt(apiKey) };
    const stamped = planSupplierAccountImport(currentSupplier, [saved], currentKeys, encrypt, [saved], options);
    expect(stamped.connections[0]?.config.accountKeyGroupId).toBe("115");
    const manual = connection({ encryptedSecret: encrypt("manual-secret") });
    const preserved = planSupplierAccountImport(currentSupplier, [manual], currentKeys, encrypt, [manual], options);
    expect(preserved.connections).toEqual([manual]);
  });

  it("preserves edits made during a rename scan and separates identically named official groups", () => {
    const saved = connection({ encryptedSecret: encrypt("same-secret"), config: {
      supplierId: "s", supplierSourceId: "source", accountKeyId: "1", accountKeyGroupId: "115", accountKeyGroup: "Old", modelGroup: "Old", usage: "canvas",
    } });
    const edited = { ...saved, name: "User edited", updatedAt: "after" };
    const currentKeys = { ...inventory, keys: [{ id: "1", group: "New", supplierGroupId: "115", apiKey: "same-secret", name: "one" }] };
    const renamed = planSupplierAccountImport(supplier, [edited], currentKeys, encrypt, [saved]);
    expect(renamed.connections).toEqual([edited]);
    const two = { ...inventory, keys: [{ id: "1", group: "Shared", supplierGroupId: "115", apiKey: "first", name: "one" },
      { id: "2", group: "Shared", supplierGroupId: "116", apiKey: "second", name: "two" }] };
    const distinct = planSupplierAccountImport({ ...supplier, catalog: { groups: [] } }, [], two, encrypt);
    expect(distinct.connections.map(item => item.config.accountKeyGroupId)).toEqual(["115", "116"]);
    expect(new Set(distinct.connections.map(item => item.config.modelGroup)).size).toBe(2);
    expect(distinct.catalog.groups.map(group => group.supplierGroupId)).toEqual(["115", "116"]);
  });

  it.each([undefined, true, false])("controls verification markers only on newly imported Keys: %s", verifyCapabilities => {
    const cleared = connection({ config: { supplierId: "s", supplierSourceId: "source", modelGroup: "B1", usage: "canvas",
      supplierVerificationRequestId: "cleared-key-old-request" } });
    const existing = connection({ id: "kept", encryptedSecret: "keep-key", config: { supplierId: "s", supplierSourceId: "source",
      modelGroup: "B2", usage: "canvas", supplierVerificationRequestId: "existing-key-accepted-request" } });
    const withNewGroup = { ...inventory, keys: [...inventory.keys, { id: "4", group: "B3", apiKey: "new-group-secret", name: "New" }] };
    const before = [cleared, existing];
    const plan = planSupplierAccountImport(supplier, before, withNewGroup, encrypt, before, { verifyCapabilities });
    expect(plan.connections[1]).toEqual(existing);
    for (const imported of [plan.connections[0]!, plan.connections[2]!]) {
      if (verifyCapabilities === false) expect(imported.config).not.toHaveProperty("supplierVerificationRequestId");
      else {
        expect(imported.config.supplierVerificationRequestId).toEqual(expect.any(String));
        expect(imported.config.supplierVerificationRequestId).not.toBe("cleared-key-old-request");
      }
    }
    expect(cleared.config.supplierVerificationRequestId).toBe("cleared-key-old-request");
  });
  it("clears former Key scan evidence when filling a cleared Key while preserving manual models", () => {
    const manualModels = [{ id: "manual", capability: "image", protocol: "openai-images" }];
    const previous = connection({ config: { supplierId: "s", supplierSourceId: "source", modelGroup: "B1", usage: "canvas",
      manualModels, modelScanStatus: "unauthorized", modelScanComplete: true, modelScanError: "Old failure",
      modelScanErrorCode: "invalid_credentials", modelScanHttpStatus: 401, modelScanLastSuccessAt: "old",
      modelScanCheckedAt: "old", modelCatalogModels: [{ id: "old-key-model" }], scannedModelIds: ["old-key-model"],
    } });
    const plan = planSupplierAccountImport(supplier, [previous], inventory, encrypt);
    expect(plan.connections[0]?.config).toMatchObject({ manualModels, modelScanStatus: "unscanned", modelScanComplete: false,
      modelScanError: null, modelScanErrorCode: null, modelScanHttpStatus: null,
      modelScanLastSuccessAt: null, modelScanCheckedAt: null, modelScanAttemptStatus: "unscanned",
      modelCatalogModels: [], scannedModelIds: [],
    });
  });
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
