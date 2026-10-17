import { describe, expect, it } from "vitest";
import type { ProviderConnectionRecord, SupplierRecord } from "@super-canvas/db";
import { catalogSourcePlan } from "./catalog-source-plan";

const supplier: SupplierRecord = { id: "synthetic-supplier", supplierKey: "synthetic", name: "Synthetic",
  siteUrl: "https://catalog.test", apiUrl: "https://catalog.test/v1", kind: "sub2api", catalog: { groups: [] },
  scanStatus: "unscanned", createdAt: "2026-10-17T00:00:00Z", updatedAt: "2026-10-17T00:00:00Z",
  state: { version: 1, revision: 1, visibility: "visible", fingerprint: "fixture-fingerprint", history: [], sourceId: "fixture-source" } };
const connection = (id: string, group: string): ProviderConnectionRecord => ({ id, provider: "openai", name: id,
  encryptedSecret: `synthetic-ciphertext-${id}`, config: { supplierId: supplier.id, supplierSourceId: supplier.state!.sourceId,
    baseUrl: supplier.apiUrl, accountKeyGroupId: group }, createdAt: supplier.createdAt, updatedAt: supplier.updatedAt });

describe("catalog read-plan sharing and scope", () => {
  it("shares a whole public/account read across apply groups while Key identities remain independent", () => {
    const first = catalogSourcePlan(connection("a", "7"), supplier), second = catalogSourcePlan(connection("b", "9"), supplier);
    for (const id of ["supplier:plaza:anonymous", "supplier:sub2api-groups:site-account", "supplier:pricing-channels:site-account"]) {
      const left = first.find(spec => spec.entryId === id)!, right = second.find(spec => spec.entryId === id)!;
      expect(left.sourceKey).toBe(right.sourceKey);
      expect(left.applyScope.connectionIds).toEqual(["a"]); expect(right.applyScope.connectionIds).toEqual(["b"]);
      expect(left.applyScope.groupIdentity).toBe("site-id:7"); expect(right.applyScope.groupIdentity).toBe("site-id:9");
      expect(left.requiredForMembership).toBe(false);
    }
    expect(first[0]!.sourceKey).not.toBe(second[0]!.sourceKey);
  });
  it("does not share observations after source, key or group identity changes", () => {
    const original = connection("a", "7"), before = catalogSourcePlan(original, supplier)[0]!;
    for (const changed of [{ ...original, encryptedSecret: "rotated-fixture-ciphertext" },
      { ...original, config: { ...original.config, accountKeyGroupId: "8" } },
      { ...original, config: { ...original.config, baseUrl: "https://other.test/v1" } }])
      expect(catalogSourcePlan(changed, supplier)[0]!.sourceKey).not.toBe(before.sourceKey);
    expect(catalogSourcePlan(original, { ...supplier, state: { ...supplier.state!, sourceId: "changed-source" } })[0]!.sourceKey).not.toBe(before.sourceKey);
  });
  it("keeps same-named numeric and name-only groups in different namespaces", () => {
    const numeric = connection("same", "7"), named = { ...numeric, config: { baseUrl: supplier.apiUrl, accountKeyGroup: "7" } };
    expect(catalogSourcePlan(numeric)[0]!.applyScope.groupIdentity).toBe("site-id:7");
    expect(catalogSourcePlan(named)[0]!.applyScope.groupIdentity).toBe("name:7");
    expect(catalogSourcePlan(numeric)[0]!.sourceKey).not.toBe(catalogSourcePlan(named)[0]!.sourceKey);
  });
});
