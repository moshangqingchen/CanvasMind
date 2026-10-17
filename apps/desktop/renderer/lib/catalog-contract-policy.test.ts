import { describe, expect, it, vi } from "vitest";
import { GenericRestAdapter, StaticConnectionResolver, type DocumentedModelInterface, type ModelDescriptor } from "@super-canvas/providers";
import { catalogContractEndpoint, catalogContractFromDocumented, catalogContractSchemaFingerprint, catalogContractSlotKey,
  emptyCatalogContractState, reduceCatalogContract, validateCatalogContractBundle, applyCatalogContractDiagnostics, catalogContractParameterFingerprint,
  type CatalogContractObservation, type CatalogContractState, type CatalogContractScope } from "./catalog-contract-policy";
import { bindScannedModelProtocols } from "./scanned-model-protocols";
import { applySavedModelInterfaces, discoverSupplierModelInterfaces } from "./supplier-interface-discovery";
import { savedModelAvailabilityError } from "./model-availability";

const scope: CatalogContractScope = { origin: "https://fixture.invalid", sourceId: "supplier-origin-1", groupIdentity: "site-id:7",
  modelId: "image-exact/v2", operation: "image.generate" };
const model: ModelDescriptor = { id: scope.modelId, name: scope.modelId, operations: ["image.generate"], inputKinds: ["text"], outputKinds: ["image"],
  parameters: [{ key: "quality", label: "质量", control: "select", default: "high", options: [{ label: "高", value: "high" }] }],
  limits: { maxInputImages: 0 } };
function binding(path = "/v1/images/generations"): DocumentedModelInterface {
  return { sourceUrl: "https://fixture.invalid/docs.json", model: structuredClone(model), connector: { auth: { type: "bearer" },
    submit: { method: "POST", path, bodyMode: "json", mappings: [
      { target: "/model", source: { kind: "request", path: "$.model" } },
      { target: "/prompt", source: { kind: "request", path: "$.prompt" } },
      { target: "/quality", source: { kind: "request", path: "$.parameters.quality" }, omitIfUndefined: true },
    ] }, output: { kind: "image", path: "$.data", urlPath: "$.url" } } };
}
function observation(path?: string): CatalogContractObservation {
  return { ...catalogContractFromDocumented(scope, "documented-rest", binding(path)), sourceKey: "source-a", owner: "automatic",
    presence: "present", complete: true, checkedAt: path ? "2026-10-17T00:01:00Z" : "2026-10-17T00:00:00Z" };
}
const connection = () => ({ provider: "rest", config: { baseUrl: "https://fixture.invalid/v1", modelScanStatus: "live", scannedModelIds: [scope.modelId],
  connector: binding("/legacy-submit").connector, modelProtocolTemplate: binding("/legacy-template").connector,
  autoModelInterfaces: { [scope.modelId]: binding("/saved-interface") }, defaultModel: scope.modelId, userParameters: { size: "3840x2160", quality: "max" } } });
const project = (state: CatalogContractState, models = [model]) => bindScannedModelProtocols(connection(), models, connection(), {
  catalogContracts: state, sourceId: scope.sourceId, groupIdentity: scope.groupIdentity });

describe("catalog contract evidence and identity", () => {
  it("does not let an automatic public contract authorize a legacy display-only model without Key membership evidence", () => {
    const state = reduceCatalogContract(emptyCatalogContractState(), observation());
    const projection = project(state, [{ ...model, metadata: { catalogMembershipVerified: false } }]);
    expect(projection.models[0]?.metadata?.canvasRunnable).toBe(false);
    expect(projection.models[0]?.metadata?.canvasUnavailableReason).toContain("成员证据");
    expect(projection.connector?.models).toEqual([]);
  });
  it("binds exact origin, source, stable group, full model, operation and normalized wire schema", () => {
    const a = observation(), b = observation();
    expect(a.identity).toEqual(b.identity);
    for (const patch of [{ sourceId: "other" }, { groupIdentity: "name:7" }, { modelId: "image-exact" }, { operation: "image.edit" as const }])
      expect(catalogContractSlotKey({ ...a.identity, ...patch })).not.toBe(catalogContractSlotKey(a.identity));
    const translated = binding(); translated.model.name = "翻译标题"; translated.model.parameters = translated.model.parameters?.map(p => ({ ...p, label: "English", description: "changed" }));
    expect(catalogContractFromDocumented(scope, "documented-rest", translated).identity.schemaFingerprint).toBe(a.identity.schemaFingerprint);
    const changed = binding(); changed.model.parameters = changed.model.parameters?.map(p => ({ ...p, default: "low", options: [{ label: "低", value: "low" }] }));
    expect(catalogContractFromDocumented(scope, "documented-rest", changed).identity.schemaFingerprint).not.toBe(a.identity.schemaFingerprint);
    expect(catalogContractFromDocumented(scope, "documented-rest", binding("/v2/submit")).identity.submit).not.toBe(a.identity.submit);
  });
  it("rejects unsafe endpoints rather than normalizing another origin or credentials", () => {
    for (const path of ["https://other.invalid/submit", "//other.invalid/s", "/submit?api_key=secret", "/../submit", "/%2e%2e/submit", "/s#hash", "https://u:p@fixture.invalid/submit"])
      expect(() => catalogContractEndpoint(scope.origin, path)).toThrow();
    expect(catalogContractEndpoint(scope.origin, "/jobs/{taskId}")).toBe("https://fixture.invalid/jobs/{taskId}");
  });
  it("resolves operation and model overrides before fingerprinting; no sibling override survives", () => {
    const value = binding();
    value.connector.operationOverrides = { "image.generate": { submit: { path: "/op", method: "POST" } } };
    value.connector.modelOverrides = { [model.id]: { submit: { path: "/exact", method: "POST" }, operationOverrides: { "image.generate": { submit: { ...value.connector.submit, path: "/exact-op", method: "POST" } } } }, sibling: { submit: { path: "/wrong" } } };
    const normalized = catalogContractFromDocumented(scope, "documented-rest", value);
    expect(normalized.identity.submit).toBe("https://fixture.invalid/exact-op");
    expect(normalized.bundle.connector.modelOverrides).toBeUndefined();
    expect(normalized.bundle.connector.operationOverrides).toBeUndefined();
  });
  it("validates enum, default, dependency, required mapping and asynchronous lifecycle as one bundle", () => {
    const value = observation();
    for (const mutate of [
      (b: NonNullable<typeof value.bundle>) => { b.model.parameters = [{ key: "q", label: "Q", control: "select", default: "bad", options: [{ label: "ok", value: "ok" }] }]; },
      (b: NonNullable<typeof value.bundle>) => { b.model.parameters = [{ key: "q", label: "Q", control: "number", required: true }]; },
      (b: NonNullable<typeof value.bundle>) => { b.model.parameters = [{ key: "q", label: "Q", control: "number", visibleWhen: [{ parameter: "absent", values: [1] }] }]; },
      (b: NonNullable<typeof value.bundle>) => { b.connector.submit.response = { taskIdPath: "$.id" }; },
      (b: NonNullable<typeof value.bundle>) => { b.connector.poll = { path: "/poll/{taskId}" }; },
      (b: NonNullable<typeof value.bundle>) => { b.connector.output = { kind: "image", path: "$.data" }; },
      (b: NonNullable<typeof value.bundle>) => { b.connector.submit.mappings = []; },
      (b: NonNullable<typeof value.bundle>) => { b.connector.output.kind = "video"; },
    ]) {
      const bundle = structuredClone(value.bundle!); mutate(bundle);
      expect(validateCatalogContractBundle({ ...value.identity, schemaFingerprint: catalogContractSchemaFingerprint(bundle) }, bundle).length).toBeGreaterThan(0);
    }
  });
});

describe("catalog contract reduction and effective inheritance", () => {
  it("keeps compatible accepted fields on unknown/partial read without mutating inputs or prices", () => {
    const initial = emptyCatalogContractState(), accepted = observation();
    const old = reduceCatalogContract(initial, accepted);
    const next = reduceCatalogContract(old, { ...accepted, presence: "unknown", complete: false, bundle: undefined });
    expect(initial.slots).toEqual({});
    expect(next.slots[catalogContractSlotKey(scope)]?.accepted).toEqual(old.slots[catalogContractSlotKey(scope)]?.accepted);
    expect(project(next).connector?.modelOverrides?.[model.id]?.submit?.path).toBe("/v1/images/generations");
    const priced: ModelDescriptor = { ...model, pricing: { kind: "per-image", currency: "CNY", unitAmount: .1, checkedAt: "old-time", confidence: "exact" },
      metadata: { priceStatus: "partial", measuredPrice: "unchanged" } };
    expect(project(next, [priced]).models[0]?.pricing).toEqual(priced.pricing);
    expect(project(next, [priced]).models[0]?.metadata).toMatchObject(priced.metadata!);
  });
  it("archives the old descriptor and blocks changed incomplete contracts through every old enrichment path", async () => {
    const accepted = reduceCatalogContract(emptyCatalogContractState(), observation());
    const changed = observation("/v2/generate");
    const pending = reduceCatalogContract(accepted, { ...changed, complete: false, bundle: undefined });
    const slot = pending.slots[catalogContractSlotKey(scope)]!;
    expect(slot.history[0]?.bundle.connector.submit.path).toBe("/v1/images/generations");
    expect(slot.accepted).toBeUndefined();
    const before = connection(), snapshot = structuredClone(before);
    const blocked = bindScannedModelProtocols(before, [model], before, { catalogContracts: pending, sourceId: scope.sourceId, groupIdentity: scope.groupIdentity });
    expect(blocked.models[0]?.metadata?.canvasRunnable).toBe(false);
    expect(blocked.connector?.restrictModels).toBe(true);
    expect(blocked.connector?.models).toEqual([]);
    const reread = bindScannedModelProtocols(before, blocked.models);
    expect(reread.models[0]?.metadata?.canvasRunnable).toBe(false);
    expect(reread.connector?.models).toEqual([]);
    expect(reread.connector?.modelOverrides).toEqual({});
    expect(applySavedModelInterfaces(before, reread.models)[0]?.metadata?.canvasRunnable).toBe(false);
    const read = vi.fn(async () => []);
    const discovered = await discoverSupplierModelInterfaces(before, reread.models, before, read);
    expect(read).not.toHaveBeenCalled();
    expect(discovered.bindings).toEqual({});
    expect(discovered.models[0]?.metadata?.canvasRunnable).toBe(false);
    expect(savedModelAvailabilityError({ ...before.config, modelCatalogModels: blocked.models }, model.id)).toContain("调用契约");
    const fetcher = vi.fn<typeof fetch>();
    const adapter = new GenericRestAdapter(new StaticConnectionResolver([{ id: "fixture", provider: "rest", apiKey: "synthetic-key", baseUrl: scope.origin,
      settings: { ...before.config, connector: reread.connector, modelCatalogModels: reread.models } }]), { fetch: fetcher });
    const validation = await adapter.validate({ connectionId: "fixture", model: model.id, operation: "image.generate", prompt: "fixture", idempotencyKey: "no-submit" });
    expect(validation.valid).toBe(false);
    expect(validation.issues.some(issue => issue.code === "unsupported_model")).toBe(true);
    expect(fetcher).not.toHaveBeenCalled();
    expect(before).toEqual(snapshot);
  });
  it("only binds a complete new contract and never reuses a legacy submit mapping", async () => {
    const first = reduceCatalogContract(emptyCatalogContractState(), observation());
    const changed = observation("/v2/generate");
    const next = reduceCatalogContract(first, changed), current = project(next);
    expect(current.connector?.modelOverrides?.[model.id]?.submit?.path).toBe("/v2/generate");
    expect(current.models[0]?.metadata?.canvasRunnable).toBe(true);
    const restored = bindScannedModelProtocols({ ...connection(), config: { ...connection().config, connector: current.connector } }, current.models);
    expect(restored.connector?.modelOverrides?.[model.id]?.submit?.path).toBe("/v2/generate");
    const fetcher = vi.fn<typeof fetch>();
    const adapter = new GenericRestAdapter(new StaticConnectionResolver([{ id: "fixture", provider: "rest", apiKey: "synthetic-key", baseUrl: scope.origin,
      settings: { ...connection().config, connector: current.connector } }]), { fetch: fetcher });
    const validation = await adapter.validate({ connectionId: "fixture", model: model.id, operation: "image.generate", prompt: "fixture", idempotencyKey: "no-submit", parameters: { quality: "high" } });
    expect(validation.valid).toBe(true); expect(fetcher).not.toHaveBeenCalled();
  });
  it("keeps manual and paid-test owners from automatic writes; app presets cannot grant a contract", () => {
    for (const owner of ["manual", "paid-test"] as const) {
      const accepted = reduceCatalogContract(emptyCatalogContractState(), { ...observation(), owner });
      const changed = reduceCatalogContract(accepted, { ...observation("/auto-new"), presence: "explicit-remove" });
      expect(changed).toEqual(accepted);
    }
    expect(reduceCatalogContract(emptyCatalogContractState(), { ...observation(), owner: "app-preset" }).slots).toEqual({});
    for (const metadata of [{ source: "manual" }, { source: "paid-test" }, { protocolEvidence: "paid-test" }]) {
      const result = project(reduceCatalogContract(emptyCatalogContractState(), observation()), [{ ...model, metadata }]);
      expect(result.models[0]?.parameters).toEqual(model.parameters);
      expect(result.connector?.modelOverrides?.[model.id]?.submit?.path).toBe("/legacy-submit");
      expect(result.models[0]?.metadata?.catalogContractStatus).toBe("protected");
    }
  });
  it("requires complete explicit removal and retains its original historical descriptor", () => {
    const original = observation(), before = reduceCatalogContract(emptyCatalogContractState(), original);
    const incomplete = reduceCatalogContract(before, { ...original, complete: false, presence: "explicit-remove" });
    expect(project(incomplete).models[0]?.metadata?.canvasRunnable).toBe(true);
    const removed = reduceCatalogContract(before, { ...original, presence: "explicit-remove" });
    expect(project(removed).models[0]?.metadata?.canvasRunnable).toBe(false);
    expect(removed.slots[catalogContractSlotKey(scope)]?.history[0]?.bundle.model.parameters).toEqual(model.parameters);
  });
  it("does not borrow another exact group/model/source and does not erase Key denials", () => {
    const state = reduceCatalogContract(emptyCatalogContractState(), observation());
    const other = bindScannedModelProtocols(connection(), [model], connection(), { catalogContracts: state, sourceId: scope.sourceId, groupIdentity: "name:7" });
    expect(other.models[0]?.metadata?.canvasRunnable).toBe(false);
    expect(project(state, [{ ...model, id: "sibling" }]).models[0]?.metadata?.canvasRunnable).toBe(false);
    expect(project(state, [{ ...model, metadata: { canvasRunnable: false, canvasUnavailableReason: "403 Key 权限拒绝" } }]).models[0]?.metadata?.canvasRunnable).toBe(false);
  });
  it("preserves user image presets, high/max quality and original saved node values", () => {
    const value = binding(); value.model.id = "gpt-image-2.5";
    value.model.parameters = [{ key: "size", label: "尺寸", control: "dimensions", allowCustomValue: true },
      { key: "quality", label: "质量", control: "select", default: "max", options: [{ label: "最高", value: "max" }] }];
    const localScope = { ...scope, modelId: value.model.id };
    const state = reduceCatalogContract(emptyCatalogContractState(), { ...observation(), ...catalogContractFromDocumented(localScope, "documented-rest", value) });
    const original = connection(), snapshot = structuredClone(original);
    const result = bindScannedModelProtocols(original, [value.model], original, { catalogContracts: state, sourceId: scope.sourceId, groupIdentity: scope.groupIdentity });
    const size = result.models[0]?.parameters?.find(parameter => parameter.key === "size");
    for (const tier of ["1K", "2K", "4K"]) expect(size?.options?.some(option => option.label.startsWith(tier))).toBe(true);
    expect(result.models[0]?.parameters?.find(parameter => parameter.key === "quality")?.default).toBe("max");
    expect(original).toEqual(snapshot);
  });
  it("never migrates legacy descriptors into fabricated contract history", () => {
    expect(project(emptyCatalogContractState()).models[0]?.metadata?.canvasRunnable).toBe(false);
    expect(emptyCatalogContractState().slots).toEqual({});
  });
  it("only blocks a comparable exact model/path/schema change, not a generic compilation failure", () => {
    const accepted = observation(), state = reduceCatalogContract(emptyCatalogContractState(), accepted);
    const context = { origin: scope.origin, sourceId: scope.sourceId, groupIdentity: scope.groupIdentity, sourceKey: accepted.sourceKey, checkedAt: accepted.checkedAt };
    const diagnostic = { modelId: model.id, operation: scope.operation, code: "contract_incomplete" as const,
      method: accepted.identity.method, submitEndpoint: accepted.identity.submit };
    expect(applyCatalogContractDiagnostics(state, [], context)).toEqual(state);
    expect(applyCatalogContractDiagnostics(state, [diagnostic], context)).toEqual(state);
    expect(applyCatalogContractDiagnostics(state, [{ ...diagnostic, parameterFingerprint: catalogContractParameterFingerprint(accepted.bundle!.model) }], context)).toEqual(state);
    for (const patch of [{ method: "PUT" }, { submitEndpoint: "https://fixture.invalid/v2/generate" }, { parameterFingerprint: "a".repeat(64) }]) {
      const pending = applyCatalogContractDiagnostics(state, [{ ...diagnostic, ...patch }], context);
      expect(pending.slots[catalogContractSlotKey(scope)]?.blocked).toBe(true);
      expect(pending.slots[catalogContractSlotKey(scope)]?.accepted).toBeUndefined();
      expect(pending.slots[catalogContractSlotKey(scope)]?.history).toHaveLength(1);
      expect(project(pending).models[0]?.metadata?.canvasRunnable).toBe(false);
    }
    expect(applyCatalogContractDiagnostics(state, [{ ...diagnostic, method: "PUT" }], { ...context, groupIdentity: "name:other" })).toEqual(state);
    expect(applyCatalogContractDiagnostics(state, [{ ...diagnostic, method: "PUT" }], { ...context, sourceKey: "other-source" })).toEqual(state);
    const manual = reduceCatalogContract(emptyCatalogContractState(), { ...accepted, owner: "manual" });
    expect(applyCatalogContractDiagnostics(manual, [{ ...diagnostic, method: "PUT" }], context)).toEqual(manual);
  });
  it("does not replay an older complete source over a new blocked contract, and equal-time conflicts stay blocked", () => {
    const initial = observation(), state = reduceCatalogContract(emptyCatalogContractState(), initial);
    const diagnostic = { modelId: model.id, operation: scope.operation, code: "contract_incomplete" as const,
      method: "POST", submitEndpoint: "https://fixture.invalid/v2/generate" };
    const context = { origin: scope.origin, sourceId: scope.sourceId, groupIdentity: scope.groupIdentity, sourceKey: initial.sourceKey,
      checkedAt: "2026-10-17T00:02:00Z" };
    const pending = applyCatalogContractDiagnostics(state, [diagnostic], context);
    const replayed = reduceCatalogContract(pending, { ...initial, sourceKey: "older-source" });
    expect(replayed).toEqual(pending);
    expect(project(replayed).models[0]?.metadata?.canvasRunnable).toBe(false);
    const next = reduceCatalogContract(state, { ...observation("/different-contract"), sourceKey: "source-b", checkedAt: initial.checkedAt });
    expect(next.slots[catalogContractSlotKey(scope)]?.blocked).toBe(true);
    const replay = reduceCatalogContract(next, initial);
    expect(replay.slots[catalogContractSlotKey(scope)]?.blocked).toBe(true);
    expect(replay.slots[catalogContractSlotKey(scope)]?.accepted).toBeUndefined();
    const acceptedNew = reduceCatalogContract(state, observation("/v2/generate"));
    const oldDiagnostic = applyCatalogContractDiagnostics(acceptedNew, [diagnostic], { ...context, checkedAt: initial.checkedAt });
    expect(oldDiagnostic).toEqual(acceptedNew);
  });
});
