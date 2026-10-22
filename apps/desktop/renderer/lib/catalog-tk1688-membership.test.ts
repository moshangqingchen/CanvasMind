import { describe, expect, it, vi } from "vitest";
import { MemoryRepository, type CatalogPipelineState } from "@super-canvas/db";
import { type ModelDescriptor } from "@super-canvas/providers";
import { catalogSourcePlan } from "./catalog-source-plan";
import { collectCatalogReadTask } from "./catalog-read-task";
import type { CatalogReadObservation } from "./catalog-read-contracts";
import { reduceCatalogInventory, type CatalogInventoryState } from "./catalog-inventory-policy";
import { applyCatalogTk1688Descriptors, projectCatalogTk1688Membership } from "./catalog-tk1688-membership";
import { createCatalogPipelineService } from "./catalog-pipeline-service";
import { mergeTk1688ModelInventory } from "./tk1688-catalog";

const base = "gpt-image-2", alias = `${base}@s1c581`, excluded = `${base}@s1c582`, foreign = "gpt-image-2.5-sunburst@s1c583";
const at = "2026-10-22T12:00:00.000Z", identityEpoch = "fixture-epoch", observationCycleId = "fixture-cycle";
const listing = (id: string, extra = {}) => ({ id: 1998, base_model: id.startsWith(base + "@") ? base : "gpt-image-2.5-sunburst", alias: id,
  charge_type: "per_request", input_price_usd: .017418, output_price_usd: .017418,
  description: "生图AD渠道仅支持medium 非超分124k", status: "active", channel_alive: true, ...extra });
const marketplace = (items = [listing(alias), listing(excluded), listing(foreign)]) => ({ success: true, data: { items, total: items.length } });
const status = { success: true, data: { payment_fx_rate_cny_per_usd: 6.8896 } };
const keyModel: ModelDescriptor = { id: base, name: base, provider: "openai", operations: ["image.generate", "image.edit"] };

async function fixture() {
  const repository = new MemoryRepository();
  const supplier = await repository.saveSupplier({ id: "tk-fixture", name: "Tk fixture", supplierKey: "tk1688", kind: "openai-compatible",
    siteUrl: "https://tk1688.com", apiUrl: "https://api.tk1688.com/v1", scanStatus: "live", scanComplete: true,
    state: { version: 1, revision: 1, visibility: "visible", sourceId: "tk-source", fingerprint: "fixture", history: [],
      siteLogin: { username: "fixture", encryptedPassword: "fixture-only", siteUrl: "https://tk1688.com" } }, catalog: { groups: [] } });
  const connection = await repository.saveConnection({ id: "tk-key", name: "Tk fixture key", provider: "openai", encryptedSecret: "fixture-encrypted",
    config: { supplierId: supplier.id, supplierSourceId: "tk-source", baseUrl: supplier.apiUrl, accountKeyGroupId: "7",
      accountKeyGroup: "default", modelGroup: "default", modelScanStatus: "live", modelCatalogModels: [], defaultModel: base } });
  const plan = catalogSourcePlan(connection, supplier);
  let accountBody: unknown = { success: true, data: [base, alias, foreign] }, marketBody: unknown = marketplace(), keyBody: unknown = { data: [{ id: base }] };
  let statusCode = 200;
  const fetcher = vi.fn<typeof fetch>(async (input, init) => {
    expect(init?.method ?? "GET").toBe("GET");
    const url = String(input);
    if (url === `${supplier.apiUrl}/models`) return Response.json(keyBody);
    if (url === "https://tk1688.com/api/marketplace/listings") return Response.json(marketBody);
    if (url === "https://tk1688.com/api/user/models") return Response.json(accountBody);
    if (url === "https://tk1688.com/api/status") return Response.json(statusCode === 200 ? status : { error: "fixture unavailable" }, { status: statusCode });
    return new Response(null, { status: 404 });
  });
  const read = async (entryId: string, dispatchSeq: number) => (await collectCatalogReadTask({ spec: plan.find(row => row.entryId === entryId)! },
    connection, supplier, [], { enabled: true, apiKey: "fixture-only", fetchFor: () => fetcher,
      now: () => at, context: { identityEpoch, observationCycleId, dispatchSeq, runId: "fixture" } })).observation;
  const observations = async () => Promise.all([read("key-models", 1), read("tk1688-marketplace", 2), read("tk1688-account-models", 3)]);
  return { repository, supplier, connection, fetcher, observations,
    setAccount(body: unknown) { accountBody = body; }, setMarket(body: unknown) { marketBody = body; }, setKey(body: unknown) { keyBody = body; },
    setStatus(code: number) { statusCode = code; } };
}

describe("Tk1688 pipeline's derived merchant membership", () => {
  it("shares the manual refresh join and refreshes the exact medium-only descriptor without changing raw Key facts", async () => {
    const value = await fixture(), rows = await value.observations(), original = structuredClone(rows);
    const projected = projectCatalogTk1688Membership(value.connection, value.supplier, rows, { identityEpoch, observationCycleId });
    const key = projected.observations[0]!;
    expect(key.facts.models.map(model => model.id)).toEqual([base, alias]);
    expect(mergeTk1688ModelInventory(rows[0]!.facts.models, marketplace(), undefined, { accountModelIds: [base, alias, foreign], checkedAt: at })
      .map(model => [model.id, model.parameters, model.limits])).toEqual(key.facts.models.map(model => [model.id, model.parameters, model.limits]));
    expect(key.receipt).toMatchObject({ complete: true, context: { dispatchSeq: 3 }, coverage: { modelIds: [base, alias], exhaustive: true } });
    expect(key.facts.membershipDerivation).toMatchObject({ kind: "tk1688-three-way", complete: true,
      rawKey: { modelIds: [base], dispatchSeq: 1, coverage: { modelIds: [base] } }, account: { dispatchSeq: 3 }, marketplace: { dispatchSeq: 2 } });
    const exact = key.facts.models.find(model => model.id === alias)!;
    expect(exact.parameters?.find(parameter => parameter.key === "quality")).toMatchObject({ default: "medium", options: [{ value: "medium" }] });
    expect(exact.metadata).toMatchObject({ tk1688PermissionSource: "key-inventory+account-inventory+marketplace", tk1688CatalogStale: false,
      catalogMembershipDerivation: { rawKeyModel: false, baseModelId: base, key: { sourceUrl: "https://api.tk1688.com/v1/models" } } });
    const old = { ...exact, parameters: exact.parameters?.map(parameter => parameter.key === "quality" ? { ...parameter, default: "high",
      options: [{ value: "high", label: "high" }] } : parameter), metadata: { ...exact.metadata, catalogNativeContract: { accepted: "fixture" } },
      pricing: { kind: "per-image" as const, currency: "CNY", unitAmount: 9, checkedAt: at, confidence: "exact" as const } };
    const updated = applyCatalogTk1688Descriptors([old], projected.descriptors)[0]!;
    expect(updated.parameters?.find(parameter => parameter.key === "quality")?.options?.map(option => option.value)).toEqual(["medium"]);
    expect(updated.pricing).toEqual(old.pricing);
    expect(updated.metadata?.catalogNativeContract).toEqual(old.metadata.catalogNativeContract);
    expect(rows).toEqual(original);
  });

  it.each(["missing-account", "partial-account", "failed-account", "partial-market", "offline-market", "no-base-key", "key-denied"])(
    "does not add a merchant with %s", async scenario => {
      const value = await fixture();
      if (scenario === "partial-account") value.setAccount({ success: true, data: [alias], has_more: true });
      if (scenario === "failed-account") value.setAccount({ success: false, data: [alias] });
      if (scenario === "partial-market") value.setMarket({ success: true, data: { items: [listing(alias)], total: 2 } });
      if (scenario === "offline-market") value.setMarket(marketplace([listing(alias, { channel_alive: false })]));
      if (scenario === "no-base-key") value.setKey({ data: [{ id: "other-model" }] });
      let rows: CatalogReadObservation[] = await value.observations();
      if (scenario === "missing-account") rows = rows.filter(row => row.receipt.spec.entryId !== "tk1688-account-models");
      if (scenario === "key-denied") rows[0]!.facts.models[0]!.metadata = { canvasRunnable: false, canvasUnavailableReason: "HTTP 403 当前 Key 权限拒绝" };
      const result = projectCatalogTk1688Membership(value.connection, value.supplier, rows, { identityEpoch, observationCycleId });
      expect(result.observations.find(row => row.receipt.spec.role === "key-membership")!.facts.models.map(model => model.id)).not.toContain(alias);
    });

  it.each(["origin", "source", "group", "key-epoch", "account-epoch", "cycle", "identity-epoch", "unread"])(
    "does not borrow %s evidence", async scenario => {
      const value = await fixture(), rows = await value.observations();
      if (scenario === "origin") rows[1]!.receipt.spec.sourceUrl = "https://foreign.example/api/marketplace/listings";
      if (scenario === "source") rows[2]!.receipt.spec.applyScope.supplierSourceId = "other-source";
      if (scenario === "group") rows[2]!.receipt.spec.applyScope.groupIdentity = "site-id:8";
      if (scenario === "key-epoch") rows[0]!.receipt.spec.authScope.credentialEpoch = "other-key";
      if (scenario === "account-epoch") rows[2]!.receipt.spec.authScope.credentialEpoch = "other-account";
      if (scenario === "cycle") rows[2]!.receipt.context.observationCycleId = "old-cycle";
      if (scenario === "identity-epoch") rows[2]!.receipt.context.identityEpoch = "old-epoch";
      if (scenario === "unread") rows[2]!.receipt.freshness = "unread";
      const result = projectCatalogTk1688Membership(value.connection, value.supplier, rows, { identityEpoch, observationCycleId });
      expect(result.observations.find(row => row.receipt.spec.role === "key-membership")!.facts.models.map(model => model.id)).not.toContain(alias);
    });

  it("keeps an exact current Key refusal over an otherwise permitted base/account/active-market join", async () => {
    const value = await fixture(); value.setKey({ data: [{ id: base }, { id: alias }] });
    const rows = await value.observations();
    rows[0]!.facts.models.find(model => model.id === alias)!.metadata = { canvasRunnable: false, canvasUnavailableReason: "HTTP 403 当前 Key 权限拒绝" };
    const result = projectCatalogTk1688Membership(value.connection, value.supplier, rows, { identityEpoch, observationCycleId });
    const exact = result.observations[0]!.facts.models.filter(model => model.id === alias);
    expect(exact).toHaveLength(1);
    expect(exact[0]!.metadata).toMatchObject({ canvasRunnable: false, canvasUnavailableReason: "HTTP 403 当前 Key 权限拒绝" });
    expect(exact[0]!.metadata?.catalogMembershipDerivation).toBeUndefined();
  });

  it("recompiles an already accepted highest-sequence raw Key baseline using local CAS order and preserves all source samples", async () => {
    const value = await fixture(), rows = await value.observations(); rows[0]!.receipt.context.dispatchSeq = 5;
    const original = structuredClone(rows), key = rows[0]!, requiredSourceKeys = [key.receipt.spec.sourceKey];
    const input = { connectionId: value.connection.id, identityEpoch, observationCycleId, observedAt: at, mode: "daily" as const,
      requiredSourceKeys, observations: [key] };
    const before = reduceCatalogInventory(undefined, input);
    expect(before.state.sources[requiredSourceKeys[0]!]!.baseline?.modelIds).toEqual([base]);
    const projected = projectCatalogTk1688Membership(value.connection, value.supplier, rows,
      { identityEpoch, observationCycleId, localProjectionDispatchSeq: 9 });
    expect(projected.observations[0]!.receipt.context.dispatchSeq).toBe(9);
    expect(projected.observations[0]!.facts.membershipDerivation).toMatchObject({ localProjectionDispatchSeq: 9,
      rawKey: { dispatchSeq: 5, checkedAt: at }, marketplace: { dispatchSeq: 2, checkedAt: at }, account: { dispatchSeq: 3, checkedAt: at } });
    const after = reduceCatalogInventory(before.state, { ...input, observations: projected.observations });
    expect(after.state.sources[requiredSourceKeys[0]!]!.baseline?.modelIds).toEqual([base, alias]);
    expect(after.manifestComplete).toBe(true);
    expect(rows).toEqual(original);
    const fenced = projectCatalogTk1688Membership(value.connection, value.supplier, rows,
      { identityEpoch, observationCycleId, localProjectionDispatchSeq: 10, keyFence: { dispatchedThrough: 5, checkedAt: at } });
    expect(fenced.observations).toEqual(rows);
    expect(fenced.observations[0]!.facts.models.map(model => model.id)).toEqual([base]);
  });

  it("retains saved SKU contracts as stale for incomplete account evidence, rather than treating it as a complete empty list", async () => {
    const value = await fixture();
    const saved = mergeTk1688ModelInventory([keyModel], marketplace(), status, { accountModelIds: [alias], checkedAt: at });
    const connection = { ...value.connection, config: { ...value.connection.config, modelCatalogModels: saved } };
    value.setAccount({ success: true, data: [], has_more: true });
    const rows = await value.observations(), original = structuredClone(rows);
    const projected = projectCatalogTk1688Membership(connection, value.supplier, rows, { identityEpoch, observationCycleId });
    expect(projected.observations[0]!.receipt).toMatchObject({ complete: false, reason: "incomplete" });
    expect(projected.observations[0]!.facts.validatedMembershipModelIds).toEqual([base]);
    expect(projected.observations[0]!.facts.models.find(model => model.id === alias)?.metadata?.tk1688CatalogStale).toBe(true);
    expect(applyCatalogTk1688Descriptors(saved, projected.descriptors).find(model => model.id === alias)).toMatchObject({
      parameters: saved.find(model => model.id === alias)!.parameters, pricing: saved.find(model => model.id === alias)!.pricing,
      metadata: { tk1688CatalogStale: true } });
    expect(rows).toEqual(original);
    // A newer failed receipt cannot fall back to an older success in the cohort.
    const full = await fixture(), complete = await full.observations();
    const failed = structuredClone(complete[2]!); failed.receipt.context.dispatchSeq = 4; failed.receipt.complete = false;
    const result = projectCatalogTk1688Membership(full.connection, full.supplier, [...complete, failed], { identityEpoch, observationCycleId });
    expect(result.observations[0]!.facts.models.map(model => model.id)).not.toContain(alias);
  });

  it("collects and publishes derived SKU controls through the real pipeline while storing the raw Key list separately", async () => {
    const value = await fixture();
    const legacy = mergeTk1688ModelInventory([keyModel], marketplace(), status, { accountModelIds: [alias], checkedAt: at });
    await value.repository.saveConnection({ ...value.connection, config: { ...value.connection.config,
      modelCatalogModels: legacy.map(model => ({ ...model, metadata: { ...model.metadata, catalogMembershipVerified: false,
        supplierChannelDescription: "原生支持124K", tk1688QualityDeclared: false,
        canvasRunnable: false, canvasUnavailableReason: "上次型号仅供历史" },
        parameters: model.parameters?.map(parameter => parameter.key === "quality" ? { ...parameter, default: "high",
          options: [{ value: "high", label: "high" }] } : parameter) })) } });
    let now = Date.parse(at);
    const transport: typeof fetch = async (...args) => { const result = await value.fetcher(...args); now += 2_000; return result; };
    const clock = { now: () => now, setTimeout: () => 0, clearTimeout: () => undefined };
    const service = createCatalogPipelineService({ repository: value.repository, environment: {}, clock, sessionStartedAt: now - 60_000,
      readers: async () => ({ apiKey: "fixture-only", fetchFor: () => transport }), random: () => .5 });
    try {
      const result = await service.run(value.connection.id, { observationCycleId: "first", revision: "fixture", budget: 4 });
      expect(result.published).toBeGreaterThanOrEqual(4);
      const current = (await value.repository.getConnection(value.connection.id))!;
      const models = current.config.modelCatalogModels as ModelDescriptor[], exact = models.find(model => model.id === alias)!;
      expect(models.map(model => model.id)).toEqual([base, alias]);
      expect(exact.metadata).toMatchObject({ canvasRunnable: true, catalogMembershipVerified: true, catalogContractStatus: "native",
        catalogNativeContract: { adapter: "tk1688-images" }, catalogMembershipDerivation: { rawKeyModel: false } });
      expect(exact.parameters?.find(parameter => parameter.key === "quality")?.options?.map(option => option.value)).toEqual(["medium"]);
      expect(exact.pricing).toMatchObject({ currency: "CNY", unitAmount: .017418 * 6.8896 });
      const state = (await value.repository.getCatalogPipelineState(value.supplier.id)) as CatalogPipelineState;
      const raw = Object.entries(state.entries).filter(([key]) => key.startsWith("fact:")).map(([, row]) => row as unknown as CatalogReadObservation)
        .find(row => row.receipt.spec.entryId === "key-models")!;
      expect(raw.facts.models.map(model => model.id)).toEqual([base]);
      expect(raw.receipt.coverage?.modelIds).toEqual([base]);
      expect(raw.facts.membershipDerivation).toBeUndefined();
      const membership = state.entries[`membership:${value.connection.id}`] as unknown as CatalogInventoryState;
      expect(Object.values(membership.sources)[0]!.baseline?.modelIds).toEqual([base, alias]);
      value.setStatus(503); now += 86_400_000;
      await service.run(value.connection.id, { observationCycleId: "fx-unavailable", revision: "fixture" });
      const withoutFx = ((await value.repository.getConnection(value.connection.id))!.config.modelCatalogModels as ModelDescriptor[]).find(model => model.id === alias)!;
      expect(withoutFx.metadata).toMatchObject({ canvasRunnable: true, tk1688CatalogStale: false, catalogContractStatus: "native" });
      expect(withoutFx.pricing?.unitAmount).toBe(exact.pricing?.unitAmount);
      expect(withoutFx.pricing?.currency).toBe("CNY");
      // Failed public/FX/account reads in a later cycle retain the accepted
      // exact contract and price; an unread catalog cannot withdraw them.
      value.setStatus(503); value.setMarket({ success: false }); value.setAccount({ success: false }); now += 86_400_000;
      await service.run(value.connection.id, { observationCycleId: "unavailable", revision: "fixture" });
      const retained = ((await value.repository.getConnection(value.connection.id))!.config.modelCatalogModels as ModelDescriptor[]).find(model => model.id === alias)!;
      expect(retained.metadata).toMatchObject({ canvasRunnable: true, tk1688CatalogStale: true, catalogContractStatus: "native" });
      expect(retained.parameters).toEqual(exact.parameters);
      expect(retained.pricing).toEqual({ ...exact.pricing, evidence: { ...exact.pricing?.evidence, status: "retained" } });
    } finally { service.close(); }
  });

  it("keeps exact raw Key models usable when no account evidence can grant merchant aliases", async () => {
    const value = await fixture(); value.setAccount({ success: false });
    await value.repository.saveConnection({ ...value.connection, config: { ...value.connection.config, modelScanStatus: "unscanned" } });
    let now = Date.parse(at);
    const transport: typeof fetch = async (...args) => { const response = await value.fetcher(...args); now += 2_000; return response; };
    const service = createCatalogPipelineService({ repository: value.repository, environment: {}, sessionStartedAt: now - 60_000,
      clock: { now: () => now, setTimeout: () => 0, clearTimeout: () => undefined }, random: () => .5,
      readers: async () => ({ apiKey: "fixture-only", fetchFor: () => transport }) });
    try {
      await service.run(value.connection.id, { observationCycleId: "raw-only", revision: "fixture" });
      const models = (await value.repository.getConnection(value.connection.id))!.config.modelCatalogModels as ModelDescriptor[];
      expect(models.map(model => model.id)).toEqual([base]);
      expect(models[0]!.metadata).toMatchObject({ canvasRunnable: true, catalogMembershipVerified: true, catalogContractStatus: "native" });
    } finally { service.close(); }
  });
});
