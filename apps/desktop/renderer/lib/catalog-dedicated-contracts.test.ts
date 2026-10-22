import { describe, expect, it, vi } from "vitest";
vi.mock("node:dns/promises", () => ({ lookup: async () => [{ address: "203.0.113.10", family: 4 }] }));
import type { ProviderConnectionRecord } from "@super-canvas/db";
import { AutoInterfaceAdapter, GenericRestAdapter, OpenAIImageAdapter, parseTk1688Marketplace, StaticConnectionResolver, type ModelDescriptor } from "@super-canvas/providers";
import { collectCatalogDedicatedContracts, normalizeCatalogDedicatedPriceFacts } from "./catalog-dedicated-contracts";
import { catalogConnectionScopes, catalogReadItem } from "./catalog-source-plan";
import { CATALOG_CONTRACT_PENDING_REASON, catalogContractSlotKey, emptyCatalogContractState, projectCatalogContractModels, reduceCatalogContracts, validateCatalogContractBundle } from "./catalog-contract-policy";
import { bindScannedModelProtocols } from "./scanned-model-protocols";
import type { CatalogReadObservation } from "./catalog-read-contracts";
import { chentuFallbackImageDescriptor } from "./chentu-catalog";
import { reduceCatalogPrices } from "./catalog-price-observations";
import { selectModelQuote } from "@super-canvas/providers/media-billing";
import { mikotoConnectionConfig, mikotoConnectorForGroup, MIKOTO_IMAGE_4K_GROUP, MIKOTO_KLING_GROUP } from "./mikoto-presets";
import { modelEstimatedQuote } from "./model-display";

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
  it.each([undefined, false])("retains Secure58's current reference-video pricing restriction over sparse or historical Key metadata: %s", historicalFlag => {
    const id = "wan3.0-video", value: ProviderConnectionRecord = { ...connection(), config: { baseUrl: "https://token.secure-skill.com/v1",
      supplierKey: "4stoken", accountKeyGroupId: "58", accountKeyGroup: "wan3", modelGroup: "wan3", usage: "canvas", modelScanStatus: "live", scannedModelIds: [id] } };
    const model: ModelDescriptor = { id, name: id, operations: ["video.generate", "video.image-to-video"], outputKinds: ["video"],
      pricing: { kind: "per-second", billingUnit: "second", unitAmount: .1, currency: "CNY", checkedAt, confidence: "exact" },
      metadata: { priceSource: "supplier-catalog", priceLabel: "¥0.1/秒", ...(historicalFlag !== undefined ? {
        referenceVideoPricingUnpublished: historicalFlag, referenceVideoPricingSourceUrl: "https://old.invalid/price", referenceVideoPricingUpdatedAt: "old" } : {}) } };
    const result = collectCatalogDedicatedContracts(value, undefined, [model], [member(value, [model])], { ...options, membershipModelIds: [id] });
    expect(result.nativeModels).toHaveLength(1);
    const scopes = catalogConnectionScopes(value), projected = projectCatalogContractModels(value, result.models, { catalogContracts: emptyCatalogContractState(),
      sourceId: scopes.apply.supplierSourceId, groupIdentity: scopes.apply.groupIdentity!, nativeModels: result.nativeModels });
    const selected = projected.models[0]!;
    expect(selected.metadata).toMatchObject({ canvasRunnable: true, catalogContractStatus: "native", referenceVideoPricingUnpublished: true,
      referenceVideoPricingSourceUrl: "https://token.secure-skill.com/api/v1/groups/available", referenceVideoPricingUpdatedAt: "2026-10-22T10:57:06.049575+08:00" });
    expect(selected.pricing).toEqual(model.pricing);expect(selected.metadata?.priceLabel).toBe("¥0.1/秒");
    const parameters = { duration: 5, resolution: "720P", aspect_ratio: "16:9" };
    expect(modelEstimatedQuote(selected, { ...parameters, has_reference_video: true })).toBeUndefined();
    expect(modelEstimatedQuote(selected, parameters)).toBeUndefined();
    expect(modelEstimatedQuote(selected, { ...parameters, has_reference_video: false })?.cost).toBe("0.5 CNY");
    expect(model.metadata?.referenceVideoPricingUnpublished).toBe(historicalFlag);
  });
  const tkModels = parseTk1688Marketplace({ success: true, data: { total: 4, items: [
    { alias: "gpt-image-2@s1c581", base_model: "gpt-image-2", status: "active", charge_type: "per_request", input_price_usd: .02, description: "仅支持medium质量，原生1k 2k，超分4k。" },
    { alias: "gpt-image-2.5-flare@s1c559", base_model: "gpt-image-2.5-flare", status: "active", charge_type: "per_request", input_price_usd: .03, description: "支持1K/2K/4K。" },
    { alias: "gpt-image-2.5-sunburst@s1c470", base_model: "gpt-image-2.5-sunburst", status: "active", charge_type: "per_request", input_price_usd: .03, description: "支持1K/2K/4K。" },
    { alias: "gpt-image-2.5@s1c559", base_model: "gpt-image-2.5", status: "active", charge_type: "per_request", input_price_usd: .03, description: "支持1K/2K/4K。" },
  ] } }, { payment_fx_rate_cny_per_usd: 7, platform_markup_percent: 0 }, { checkedAt }).models;
  const tkConnection = (): ProviderConnectionRecord => ({ ...connection(), config: { baseUrl: "https://api.tk1688.com/v1",
    supplierKey: "custom-tk-supplier", accountKeyGroupId: "1", accountKeyGroup: "vip", modelGroup: "vip", usage: "canvas", modelScanStatus: "live",
    scannedModelIds: tkModels.map(model => model.id), modelCatalogModels: tkModels } });
  it.each(["gpt-image-2", "gpt-image-2.5", "gpt-image-2.5-flare@s1c559", "gpt-image-2.5-sunburst@s1c470", "gpt-image-2@s1c581"])(
    "keeps current-Key Tk1688 %s on its real Images route through collect, projection and native request", async id => {
      const value = tkConnection(), original = tkModels.find(model => model.id === id)!;
      expect(original).toBeDefined();
      const model = { ...original, metadata: { ...original.metadata, canvasRunnable: false, catalogContractPolicy: 1,
        catalogContractStatus: "pending", catalogMembershipVerified: true, canvasUnavailableReason: CATALOG_CONTRACT_PENDING_REASON } };
      const result = collectCatalogDedicatedContracts(value, undefined, [model], [member(value, [model])], { ...options, membershipModelIds: [id] });
      expect(result.nativeModels).toHaveLength(1);expect(result.contracts).toEqual([]);
      const scopes = catalogConnectionScopes(value), projected = projectCatalogContractModels(value, result.models, { catalogContracts: emptyCatalogContractState(),
        sourceId: scopes.apply.supplierSourceId, groupIdentity: scopes.apply.groupIdentity!, nativeModels: result.nativeModels, nativeBindings: result.nativeBindings });
      const selected = projected.models[0]!;
      expect(selected.metadata).toMatchObject({ canvasRunnable: true, catalogContractStatus: "native", catalogNativeContract: { adapter: "tk1688-images" } });
      expect(selected.metadata?.canvasUnavailableReason).toBeUndefined();expect(selected.pricing).toEqual(original.pricing);
      if (id === "gpt-image-2@s1c581") expect(selected.parameters?.find(parameter => parameter.key === "quality")?.options?.map(option => option.value)).toEqual(["medium"]);
      const fetcher = vi.fn<typeof fetch>(async () => Response.json({ data: [{ url: "https://media.example/original.png" }] }));
      const resolver = new StaticConnectionResolver([{ id: value.id, provider: "openai", baseUrl: String(value.config.baseUrl), apiKey: "offline-only",
        settings: { ...value.config, modelCatalogModels: projected.models, autoModelInterfaces: {} } }]);
      const adapter = new AutoInterfaceAdapter(resolver, new OpenAIImageAdapter(resolver, { fetch: fetcher }), { fetch: fetcher });
      for (const operation of ["image.generate", "image.edit"] as const) {
        const bytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
        const request = { connectionId: value.id, model: id, operation, prompt: "offline", idempotencyKey: "offline",
          parameters: { size: "1024x1024", quality: "medium" }, ...(operation === "image.edit" ? { assets: [{ id: "original-alpha", kind: "image" as const,
            role: "reference" as const, mimeType: "image/png", data: bytes }] } : {}) };
        const before = structuredClone(request);expect((await adapter.validate(request)).valid).toBe(true);
        expect((await adapter.submit(request)).status).toBe("succeeded");
        const [url, init] = fetcher.mock.calls.at(-1)!;
        expect(String(url)).toBe(`https://api.tk1688.com/v1/images/${operation === "image.edit" ? "edits" : "generations"}`);
        if (operation === "image.generate") expect(JSON.parse(String(init?.body))).toMatchObject({ model: id, size: "1024x1024", quality: "medium" });
        else { const form = init?.body as FormData;expect(form.get("model")).toBe(id);expect(form.get("quality")).toBe("medium");
          expect(new Uint8Array(await (form.get("image") as Blob).arrayBuffer())).toEqual(bytes); }
        expect(request).toEqual(before);
      }
    });
  it("never grants Tk1688 Images from public, unread, sibling, unknown or manual membership", () => {
    const value = tkConnection(), model = tkModels.find(model => model.id === "gpt-image-2@s1c581")!, fresh = member(value, [model]);
    for (const rows of [[], [member(value, [])], [{ ...fresh, receipt: { ...fresh.receipt, freshness: "unread" as const } }],
      [{ ...fresh, receipt: { ...fresh.receipt, spec: { ...fresh.receipt.spec, role: "catalog-offer" as const, authScope: { ...fresh.receipt.spec.authScope, kind: "anonymous" as const } } } }],
      [{ ...fresh, receipt: { ...fresh.receipt, spec: { ...fresh.receipt.spec, authScope: { ...fresh.receipt.spec.authScope, principalRef: "another-key" } } } }]])
      expect(collectCatalogDedicatedContracts(value, undefined, [model], rows, { ...options, membershipModelIds: [model.id] }).nativeModels).toEqual([]);
    for (const changes of [{ baseUrl: "https://api.tk1688.com.example/v1" }, { baseUrl: "http://api.tk1688.com/v1" },
      { baseUrl: "https://api.tk1688.com:8443/v1" }, { baseUrl: "https://api.tk1688.com/private/v1" }, { baseUrl: "https://user@api.tk1688.com/v1" },
      { baseUrl: "https://api.tk1688.com/v1?model=gpt-image-2" }, { manualProtocol: true }, { autoProtocol: false },
      { manualModels: [{ id: model.id }] }, { modelScanStatus: "unauthorized" }]) {
      const target = { ...value, config: { ...value.config, ...changes } };
      const targetScopes = catalogConnectionScopes(target), targetMember = { ...fresh, receipt: { ...fresh.receipt,
        spec: { ...fresh.receipt.spec, authScope: targetScopes.key, applyScope: targetScopes.apply } } };
      expect(collectCatalogDedicatedContracts(target, undefined, [model], [targetMember], { ...options, membershipModelIds: [model.id] }).nativeModels).toEqual([]);
    }
    for (const id of ["gpt-image-2-private", "gpt-image-2@s1", "gpt-image-2@s1c581-extra", "gpt-image-2.6@s1c581", "gemini-private@s1c581"]) {
      const unknown = { ...model, id };
      expect(collectCatalogDedicatedContracts(value, undefined, [unknown], [member(value, [unknown])], { ...options, membershipModelIds: [id] }).nativeModels).toEqual([]);
    }
    for (const metadata of [{ ...model.metadata, canvasRunnable: false, canvasUnavailableReason: "HTTP 403 权限拒绝" },
      { ...model.metadata, source: "manual" }, { ...model.metadata, protocolEvidence: "paid-test" }]) {
      const denied = { ...model, metadata };
      expect(collectCatalogDedicatedContracts(value, undefined, [denied], [member(value, [denied])], { ...options, membershipModelIds: [model.id] }).nativeModels).toEqual([]);
    }
    const wrongProvider = { ...value, provider: "weai" };
    expect(collectCatalogDedicatedContracts(wrongProvider, undefined, [model], [member(wrongProvider, [model])], { ...options, membershipModelIds: [model.id] }).nativeModels).toEqual([]);
  });
  it.each(["sd8-seedance-2.5-n", "omni-fast", "flux-3-image", "flux-3-klein"])("projects %s's exact production Cangyuan builder past pending without inheriting a private route", async id => {
    const image = id.startsWith("flux"), value: ProviderConnectionRecord = { ...connection(), provider: "rest", config: {
      baseUrl: "https://ai.cangyuansuanli.cn", supplierKey: "cangyuan", preset: "cangyuan-gpt-image-2", modelGroup: image ? "IMAGE" : "VIDEO",
      accountKeyGroup: image ? "IMAGE" : "VIDEO", usage: "canvas", modelScanStatus: "live", scannedModelIds: [id],
      connector: { submit: { path: "/private-old", method: "POST", bodyMode: "json" }, output: { path: "$.old", kind: "image" } } } };
    const model: ModelDescriptor = { id, name: id, operations: [], outputKinds: [image ? "image" : "video"], pricing: {
      kind: "per-request", currency: "CNY", unitAmount: .7, checkedAt, confidence: "exact" }, metadata: { canvasRunnable: false,
      catalogContractPolicy: 1, catalogContractStatus: "pending", catalogMembershipVerified: true, canvasUnavailableReason: CATALOG_CONTRACT_PENDING_REASON } };
    const result = collectCatalogDedicatedContracts(value, undefined, [model], [member(value, [model])], { ...options, membershipModelIds: [id] });
    expect(result.nativeModels).toHaveLength(1);
    expect(result.nativeBindings).toHaveLength(image ? 2 : 0);
    expect(result.nativeBindings.every(row => !validateCatalogContractBundle(row.identity, row.bundle!).length)).toBe(true);
    const scopes = catalogConnectionScopes(value), projected = projectCatalogContractModels(value, result.models, { catalogContracts: emptyCatalogContractState(),
      sourceId: scopes.apply.supplierSourceId, groupIdentity: scopes.apply.groupIdentity!, nativeModels: result.nativeModels, nativeBindings: result.nativeBindings });
    expect(projected.models[0]?.metadata).toMatchObject({ canvasRunnable: true, catalogContractStatus: "native" });
    expect(projected.models[0]?.pricing).toEqual(model.pricing);
    if (image) expect(JSON.stringify(projected.connector)).not.toContain("private-old");
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json({ id: "original-task", status: "queued" }))
      .mockResolvedValueOnce(Response.json(image ? { status: "completed", data: [{ url: "https://media.example/original.png" }] }
        : { status: "completed", video_url: "https://media.example/original.mp4" }));
    const adapter = new GenericRestAdapter(new StaticConnectionResolver([{ id: value.id, provider: "rest", baseUrl: String(value.config.baseUrl), apiKey: "offline",
      settings: { ...value.config, connector: projected.connector ?? { ...value.config.connector as object, models: projected.models } } }]), { fetch: fetcher });
    const request = { connectionId: value.id, model: id, operation: image ? "image.edit" as const : "video.generate" as const, prompt: "offline", idempotencyKey: "offline",
      parameters: image ? { resolution: "4K", aspect_ratio: "9:16", n: 1 } : id === "omni-fast" ? { duration: 10 } : { duration: 30, resolution: "720p" },
      ...(id === "omni-fast" ? {} : { assets: [{ id: "original-alpha", kind: "image" as const, role: "reference" as const, mimeType: "image/png", url: "https://media.example/original.png" }] }) };
    const before = structuredClone(request), task = await adapter.submit(request);
    expect(String(fetcher.mock.calls[0]![0])).toBe(`https://ai.cangyuansuanli.cn/v1/${image ? "images/edits" : "videos"}`);
    const body = JSON.parse(String(fetcher.mock.calls[0]![1]!.body));
    if (image) expect(body).toMatchObject({ resolution: "4K", size: "9:16", images: ["https://media.example/original.png"] });
    else if (id === "sd8-seedance-2.5-n") expect(body.reference_image_urls).toEqual(["https://media.example/original.png"]);
    expect((await adapter.poll(task)).status).toBe("succeeded");
    expect(request).toEqual(before);
    expect(collectCatalogDedicatedContracts(value, undefined, [model], [], { ...options, membershipModelIds: [id] }).nativeModels).toEqual([]);
    for (const target of [{ ...value, config: { ...value.config, baseUrl: "https://foreign.example" } },
      { ...value, config: { ...value.config, manualProtocol: true } }])
      expect(collectCatalogDedicatedContracts(target, undefined, [model], [member(target, [model])], { ...options, membershipModelIds: [id] }).nativeModels).toEqual([]);
    const unknown = { ...model, id: `${id}-private-unknown` };
    expect(collectCatalogDedicatedContracts(value, undefined, [unknown], [member(value, [unknown])], { ...options, membershipModelIds: [unknown.id] }).nativeModels).toEqual([]);
    const denied = { ...model, metadata: { ...model.metadata, canvasUnavailableReason: "HTTP 403 权限拒绝" } };
    expect(collectCatalogDedicatedContracts(value, undefined, [denied], [member(value, [denied])], { ...options, membershipModelIds: [id] }).nativeModels).toEqual([]);
  });
  it.each(["dreamina-seedance-2-0-fast", "dreamina-seedance-2-0-mini"])("restores only the exact current-Key Secure60 %s native contract after a fresh directory observation", id => {
    const value: ProviderConnectionRecord = { ...connection(), config: { baseUrl: "https://token.secure-skill.com/v1", supplierKey: "4stoken",
      accountKeyGroupId: "60", accountKeyGroup: "海外sd-fast/mini", modelGroup: "海外sd-fast/mini", usage: "canvas", modelScanStatus: "live", scannedModelIds: [id] } };
    const model: ModelDescriptor = { id, name: id, operations: ["video.generate", "video.image-to-video"], outputKinds: ["video"], parameters: [],
      metadata: { canvasRunnable: false, catalogContractPolicy: 1, catalogContractStatus: "pending", catalogMembershipVerified: true,
        canvasUnavailableReason: CATALOG_CONTRACT_PENDING_REASON, priceLabel: "480p/720p Token 本组报价", outputKindsSource: "declared" } };
    const result = collectCatalogDedicatedContracts(value, undefined, [model], [member(value, [model])], { ...options, membershipModelIds: [id] });
    expect(result.nativeModels).toHaveLength(1);
    const scopes = catalogConnectionScopes(value), projected = projectCatalogContractModels(value, result.models, { catalogContracts: emptyCatalogContractState(),
      sourceId: scopes.apply.supplierSourceId, groupIdentity: scopes.apply.groupIdentity!, nativeModels: result.nativeModels });
    expect(projected.models[0]?.metadata).toMatchObject({ canvasRunnable: true, catalogContractStatus: "native", priceLabel: model.metadata?.priceLabel });
    expect(projected.models[0]?.parameters?.map(parameter => parameter.key)).toEqual(expect.arrayContaining(["duration", "aspect_ratio", "resolution", "generate_audio"]));
    // A second cached projection retains the accepted exact native contract.
    expect(bindScannedModelProtocols(value, projected.models).models).toEqual(projected.models);
    expect(collectCatalogDedicatedContracts(value, undefined, projected.models, [], { ...options, membershipModelIds: [id] }).nativeModels).toHaveLength(1);
    // Before acceptance, historical membership alone cannot grant this contract.
    expect(collectCatalogDedicatedContracts(value, undefined, [model], [], { ...options, membershipModelIds: [id] }).nativeModels).toEqual([]);
    for (const changes of [{ accountKeyGroupId: "61" }, { baseUrl: "https://foreign.example/v1" }, { manualProtocol: true }]) {
      const target = { ...value, config: { ...value.config, ...changes } };
      expect(collectCatalogDedicatedContracts(target, undefined, [model], [member(target, [model])], { ...options, membershipModelIds: [id] }).nativeModels).toEqual([]);
    }
    const rejected = { ...model, metadata: { ...model.metadata, canvasUnavailableReason: "HTTP 403 权限拒绝" } };
    expect(collectCatalogDedicatedContracts(value, undefined, [rejected], [member(value, [rejected])], { ...options, membershipModelIds: [id] }).nativeModels).toEqual([]);
  });

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
