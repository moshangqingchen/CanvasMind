import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ProviderConnectionRecord, SupplierRecord } from "@super-canvas/db";

const guards = vi.hoisted(() => ({ implicit: vi.fn(), endpoint: vi.fn(async () => undefined) }));
vi.mock("@super-canvas/providers", async original => ({ ...await original<typeof import("@super-canvas/providers")>(),
  assertSafeProviderEndpoint: guards.endpoint, providerFetch: guards.implicit, weAIFetch: guards.implicit }));
vi.mock("./supplier-service", () => ({ getSupplierRecord: guards.implicit }));
vi.mock("./supplier-site-session", () => ({ openSupplierSiteSession: guards.implicit, supplierSiteLoginCacheIdentity: vi.fn() }));

import { collectCatalogReadCycle, type CatalogCollectorDependencies } from "./catalog-read-collector";
import { catalogConnectionManifest, catalogReadReason, type CatalogReadObservation } from "./catalog-read-contracts";
import { catalogConnectionScopes, catalogReadItem, catalogReadPreviewEnabled, catalogSourcePlan } from "./catalog-source-plan";

const now = () => "2026-10-17T12:00:00.000Z";
const context = { runId: "fixture-run-1", observationCycleId: "fixture-cycle-1", identityEpoch: "fixture-identity-1", dispatchSeq: 1 };
const connection = (baseUrl = "https://supplier.test/v1", config: ProviderConnectionRecord["config"] = {}): ProviderConnectionRecord => ({
  id: "fixture-connection", name: "Fixture connection", provider: "openai", encryptedSecret: "fixture-ciphertext",
  config: { baseUrl, ...config }, createdAt: now(), updatedAt: now(),
});
const supplier = (config: Partial<SupplierRecord> = {}): SupplierRecord => ({ id: "fixture-supplier", name: "Fixture supplier",
  supplierKey: "fixture", siteUrl: "https://supplier.test", apiUrl: "https://supplier.test/v1", kind: "newapi", catalog: { groups: [] },
  scanStatus: "unscanned", state: { version: 1, revision: 1, visibility: "visible", sourceId: "fixture-source",
    fingerprint: "fixture-fingerprint", history: [] }, createdAt: now(), updatedAt: now(), ...config });
const dependencies = (fetchFor: CatalogCollectorDependencies["fetchFor"], overrides: Partial<CatalogCollectorDependencies> = {}): CatalogCollectorDependencies => ({
  enabled: true, apiKey: "fixture-only-key", fetchFor, context, now, ...overrides,
});
const keyList = (id = "key-only-full-model-id") => Response.json({ data: [{ id }] });

beforeEach(() => {
  vi.clearAllMocks();
  guards.implicit.mockImplementation(() => { throw new Error("Implicit network/repository access is forbidden"); });
  vi.stubGlobal("fetch", guards.implicit);
});
afterEach(() => { vi.unstubAllGlobals(); });

describe("catalog read-cycle integration", () => {
  it("limits per-model schemas without losing or discrediting the complete Key list", async () => {
    let schemaRequests = 0;
    const result = await collectCatalogReadCycle(connection("https://api.miaowuai.store/v1"), undefined, dependencies(spec =>
      vi.fn<typeof fetch>(async () => {
        if (spec.entryId === "key-models") return Response.json({ data: [] });
        if (spec.entryId === "miaowu-media") return Response.json({ data: Array.from({ length: 35 }, (_, index) => ({ id: `image-${index}`, type: "image" })) });
        if (spec.entryId.startsWith("miaowu-schema:")) schemaRequests++;
        return new Response(null, { status: 503 });
      }), { schemaBudget: 1, documentBudget: 0 }));
    expect(schemaRequests).toBe(1);
    expect(result.keyVisibleModels).toHaveLength(35);
    expect(result.manifest.complete).toBe(true);
    expect(result.observations.filter(row => row.receipt.spec.entryId.startsWith("miaowu-schema:") && row.receipt.reason === "budget")).toHaveLength(34);
  });

  it("keeps actual Tk1688 aliases separate from synthesized display models", async () => {
    const result = await collectCatalogReadCycle(connection("https://api.tk1688.com/v1"), undefined, dependencies(spec =>
      vi.fn<typeof fetch>(async () => spec.entryId === "key-models" ? keyList("exact-key-only") : spec.entryId === "tk1688-marketplace"
        ? Response.json({ success: true, data: { items: [{ base_model: "gpt-image-2.5-sunburst", alias: "gpt-image-2.5-sunburst@s1c1",
          description: "4K", charge_type: "per_request", input_price_usd: .03, status: "active", channel_alive: true }], total: 1 } })
        : new Response(null, { status: 503 })), { documentBudget: 0 }));
    expect(result.catalogOffers.map(model => model.id)).toEqual(["gpt-image-2.5-sunburst@s1c1"]);
    expect(result.keyVisibleModels.map(model => model.id)).toEqual(["exact-key-only"]);
    expect(result.observations.find(row => row.receipt.spec.entryId === "tk1688-marketplace")?.facts.sourceFacts?.kind).toBe("tk1688");
  });

  it("preserves successful Key facts when Cangyuan public pricing, homepage and documents all fail", async () => {
    const transports = new Map<string, ReturnType<typeof vi.fn<typeof fetch>>>();
    const result = await collectCatalogReadCycle(connection("https://ai.cangyuansuanli.cn/v1"), undefined, dependencies(spec => {
      const transport = vi.fn<typeof fetch>(async () => spec.entryId === "key-models" ? keyList() : new Response(null, { status: 503 }));
      transports.set(spec.entryId, transport); return transport;
    }));
    expect(result.keyVisibleModels.map(model => model.id)).toEqual(["key-only-full-model-id"]);
    expect(result.catalogOffers).toEqual([]);
    expect(result.manifest.complete).toBe(true);
    for (const source of ["cangyuan-homepage", "cangyuan-documentation", "cangyuan-pricing"])
      expect(result.observations.find(row => row.receipt.spec.entryId === source)?.receipt).toMatchObject({ status: "failed", complete: false });
    expect(transports.get("key-models")).toHaveBeenCalledTimes(1);
    expect(guards.implicit).not.toHaveBeenCalled();
    expect(result.publication).toBe("disabled");
    expect(JSON.stringify(result)).not.toContain("fixture-only-key");
  });

  it("retains public catalog offers after a Key denial without assigning their IDs to that Key", async () => {
    const result = await collectCatalogReadCycle(connection("https://ai.cangyuansuanli.cn/v1"), undefined, dependencies(spec =>
      vi.fn<typeof fetch>(async () => spec.entryId === "cangyuan-pricing"
        ? Response.json({ data: [{ model_name: "public-only-full-model-id", enable_groups: ["public-group"] }] })
        : new Response(null, { status: spec.entryId === "key-models" ? 401 : 503 }))));
    expect(result.catalogOffers.map(model => model.id)).toContain("public-only-full-model-id");
    expect(result.keyVisibleModels).toEqual([]);
    expect(result.manifest.complete).toBe(false);
    expect(result.observations.find(row => row.receipt.spec.entryId === "key-models")?.receipt.reason).toBe("authentication");
    expect(guards.implicit).not.toHaveBeenCalled();
  });

  it("does not discard a successful generic list when its independently required native list fails", async () => {
    const result = await collectCatalogReadCycle(connection("https://api.eaheng.com/v1", { accountKeyGroupId: "11" }), undefined,
      dependencies(spec => vi.fn<typeof fetch>(async () => spec.entryId === "key-models" ? keyList("generic-survives") : new Response(null, { status: 503 }))));
    expect(result.keyVisibleModels.map(model => model.id)).toEqual(["generic-survives"]);
    expect(result.manifest.complete).toBe(false);
    expect(result.manifest.requiredSourceKeys).toHaveLength(2);
    expect(result.observations.find(row => row.receipt.spec.entryId === "native-key-models")?.receipt).toMatchObject({ status: "failed", complete: false });
    expect(guards.implicit).not.toHaveBeenCalled();
  });

  it("records every documentation entry over budget as unread/deferred instead of silently losing it", async () => {
    const documentCalls: string[] = [];
    const result = await collectCatalogReadCycle(connection(), undefined, dependencies(spec => vi.fn<typeof fetch>(async input => {
      if (spec.entryId === "key-models") return Response.json({ data: Array.from({ length: 40 }, (_, index) => ({
        id: `key-model-${index}`, documentationUrl: `https://docs.supplier.test/manual-${index}`,
      })) });
      documentCalls.push(String(input));
      return new Response('<a href="/child-a.json">a</a><a href="/child-b.json">b</a>');
    }), { documentBudget: 2 }));
    const docs = result.observations.filter(row => row.receipt.spec.entryId.startsWith("schema-document:"));
    const deferred = docs.filter(row => row.receipt.status === "deferred");
    expect(documentCalls).toHaveLength(2);
    expect(docs.length).toBeGreaterThanOrEqual(44);
    expect(deferred).toContainEqual(expect.objectContaining({ receipt: expect.objectContaining({
      spec: expect.objectContaining({ sourceUrl: "https://docs.supplier.test/manual-39" }), reason: "budget", freshness: "unread", complete: false,
    }) }));
    expect(deferred.some(row => row.receipt.spec.sourceUrl === "https://docs.supplier.test/child-a.json")).toBe(true);
    expect(result.keyVisibleModels).toHaveLength(40);
    expect(result.manifest.complete).toBe(true);
    expect(guards.implicit).not.toHaveBeenCalled();
  });

  it("defaults off and never requests transport, even when credentials and a source plan are available", async () => {
    const fetchFor = vi.fn();
    const deps = dependencies(fetchFor); delete deps.enabled;
    expect(await collectCatalogReadCycle(connection(), supplier(), deps)).toMatchObject({ enabled: false, observations: [],
      keyVisibleModels: [], catalogOffers: [], publication: "disabled", manifest: { complete: false } });
    expect(fetchFor).not.toHaveBeenCalled(); expect(guards.implicit).not.toHaveBeenCalled();
    expect(catalogReadPreviewEnabled({ SUPERCANVAS_CATALOG_READ_PREVIEW: "1" })).toBe(false);
    expect(catalogReadPreviewEnabled({ SUPERCANVAS_CATALOG_READ_PREVIEW: "1", USE_MEMORY_STORE: "ephemeral" })).toBe(true);
  });
});

describe("source identities and manifest completeness", () => {
  it("a missing required source receipt cannot be hidden by a different successful source", () => {
    const record = connection("https://api.eaheng.com/v1", { accountKeyGroupId: "11" });
    const plan = catalogSourcePlan(record), required = plan.filter(spec => spec.requiredForMembership);
    const observations: CatalogReadObservation[] = [{ receipt: { spec: required[0]!, context, status: "succeeded", complete: true,
      freshness: "live", checkedAt: now() }, facts: { models: [{ id: "generic", name: "generic", operations: [] }] } }];
    expect(required).toHaveLength(2);
    const manifest = catalogConnectionManifest(record.id, context.observationCycleId, observations, plan);
    expect(manifest.complete).toBe(false);
    expect(manifest.requiredSourceKeys).toEqual(required.map(spec => spec.sourceKey));
  });

  it("the same URL with another credential principal/epoch has a distinct source identity", () => {
    const record = connection(), scopes = catalogConnectionScopes(record, supplier());
    const key = catalogReadItem("same-entry", "https://supplier.test/shared", "catalog-offer", scopes.key, scopes.apply);
    const anonymous = catalogReadItem("same-entry", "https://supplier.test/shared", "catalog-offer", scopes.anonymous, scopes.apply);
    const account = catalogReadItem("same-entry", "https://supplier.test/shared", "catalog-offer", scopes.account, scopes.apply);
    const rotated = catalogReadItem("same-entry", "https://supplier.test/shared", "catalog-offer", { ...scopes.key, credentialEpoch: "next-epoch" }, scopes.apply);
    expect(new Set([key, anonymous, account, rotated].map(spec => spec.sourceKey)).size).toBe(4);
    expect(new Set([key, anonymous, account, rotated].map(spec => spec.sourceUrl)).size).toBe(1);
  });

  it("source keys remain stable across observation cycles while receipt cycle/sequence advance", async () => {
    const input = connection(), transport = () => vi.fn<typeof fetch>(async () => keyList());
    const first = await collectCatalogReadCycle(input, undefined, dependencies(transport, { documentBudget: 0 }));
    const next = await collectCatalogReadCycle(input, undefined, dependencies(transport, { documentBudget: 0,
      context: { ...context, runId: "fixture-run-2", observationCycleId: "fixture-cycle-2", dispatchSeq: 2 } }));
    expect(next.observations.map(row => row.receipt.spec.sourceKey)).toEqual(first.observations.map(row => row.receipt.spec.sourceKey));
    expect(next.observations[0]?.receipt.context).toMatchObject({ observationCycleId: "fixture-cycle-2", dispatchSeq: 2 });
    expect(first.observations[0]?.receipt.context).toMatchObject({ observationCycleId: "fixture-cycle-1", dispatchSeq: 1 });
  });

  it.each(["https://ai.cangyuansuanli.cn/custom/v1", "https://tu.988236.xyz/custom/v1", "https://asian-acc.we-token.cc/custom/v1",
    "https://api.tk1688.com/custom/v1", "https://api.miaowuai.store/custom/v1", "https://api.mikoto.vip/custom/v1"])
    ("custom instance subpath %s never dispatches a fixed official catalog/native loader", async base => {
      const record = connection(base, { accountKeyGroupId: "28" });
      const plan = catalogSourcePlan(record);
      expect(plan.map(spec => spec.entryId)).toEqual(["key-models"]);
      const requested: string[] = [];
      const result = await collectCatalogReadCycle(record, undefined, dependencies(spec => vi.fn<typeof fetch>(async input => {
        requested.push(String(input));
        return spec.entryId === "key-models" ? keyList("gpt-image-2") : new Response(null, { status: 404 });
      }), { documentBudget: 0 }));
      expect(requested).toEqual([`${base}/models`]);
      expect(result.keyVisibleModels.map(model => model.id)).toEqual(["gpt-image-2"]);
      expect(guards.implicit).not.toHaveBeenCalled();
    });
});

describe("catalog read failure reasons", () => {
  it("classifies an exhausted balance as balance even when the gateway answers 401 or 403", () => {
    expect(catalogReadReason("insufficient_balance", 403)).toBe("balance");
    expect(catalogReadReason("insufficient_quota", 401)).toBe("balance");
    expect(catalogReadReason("账户余额不足", 403)).toBe("balance");
    expect(catalogReadReason(undefined, 402)).toBe("balance");
    expect(catalogReadReason("permission_denied", 403)).toBe("authentication");
    expect(catalogReadReason(undefined, 401)).toBe("authentication");
    expect(catalogReadReason("credentials-unavailable")).toBe("authentication");
  });
});
