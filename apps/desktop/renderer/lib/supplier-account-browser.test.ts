import { describe, expect, it } from "vitest";
import type { ProviderConnectionView } from "./client-api";
import type { SupplierRecord } from "./client-suppliers";
import { newSupplierAccountDraft, supplierAccountLabel, supplierAccountMatches, supplierAccountRows } from "./supplier-account-browser";

const supplier = (id: string, username: string): SupplierRecord => ({
  id, name: "同一供应商", supplierKey: "same", kind: "newapi", siteUrl: "https://example.invalid", apiUrl: "https://api.example.invalid/v1",
  siteLogin: { configured: true, username }, catalog: { groups: [] }, scanStatus: "live", createdAt: "", updatedAt: "",
});
const connection = (id: string, supplierId: string, status = "live"): ProviderConnectionView => ({
  id, name: "工作创作组", provider: "openai", apiKey: "must-not-be-searchable", apiKeySet: true,
  config: { supplierId, supplierKey: "same", baseUrl: "https://api.example.invalid/v1", modelScanStatus: status },
});

describe("supplier account browser", () => {
  it("searches account identity and connection labels without merging same-site accounts or exposing credentials", () => {
    const a = supplier("a", "alice@example.invalid"), b = supplier("b", "bob@example.invalid");
    const rows = supplierAccountRows([a, b].map(record => ({ ...record, record })), [connection("a-key", "a"), connection("b-key", "b", "failed")]);
    expect(rows.map(row => row.connectionCount)).toEqual([1, 1]);
    expect(rows.filter(row => supplierAccountMatches(row, " Alice 工作 ", "all")).map(row => row.entry.id)).toEqual(["a"]);
    expect(rows.filter(row => supplierAccountMatches(row, "", "attention")).map(row => row.entry.id)).toEqual(["b"]);
    expect(rows.every(row => !supplierAccountMatches(row, "must-not-be-searchable", "all"))).toBe(true);
    expect(supplierAccountLabel({ ...a, siteLogin: { configured: true, authMode: "access-token", userId: "007" } })).toBe("用户 ID · 007");
  });

  it("keeps a failed empty inventory visible as needing attention and distinguishes templates from saved accounts", () => {
    const record = supplier("a", "alice");
    const failed = connection("a-key", "a", "empty");
    failed.config.modelScanAttemptStatus = "failed";
    const rows = supplierAccountRows([{ ...record, record }, { id: "template:b", name: "模板", supplierKey: "b", siteUrl: "", apiUrl: "" }], [failed]);
    expect(supplierAccountMatches(rows[0]!, "", "attention")).toBe(true);
    expect(supplierAccountMatches(rows[0]!, "", "saved")).toBe(true);
    expect(supplierAccountMatches(rows[1]!, "", "saved")).toBe(false);
    expect(supplierAccountMatches(rows[1]!, "", "unconfigured")).toBe(true);
  });

  it("prepares an independent account using an explicit allowlist of non-secret defaults", () => {
    const record = supplier("a", "alice");
    const draft = newSupplierAccountDraft({ ...record, record });
    expect(draft).toEqual({ name: "同一供应商 · 新账号", supplierKey: "same", siteUrl: record.siteUrl, apiUrl: record.apiUrl, kind: "newapi" });
    expect(Object.keys(draft)).toHaveLength(5);
    expect(JSON.stringify(draft)).not.toContain("alice");
    expect(record.name).toBe("同一供应商");
  });

  it("never lends an unbound legacy Key to same-site accounts; only its exact API-projected identity owns it", () => {
    const a = supplier("a", "alice"), b = supplier("b", "bob"), legacy = supplier("supplier-legacy-derived-id", "");
    const oldKey = connection("old-key", "", "failed");
    delete oldKey.config.supplierId;
    const entries = [a, b, legacy].map(record => ({ ...record, record }));
    const unboundRows = supplierAccountRows(entries, [oldKey]);
    expect(unboundRows.map(row => row.connectionCount)).toEqual([0, 0, 0]);
    expect(unboundRows.every(row => !row.needsAttention && !supplierAccountMatches(row, "工作创作组", "all"))).toBe(true);
    const projectedKey = { ...oldKey, config: { ...oldKey.config, supplierId: legacy.id } };
    const rows = supplierAccountRows(entries, [projectedKey]);
    expect(rows.map(row => row.connectionCount)).toEqual([0, 0, 1]);
    expect(rows.map(row => row.needsAttention)).toEqual([false, false, true]);
    expect(rows.filter(row => supplierAccountMatches(row, "工作创作组", "all")).map(row => row.entry.id)).toEqual([legacy.id]);
    expect(oldKey.config).not.toHaveProperty("supplierId");
  });
});
