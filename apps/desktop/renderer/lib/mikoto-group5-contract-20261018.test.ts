import { describe, expect, it } from "vitest";
import type { ProviderConnectionRecord } from "@super-canvas/db";
import type { ModelDescriptor } from "@super-canvas/providers";
import { collectCatalogDedicatedContracts } from "./catalog-dedicated-contracts";
import { catalogConnectionScopes, catalogReadItem } from "./catalog-source-plan";
import { emptyCatalogContractState, projectCatalogContractModels } from "./catalog-contract-policy";
import type { CatalogReadObservation } from "./catalog-read-contracts";
import { MIKOTO_IMAGE_1K_GROUP, mikotoConnectionConfig } from "./mikoto-presets";

const checkedAt = "2026-10-18T00:28:00Z", options = { identityEpoch: "fixture-epoch", observationCycleId: "fixture-cycle" };
function fixture(id: string, stableId = "5", name = MIKOTO_IMAGE_1K_GROUP) {
  const connection: ProviderConnectionRecord = { id: "mikoto-g5-isolated", name: "Mikoto", provider: "rest", encryptedSecret: "opaque-fixture",
    createdAt: checkedAt, updatedAt: checkedAt, config: { ...mikotoConnectionConfig(MIKOTO_IMAGE_1K_GROUP), accountKeyGroupId: stableId,
      accountKeyGroup: name, modelGroup: name, modelScanStatus: "live", scannedModelIds: [id] } };
  const model: ModelDescriptor = { id, name: id, operations: ["image.generate", "image.edit"], inputKinds: ["text", "image"], outputKinds: ["image"],
    pricing: { kind: "per-image", currency: "USD", unitAmount: .02, confidence: "exact", checkedAt },
    metadata: { catalogContractPolicy: 1, catalogContractStatus: "pending", canvasRunnable: false,
      canvasUnavailableReason: "当前调用契约尚未完整读取；上次契约仅供历史查看", supplierPriceGroupId: "5" } };
  const scopes = catalogConnectionScopes(connection);
  const member: CatalogReadObservation = { receipt: { spec: catalogReadItem("key-models", "https://api.mikoto.vip/v1/models", "key-membership", scopes.key, scopes.apply, true),
    context: { ...options, runId: "offline", dispatchSeq: 1 }, status: "succeeded", complete: true, freshness: "live", checkedAt,
    coverage: { domain: "key-list", exhaustive: true, modelIds: [id] } }, facts: { models: [model] } };
  return { connection, model, member, scopes };
}

describe("Mikoto stable group5 owns separate documented Flare and Sunburst contracts", () => {
  it.each(["gpt-image-2.5-flare", "gpt-image-2.5-sunburst"])("rebuilds %s pending contract only after exact current Key membership", id => {
    const f = fixture(id), before = structuredClone(f.connection);
    const result = collectCatalogDedicatedContracts(f.connection, undefined, [f.model], [f.member], { ...options, membershipModelIds: [id] });
    expect(result.nativeModels).toHaveLength(1); expect(result.nativeBindings).toHaveLength(2);
    const projected = projectCatalogContractModels(f.connection, result.models, { catalogContracts: emptyCatalogContractState(),
      sourceId: f.scopes.apply.supplierSourceId, groupIdentity: f.scopes.apply.groupIdentity!, nativeModels: result.nativeModels, nativeBindings: result.nativeBindings });
    expect(projected.models[0]?.metadata).toMatchObject({ canvasRunnable: true, catalogContractStatus: "native",
      imageReferenceContractCaseId: id.endsWith("flare") ? "H091" : "H092" });
    expect(projected.models[0]?.pricing).toEqual(f.model.pricing);
    const edit = result.nativeBindings.find(row => row.identity.operation === "image.edit")!;
    expect(edit.bundle?.connector.submit).toMatchObject({ path: "/v1/images/edits/async", bodyMode: "multipart" });
    expect(edit.bundle?.connector.poll?.path).toBe("/v1/images/tasks/{taskId}");
    expect(edit.bundle?.connector.output.path).toBe("$.result.data");
    expect(collectCatalogDedicatedContracts(f.connection, undefined, [f.model], [], { ...options, membershipModelIds: [id] }).nativeModels).toEqual([]);
    expect(f.connection).toEqual(before);
  });
  it("uses stable5 through a group rename but does not lend its contract to another stable group or unknown fullID", () => {
    const f = fixture("gpt-image-2.5-sunburst", "5", "renamed-5");
    expect(collectCatalogDedicatedContracts(f.connection, undefined, [f.model], [f.member], { ...options, membershipModelIds: [f.model.id] }).nativeModels).toHaveLength(1);
    for (const test of [fixture("gpt-image-2.5-sunburst", "16"), fixture("gpt-image-2.5-sunburst-private", "5")])
      expect(collectCatalogDedicatedContracts(test.connection, undefined, [test.model], [test.member], { ...options, membershipModelIds: [test.model.id] }).nativeModels).toEqual([]);
  });
  it("retains a real Key denial instead of replacing it with the built-in contract", () => {
    const f = fixture("gpt-image-2.5-sunburst"), denied = { ...f.model, metadata: { ...f.model.metadata, canvasUnavailableReason: "HTTP403 当前Key没有权限" } };
    expect(collectCatalogDedicatedContracts(f.connection, undefined, [denied], [{ ...f.member, facts: { models: [denied] } }],
      { ...options, membershipModelIds: [denied.id] }).nativeModels).toEqual([]);
  });
});
