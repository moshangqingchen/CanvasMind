import { describe, it, expect, vi } from "vitest";
import {
  MemoryRepository,
  type SupplierRecord,
  type ProviderConnectionRecord,
  type SupplierVerificationCase,
} from "@super-canvas/db";
import { ProviderHttpError, type ModelDescriptor } from "@super-canvas/providers";
import {
  classifyActualResolution,
  effectiveImageCapabilities,
  reconcileVerificationCharge,
  verificationParameters,
} from "./supplier-capabilities";
import {
  SupplierVerificationService,
  verificationFingerprint,
  publicVerification,
  EmptyVerificationImageError,
  shouldAutomaticallyVerifyConnection,
  type VerificationDependencies,
} from "./supplier-verification-service";

const model: ModelDescriptor = {
  id: "gpt-image-2",
  name: "GPT Image 2",
  operations: ["image.generate"],
};
const supplier: SupplierRecord = {
  id: "supplier-test",
  name: "Test",
  supplierKey: "test",
  apiUrl: "https://example.com",
  siteUrl: "https://example.com",
  kind: "newapi",
  catalog: { groups: [] },
  scanStatus: "live",
  createdAt: "2026-09-21",
  updatedAt: "2026-09-21",
};
const connection: ProviderConnectionRecord = {
  id: "connection-test",
  name: "Test",
  provider: "openai",
  config: { supplierId: supplier.id, modelGroup: "默认分组", usage: "canvas" },
  encryptedSecret: "cipher-a",
  createdAt: "2026-09-21",
  updatedAt: "2026-09-21",
};
function capabilities(group: string, description = "", custom = model) {
  return effectiveImageCapabilities({
    supplier: {
      ...supplier,
      catalog: {
        groups: [
          {
            id: group,
            label: group,
            models: [],
            details: { source: "model-plaza", description },
          },
        ],
      },
    },
    connection: {
      ...connection,
      config: { ...connection.config, modelGroup: group },
    },
    model: custom,
    fingerprint: "fingerprint",
  });
}

describe("supplier capability decisions", () => {
  it("keeps resolution-valued quality fields and their case in the actual verification request", () => {
    const result = capabilities("图片", "", { ...model, id: "gemini-3-pro-image-preview", parameters: [
      { key: "quality", label: "分辨率", control: "select", default: "4k", options: ["1k", "2k", "4k"].map(value => ({ value, label: value })) },
      { key: "aspect_ratio", label: "比例", control: "select", options: [{ value: "16:9", label: "16:9" }] },
    ] });
    expect(result.tiers.map(t => t.tier)).toEqual(["1K", "2K", "4K"]);
    expect(result.model.parameters?.find(p => p.key === "quality")).toMatchObject({ label: "分辨率", default: "4k" });
    expect(result.qualityKey).toBeUndefined();
    expect(result.needsQualityProbe).toBe(false);
    expect(verificationParameters(result, "4K").parameters).toEqual({ n: 1, quality: "4k", aspect_ratio: "16:9" });
  });
  it("uses documented pixels for probes and never invents a tier outside a native enum", () => {
    const pixels = capabilities("图片", "支持4K", { ...model, id: "banana", parameters: [
      { key: "size", label: "尺寸", control: "dimensions", max: 5504, options: [{ value: "5504x3072", label: "4K · 16:9" }] },
    ] });
    expect(verificationParameters(pixels, "4K")).toMatchObject({ parameters: { size: "5504x3072" }, width: 5504, height: 3072 });
    const limited = capabilities("图片", "", { ...model, id: "banana", parameters: [
      { key: "image_size", label: "尺寸", control: "select", default: "2K", options: [{ value: "2K", label: "2K" }] },
    ] });
    expect(limited.probeTiers).toEqual(["2K"]);
    expect(limited.tiers.map(t => t.tier)).toEqual(["2K"]);
  });
  it("opens all declared tiers from a cached compact group description without claiming paid verification", () => {
    const result = capabilities("image2.5特价", "image2.5特价，0.06一张 124K", { ...model, id: "gpt-image-2.5-all" });
    expect(result.tiers.map(tier => ({ tier: tier.tier, status: tier.status }))).toEqual([
      { tier: "1K", status: "declared" }, { tier: "2K", status: "declared" }, { tier: "4K", status: "declared" },
    ]);
    const sizes = result.model.parameters?.find(parameter => parameter.key === "size")?.options ?? [];
    expect(sizes.some(option => option.value === "auto")).toBe(true);
    for (const tier of ["1K", "2K", "4K"])
      expect(sizes.filter(option => option.label.startsWith(tier))).toHaveLength(11);
    expect(sizes.some(option => option.label.startsWith("2K") && /^\d+x\d+$/u.test(String(option.value)))).toBe(true);
    expect(sizes.some(option => option.label.startsWith("4K") && option.value === "3840x2160")).toBe(true);
    expect(result.evidence.filter(item => item.resolution).every(item => item.kind === "group")).toBe(true);
    expect(result.model.parameters?.find(parameter => parameter.key === "quality")).toMatchObject({
      default: "max", options: ["auto", "low", "medium", "high", "xhigh", "max"].map(value => ({ value })),
    });
  });
  it("expands declared native ratio controls and a declared highest quality without fabricating test evidence", () => {
    const result = capabilities("图片", "支持4K，quality: max", { ...model, id: "gpt-image-2.5-all", parameters: [
      { key: "image_size", label: "尺寸", control: "select", options: [{ value: "4K", label: "4K" }] },
      { key: "aspect_ratio", label: "比例", control: "select", options: [{ value: "16:9", label: "16:9" }] },
    ] });
    expect(result.model.parameters?.find(parameter => parameter.key === "aspect_ratio")?.options).toHaveLength(12);
    expect(result.model.parameters?.find(parameter => parameter.key === "aspect_ratio")?.options?.[0]?.value).toBe("auto");
    expect(result.model.parameters?.find(parameter => parameter.key === "quality")?.options).toHaveLength(6);
    expect(result.evidence.some(item => item.kind === "test")).toBe(false);
  });
  it("preserves declared pixel choices while adding all ratios, and keeps explicit quality rejections", () => {
    const result = capabilities("图片", "支持2K，quality: max", { ...model, id: "gpt-image-2.5-all", parameters: [
      { key: "size", label: "尺寸", control: "dimensions", options: [{ value: "2560x1440", label: "2K · 16:9" }] },
    ] });
    const sizes = result.model.parameters?.find(parameter => parameter.key === "size")?.options ?? [];
    expect(sizes.filter(option => option.label.startsWith("2K"))).toHaveLength(11);
    expect(sizes.find(option => option.label.startsWith("2K · 16:9"))?.value).toBe("2560x1440");
    const limited = capabilities("图片", "支持4K；支持 max；不支持 low", { ...model, id: "gpt-image-2.5-all" });
    expect(limited.model.parameters?.find(parameter => parameter.key === "quality")?.options?.map(o=>o.value)).toEqual(["auto", "medium", "high", "xhigh", "max"]);
  });
  it.each(["gpt-image-2.5", "nano-banana2-4k"])("fills the independent ratio menu for %s without adding a resolution control", id => {
    const result = capabilities("图片", "", { ...model, id, parameters: [
      { key: "aspect_ratio", label: "比例", control: "select", default: "16:9", options: [{ value: "16:9", label: "16:9 (documented)" }] },
    ] });
    const ratio = result.model.parameters?.find(p => p.key === "aspect_ratio");
    expect(ratio?.options).toHaveLength(12);
    expect(ratio?.options).toContainEqual({ value: "16:9", label: "16:9 (documented)" });
    expect(ratio?.options).toContainEqual({ value: "9:21", label: "9:21" });
    expect(ratio?.default).toBe("16:9");
    expect(result.evidence.some(e => e.kind === "test")).toBe(false);
    if (id === "nano-banana2-4k") expect(result.model.parameters?.some(p => p.key === "size")).toBe(false);
  });
  it.each([
    ["gpt-image-2.5-flare", "max", ["auto", "low", "medium", "high", "xhigh", "max"]],
    ["gpt-image-2", "high", ["low", "medium", "high"]],
  ] as const)("opens all quality options for %s after its highest request succeeds", (id, highest, values) => {
    const currentModel: ModelDescriptor = { ...model, id, parameters: [{ key: "quality", label: "质量", control: "select", options: [{ value: highest, label: highest }] }] };
    const passed: SupplierVerificationCase = {
      id: "passed", requestId: "request", supplierId: supplier.id, sourceId: "source", connectionId: connection.id,
      group: "默认分组", modelId: id, provider: "openai", fingerprint: "f", dedupeKey: "d",
      resolution: "1K", ratio: "1:1", expectedWidth: 1024, expectedHeight: 1024, actualWidth: 1024, actualHeight: 1024,
      quality: highest, parameters: { size: "1024x1024", quality: highest }, status: "succeeded", createdAt: "now", updatedAt: "now",
    };
    const get = (tests: SupplierVerificationCase[], fingerprint = "f") => effectiveImageCapabilities({ supplier, connection, model: currentModel, fingerprint, tests });
    const result = get([passed]);
    expect(result.model.parameters?.find(p => p.key === "quality")).toMatchObject({ default: highest, options: values.map(value => ({ value })) });
    expect(result.model.parameters?.find(p => p.key === "quality")?.description).toContain("未逐档实测");
    expect(result.evidence.filter(e => e.quality)).toHaveLength(1);
    expect(result.evidence.find(e => e.quality)?.quality).toBe(highest);
    for (const tests of [[{ ...passed, status: "inconclusive" as const }], [{ ...passed, modelId: "other" }], [{ ...passed, connectionId: "other" }]]) {
      expect(get(tests).model.parameters?.find(p => p.key === "quality")?.options?.map(o=>o.value)).toEqual(values);
      expect(get(tests).evidence.some(e => e.quality && e.status === "verified")).toBe(false);
    }
    expect(get([passed], "changed-key").evidence.some(e => e.quality && e.status === "verified")).toBe(false);
    if (highest === "max") expect(get([{ ...passed, quality: "high" }]).model.parameters?.find(p => p.key === "quality")?.options?.map(o=>o.value)).toEqual(values);
    const rejected = { ...passed, id: "rejected", quality: "low", status: "unsupported" as const, rejectedParameter: "quality" as const };
    expect(get([passed, rejected]).model.parameters?.find(p => p.key === "quality")?.options?.some(o => o.value === "low")).toBe(false);
    const fixed = effectiveImageCapabilities({ supplier: { ...supplier, apiUrl: "https://token.secure-skill.com/v1" }, connection, model: { ...currentModel, parameters: [] }, fingerprint: "f", tests: [passed] });
    if (id === "gpt-image-2") expect(fixed.model.parameters?.some(p => p.key === "quality")).toBe(false);
  });
  it("unlocks every ratio and infers 2K from 4K without inventing a 2K paid result", () => {
    const passed: SupplierVerificationCase = {
      id: "passed", requestId: "request", supplierId: supplier.id, sourceId: "source", connectionId: connection.id,
      group: "默认分组", modelId: model.id, provider: "openai", fingerprint: "f", dedupeKey: "d",
      resolution: "4K", ratio: "16:9", expectedWidth: 3840, expectedHeight: 2160,
      actualWidth: 3840, actualHeight: 2160, parameters: { size: "3840x2160" },
      status: "succeeded", createdAt: "now", updatedAt: "now",
    };
    const result = effectiveImageCapabilities({ supplier, connection, model, fingerprint: "f", tests: [passed] });
    const size = result.model.parameters!.find(p => p.key === "size")!;
    expect(size.options?.some(o => o.value === "auto")).toBe(true);
    expect(size.options?.filter(o => o.label.startsWith("4K"))).toHaveLength(11);
    expect(size.options?.some(o => o.value === "2160x3840")).toBe(true);
    expect(result.tiers.map(t => t.tier)).toEqual(["1K", "2K", "4K"]);
    expect(size.options?.filter(o => o.label.startsWith("2K"))).toHaveLength(11);
    expect(result.evidence.find(e => e.resolution === "2K")).toMatchObject({ status: "inferred", kind: "inference", actualWidth: undefined, actualHeight: undefined });
    expect(result.evidence.find(e => e.resolution === "2K")?.excerpt).toContain("未另行生成");
    expect(result.evidence.filter(e => e.kind === "test")).toHaveLength(1);
    expect(result.evidence.find(e => e.kind === "test")?.excerpt).toContain("仅核验 16:9");
    expect(effectiveImageCapabilities({ supplier, connection, model, fingerprint: "f", tests: [{ ...passed, id: "old", status: "unsupported" }, passed] }).tiers.some(t => t.tier === "4K")).toBe(true);
    expect(effectiveImageCapabilities({ supplier, connection, model, fingerprint: "different", tests: [passed] }).tiers.map(t => [t.tier, t.status])).toEqual([["1K", "assumed"], ["4K", "assumed"]]);
    for (const other of [{ ...passed, connectionId: "other" }, { ...passed, modelId: "other" }, { ...passed, fingerprint: "changed-key" }])
      expect(effectiveImageCapabilities({ supplier, connection, model, fingerprint: "f", tests: [other] }).tiers.map(t => [t.tier, t.status])).toEqual([["1K", "assumed"], ["4K", "assumed"]]);
    const overloaded2K = { ...passed, id: "overloaded", resolution: "2K" as const, status: "inconclusive" as const, actualWidth: undefined, actualHeight: undefined };
    expect(effectiveImageCapabilities({ supplier, connection, model, fingerprint: "f", tests: [overloaded2K, passed] }).tiers).toContainEqual({ tier: "2K", status: "inferred" });
    const native = effectiveImageCapabilities({ supplier, connection, model: { ...model, id: "banana" }, fingerprint: "f",
      tests: [{ ...passed, modelId: "banana", ratio: "1:1", parameters: { image_size: "4K", aspect_ratio: "1:1" } }] });
    expect(native.model.parameters?.find(p => p.key === "image_size")?.options?.some(o => o.value === "4K")).toBe(true);
    expect(native.model.parameters?.find(p => p.key === "aspect_ratio")?.options).toHaveLength(12);
  });
  it("binds evidence to routing headers and actual account group without invalidating equivalent group aliases", () => {
    const original=verificationFingerprint(connection,"key");
    expect(verificationFingerprint({...connection,config:{...connection.config,accountKeyGroup:"默认分组"}},"key")).toBe(original);
    expect(verificationFingerprint({...connection,config:{...connection.config,accountKeyGroup:"other"}},"key")).not.toBe(original);
    expect(verificationFingerprint({...connection,config:{...connection.config,headers:{"x-routing-group":"other"}}},"key")).not.toBe(original);
  });
  it("scopes an automatically discovered route to one model without invalidating paid evidence for other models", () => {
    const before = verificationFingerprint(connection, "key", "old-image");
    const next = { ...connection, config: { ...connection.config, autoModelInterfaces: {
      "new-image": { connector: { submit: { path: "/new" }, output: { path: "$.url", kind: "image" } }, model: { id: "new-image" } },
    } } } as typeof connection;
    expect(verificationFingerprint(next, "key", "old-image")).toBe(before);
    expect(verificationFingerprint(next, "key", "new-image")).not.toBe(before);
    const edited = structuredClone(next);
    (edited.config.autoModelInterfaces as Record<string, { connector: { submit: { path: string } } }>)["new-image"]!.connector.submit.path = "/changed";
    expect(verificationFingerprint(edited, "key", "new-image")).not.toBe(verificationFingerprint(next, "key", "new-image"));
  });
  it("does not resolution-test 1K groups; tests highest quality once", () => {
    const result = capabilities("生图（1k）");
    expect(result.tiers.map((t) => t.tier)).toEqual(["1K"]);
    expect(result.probeTiers).toEqual(["1K"]);
    expect(result.quality).toBe("high");
  });
  it("recognizes a named 1K group and scoped quality documentation", () => {
    expect(capabilities("1k分组").probeTiers).toEqual(["1K"]);
    expect(capabilities("1k低价生图").probeTiers).toEqual(["1K"]);
    expect(capabilities("生图（原生4k").tiers.map(t=>t.tier)).toEqual(["1K", "2K", "4K"]);
    const result = effectiveImageCapabilities({
      supplier,
      connection,
      model: { ...model, metadata: { documentationUrl: "https://example.com/docs/gpt-image-2" } },
      fingerprint: "f",
      documentation: "支持 1K、2K、4K，quality: high",
    });
    expect(result.probeTiers).toEqual([]);
    expect(result.quality).toBe("high");
    expect(result.evidence.find(e => e.kind === "documentation")?.sourceUrl).toBe("https://example.com/docs/gpt-image-2");
  });
  it("adds 2K and 4K for a 4K group without generating a baseline", () => {
    const result = capabilities("生图（4k）", "高质量");
    expect(result.tiers.map((t) => t.tier)).toEqual(["1K", "2K", "4K"]);
    expect(result.probeTiers).toEqual([]);
    expect(result.quality).toBe("high");
  });
  it("does not test explicit exclusions or grant a different fixed SKU", () => {
    expect(
      capabilities("图片", "支持1K，不支持2K和4K，高质量").probeTiers,
    ).toEqual([]);
    const fixed = capabilities("4K分组", "高质量", {
      ...model,
      id: "gpt-image-2-4k",
    });
    expect(fixed.tiers.map((t) => t.tier)).toEqual(["4K"]);
  });
  it("probes only missing sizes at the highest legal quality", () => {
    const result = capabilities("普通图片");
    expect(result.probeTiers).toEqual(["4K"]);
    expect(result.tiers).toMatchObject([{ tier: "1K", status: "assumed" }, { tier: "4K", status: "assumed" }]);
    expect(result.model.parameters?.find(parameter => parameter.key === "size")?.options?.filter(option => option.label.startsWith("4K"))).toHaveLength(11);
    expect(result.evidence.find(entry => entry.resolution === "4K")).toMatchObject({ status: "assumed", excerpt: expect.stringContaining("待核验") });
  });
  it("keeps a newly imported Sunburst's pending 4K selectable without inventing verified capability", async () => {
    const sunburst = { ...model, id: "gpt-image-2.5-sunburst" };
    const f = await fixture({ models: async () => [sunburst] });
    await f.service.plan(supplier.id);
    const planned = (await f.repository.getSupplierVerification(supplier.id))!;
    const result = effectiveImageCapabilities({ supplier, connection, model: sunburst,
      fingerprint: verificationFingerprint(connection, "server-secret", sunburst.id), tests: planned.cases });
    expect(planned.cases[0]).toMatchObject({ resolution: "4K", quality: "max", status: "queued", parameters: { size: "3840x2160" } });
    expect(result.tiers.map(item => [item.tier, item.status])).toEqual([["1K", "assumed"], ["4K", "assumed"]]);
    expect(result.probeTiers).toEqual([]);
    expect(f.submit).not.toHaveBeenCalled();
  });
  it("uses the user's 1536/3072 long-edge thresholds while retaining the aspect tolerance and exact pixels", () => {
    expect(classifyActualResolution(3584, 2016, 3840, 2160)).toBe(
      "approximate",
    );
    expect(classifyActualResolution(3072, 1728, 3840, 2160)).toBe(
      "approximate",
    );
    expect(classifyActualResolution(3840, 3840, 3840, 2160)).toBe(
      "unsupported",
    );
    expect(classifyActualResolution(3840, 2160, 3840, 2160)).toBe("verified");
    expect(classifyActualResolution(1672, 941, 2720, 1536, "2K")).toBe("approximate");
    expect(classifyActualResolution(941, 1672, 1536, 2720, "2K")).toBe("approximate");
    expect(classifyActualResolution(1536, 864, 2720, 1536, "2K")).toBe("approximate");
    expect(classifyActualResolution(1535, 864, 2720, 1536, "2K")).toBe("unsupported");
    expect(classifyActualResolution(3071, 1728, 3840, 2160, "4K")).toBe("unsupported");
    expect(classifyActualResolution(1672, 941, 3840, 2160, "4K")).toBe("unsupported");
    expect(classifyActualResolution(0, 0, 3840, 2160, "4K")).toBe("unsupported");
  });
  it("never joins charges by time or converts undeclared currencies", () => {
    const expected = {
      amount: 0.1,
      currency: "credits",
      unit: "image" as const,
      checkedAt: "now",
    };
    expect(
      reconcileVerificationCharge(
        expected,
        { ...expected, requestId: "different" },
        "request",
      ),
    ).toBe("unknown");
    expect(
      reconcileVerificationCharge(
        expected,
        { ...expected, currency: "CNY", requestId: "request" },
        "request",
      ),
    ).toBe("unknown");
    expect(
      reconcileVerificationCharge(
        expected,
        { ...expected, requestId: "request" },
        "request",
      ),
    ).toBe("matched");
    expect(
      reconcileVerificationCharge(
        expected,
        { ...expected, amount: 0.2, requestId: "request" },
        "request",
      ),
    ).toBe("mismatch");
  });
});

describe("automatic connection onboarding", () => {
  it("starts for new keys, routing changes, enabled connections and added models", () => {
    expect(shouldAutomaticallyVerifyConnection(null, connection)).toBe(true);
    for (const changed of [
      { ...connection, encryptedSecret: "cipher-b" },
      { ...connection, config: { ...connection.config, headers: { "x-group": "other" } } },
      { ...connection, config: { ...connection.config, modelGroup: "other" } },
      { ...connection, config: { ...connection.config, manualModels: [{ id: "new-image" }] } },
      { ...connection, config: { ...connection.config, usage: "agent" } },
      { ...connection, config: { ...connection.config, directorProtocol: "openai-responses" } },
    ]) expect(shouldAutomaticallyVerifyConnection(connection, changed)).toBe(true);
    expect(shouldAutomaticallyVerifyConnection({ ...connection, config: { ...connection.config, usage: "disabled" } }, connection)).toBe(true);
  });
  it("does not schedule for reads, default/name/hosting saves or disabled connections", () => {
    expect(shouldAutomaticallyVerifyConnection(connection, connection)).toBe(false);
    expect(shouldAutomaticallyVerifyConnection(connection, { ...connection, name: "renamed", config: { ...connection.config, defaultModel: "new", referenceImageHosting: "litterbox-24h", modelScanRequestId: "scan" } })).toBe(false);
    for (const next of [
      { ...connection, encryptedSecret: undefined },
      { ...connection, config: { ...connection.config, usage: "disabled" } },
      { ...connection, config: { ...connection.config, supplierArchived: true } },
    ]) expect(shouldAutomaticallyVerifyConnection(null, next)).toBe(false);
  });
});

async function fixture(overrides: Partial<VerificationDependencies> = {}) {
  const repository = new MemoryRepository();
  await repository.saveSupplier(supplier);
  await repository.saveConnection(connection);
  const submit = vi
    .fn<VerificationDependencies["submit"]>()
    .mockResolvedValue({
      providerTaskId: "remote-task",
      status: "succeeded",
      result: { image: "fake" },
    });
  const deps: VerificationDependencies = {
    repository,
    fingerprintKey: "server-secret",
    models: async () => [model],
    submit,
    poll: async (_, task) => task,
    archive: async (test) => ({
      assetId: `asset-${test.id}`,
      width: test.expectedWidth,
      height: test.expectedHeight,
    }),
    sleep: async () => {},
    ...overrides,
  };
  return {
    repository,
    submit,
    deps,
    service: new SupplierVerificationService(deps),
  };
}

describe("durable paid verification", () => {
  it("pauses image verification on non-retryable query authentication errors", async () => {
    const poll = vi.fn<VerificationDependencies["poll"]>(async () => {
      throw new ProviderHttpError("credential expired", { kind: "authentication", phase: "poll", status: 401, retryable: false, submissionMayHaveOccurred: false });
    });
    const f = await fixture({ poll });
    f.submit.mockResolvedValue({ providerTaskId: "known-image", status: "running" });
    await f.service.plan(supplier.id);
    await f.service.kick();
    expect(poll).toHaveBeenCalledOnce();
    expect(f.submit).toHaveBeenCalledOnce();
    const record = (await f.repository.getSupplierVerification(supplier.id))!;
    expect(record.cases[0]?.status).toBe("needs_attention");
    expect(record.cases[0]?.task?.providerTaskId).toBe("known-image");
  });

  it.each([false, true])("automatically starts a newly added Key after a preparation-only hold (legacy=%s)", async legacy => {
    const f = await fixture({ models: async () => [] });
    await f.service.plan(supplier.id, true);
    const prepared = (await f.repository.getSupplierVerification(supplier.id))!;
    if (legacy) {
      delete prepared.pauseReason;
      await f.repository.saveSupplierVerification(prepared, prepared.revision);
    }
    await f.repository.saveConnection({ ...connection, id: "new-key" });
    f.deps.models = async key => key.id === "new-key" ? [model] : [];
    await f.service.plan(supplier.id, false, { onboarding: true });
    await f.service.kick();
    expect(f.submit).toHaveBeenCalledOnce();
    expect(f.submit.mock.calls[0]?.[0].connectionId).toBe("new-key");
    expect((await f.repository.getSupplierVerification(supplier.id))!).toMatchObject({ paused: false, used: 1 });
    await f.service.plan(supplier.id, false, { onboarding: true });
    await f.service.kick();
    expect(f.submit).toHaveBeenCalledOnce();
  });
  it("keeps preview and ordinary planning from starting prepared paid cases", async () => {
    const f = await fixture();
    await f.service.plan(supplier.id, true);
    await f.service.plan(supplier.id);
    await f.service.kick();
    expect(f.submit).not.toHaveBeenCalled();
    expect((await f.repository.getSupplierVerification(supplier.id))!).toMatchObject({ paused: true, pauseReason: "preview" });
  });
  it("preserves an explicit user pause through another preview and a new Key", async () => {
    const f = await fixture();
    await f.service.plan(supplier.id, true);
    await f.service.action(supplier.id, "pause");
    await f.service.plan(supplier.id, true);
    await f.repository.saveConnection({ ...connection, id: "new-key" });
    await f.service.plan(supplier.id, false, { onboarding: true });
    await f.service.kick();
    expect(f.submit).not.toHaveBeenCalled();
    expect((await f.repository.getSupplierVerification(supplier.id))!).toMatchObject({ paused: true, pauseReason: "manual" });
  });
  it("preserves billing safety holds and unknown legacy pauses when a Key is added", async () => {
    for (const pauseReason of ["safety", undefined] as const) {
      const f = await fixture();
      await f.service.plan(supplier.id, true);
      const held = (await f.repository.getSupplierVerification(supplier.id))!;
      held.pauseReason = pauseReason;
      held.reason = "已有任务需要核对";
      await f.repository.saveSupplierVerification(held, held.revision);
      await f.service.plan(supplier.id, false, { onboarding: true });
      await f.service.kick();
      expect(f.submit).not.toHaveBeenCalled();
      expect((await f.repository.getSupplierVerification(supplier.id))?.paused).toBe(true);
    }
  });
  it("never releases a preparation hold containing a submitted result with unknown billing", async () => {
    const f = await fixture();
    await f.service.plan(supplier.id, true);
    const held = (await f.repository.getSupplierVerification(supplier.id))!;
    held.used = 1;
    Object.assign(held.cases[0]!, { submittedAt: "2026-09-24", status: "inconclusive" });
    await f.repository.saveSupplierVerification(held, held.revision);
    await f.repository.saveConnection({ ...connection, id: "new-key" });
    await f.service.plan(supplier.id, false, { onboarding: true });
    await f.service.kick();
    expect(f.submit).not.toHaveBeenCalled();
    expect((await f.repository.getSupplierVerification(supplier.id))?.paused).toBe(true);
  });
  it("automatically reads agent-only Keys without creating image probes, even for a mixed model list", async () => {
    const models = vi.fn(async () => [model, { id: "gpt-5.4", name: "GPT", operations: [] } as ModelDescriptor]);
    const f = await fixture({ models });
    await f.repository.saveConnection({ ...connection, config: { ...connection.config, usage: "agent" } });
    await f.service.plan(supplier.id);
    await f.service.kick();
    expect(models).toHaveBeenCalledOnce();
    expect(f.submit).not.toHaveBeenCalled();
    expect((await f.repository.getSupplierVerification(supplier.id))!.cases).toEqual([]);
  });
  it("walks multiple quality tiers at one size, persists rejections, and stops after success", async () => {
    const f = await fixture({ models: async () => [{ ...model, id: "gpt-image-2.5-flare", parameters: [{
      key: "quality", label: "质量", control: "select", options: ["low", "high", "xhigh", "max"].map(value => ({ value, label: value })),
    }] }] });
    f.submit.mockImplementation(async test => {
      if (test.quality === "max") throw Object.assign(new Error("unsupported quality"), { details: { status: 400, responseBody: { charged: false } } });
      if (test.quality === "xhigh") throw Object.assign(new Error("temporarily busy"), { details: { status: 503, responseBody: { charged: false } } });
      return { providerTaskId: test.id, status: "succeeded" };
    });
    await f.service.plan(supplier.id); await f.service.kick();
    expect(f.submit.mock.calls.map(([test]) => [test.resolution, test.quality])).toEqual([["4K", "max"], ["4K", "xhigh"], ["4K", "high"]]);
    const record = (await f.repository.getSupplierVerification(supplier.id))!;
    expect(record.cases.map(test => test.status)).toEqual(["unsupported", "inconclusive", "succeeded"]);
    expect(record.cases[1]?.rejectedParameter).toBeUndefined();
    await f.service.plan(supplier.id); await f.service.kick();
    expect(f.submit).toHaveBeenCalledTimes(3);
    const effective = effectiveImageCapabilities({ supplier, connection, model: (await f.deps.models(connection))[0]!, fingerprint: verificationFingerprint(connection, "server-secret"), tests: record.cases });
    expect(effective.model.parameters?.find(p => p.key === "quality")?.default).toBe("high");
    expect(effective.model.parameters?.find(p => p.key === "quality")?.options?.some(option => option.value === "max")).toBe(false);
  });
  it.each(["quality", "size"])("requires confirmed no charge before retrying an explicit %s rejection, including resume and restart", async parameter => {
    const charge = vi.fn<NonNullable<VerificationDependencies["charge"]>>(async () => undefined);
    const f = await fixture({ charge });
    f.submit.mockRejectedValueOnce(Object.assign(new Error("unsupported " + parameter), {details:{status:400}}));
    await f.service.plan(supplier.id); await f.service.kick();
    const first = (await f.repository.getSupplierVerification(supplier.id))!;
    expect(first.paused).toBe(true);
    expect(first.cases).toHaveLength(1);
    expect(first.cases[0]).toMatchObject({status:"unsupported",rejectedParameter:parameter === "quality" ? "quality" : "resolution"});
    await expect(f.service.action(supplier.id,"resume")).rejects.toThrow("核对");
    await new SupplierVerificationService(f.deps).kick();
    expect(f.submit).toHaveBeenCalledTimes(1);
    charge.mockImplementation(async (_, test) => ({amount:0,currency:"CNY",unit:"request",checkedAt:"now",requestId:test.requestId}));
    await f.service.action(supplier.id,"reconcile");
    expect(f.submit).toHaveBeenCalledTimes(1);
    await f.service.action(supplier.id,"resume"); await f.service.kick();
    expect(f.submit).toHaveBeenCalledTimes(2);
    expect(f.submit.mock.calls[1]?.[0]).toMatchObject(parameter === "quality" ? {resolution:"4K",quality:"medium"} : {resolution:"2K",quality:"high"});
  });
  it("does not treat an absent bill or a failed billing lookup as no charge", async () => {
    for (const charge of [async () => undefined, async () => { throw new Error("billing offline"); }]) {
      const f = await fixture({ charge });
      f.submit.mockRejectedValue(Object.assign(new Error("gateway busy"), { details: { status: 503 } }));
      await f.service.plan(supplier.id); await f.service.kick();
      expect(f.submit).toHaveBeenCalledTimes(1);
      expect((await f.repository.getSupplierVerification(supplier.id))?.paused).toBe(true);
    }
  });
  it("uses a request-matched zero charge to retry a failed asynchronous task", async () => {
    const f = await fixture({ charge: async (_, test) => ({ amount: test.quality === "high" ? 0 : 0.1, currency: "CNY", unit: "image", checkedAt: "now", requestId: test.requestId }) });
    f.submit.mockImplementation(async test => ({ providerTaskId: test.id, status: test.quality === "high" ? "failed" : "succeeded", error: "busy" }));
    await f.service.plan(supplier.id); await f.service.kick();
    expect(f.submit.mock.calls.map(([test]) => test.quality)).toEqual(["high", "medium"]);
  });
  it("keeps highest capabilities provisional on upstream account outages and continues other models", async () => {
    const f = await fixture({ models: async () => [model, { ...model, id: "gpt-image-2-other" }] });
    f.submit.mockRejectedValueOnce(Object.assign(new Error("No available accounts for this group"), { details: { status: 503 } }));
    await f.service.plan(supplier.id); await f.service.kick();
    const record = (await f.repository.getSupplierVerification(supplier.id))!;
    expect(record.paused).toBe(false);
    expect(record.cases[0]).toMatchObject({ status: "inconclusive", provisional: true, resolution: "4K", quality: "high" });
    const effective = effectiveImageCapabilities({ supplier, connection, model, fingerprint: verificationFingerprint(connection, "server-secret"), tests: record.cases });
    expect(effective.tiers).toContainEqual({ tier: "4K", status: "assumed", width: undefined, height: undefined });
    expect(effective.probeTiers).toEqual([]);
    expect(record.cases.find(test => test.modelId === "gpt-image-2-other")?.status).toBe("succeeded");
  });
  it("does not reclassify an undersized returned image as unsupported or buy another image", async () => {
    const f = await fixture({ archive: async () => ({ assetId: "small", width: 1024, height: 576 }) });
    await f.service.plan(supplier.id); await f.service.kick();
    await f.service.plan(supplier.id); await f.service.kick();
    expect(f.submit).toHaveBeenCalledTimes(1);
    expect((await f.repository.getSupplierVerification(supplier.id))?.cases[0]).toMatchObject({ status: "inconclusive", resolutionMismatch: true, rejectedParameter: undefined, actualWidth: 1024 });
  });
  it("retries a free failure at the lowest quality later without a tight loop", async () => {
    const f = await fixture({ models: async () => [{ ...model, parameters: [{ key: "quality", label: "Q", control: "select", options: [{value:"low",label:"low"}] }] }] });
    f.submit.mockRejectedValue(Object.assign(new Error("busy"), { details: { status: 503, responseBody: { billed: false } } }));
    await f.service.plan(supplier.id); await f.service.kick();
    expect(f.submit).toHaveBeenCalledTimes(1);
    const record = (await f.repository.getSupplierVerification(supplier.id))!;
    expect(record.cases[1]).toMatchObject({ status: "queued", quality: "low", retryOf: record.cases[0]?.id, nextAttemptAt: expect.any(String) });
    await f.service.action(supplier.id, "cancel");
  });
  it("uses explicit channel quality/resolution declarations without generating", async () => {
    const f = await fixture({ models: async () => [{ ...model, metadata: { supplierChannelDescription: "支持1K、2K、4K；支持low，medium，high" } }] });
    await f.service.plan(supplier.id); await f.service.kick();
    expect(f.submit).not.toHaveBeenCalled();
  });
  it("recovers a saved free failure after a crash between failure and retry persistence", async () => {
    const f = await fixture(); await f.service.plan(supplier.id, true);
    const record = (await f.repository.getSupplierVerification(supplier.id))!;
    const first = record.cases[0]!;
    first.status = "inconclusive"; first.submittedAt = "2026-09-23";
    first.actualCharge = { amount: 0, currency: "CNY", unit: "image", checkedAt: "now", requestId: first.requestId };
    record.paused = false; record.used = 1;
    await f.repository.saveSupplierVerification(record, record.revision);
    await new SupplierVerificationService(f.deps).kick();
    expect(f.submit).toHaveBeenCalledTimes(1);
    expect(f.submit.mock.calls[0]?.[0].quality).toBe("medium");
    expect(f.submit.mock.calls[0]?.[0].requestId).not.toBe(first.requestId);
  });
  it("cancels an old queued test when new free documentation fully settles its capabilities", async () => {
    const f = await fixture(); await f.service.plan(supplier.id, true);
    f.deps.document = async () => "支持1K、2K、4K；quality: high";
    await f.service.plan(supplier.id, true); await f.service.action(supplier.id, "resume"); await f.service.kick();
    expect(f.submit).not.toHaveBeenCalled();
  });
  it("pays once for 4K and keeps inferred 2K after restart and replanning", async () => {
    const f = await fixture();
    await f.service.plan(supplier.id); await f.service.kick();
    const record = (await f.repository.getSupplierVerification(supplier.id))!;
    expect(f.submit.mock.calls.map(([test]) => test.resolution)).toEqual(["4K"]);
    expect(record.used).toBe(1); expect(record.limit).toBe(1);
    const skipped = record.cases.find(test => test.resolution === "2K");
    expect(skipped).toBeUndefined();
    expect(skipped?.submittedAt).toBeUndefined(); expect(skipped?.assetId).toBeUndefined();
    expect(record.evidence.find(item => item.resolution === "2K")).toMatchObject({ status: "inferred", kind: "inference" });
    const repository = new MemoryRepository(f.repository.exportSnapshot());
    const restarted = new SupplierVerificationService({ ...f.deps, repository });
    await restarted.plan(supplier.id); await restarted.kick();
    expect(f.submit).toHaveBeenCalledTimes(1);
    expect((await repository.getSupplierVerification(supplier.id))?.evidence.find(item => item.resolution === "2K")?.status).toBe("inferred");
  });
  it("falls back to one 2K probe only when 4K is explicitly unsupported", async () => {
    const f = await fixture();
    f.submit.mockRejectedValueOnce(Object.assign(new Error("unsupported size"), { details: { status: 400, responseBody: { charged: false } } }));
    await f.service.plan(supplier.id); await f.service.kick();
    await f.service.plan(supplier.id); await f.service.kick();
    expect(f.submit.mock.calls.map(([test]) => test.resolution)).toEqual(["4K", "2K"]);
    const record = (await f.repository.getSupplierVerification(supplier.id))!;
    expect(record.cases.map(test => test.status)).toEqual(["unsupported", "succeeded"]);
    expect(record.evidence.find(item => item.resolution === "2K")?.status).toBe("verified");
  });
  it("replaces an old 2K-first queue with one 4K request and respects disabled connections", async () => {
    const f = await fixture(); await f.service.plan(supplier.id);
    const old = (await f.repository.getSupplierVerification(supplier.id))!;
    old.cases.reverse();
    await f.repository.saveSupplierVerification(old, old.revision);
    await f.service.kick();
    expect(f.submit.mock.calls.map(([test]) => test.resolution)).toEqual(["4K"]);
    const disabled = await fixture(); await disabled.service.plan(supplier.id);
    await disabled.repository.saveConnection({ ...connection, config: { ...connection.config, usage: "disabled" } });
    await disabled.service.kick();
    expect(disabled.submit).not.toHaveBeenCalled();
  });
  it("never schedules video models for paid probes, including stale mixed operation declarations", async () => {
    const f = await fixture({ models: async () => [
      { ...model, id: "grok-imagine-video", operations: ["video.generate", "video.image-to-video"], inputKinds: ["image"], outputKinds: ["video"] },
      { ...model, id: "opaque-video", metadata: { catalogCapability: "video" } },
    ] });
    await f.service.plan(supplier.id); await f.service.kick();
    expect((await f.repository.getSupplierVerification(supplier.id))?.cases).toHaveLength(0);
    expect(f.submit).not.toHaveBeenCalled();
  });
  it("identifies a completed but empty image response without retrying or claiming unsupported", async () => {
    const f = await fixture({ archive: async () => { throw new EmptyVerificationImageError(); } });
    await f.service.plan(supplier.id); await f.service.kick();
    const record = (await f.repository.getSupplierVerification(supplier.id))!;
    expect(record.used).toBe(1); expect(record.paused).toBe(true);
    expect(record.cases[0]).toMatchObject({ status: "inconclusive", reason: expect.stringContaining("没有提供图片") });
    await f.service.action(supplier.id, "reconcile");
    expect(f.submit).toHaveBeenCalledTimes(1);
  });
  it("never reserves or submits a case rejected by local adapter validation", async () => {
    const f = await fixture({validate:async()=>"当前协议不接受此尺寸"});
    await f.service.plan(supplier.id); await f.service.kick();
    const record=(await f.repository.getSupplierVerification(supplier.id))!;
    expect(record.used).toBe(0);expect(f.submit).not.toHaveBeenCalled();
    expect(record.cases.every(c=>c.status==="cancelled"&&c.reason?.startsWith("未提交："))).toBe(true);
  });
  it("cancels unsubmitted 2K/4K cases when free group evidence restricts it to 1K", async () => {
    const f = await fixture(); await f.service.plan(supplier.id, true);
    await f.repository.saveSupplier({...supplier, catalog:{groups:[{id:"默认分组",label:"默认分组",models:[],details:{source:"model-plaza",supportedResolutions:["1K"],exclusiveResolutions:true}}]}});
    await f.service.plan(supplier.id, true);
    const record = (await f.repository.getSupplierVerification(supplier.id))!;
    expect(record.used).toBe(0);
    expect(record.cases.filter(c=>c.status==="queued").map(c=>c.resolution)).toEqual(["1K"]);
    await f.service.action(supplier.id,"resume"); await f.service.kick();
    expect(f.submit).toHaveBeenCalledTimes(1);
    expect(f.submit.mock.calls[0]?.[0].resolution).toBe("1K");
  });
  it("prepares reviewable cases without spending even when another queue wake occurs", async () => {
    const f = await fixture(); await f.service.plan(supplier.id, true); await f.service.kick();
    expect(f.submit).not.toHaveBeenCalled();
    expect((await f.repository.getSupplierVerification(supplier.id))?.cases).toHaveLength(1);
    await f.service.action(supplier.id, "resume"); await f.service.kick();
    expect(f.submit).toHaveBeenCalledTimes(1);
  });

  it("pauses balance/limit errors without declaring the capability unsupported or blocking recovery", async () => {
    for (const status of [402, 429]) {
      const f = await fixture();
      f.submit.mockRejectedValueOnce(Object.assign(new Error("rejected"), { details: { status } }));
      await f.service.plan(supplier.id); await f.service.kick();
      const record = (await f.repository.getSupplierVerification(supplier.id))!;
      expect(record.used).toBe(1); expect(record.paused).toBe(true); expect(record.cases[0]?.status).toBe("inconclusive");
    }
  });

  it("imports the legacy uncertain request by its connection-to-supplier binding", async () => {
    const f = await fixture();
    await f.repository.saveConnection({ ...connection, id: "ff52083f-e2bb-4563-9323-1c3e05971e9d" });
    await f.service.plan(supplier.id); await f.service.kick();
    const record = (await f.repository.getSupplierVerification(supplier.id))!;
    expect(record.used).toBe(1);
    expect(record.paused).toBe(true);
    expect(record.cases[0]?.requestId).toBe("0ddc7ea3-f7cc-4d13-bfc2-8767dda1193f");
    expect(f.submit).not.toHaveBeenCalled();
  });

  it("reserves before submitting and covers every model beyond the old six-case cap", async () => {
    const f = await fixture({
      models: async () =>
        Array.from({ length: 8 }, (_, i) => ({
          ...model,
          id: `gpt-image-2-${i}`,
        })),
    });
    f.submit.mockImplementation(async (test) => {
      const saved = (await f.repository.getSupplierVerification(supplier.id))!;
      expect(saved.cases.find((item) => item.id === test.id)?.status).toBe(
        "submitting",
      );
      expect(saved.used).toBeGreaterThan(0);
      return { providerTaskId: test.id, status: "succeeded" };
    });
    await Promise.all([
      f.service.plan(supplier.id),
      f.service.plan(supplier.id),
    ]);
    await Promise.all([f.service.kick(), f.service.kick()]);
    await f.service.plan(supplier.id);
    await f.service.kick();
    expect(f.submit).toHaveBeenCalledTimes(8);
    expect(
      (await f.repository.getSupplierVerification(supplier.id))?.used,
    ).toBe(8);
  });
  it.each([401, 403])("isolates HTTP %s to the rejected Key and continues another group's 4K probe after restart", async status => {
    const f = await fixture({ models: async () => [model, { ...model, id: "gpt-image-2-other" }] });
    const other = { ...connection, id: "z-new-key", config: { ...connection.config, modelGroup: "新全参分组" } };
    await f.repository.saveConnection(other);
    f.submit.mockImplementation(async test => {
      if (test.connectionId === connection.id) throw Object.assign(new Error("rejected"), { details: { status } });
      return { providerTaskId: test.id, status: "succeeded" };
    });
    await f.service.plan(supplier.id); await f.service.kick();
    const record = (await f.repository.getSupplierVerification(supplier.id))!;
    expect(record.paused).toBe(false);
    expect(record.connectionBlocks).toMatchObject([{ connectionId: connection.id, kind: "authentication" }]);
    expect(f.submit.mock.calls.filter(([test]) => test.connectionId === connection.id)).toHaveLength(1);
    expect(f.submit.mock.calls.filter(([test]) => test.connectionId === other.id)).toHaveLength(2);
    expect(f.submit.mock.calls.every(([test]) => test.resolution === "4K")).toBe(true);
    expect(JSON.stringify(publicVerification(record)?.connectionBlocks)).not.toContain("fingerprint");
    const restarted = new SupplierVerificationService(f.deps);
    await restarted.kick();
    expect(f.submit).toHaveBeenCalledTimes(3);
    await f.repository.saveConnection({ ...connection, encryptedSecret: "fixed-key" });
    f.submit.mockResolvedValue({ providerTaskId: "fixed", status: "succeeded" });
    await restarted.plan(supplier.id, false, { onboarding: true }); await restarted.kick();
    expect((await f.repository.getSupplierVerification(supplier.id))?.connectionBlocks).toEqual([]);
    expect(f.submit).toHaveBeenCalledTimes(5);
  });
  it("migrates a legacy authentication hold and executes only the selected unsubmitted 4K case once", async () => {
    const f = await fixture();
    await f.service.plan(supplier.id);
    const old = (await f.repository.getSupplierVerification(supplier.id))!;
    old.cases[0]!.status = "inconclusive"; old.cases[0]!.submittedAt = "2026-09-21";
    old.cases[0]!.reason = "鉴权失败，请检查当前分组 Key 后恢复队列";
    old.used = 1; old.paused = true; old.reason = old.cases[0]!.reason;
    await f.repository.saveSupplierVerification(old, old.revision);
    await f.repository.saveConnection({ ...connection, id: "new-key", config: { ...connection.config, modelGroup: "image2.5全参" } });
    f.deps.models = async key => key.id === "new-key" ? [{ ...model, id: "gpt-image-2.5-sunburst" }, { ...model, id: "gpt-image-2.5-flare" }] : [model];
    await f.service.plan(supplier.id);
    const queued = (await f.repository.getSupplierVerification(supplier.id))!.cases.find(test => test.modelId === "gpt-image-2.5-sunburst")!;
    await f.service.runQueuedCase(supplier.id, queued.id);
    expect(f.submit).toHaveBeenCalledOnce();
    expect(f.submit.mock.calls[0]?.[0]).toMatchObject({ modelId: "gpt-image-2.5-sunburst", resolution: "4K", quality: "max" });
    await expect(f.service.runQueuedCase(supplier.id, queued.id)).rejects.toThrow("尚未提交");
    const after = (await f.repository.getSupplierVerification(supplier.id))!;
    expect(after.cases.find(test => test.modelId === "gpt-image-2.5-flare")?.status).toBe("queued");
    expect(after.connectionBlocks).toMatchObject([{ connectionId: connection.id }]);
  });
  it("does not release manual, charged or unresolved holds to run a selected case", async () => {
    for (const hold of ["manual", "charged", "unknown"] as const) {
      const f = await fixture({ models: async () => [model, { ...model, id: "gpt-image-2-other" }] });
      await f.service.plan(supplier.id);
      const record = (await f.repository.getSupplierVerification(supplier.id))!;
      const first = record.cases[0]!;
      first.status = hold === "unknown" ? "needs_attention" : "inconclusive";
      first.submittedAt = "2026-09-21"; first.reason = "鉴权失败，请检查当前分组 Key";
      if (hold === "charged") first.actualCharge = { amount: 1, currency: "CNY", unit: "request", checkedAt: "now", requestId: first.requestId };
      record.used = 1; record.paused = true; record.reason = first.reason;
      if (hold === "manual") record.pauseReason = "manual";
      await f.repository.saveSupplierVerification(record, record.revision);
      await expect(f.service.runQueuedCase(supplier.id, record.cases[1]!.id)).rejects.toThrow("暂停");
      expect(f.submit).not.toHaveBeenCalled();
    }
  });
  it("covers each group/model once and deduplicates extra connections in the same group", async () => {
    const f = await fixture({ models: async () => Array.from({ length: 4 }, (_, i) => ({ ...model, id: `gpt-image-2-${i}` })) });
    await f.repository.saveConnection({ ...connection, id: "duplicate-key" });
    await f.repository.saveConnection({ ...connection, id: "other-group", config: { ...connection.config, modelGroup: "第二分组" } });
    await Promise.all([f.service.plan(supplier.id), f.service.plan(supplier.id)]);
    const planned = (await f.repository.getSupplierVerification(supplier.id))!;
    expect(planned.policyVersion).toBe(2);
    expect(planned.coverage).toHaveLength(8);
    expect(planned.cases).toHaveLength(8);
    expect(planned.limit).toBe(8);
    await f.service.kick();
    await f.service.plan(supplier.id); await f.service.kick();
    expect(f.submit).toHaveBeenCalledTimes(8);
    for (const group of ["默认分组", "第二分组"])
      expect(f.submit.mock.calls.filter(([test]) => test.group === group)).toHaveLength(4);
  });
  it("migrates a spent six-case ledger without refunding or repeating previous requests", async () => {
    const f = await fixture({ models: async () => Array.from({ length: 4 }, (_, i) => ({ ...model, id: `gpt-image-2-${i}` })) });
    await f.service.plan(supplier.id);
    const old = (await f.repository.getSupplierVerification(supplier.id))!;
    old.policyVersion = 1; old.limit = 6; old.cases = old.cases.slice(0, 6);
    await f.repository.saveSupplierVerification(old, old.revision);
    await f.service.kick();
    const submitted = f.submit.mock.calls.map(([test]) => test.requestId);
    await f.service.plan(supplier.id); await f.service.kick();
    const expanded = (await f.repository.getSupplierVerification(supplier.id))!;
    expect(expanded.used).toBe(4); expect(expanded.limit).toBe(4);
    expect(expanded.cases.filter(test => submitted.includes(test.requestId))).toHaveLength(4);
    expect(f.submit).toHaveBeenCalledTimes(4);
  });
  it("does one quality-only check for each model in every 1K group", async () => {
    const f = await fixture({ models: async () => [{ ...model, id: "gpt-image-2-a" }, { ...model, id: "gpt-image-2-b" }] });
    await f.repository.saveConnection({ ...connection, config: { ...connection.config, modelGroup: "1k分组" } });
    await f.repository.saveConnection({ ...connection, id: "second1k", config: { ...connection.config, modelGroup: "1k低价分组" } });
    await f.service.plan(supplier.id); await f.service.kick();
    expect(f.submit).toHaveBeenCalledTimes(4);
    expect(f.submit.mock.calls.every(([test]) => test.resolution === "1K" && test.quality === "high")).toBe(true);
  });
  it("shows image groups without keys instead of silently omitting them or guessing a key", async () => {
    const f = await fixture();
    await f.repository.saveSupplier({ ...supplier, catalog: { groups: [{ id: "缺少连接的生图组", label: "图片", models: [{ id: "gpt-image-2", capability: "image" }] }] } });
    await f.service.plan(supplier.id, true);
    expect((await f.repository.getSupplierVerification(supplier.id))?.skipped).toContainEqual(expect.objectContaining({ group: "缺少连接的生图组", reason: expect.stringContaining("Key") }));
    expect(f.submit).not.toHaveBeenCalled();
  });
  it("bounds automatic enum corrections even if the provider keeps rejecting legal values", async () => {
    const f = await fixture();
    f.submit.mockImplementation(async test => { throw Object.assign(new Error("unsupported quality"), { details: { status: 400, responseBody: { charged: false, error: { allowed_values: test.quality === "high" ? ["max"] : ["high"] } } } }); });
    await f.service.plan(supplier.id); await f.service.kick();
    await f.service.plan(supplier.id); await f.service.kick();
    expect(f.submit).toHaveBeenCalledTimes(2);
    expect((await f.repository.getSupplierVerification(supplier.id))?.cases.filter(test => test.retryOf)).toHaveLength(1);
  });
  it("does not submit when the durable reservation cannot be saved", async () => {
    const f = await fixture();
    await f.service.plan(supplier.id);
    const save = f.repository.saveSupplierVerification.bind(f.repository);
    vi.spyOn(f.repository, "saveSupplierVerification").mockImplementation(
      (record, revision) => {
        if (record.cases.some((test) => test.status === "submitting"))
          return Promise.reject(new Error("disk full"));
        return save(record, revision);
      },
    );
    await expect(f.service.kick()).rejects.toThrow("disk full");
    expect(f.submit).not.toHaveBeenCalled();
  });
  it("does not cancel existing queued cases on a free scan outage", async () => {
    const f = await fixture();
    await f.service.plan(supplier.id);
    f.deps.models = async () => {
      throw new Error("offline");
    };
    await f.service.plan(supplier.id);
    expect(
      (await f.repository.getSupplierVerification(supplier.id))?.cases.map(
        (item) => item.status,
      ),
    ).toEqual(["queued"]);
  });
  it("uses the highest returned legal quality only within the same budget", async () => {
    const f = await fixture({
      models: async () => [
        {
          ...model,
          parameters: [
            {
              key: "quality",
              label: "Quality",
              control: "select",
              options: [
                { label: "Max", value: "max" },
                { label: "High", value: "high" },
              ],
            },
          ],
        },
      ],
    });
    f.submit.mockImplementation(async (test) => {
      if (test.quality === "max")
        throw Object.assign(new Error("unsupported quality"), {
          details: {
            status: 400,
            responseBody: { charged: false, error: { allowed_values: ["low", "high"] } },
          },
        });
      return { providerTaskId: test.id, status: "succeeded" };
    });
    await f.service.plan(supplier.id);
    await f.service.kick();
    expect(f.submit.mock.calls.map(([test]) => test.quality)).toEqual([
      "max",
      "high",
    ]);
    const record = (await f.repository.getSupplierVerification(supplier.id))!;
    expect(record.used).toBe(2);
    expect(
      record.cases.filter((item) => item.status === "succeeded"),
    ).toHaveLength(1);
  });
  it("keeps generation POST count at one after uncertain response, reload and reconcile", async () => {
    const f = await fixture();
    f.submit.mockRejectedValue(new TypeError("fetch failed"));
    await f.service.plan(supplier.id);
    await f.service.kick();
    const disk = f.repository.exportSnapshot();
    const repository = new MemoryRepository(disk);
    const restarted = new SupplierVerificationService({
      ...f.deps,
      repository,
    });
    await restarted.plan(supplier.id);
    await restarted.kick();
    await restarted.action(supplier.id, "reconcile");
    expect(f.submit).toHaveBeenCalledTimes(1);
    expect(
      (await repository.getSupplierVerification(supplier.id))?.cases[0]?.status,
    ).toBe("needs_attention");
    await expect(restarted.action(supplier.id, "resume")).rejects.toThrow(
      "先核对",
    );
  });
  it("recovers a crash during submit without another POST", async () => {
    const f = await fixture();
    await f.service.plan(supplier.id);
    const record = (await f.repository.getSupplierVerification(supplier.id))!;
    record.cases[0]!.status = "submitting";
    record.used = 1;
    await f.repository.saveSupplierVerification(record, record.revision);
    const restarted = new SupplierVerificationService(f.deps);
    await restarted.kick();
    expect(f.submit).not.toHaveBeenCalled();
    expect(
      (await f.repository.getSupplierVerification(supplier.id))?.paused,
    ).toBe(true);
  });
  it("archives an existing task after restart without another submission", async () => {
    const f = await fixture();
    await f.service.plan(supplier.id);
    const record = (await f.repository.getSupplierVerification(supplier.id))!;
    record.cases[0]!.status = "archiving";
    record.cases[0]!.task = { providerTaskId: "known", status: "succeeded" };
    record.used = 1;
    record.paused = true;
    await f.repository.saveSupplierVerification(record, record.revision);
    await new SupplierVerificationService(f.deps).kick();
    expect(f.submit).not.toHaveBeenCalled();
    expect(
      (await f.repository.getSupplierVerification(supplier.id))?.cases[0]
        ?.status,
    ).toBe("succeeded");
  });
  it("supersedes old keys and does not expose signed URLs or fingerprints", async () => {
    const f = await fixture();
    await f.service.plan(supplier.id);
    await f.repository.saveConnection({
      ...connection,
      encryptedSecret: "cipher-b",
    });
    await f.service.kick();
    expect(f.submit).not.toHaveBeenCalled();
    const record = (await f.repository.getSupplierVerification(supplier.id))!;
    record.cases[0]!.task = {
      providerTaskId: "id",
      result: { url: "https://signed.example/?token=secret" },
    };
    expect(JSON.stringify(publicVerification(record))).not.toContain(
      "token=secret",
    );
    expect(publicVerification(record)?.cases[0]).not.toHaveProperty("fingerprint");
    expect(publicVerification(record)?.cases[0]).not.toHaveProperty("task");
    expect(record.cases[0]?.fingerprint).toBeTruthy();
    expect(record.cases[0]?.task).toBeDefined();
    expect(verificationFingerprint(connection, "a")).not.toBe(
      verificationFingerprint(connection, "b"),
    );
  });
  it("pauses remaining paid cases when an exact request charge differs", async () => {
    const priced = {
      ...model,
      pricing: {
        kind: "per-image" as const,
        currency: "credits",
        unitAmount: 0.1,
        checkedAt: "now",
        confidence: "exact" as const,
      },
    };
    const f = await fixture({
      models: async () => [priced],
      charge: async (_, test) => ({
        amount: 0.5,
        currency: "credits",
        unit: "image",
        checkedAt: "now",
        requestId: test.requestId,
      }),
    });
    await f.service.plan(supplier.id);
    await f.service.kick();
    expect(f.submit).toHaveBeenCalledTimes(1);
    expect(
      (await f.repository.getSupplierVerification(supplier.id))?.reason,
    ).toContain("扣费");
  });
});
