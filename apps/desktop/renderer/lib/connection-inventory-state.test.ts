import { describe, expect, it } from "vitest";
import type { JsonObject, ProviderConnectionRecord } from "@super-canvas/db";
import { reconcileConnectionInventory, resetConnectionInventory } from "./connection-inventory-state";

const saved: ProviderConnectionRecord = {
  id: "connection", provider: "openai", name: "Account", createdAt: "before", updatedAt: "before",
  encryptedSecret: "encrypted-fixture", config: {
    supplierId: "account-one", supplierSourceId: "source-one", baseUrl: "https://example.test/v1",
    accountKeyGroupId: "10", accountKeyId: "100", modelGroup: "images", customGroup: true,
    modelScanStatus: "live", modelScanAttemptStatus: "live", modelScanComplete: true,
    modelScanCheckedAt: "before", modelScanError: null, modelScanHttpStatus: null,
    modelCatalogModels: [{ id: "image-model" }], autoModelInterfaces: { "image-model": { path: "/draw" } },
    emptyScanConfirmations: 1, emptyScanScope: "previous-key", modelAddedIds: ["image-model"],
    defaultModel: "image-model", defaultParameters: { quality: "high", resolution: "4K" },
  },
};

describe("connection inventory ownership", () => {
  it.each([
    { supplierId: "account-two" }, { supplierSourceId: "source-two" }, { accountKeyGroupId: "11" },
    { accountKeyId: "101" }, { modelGroup: "video" }, { customGroup: false },
    { protocol: "responses" }, { preset: "another-preset" },
  ])("resets every scan observation when its identity changes: %j", change => {
    const input = { ...saved.config, ...change };
    const before = structuredClone(input);
    const result = reconcileConnectionInventory(input, saved, saved.provider, false);
    expect(result.identityChanged).toBe(true);
    expect(result.config).toMatchObject({ modelScanStatus: "unscanned", modelScanComplete: false,
      modelCatalogSource: "unverified", defaultModel: "image-model", defaultParameters: saved.config.defaultParameters });
    for (const field of ["modelScanCheckedAt", "modelScanError", "modelScanHttpStatus", "modelCatalogModels",
      "autoModelInterfaces", "emptyScanConfirmations", "emptyScanScope", "modelAddedIds"])
      expect(result.config).not.toHaveProperty(field);
    expect(input).toEqual(before);
  });
  it("takes all confirmation and failure fields from the server on ordinary settings saves", () => {
    const config: JsonObject = { ...saved.config, defaultModel: "user-choice", modelScanComplete: false,
      modelScanError: "browser-error", modelScanHttpStatus: 401, modelScanUpstreamErrorCode: "invented",
      emptyScanConfirmations: 2, modelAddedIds: ["injected"], modelCatalogModels: [] };
    const result = reconcileConnectionInventory(config, saved, saved.provider, false);
    expect(result.identityChanged).toBe(false);
    expect(result.config).toEqual({ ...saved.config, defaultModel: "user-choice" });
  });
  it("never carries an old Key's successful or empty confirmation into a new Key", () => {
    const result = reconcileConnectionInventory(saved.config, saved, saved.provider, true);
    expect(result.identityChanged).toBe(true);
    expect(result.config).toEqual(resetConnectionInventory(saved.config));
  });
});
