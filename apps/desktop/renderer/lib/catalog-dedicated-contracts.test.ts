import { describe, expect, it } from "vitest";
import type { ProviderConnectionRecord } from "@super-canvas/db";
import type { ModelDescriptor } from "@super-canvas/providers";
import { collectCatalogDedicatedContracts, normalizeCatalogDedicatedPriceFacts } from "./catalog-dedicated-contracts";
import { catalogConnectionScopes, catalogReadItem } from "./catalog-source-plan";
import { catalogContractSlotKey, emptyCatalogContractState, projectCatalogContractModels, reduceCatalogContracts, validateCatalogContractBundle } from "./catalog-contract-policy";
import type { CatalogReadObservation } from "./catalog-read-contracts";
import { chentuFallbackImageDescriptor } from "./chentu-catalog";
import { reduceCatalogPrices } from "./catalog-price-observations";
import { selectModelQuote } from "@super-canvas/providers/media-billing";
import { mikotoConnectionConfig, mikotoConnectorForGroup, MIKOTO_IMAGE_4K_GROUP, MIKOTO_KLING_GROUP } from "./mikoto-presets";

const checkedAt = "2026-10-17T08:00:00Z", options = { identityEpoch: "epoch", observationCycleId: "cycle" };
const connection = (supplier: "chentu" | "miaowu" = "chentu"): ProviderConnectionRecord => ({ id: "connection", name: "Fixture", encryptedSecret: "fixture-only", createdAt: checkedAt, updatedAt: checkedAt,
  provider: supplier === "chentu" ? "openai" : "rest", config: { baseUrl: supplier === "chentu" ? "https://tu.988236.xyz/v1" : "https://api.miaowuai.store",
    supplierKey: supplier, preset: supplier === "chentu" ? "chentu-openai-images" : "miaowu-openai-videos", modelGroup: "default", accountKeyGroup: "default", accountKeyGroupId: "7", modelScanStatus: "live" } });
function member(value: ProviderConnectionRecord, models: ModelDescriptor[]): CatalogReadObservation {
  const scopes = catalogConnectionScopes(value);
  return { receipt: { spec: catalogReadItem("key-models", `${String(value.config.baseUrl)}/models`, "key-membership", scopes.key, scopes.apply, true),
    context: { ...options, runId: "fixture", dispatchSeq: 1 }, status: "succeeded", complete: true, freshness: "live", checkedAt,
    coverage: { domain: "key-list", exhaustive: true, modelIds: models.map(model => model.id) } }, facts: { models } };
}
function schema(value: ProviderConnectionRecord, id: string, contract: NonNullable<Extract<NonNullable<CatalogReadObservation["facts"]["sourceFacts"]>, { kind: "miaowu-schema" }>["contract"]>): CatalogReadObservation {
  const scopes = catalogConnectionScopes(value);
  return { receipt: { spec: catalogReadItem(`miaowu-schema:${id}`, `https://api.miaowuai.store/v1/dream/model_schema?model=${encodeURIComponent(id)}`,
    "schema", scopes.key, { ...scopes.apply, modelId: id }), context: { ...options, runId: "fixture", dispatchSeq: 2 },
  status: "succeeded", complete: true, freshness: "live", checkedAt }, facts: { models: [], sourceFacts: { kind: "miaowu-schema", contract } } };
}

describe("dedicated schema and native adapter projection", () => {
  it("uses exact current Chentu size facts with its existing image adapter, never a fake Rest route", () => {
    const value = connection(), model = chentuFallbackImageDescriptor("gpt-image-2-4k", "default")!;
    const scopes = catalogConnectionScopes(value), capability: CatalogReadObservation = { receipt: { spec: catalogReadItem("chentu-image-capabilities", "https://tu.988236.xyz/v1/image/model-capabilities", "schema", scopes.key, scopes.apply),
      context: { ...options, runId: "fixture", dispatchSeq: 2 }, status: "succeeded", complete: true, freshness: "live", checkedAt },
    facts: { models: [], sourceFacts: { kind: "chentu-capabilities", capabilities: [{ modelId: model.id, sizes: [{ value: "3840x2160", ratio: "16:9" }] }] } } };
    const result = collectCatalogDedicatedContracts(value, undefined, [model], [member(value, [model]), capability], { ...options, membershipModelIds: [model.id] });
    expect(result.nativeModels).toHaveLength(1); expect(result.contracts).toEqual([]);
    expect(result.models[0]?.parameters?.find(parameter => parameter.key === "size")?.options).toContainEqual({ label: "4K · 16:9 · 3840 × 2160", value: "3840x2160" });
    const projected = projectCatalogContractModels(value, result.models, { catalogContracts: emptyCatalogContractState(), sourceId: scopes.apply.supplierSourceId,
      groupIdentity: scopes.apply.groupIdentity!, nativeModels: result.nativeModels });
    expect(projected.models[0]?.metadata).toMatchObject({ canvasRunnable: true, catalogContractStatus: "native" });
    expect(projected.connector).toBeUndefined();
  });
  it("does not treat capabilities alone, a public row, a sibling Key or a legacy descriptor as native permission", () => {
    const value = connection(), model = chentuFallbackImageDescriptor("gpt-image-2-4k", "default")!, fresh = member(value, [model]);
    for (const input of [[], [{ ...fresh, receipt: { ...fresh.receipt, spec: { ...fresh.receipt.spec, role: "catalog-offer" as const, authScope: { ...fresh.receipt.spec.authScope, kind: "anonymous" as const } } } }],
      [{ ...fresh, receipt: { ...fresh.receipt, spec: { ...fresh.receipt.spec, authScope: { ...fresh.receipt.spec.authScope, principalRef: "other-key" } } } }]]) {
      expect(collectCatalogDedicatedContracts(value, undefined, [model], input, { ...options, membershipModelIds: [model.id] }).nativeModels).toEqual([]);
    }
  });
  it("retains only an accepted exact-scope native marker through unknown reads, and invalidates it on identity or membership change", () => {
    const value = connection(), model = chentuFallbackImageDescriptor("gpt-image-2-4k", "default")!;
    const first = collectCatalogDedicatedContracts(value, undefined, [model], [member(value, [model])], { ...options, membershipModelIds: [model.id] });
    expect(first.nativeModels).toHaveLength(1);
    expect(collectCatalogDedicatedContracts(value, undefined, first.models, [], { ...options, membershipModelIds: [model.id] }).nativeModels).toHaveLength(1);
    expect(collectCatalogDedicatedContracts(value, undefined, first.models, [], { ...options, membershipModelIds: [] }).nativeModels).toEqual([]);
    expect(collectCatalogDedicatedContracts({ ...value, config: { ...value.config, accountKeyGroupId: "changed" } }, undefined,
      first.models, [], { ...options, membershipModelIds: [model.id] }).nativeModels).toEqual([]);
    const rejected = { ...first.models[0]!, metadata: { ...first.models[0]!.metadata, canvasRunnable: false, canvasUnavailableReason: "HTTP 403 权限拒绝" } };
    expect(collectCatalogDedicatedContracts(value, undefined, [rejected], [member(value, [rejected])], { ...options, membershipModelIds: [model.id] }).nativeModels).toEqual([]);
  });
  it("a changed incomplete contract still blocks the native adapter and does not resurrect a saved template", () => {
    const value = connection(), model = chentuFallbackImageDescriptor("gpt-image-2-4k", "default")!, scopes = catalogConnectionScopes(value);
    value.config.connector = { submit: { path: "/private-old" }, output: { kind: "image" } };
    value.config.modelProtocolTemplate = value.config.connector;
    const result = collectCatalogDedicatedContracts(value, undefined, [model], [member(value, [model])], { ...options, membershipModelIds: [model.id] });
    const identity = { origin: "https://tu.988236.xyz", sourceId: scopes.apply.supplierSourceId, groupIdentity: scopes.apply.groupIdentity!, modelId: model.id,
      operation: "image.generate" as const, protocol: "rest", method: "POST", submit: "https://tu.988236.xyz/new-route", schemaFingerprint: "0".repeat(64) };
    const state = emptyCatalogContractState(); state.slots[catalogContractSlotKey(identity)] = { identity, sourceKey: "exact-new-schema", presence: "unknown", checkedAt,
      blocked: true, reason: "incomplete", history: [] };
    expect(projectCatalogContractModels(value, result.models, { catalogContracts: state, sourceId: scopes.apply.supplierSourceId,
      groupIdentity: scopes.apply.groupIdentity!, nativeModels: result.nativeModels }).models[0]?.metadata?.canvasRunnable).toBe(false);
  });
  for (const kind of ["image", "video"] as const) it(`compiles an exact Miaowu ${kind} schema through the existing async adapter and preserves the independent price`, () => {
    const value = connection("miaowu"), id = `fixture-${kind}-complete-id`, model: ModelDescriptor = { id, name: id,
      operations: kind === "image" ? ["image.generate"] : ["video.generate"], inputKinds: ["text"], outputKinds: [kind],
      pricing: { kind: "per-request", currency: "CNY", checkedAt, confidence: "exact", unitAmount: .5 } };
    const contract = kind === "image" ? { modes: ["text-to-image", "image-to-image"] as ("text-to-image" | "image-to-image")[], resolutions: ["1K", "2K"], ratios: ["1:1", "16:9"], maxInputImages: 2 }
      : { durations: [4, 8], resolutions: ["720p"], ratios: ["16:9"], maxInputImages: 2, maxInputVideos: 0, maxInputAudios: 0 };
    const result = collectCatalogDedicatedContracts(value, undefined, [model], [member(value, [model]), schema(value, id, contract)], { ...options, membershipModelIds: [id] });
    expect(result.nativeModels).toEqual([]); expect(result.contracts).toHaveLength(2);
    expect(result.contracts.every(row => !validateCatalogContractBundle(row.identity, row.bundle!).length)).toBe(true);
    expect(result.contracts[0]?.identity.submit).toBe(`https://api.miaowuai.store/v1/${kind === "image" ? "images" : "videos"}`);
    expect(result.models[0]?.pricing).toEqual(model.pricing);
    const scopes = catalogConnectionScopes(value), state = reduceCatalogContracts(emptyCatalogContractState(), result.contracts);
    expect(projectCatalogContractModels(value, result.models, { catalogContracts: state, sourceId: scopes.apply.supplierSourceId, groupIdentity: scopes.apply.groupIdentity! }).models[0]?.metadata?.canvasRunnable).toBe(true);
  });
  it("exposes only an exact group's schema display prices to P4, retaining source, role, cycle and sequence", () => {
    const value = connection("miaowu"), id = "fixture-full-image-id", row = schema(value, id, {
      modes: ["text-to-image"], resolutions: ["1K", "2K"], ratios: ["1:1"], maxInputImages: 0,
      pricingDisplay: { currency: "CNY", groups: { default: { rules: [{ resolution: "1K", price: .4 }, { resolution: "2K", price: .8 }] },
        other: { rules: [{ resolution: "1K", price: .1 }, { resolution: "2K", price: .2 }] } } },
    });
    const normalized = normalizeCatalogDedicatedPriceFacts(value, undefined, [row]);
    expect(normalized[0]?.receipt).toEqual(row.receipt);
    expect(normalized[0]?.facts.models[0]?.pricing?.tiers?.map(tier => tier.price)).toEqual([.4, .8]);
    expect(normalized[0]?.facts.models[0]?.metadata?.catalogPriceOperation).toBe("image.generate");
    expect(normalizeCatalogDedicatedPriceFacts({ ...value, config: { ...value.config, accountKeyGroup: "never-published" } }, undefined, [row])[0]).toBe(row);
    expect(normalizeCatalogDedicatedPriceFacts({ ...value, id: "other-key" }, undefined, [row])[0]).toBe(row);
  });
  it("publishes a fresh Miaowu schema tariff through P4 only for its exact Key, group and declared generation operation", () => {
    const value = connection("miaowu"), id = "fixture-full-image-id", model: ModelDescriptor = { id, name: id, operations: ["image.generate", "image.edit"], outputKinds: ["image"] };
    const row = schema(value, id, { modes: ["text-to-image", "image-to-image"], resolutions: ["1K", "2K"], ratios: ["1:1"], maxInputImages: 2,
      pricingDisplay: { currency: "CNY", groups: { default: { rules: [{ resolution: "1K", price: .4 }, { resolution: "2K", price: .8 }] } } } });
    const reduce = (target: ProviderConnectionRecord) => reduceCatalogPrices(undefined, { connection: target, models: [model],
      observations: normalizeCatalogDedicatedPriceFacts(target, undefined, [row]), identityEpoch: options.identityEpoch, mode: "daily", observedAt: checkedAt });
    const result = reduce(value), published = result.models[0]!;
    expect(result.changes).toMatchObject([{ kind: "price", modelId: id, before: "—" }]);
    expect(selectModelQuote(published, { resolution: "1K" }, { operation: "image.generate" }).amount).toBe(.4);
    expect(published.pricing?.evidence?.operations).toEqual(["image.generate"]);
    expect(selectModelQuote(published, { resolution: "1K" }, { operation: "image.edit" }).estimatePricing).toBeUndefined();
    for (const target of [{ ...value, id: "other-key" }, { ...value, config: { ...value.config, accountKeyGroupId: "different-site-group" } }]) {
      const rejected = reduce(target); expect(rejected.models[0]?.pricing).toBeUndefined(); expect(rejected.changes).toEqual([]);
    }
  });
  it("uses CyberAfei's exact built-in Rest builder without inheriting the saved private override", () => {
    const value: ProviderConnectionRecord = { ...connection(), provider: "rest", config: { baseUrl: "https://api.3365api.cn", supplierKey: "cyberafei", preset: "cyberafei-api",
      modelGroup: "image-2稳定生图", accountKeyGroup: "image-2稳定生图", modelScanStatus: "live", connector: { submit: { path: "/private-old" }, output: { kind: "image" } } } };
    const model: ModelDescriptor = { id: "gpt-image-4K", name: "gpt-image-4K", operations: ["image.generate", "image.edit"], outputKinds: ["image"] };
    const result = collectCatalogDedicatedContracts(value, undefined, [model], [member(value, [model])], { ...options, membershipModelIds: [model.id] });
    expect(result.nativeModels).toHaveLength(1); expect(result.nativeBindings).toHaveLength(2);
    expect(result.contracts).toEqual([]);
    const scopes = catalogConnectionScopes(value), projected = projectCatalogContractModels(value, result.models, { catalogContracts: emptyCatalogContractState(),
      sourceId: scopes.apply.supplierSourceId, groupIdentity: scopes.apply.groupIdentity!, nativeModels: result.nativeModels, nativeBindings: result.nativeBindings });
    expect(projected.models[0]?.metadata?.canvasRunnable).toBe(true);
    expect(JSON.stringify(projected.connector)).not.toContain("private-old");
    expect(projected.connector?.models?.map(row => row.id)).toEqual([model.id]);
  });
  for (const group of [MIKOTO_IMAGE_4K_GROUP, MIKOTO_KLING_GROUP] as const) it(`retains Mikoto's exact ${group} Rest contract without borrowing another model or group`, () => {
    const value: ProviderConnectionRecord = { ...connection(), provider: "rest", config: mikotoConnectionConfig(group) }, configured = mikotoConnectorForGroup(group).models![0]!;
    const model = { ...configured, pricing: undefined, metadata: { ...configured.metadata, priceLabel: undefined } };
    const result = collectCatalogDedicatedContracts(value, undefined, [model], [member(value, [model])], { ...options, membershipModelIds: [model.id] });
    expect(result.nativeModels).toHaveLength(1); expect(result.nativeBindings).toHaveLength(model.operations.length);
    const scopes = catalogConnectionScopes(value), projected = projectCatalogContractModels(value, result.models, { catalogContracts: emptyCatalogContractState(),
      sourceId: scopes.apply.supplierSourceId, groupIdentity: scopes.apply.groupIdentity!, nativeModels: result.nativeModels, nativeBindings: result.nativeBindings });
    expect(projected.models[0]?.metadata?.canvasRunnable).toBe(true);
    expect(projected.models[0]?.pricing).toBeUndefined();
    const unknown = { ...model, id: `${model.id}-private-unknown` };
    expect(collectCatalogDedicatedContracts(value, undefined, [unknown], [member(value, [unknown])], { ...options, membershipModelIds: [unknown.id] }).nativeModels).toEqual([]);
  });
  it("retains Chentu's exact built-in Rest video contract, while unknown sibling IDs stay pending", () => {
    const value = { ...connection(), provider: "rest" }, model: ModelDescriptor = { id: "seedance-2.0-720p", name: "Video", operations: ["video.generate"], outputKinds: ["video"] };
    const result = collectCatalogDedicatedContracts(value, undefined, [model], [member(value, [model])], { ...options, membershipModelIds: [model.id] });
    expect(result.nativeModels).toHaveLength(1); expect(result.nativeBindings).toEqual([]);
    const scopes = catalogConnectionScopes(value), projected = projectCatalogContractModels(value, result.models, { catalogContracts: emptyCatalogContractState(),
      sourceId: scopes.apply.supplierSourceId, groupIdentity: scopes.apply.groupIdentity!, nativeModels: result.nativeModels, nativeBindings: result.nativeBindings });
    expect(projected.models[0]?.metadata?.canvasRunnable).toBe(true);
    expect(projected.models[0]?.metadata?.catalogContractStatus).toBe("native");
    const unknown = { ...model, id: "seedance-2.0-private-unlisted" };
    expect(collectCatalogDedicatedContracts(value, undefined, [unknown], [member(value, [unknown])], { ...options, membershipModelIds: [unknown.id] }).nativeModels).toEqual([]);
  });
});
