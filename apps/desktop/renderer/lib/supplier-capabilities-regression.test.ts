import { describe, expect, it, vi } from "vitest";
import { MemoryRepository, type ProviderConnectionRecord, type SupplierRecord, type SupplierVerificationCase } from "@super-canvas/db";
import { OpenAIImageAdapter, StaticConnectionResolver, type ModelDescriptor } from "@super-canvas/providers";
import { declaredImageCharge, effectiveImageCapabilities, verificationParameters } from "./supplier-capabilities";
import { SupplierVerificationService, verificationFingerprint, type VerificationDependencies } from "./supplier-verification-service";
import { cangyuanCurrentModel, cangyuanCurrentRequestIssues } from "../../../../packages/providers/src/cangyuan-current-models";
import { bindScannedModelProtocols } from "./scanned-model-protocols";
import { cangyuanConnectorForModels } from "./cangyuan-catalog";

const group = "B4-GPT生图原生渠道V3（高质量）";
const supplier: SupplierRecord = {
  id: "monster", name: "怪兽ai", supplierKey: "monster", apiUrl: "https://api.eaheng.com",
  siteUrl: "https://api.eaheng.com", kind: "newapi", scanStatus: "live", createdAt: "now", updatedAt: "now",
  catalog: { groups: [{ id: group, label: group, models: [], details: { source: "model-plaza",
    description: "高质量稳定组。支持全质量 medium high xhigh max（默认medium），不同模型质量价格不同。" } }] },
};
const connection = { id: "key-a", provider: "openai", config: { accountKeyGroup: group } };
const model = (id: string): ModelDescriptor => ({ id, name: id, operations: ["image.generate"] });
const get = (current: ModelDescriptor, extra: Partial<Parameters<typeof effectiveImageCapabilities>[0]> = {}) =>
  effectiveImageCapabilities({ supplier, connection, model: current, fingerprint: "f", ...extra });
const attempt = (id: string, overrides: Partial<SupplierVerificationCase> = {}): SupplierVerificationCase => ({
  id: "original", requestId: "original-request", supplierId: supplier.id, sourceId: "source", connectionId: connection.id,
  group, modelId: id, provider: "openai", fingerprint: "f", dedupeKey: "d", resolution: "4K", ratio: "16:9",
  expectedWidth: 3840, expectedHeight: 2160, quality: "max", parameters: { size: "3840x2160", quality: "max" },
  status: "needs_attention", reason: "原请求结果与扣费待核对", createdAt: "now", updatedAt: "later", ...overrides,
});

describe("supplier fixed quality and unresolved resolution requests", () => {
  it.each(["flare", "sunburst"])("keeps Monster B4 %s high/max as independent fixed-quality models", variant => {
    for (const quality of ["high", "max"]) {
      const id = `gpt-image-2.5-${variant}-${quality}`;
      for (const current of [model(id), { ...model(id), parameters: [{ key: "quality", label: "质量",
        control: "select" as const, default: "max", options: ["medium", "high", "xhigh", "max"].map(value => ({ value, label: value })) }] }]) {
        const result = get(current);
        expect(result.model.parameters?.find(parameter => parameter.key === "quality")).toMatchObject({
          default: quality, options: [{ value: quality }],
        });
        expect(result.qualityOptions).toEqual([quality]);
        expect(verificationParameters(result, "4K").parameters).toMatchObject({ quality, size: "3840x2160" });
        expect(get(result.model).quality).toBe(quality);
        expect(result.evidence.some(evidence => evidence.status === "verified")).toBe(false);
      }
    }
  });

  it("uses explicit adapter fixedQuality metadata ahead of a generic group declaration", () => {
    const current = { ...model("supplier-fixed-image"), metadata: { fixedQuality: "high" }, parameters: [
      { key: "size", label: "尺寸", control: "dimensions" as const },
      { key: "quality", label: "质量", control: "select" as const, options: ["high", "max"].map(value => ({ value, label: value })) },
    ] };
    const result = get(current);
    expect(result.quality).toBe("high");
    expect(result.qualityOptions).toEqual(["high"]);
    expect(result.model.parameters?.find(parameter => parameter.key === "quality")?.options?.map(option => option.value)).toEqual(["high"]);
  });

  it("retains a descriptor's explicit fixed quality when rereading the transformed cache", () => {
    const current: ModelDescriptor = { ...model("documented-fixed-image"), parameters: [
      { key: "size", label: "尺寸", control: "dimensions" },
      { key: "quality", label: "质量", control: "select", description: "当前型号固定 high 质量",
        options: [{ value: "high", label: "high" }] },
    ] };
    const result = get(current);
    expect(result.quality).toBe("high");
    expect(get(result.model).qualityOptions).toEqual(["high"]);
    expect(get(result.model).quality).toBe("high");
  });

  it("does not assign Monster-specific suffix semantics to another supplier or group", () => {
    const current = model("gpt-image-2.5-flare-max");
    expect(get(current, { supplier: { ...supplier, apiUrl: "https://another.example" } }).qualityOptions).toContain("medium");
    expect(get(current, { connection: { ...connection, config: { accountKeyGroup: "another-group" } } }).qualityOptions).toContain("medium");
  });

  it("does not reopen a rejected fixed quality or substitute another model's quality", () => {
    const current = model("gpt-image-2.5-flare-high");
    for (const extra of [
      { documentation: "不支持 high" },
      { tests: [attempt(current.id, { status: "unsupported", rejectedParameter: "quality", quality: "high", legalQualities: ["max"] })] },
    ]) {
      const result = get(current, extra);
      expect(result.quality).toBeUndefined();
      expect(result.qualityOptions).toEqual([]);
      expect(result.model.parameters?.some(parameter => parameter.key === "quality")).toBe(false);
      expect(result.probeTiers).toEqual([]);
      expect(result.reason).toContain("固定质量 high");
    }
  });

  it.each(["needs_attention", "inconclusive"] as const)("retains the 4K request menu while the original result is %s", status => {
    const current = model("gpt-image-2.5-flare");
    const original = attempt(current.id, { status });
    const snapshot = structuredClone(original);
    const result = get(current, { supplier: { ...supplier, catalog: { groups: [] } }, tests: [original] });
    const sizes = result.model.parameters?.find(parameter => parameter.key === "size")?.options ?? [];
    expect(result.tiers).toContainEqual({ tier: "4K", status: "assumed" });
    expect(sizes.filter(option => option.label.startsWith("4K"))).toHaveLength(11);
    expect(sizes.filter(option => option.label.startsWith("4K")).every(option => option.label.includes("待核验"))).toBe(true);
    expect(sizes.some(option => option.value === "auto")).toBe(true);
    expect(result.probeTiers).toEqual([]);
    expect(result.evidence.find(evidence => evidence.resolution === "4K")).toMatchObject({
      status: "assumed", kind: "test", checkedAt: "later", excerpt: expect.stringContaining("original-request"),
    });
    expect(result.evidence.some(evidence => evidence.status === "verified" || evidence.status === "inferred")).toBe(false);
    expect(original).toEqual(snapshot);
  });

  it("retains the tier after a quality rejection while honoring resolution rejections and exact scope", () => {
    const current = model("gpt-image-2.5-flare");
    const rejected = attempt(current.id, { status: "unsupported", rejectedParameter: "quality", legalQualities: ["high"] });
    expect(get(current, { tests: [rejected] }).tiers).toContainEqual({ tier: "4K", status: "assumed" });
    expect(get(current, { tests: [{ ...rejected, rejectedParameter: "resolution" }] }).tiers.some(tier => tier.tier === "4K")).toBe(false);
    expect(get(current, { tests: [{ ...rejected, status: "inconclusive", rejectedParameter: "resolution" }] }).tiers.some(tier => tier.tier === "4K")).toBe(false);
    const limited = { ...current, parameters: [{ key: "image_size", label: "尺寸", control: "select" as const,
      options: [{ value: "1K", label: "1K" }] }] };
    expect(get(limited, { tests: [attempt(current.id, { connectionId: "another-key" })] }).tiers.map(tier => tier.tier)).toEqual(["1K"]);
  });

  it.each(["gpt-image-2-x", "gpt-image-2.5-x"])("retains supplier-native tier and quality values and conditional controls for %s", id => {
    const visibleWhen = [{ parameter: "tier", values: ["1k", "2k", "4k"] }];
    const nativeQualities = [...(id === "gpt-image-2.5-x" ? ["auto"] : []), "low", "medium", "high", "xhigh", "max"];
    const current: ModelDescriptor = { ...model(id), metadata: {
      imageNativeQualityOptions: true,
      imageNativeResolutionParameter: "tier", imageSupportedResolutions: ["1K", "2K", "4K"], imageRequestResolutions: ["1K", "2K", "4K"],
    }, parameters: [
      { key: "series", label: "变体", control: "select", required: true, default: "sunburst", options: ["flare", "sunburst"].map(value => ({ value, label: value })) },
      { key: "tier", label: "输出档位", control: "select", default: "4k", options: ["web", "1k", "2k", "4k"].map(value => ({ value, label: value })) },
      { key: "aspect_ratio", label: "比例", control: "select", options: [{ value: "16:9", label: "16:9" }] },
      { key: "quality", label: "质量", control: "select", default: "max", visibleWhen,
        options: nativeQualities.map(value => ({ value, label: value })) },
    ] };
    const result = get(current, { supplier: { ...supplier, catalog: { groups: [] } } });
    expect(result.sizeKey).toBe("tier");
    expect(result.model.parameters?.some(parameter => parameter.key === "size")).toBe(false);
    expect(result.model.parameters?.find(parameter => parameter.key === "tier")?.options?.map(option => option.value)).toEqual(["web", "1k", "2k", "4k"]);
    expect(result.model.parameters?.find(parameter => parameter.key === "quality")?.visibleWhen).toEqual(visibleWhen);
    expect(result.model.parameters?.find(parameter => parameter.key === "quality")).toMatchObject({ default: "max",
      options: nativeQualities.map(value => ({ value })) });
    expect(result.model.parameters?.find(parameter => parameter.key === "aspect_ratio")?.options).toHaveLength(12);
    expect(verificationParameters(result, "4K").parameters).toMatchObject({ tier: "4k", quality: "max", series: "sunburst" });
    const quoted: ModelDescriptor = { ...current, pricing: { kind: "tiered", currency: "CNY", billingUnit: "image", confidence: "exact", checkedAt: "now",
      tiers: [{ id: "sunburst-4k-max", label: "sunburst 4k max", price: 4, conditionMode: "all", conditions: [
        { parameter: "series", operator: "equals", value: "sunburst" }, { parameter: "tier", operator: "equals", value: "4k" },
        { parameter: "quality", operator: "equals", value: "max" },
      ] }, { id: "web", label: "web", price: 0.2, otherwise: true }] } };
    expect(declaredImageCharge(quoted, "4K", "max", verificationParameters(result, "4K").parameters)?.amount).toBe(4);
  });

  it("respects provider-decided resolution and a documented 2K ceiling", () => {
    const native: ModelDescriptor = { ...model("midjourney-v7"), metadata: { imageResolutionMode: "provider-decided", qualitySupport: "provider-decided" },
      parameters: [{ key: "aspect_ratio", label: "画幅", control: "select", options: [{ value: "1:1", label: "方形" }] }] };
    const result = get(native);
    expect(result.tiers).toEqual([]);
    expect(result.model.parameters).toEqual(native.parameters);
    expect(result.probeTiers).toEqual([]);
    expect(result.reason).toContain("供应商未定义");
    const seedream: ModelDescriptor = { ...model("seedream-5.0-pro-x"), metadata: { imageSupportedResolutions: ["1K", "2K"],
      imageRequestResolutions: ["1K", "2K"], imageUnsupportedResolutions: ["4K"], qualitySupport: "provider-decided" },
      parameters: [{ key: "size", label: "尺寸", control: "dimensions" }] };
    const limited = get(seedream);
    expect(limited.tiers.map(tier => tier.tier)).toEqual(["1K", "2K"]);
    expect(limited.qualityKey).toBeUndefined();
    expect(limited.model.parameters?.find(parameter => parameter.key === "size")?.options).toHaveLength(23);
    const providerQuality = get({ ...model("gpt-image-2.5-provider-decided"), metadata: { qualitySupport: "provider-decided" } });
    expect(providerQuality.qualityKey).toBeUndefined();
    expect(providerQuality.model.parameters?.some(parameter => parameter.key === "quality")).toBe(false);
  });

  it.each(["high", "max"])("forwards the fixed %s SKU and quality to the mocked Images request", async quality => {
    const id = `gpt-image-2.5-flare-${quality}`;
    const fetchMock = vi.fn<typeof fetch>(async () => Response.json({ data: [{ b64_json: "bW9jaw==" }] }));
    const adapter = new OpenAIImageAdapter(new StaticConnectionResolver([{
      id: connection.id, provider: "openai", apiKey: "isolated-test-key", baseUrl: supplier.apiUrl,
      settings: { supplierKey: supplier.supplierKey, modelGroup: group },
    }]), { fetch: fetchMock });
    const request = { connectionId: connection.id, operation: "image.generate" as const, model: id,
      prompt: "isolated transport validation", idempotencyKey: `mock-${quality}`,
      parameters: verificationParameters(get(model(id)), "4K").parameters };
    expect((await adapter.validate(request)).valid).toBe(true);
    await adapter.submit(request);
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toMatchObject({ model: id, quality, size: "3840x2160" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("current supplier descriptor integration", () => {
  it.each(["gpt-image-2-x", "gpt-image-2.5-x"])("keeps %s native controls and creates a valid captured request", id => {
    const current = cangyuanCurrentModel(model(id));
    const result = get(current, { supplier: { ...supplier, apiUrl: "https://ai.cangyuansuanli.cn", catalog: { groups: [] } } });
    const parameters = verificationParameters(result, "4K").parameters;
    expect(result.model.parameters?.find(parameter => parameter.key === "tier")?.options?.map(option => option.value)).toEqual(["web", "1k", "2k", "4k"]);
    expect(result.model.parameters?.find(parameter => parameter.key === "quality")?.options?.map(option => option.value))
      .toEqual(current.parameters?.find(parameter => parameter.key === "quality")?.options?.map(option => option.value));
    expect(parameters).toMatchObject({ tier: "4k", quality: "max", aspect_ratio: "16:9" });
    if (id === "gpt-image-2.5-x") expect(parameters.series).toBe("sunburst");
    expect(cangyuanCurrentRequestIssues({ connectionId: "mock", operation: "image.generate", model: id,
      prompt: "isolated integration", idempotencyKey: "mock", parameters }, "https://ai.cangyuansuanli.cn")).toEqual([]);
  });

  it("honors the actual Seedream 2K ceiling and actual Midjourney no-K declaration", () => {
    const seedream = get(cangyuanCurrentModel(model("seedream-5.0-pro-x")));
    expect(seedream.tiers.map(tier => tier.tier)).toEqual(["1K", "2K"]);
    expect(seedream.model.parameters?.some(parameter => parameter.key === "quality")).toBe(false);
    const native = cangyuanCurrentModel(model("midjourney-v7"));
    const midjourney = get(native);
    expect(midjourney.tiers).toEqual([]);
    expect(midjourney.model.parameters).toEqual(native.parameters);
    expect(midjourney.probeTiers).toEqual([]);
  });

  it("does not change a shared connector's historical fingerprint when adding four native contracts", () => {
    const legacy: ModelDescriptor = { ...model("gpt-image-2.5-flare"), operations: ["image.generate", "image.edit"] };
    const native = ["gpt-image-2-x", "gpt-image-2.5-x", "midjourney-v7", "seedream-5.0-pro-x"].map(id => model(id));
    const connector = cangyuanConnectorForModels("IMAGE", [legacy]);
    const before: ProviderConnectionRecord = { id: "cangyuan-key", name: "isolated", provider: "rest", encryptedSecret: "mock-cipher",
      createdAt: "now", updatedAt: "now", config: { supplierId: "cangyuan-test", supplierKey: "cangyuan", supplierSourceId: "legacy",
        baseUrl: "https://ai.cangyuansuanli.cn", preset: "cangyuan-gpt-image-2", modelGroup: "IMAGE", usage: "canvas", connector: connector as never } };
    const bound = bindScannedModelProtocols(before, [legacy, ...native]);
    expect(bound.connector?.modelOverrides).toEqual(connector.modelOverrides);
    const after = { ...before, config: { ...before.config, connector: bound.connector as never } };
    expect(verificationFingerprint(after, "mock-key", legacy.id)).toBe(verificationFingerprint(before, "mock-key", legacy.id));
    expect(verificationFingerprint(after, "mock-key")).toBe(verificationFingerprint(before, "mock-key"));
    expect(cangyuanConnectorForModels("IMAGE", [legacy, ...native.map(cangyuanCurrentModel)]).modelOverrides).toEqual(connector.modelOverrides);
    for (const changed of [
      { ...after, encryptedSecret: "another-secret" },
      { ...after, config: { ...after.config, supplierSourceId: "another-source" } },
      { ...after, config: { ...after.config, modelGroup: "another-group" } },
      { ...after, config: { ...after.config, protocol: "another-protocol" } },
      { ...after, config: { ...after.config, headers: { "x-route": "changed" } } },
    ]) expect(verificationFingerprint(changed, "mock-key", legacy.id)).not.toBe(verificationFingerprint(before, "mock-key", legacy.id));
  });
});

async function planFixture(current: ModelDescriptor) {
  const repository = new MemoryRepository();
  const storedConnection: ProviderConnectionRecord = { ...connection, name: "isolated test", encryptedSecret: "mock-cipher",
    createdAt: "now", updatedAt: "now", config: { ...connection.config, supplierId: supplier.id, usage: "canvas" } };
  await repository.saveSupplier(supplier);
  await repository.saveConnection(storedConnection);
  const submit = vi.fn<VerificationDependencies["submit"]>(async () => ({ providerTaskId: "mock-task", status: "succeeded" }));
  const dependencies: VerificationDependencies = { repository, fingerprintKey: "mock-key", models: async () => [current], submit,
    poll: async (_, task) => task, archive: async test => ({ assetId: "mock-asset", width: test.expectedWidth, height: test.expectedHeight }),
    sleep: async () => {} };
  const service = new SupplierVerificationService(dependencies);
  await service.plan(supplier.id, true);
  return { repository, service, submit, dependencies };
}

describe("durable quality-plan correction", () => {
  it("reuses old success and unresolved requests when newly documented models enter the same connection", async () => {
    const repository = new MemoryRepository();
    const owner: SupplierRecord = { ...supplier, id: "cangyuan-test", supplierKey: "cangyuan", apiUrl: "https://ai.cangyuansuanli.cn", catalog: { groups: [] } };
    const legacy = ["gpt-image-2.5-flare", "gpt-image-2.5-sunburst"].map(id => ({ ...model(id), operations: ["image.generate", "image.edit"] as const }));
    const connector = cangyuanConnectorForModels("IMAGE", legacy);
    const before: ProviderConnectionRecord = { id: "cangyuan-key", name: "isolated", provider: "rest", encryptedSecret: "mock-cipher",
      createdAt: "now", updatedAt: "now", config: { supplierId: owner.id, supplierKey: "cangyuan", supplierSourceId: "legacy",
        baseUrl: owner.apiUrl, preset: "cangyuan-gpt-image-2", modelGroup: "IMAGE", usage: "canvas", connector: connector as never } };
    const history = legacy.map((current, index) => attempt(current.id, { id: `historical-${index}`, requestId: `submitted-${index}`,
      supplierId: owner.id, sourceId: "legacy", connectionId: before.id, group: "IMAGE", provider: "rest",
      fingerprint: verificationFingerprint(before, "mock-key", current.id), submittedAt: "submitted",
      status: index === 0 ? "succeeded" : "needs_attention", actualWidth: index === 0 ? 3840 : undefined,
      actualHeight: index === 0 ? 2160 : undefined, task: { providerTaskId: `original-remote-${index}` },
      actualCharge: index === 0 ? { amount: 0.3, currency: "CNY", unit: "image", checkedAt: "now", requestId: `submitted-${index}` } : undefined,
    }));
    await repository.saveSupplier(owner);
    await repository.saveConnection(before);
    await repository.saveSupplierVerification({ id: owner.id, schemaVersion: 1, revision: 0, sourceId: "legacy", policyVersion: 2,
      limit: 2, used: 2, round: 1, paused: true, pauseReason: "safety", reason: "原请求待核对", createdAt: "now", updatedAt: "now",
      cases: history, evidence: [], skipped: [] }, 0);
    const bound = bindScannedModelProtocols(before, [...legacy, ...["gpt-image-2-x", "gpt-image-2.5-x", "midjourney-v7", "seedream-5.0-pro-x"].map(id => model(id))]);
    await repository.saveConnection({ ...before, config: { ...before.config, connector: bound.connector as never } });
    const submit = vi.fn<VerificationDependencies["submit"]>(async () => ({ providerTaskId: "new-mock", status: "succeeded" }));
    const service = new SupplierVerificationService({ repository, fingerprintKey: "mock-key", models: async () => bound.models, submit,
      poll: async (_, task) => task, archive: async test => ({ assetId: "mock-asset", width: test.expectedWidth, height: test.expectedHeight }) });
    await service.plan(owner.id, true);
    const prepared = (await repository.getSupplierVerification(owner.id))!;
    expect(prepared.cases.filter(test => legacy.some(current => current.id === test.modelId))).toEqual(history);
    expect(prepared.evidence.find(item => item.modelId === legacy[0]!.id && item.resolution === "4K")?.status).toBe("verified");
    expect(prepared.evidence.find(item => item.modelId === legacy[1]!.id && item.resolution === "4K")?.status).toBe("assumed");
    expect(prepared).toMatchObject({ used: 2, paused: true, pauseReason: "safety", reason: "原请求待核对" });
    await service.kick();
    expect(submit).not.toHaveBeenCalled();
  });

  it("uses native tier and series parameters for the queued request's expected price", async () => {
    const current: ModelDescriptor = { ...model("gpt-image-2.5-x"), metadata: { imageNativeResolutionParameter: "tier", imageNativeQualityOptions: true },
      parameters: [
        { key: "tier", label: "档位", control: "select", default: "4k", options: [{ value: "4k", label: "4k" }] },
        { key: "series", label: "产品线", control: "select", required: true, default: "sunburst" },
        { key: "quality", label: "质量", control: "select", options: [{ value: "max", label: "max" }] },
      ], pricing: { kind: "tiered", currency: "CNY", billingUnit: "image", confidence: "exact", checkedAt: "now",
        tiers: [{ id: "native", label: "sunburst 4k", price: 4, conditionMode: "all", conditions: [
          { parameter: "series", operator: "equals", value: "sunburst" }, { parameter: "tier", operator: "equals", value: "4k" },
        ] }, { id: "web", label: "web", price: 0.2, otherwise: true }] } };
    const fixture = await planFixture(current);
    expect((await fixture.repository.getSupplierVerification(supplier.id))?.cases[0]).toMatchObject({
      parameters: { tier: "4k", quality: "max", series: "sunburst" }, expectedCharge: { amount: 4, currency: "CNY" },
    });
    expect(fixture.submit).not.toHaveBeenCalled();
  });
  it("corrects the existing unsubmitted B4-high plan while preserving its IDs and protection pause", async () => {
    const fixture = await planFixture(model("gpt-image-2.5-flare-high"));
    const old = (await fixture.repository.getSupplierVerification(supplier.id))!;
    Object.assign(old.cases[0]!, { quality: "max", parameters: { ...old.cases[0]!.parameters, quality: "max" },
      qualityCandidates: ["medium", "high", "xhigh", "max"] });
    old.paused = true; old.pauseReason = "safety"; old.reason = "等待核对其他请求费用";
    const original = structuredClone(old.cases[0]!);
    await fixture.repository.saveSupplierVerification(old, old.revision);
    await fixture.service.plan(supplier.id, true);
    const prepared = (await fixture.repository.getSupplierVerification(supplier.id))!;
    expect(prepared.cases).toHaveLength(1);
    expect(prepared.cases[0]).toMatchObject({ id: original.id, requestId: original.requestId, fingerprint: original.fingerprint,
      quality: "high", qualityCandidates: ["high"], parameters: { size: "3840x2160", quality: "high" }, status: "queued" });
    expect(prepared).toMatchObject({ used: 0, paused: true, pauseReason: "safety", reason: "等待核对其他请求费用" });
    await fixture.service.kick();
    expect(fixture.submit).not.toHaveBeenCalled();
  });

  it("retains an already submitted request and its fee even when its old quality is invalid", async () => {
    const fixture = await planFixture(model("gpt-image-2.5-flare-high"));
    const record = (await fixture.repository.getSupplierVerification(supplier.id))!;
    Object.assign(record.cases[0]!, { quality: "max", parameters: { size: "3840x2160", quality: "max" },
      submittedAt: "submitted", status: "needs_attention", actualCharge: { amount: 2.2, currency: "unknown", unit: "image", checkedAt: "now" } });
    record.used = 1; record.paused = true; record.pauseReason = "safety";
    const submitted = structuredClone(record.cases[0]!);
    await fixture.repository.saveSupplierVerification(record, record.revision);
    await fixture.service.plan(supplier.id, true);
    expect((await fixture.repository.getSupplierVerification(supplier.id))?.cases).toEqual([submitted]);
    await fixture.service.kick();
    expect(fixture.submit).not.toHaveBeenCalled();
  });

  it("keeps a legal lower-quality retry selected and cancels a newly rejected fixed SKU", async () => {
    const fixture = await planFixture(model("gpt-image-2.5-flare"));
    const record = (await fixture.repository.getSupplierVerification(supplier.id))!;
    Object.assign(record.cases[0]!, { quality: "high", parameters: { size: "3840x2160", quality: "high" }, retryOf: "failed-max" });
    await fixture.repository.saveSupplierVerification(record, record.revision);
    await fixture.service.plan(supplier.id, true);
    expect((await fixture.repository.getSupplierVerification(supplier.id))?.cases[0]).toMatchObject({ quality: "high", parameters: { quality: "high" } });
    const fixed = await planFixture(model("gpt-image-2.5-flare-high"));
    fixed.dependencies.document = async () => "不支持 high";
    await fixed.service.plan(supplier.id, true);
    expect((await fixed.repository.getSupplierVerification(supplier.id))?.cases[0]).toMatchObject({ status: "cancelled" });
    expect(fixed.submit).not.toHaveBeenCalled();
  });
});
