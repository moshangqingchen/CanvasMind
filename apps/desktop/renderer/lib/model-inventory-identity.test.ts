import { describe, expect, it } from "vitest";
import { requiresAuthoritativeModelScan } from "./model-inventory-identity";
import { CHENTU_PRESET_ID } from "./chentu-presets";
import { FRIMODEL_PRESET_ID } from "./frimodel-presets";

describe("model inventory identity", () => {
  it("retains manual connector behavior when GET only projects its legacy account label", () => {
    const manual = { provider: "rest", config: { connector: { models: [{ id: "manual", limits: { maxInputVideos: 0 } }] } } };
    expect(requiresAuthoritativeModelScan(manual)).toBe(false);
    expect(requiresAuthoritativeModelScan({ ...manual, config: { ...manual.config, supplierId: "legacy-projection" }, supplierIdentityProjected: true })).toBe(false);
    expect(requiresAuthoritativeModelScan({ ...manual, config: { ...manual.config, supplierId: "saved-account" } })).toBe(true);
  });
  it("keeps CLI, verified WeAI and dedicated preset scans authoritative even with a projected account label", () => {
    const projected = { provider: "rest", config: { supplierId: "legacy-projection" }, supplierIdentityProjected: true as const };
    expect(requiresAuthoritativeModelScan({ ...projected, provider: "cli" })).toBe(true);
    expect(requiresAuthoritativeModelScan(projected, true)).toBe(true);
    for (const preset of ["cyberafei-api", CHENTU_PRESET_ID, FRIMODEL_PRESET_ID])
      expect(requiresAuthoritativeModelScan({ ...projected, config: { ...projected.config, preset } })).toBe(true);
  });
});
