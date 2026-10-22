import { expect, it } from "vitest";
import type { ProviderConnectionRecord, SupplierRecord } from "@super-canvas/db";
import { reconcileSupplierGroupNames } from "./supplier-group-reconciliation";

const supplier = { id: "supplier", state: { sourceId: "current-source" } } as SupplierRecord;
const connection: ProviderConnectionRecord = { id: "keep-id", name: "User title", provider: "openai", encryptedSecret: "keep-ciphertext",
  createdAt: "before", updatedAt: "before", config: { supplierId: "supplier", supplierSourceId: "current-source", accountKeyId: "12",
    accountKeyGroupId: "99", accountKeyGroup: "old", modelGroup: "old", usage: "canvas", parameters: { quality: "high" } } };
const fresh = { id: "current", label: "Current display", supplierGroupId: "99", source: "catalog" as const, models: [] };

it("uses only a unique fresh stable-ID group on the same source and keeps ciphertext, references and saved parameters", () => {
  const before = structuredClone(connection);
  expect(reconcileSupplierGroupNames(supplier, [connection], [fresh])[0]).toEqual({ ...connection,
    config: { ...connection.config, accountKeyGroup: "current", modelGroup: "current" } });
  expect(connection).toEqual(before);
  for (const group of [{ ...fresh, supplierGroupId: "100" }, { ...fresh, supplierGroupId: undefined },
    { ...fresh, source: "manual" as const }, { ...fresh, details: { source: "key-groups" as const, stale: true } },
    { ...fresh, status: "missing" as const }]) expect(reconcileSupplierGroupNames(supplier, [connection], [group])[0]).toBe(connection);
  expect(reconcileSupplierGroupNames(supplier, [connection], [fresh, { ...fresh, id: "ambiguous" }])[0]).toBe(connection);
  for (const config of [{ supplierSourceId: "old-source" }, { supplierArchived: true }, { supplierId: "other" },
    { usage: "disabled" }, { modelGroup: "user-edited-group" }]) {
    const changed = { ...connection, config: { ...connection.config, ...config } };
    expect(reconcileSupplierGroupNames(supplier, [changed], [fresh])[0]).toBe(changed);
  }
  const concurrent = { ...connection, config: { ...connection.config, accountKeyGroup: "changed", modelGroup: "changed" } };
  expect(reconcileSupplierGroupNames(supplier, [concurrent], [fresh], [connection])[0]).toBe(concurrent);
});
