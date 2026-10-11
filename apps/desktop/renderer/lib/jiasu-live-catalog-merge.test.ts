import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";

const isolatedNetwork = vi.hoisted(() => ({
  providerFetch: vi.fn<typeof fetch>(),
  globalFetch: vi.fn<typeof fetch>(),
  lookup: vi.fn(async () => [{ address: "203.0.113.10", family: 4 }]),
}));
vi.mock("node:dns/promises", () => ({ lookup: isolatedNetwork.lookup }));
vi.mock("@super-canvas/providers", async original => ({
  ...(await original<typeof import("@super-canvas/providers")>()),
  providerFetch: isolatedNetwork.providerFetch,
}));
vi.mock("./supplier-service", () => ({ getSupplierRecord: vi.fn(async () => null) }));
vi.mock("./server", () => ({ repository: { getSupplierVerification: vi.fn(async () => null) } }));

import { discoverSupplierCatalog, scanProviderModelCatalog, type SupplierCatalogDiscovery } from "@super-canvas/providers";
import { remainingVideoModel } from "@super-canvas/providers/remaining-video-contracts";
import { getSupplierRecord } from "./supplier-service";
import { applySupplierCatalogPrices, enrichSupplierModelPrices } from "./supplier-model-pricing";
import { bindScannedModelProtocols } from "./scanned-model-protocols";

const captured = JSON.parse(readFileSync(new URL("../../../../packages/providers/src/fixtures/jiasu-api-examples-20261010.json", import.meta.url), "utf8")) as {
  templateExcerpt: string;
  sourceReceipt: { sourceUrl: string; bodySha256: string };
  supported_endpoint: Record<string, { path: string; method: string }>;
  data: Record<string, unknown>[];
};
const site = "https://ai.jiasuapi.com";
const apiUrl = `${site}/v1`;
const firstAt = "2026-10-12T01:00:00.000Z";
const nextAt = "2026-10-12T02:00:00.000Z";
const partialAt = "2026-10-12T03:00:00.000Z";
// The authenticated directory evidence contains these exact 13 video IDs.
const keyVideoIds = [
  "sd-2.5-J2", "grok-1.5", "seedance2.0-720-满血真人", "sd-2.0-mini-J1", "dola-sd-2.5", "minimax-h3",
  "seedance2.0-mini-A", "seedance2.5-全参真人", "sd-2.0-933-720-fast-原生真人", "sd-2.0-fast-803-J3",
  "sd-2.0-mini-503-J3", "dola-sd-2.0", "sd-2.0-fast-813-J3",
];
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
type WithMetadata = { metadata?: Readonly<Record<string, unknown>> };
const example = (model: WithMetadata) => model.metadata?.jiasuApiExampleContract as Record<string, unknown> | undefined;
const nestedExample = (model: WithMetadata) => (model.metadata?.jiasuCatalogRecord as { apiExampleContract?: Record<string, unknown> } | undefined)?.apiExampleContract;
const directory = (ids: readonly string[] = keyVideoIds) => scanProviderModelCatalog({ data: ids.map(id => ({ id })) }, { baseUrl: apiUrl, modelGroup: "vip" }).models;
const connection = (ids: readonly string[] = keyVideoIds) => ({ provider: "openai", config: {
  baseUrl: apiUrl, modelGroup: "vip", accountKeyGroup: "vip", usage: "canvas", modelScanStatus: "live", scannedModelIds: [...ids],
} });

/** Literal captured schema and JS are parsed by the production discovery path.
 * Only the amounts/group membership are isolated controls, not claimed live prices.
 */
function publicDirectoryFetch(validTemplate = true, group = "vip") {
  return vi.fn<typeof fetch>(async (url, init) => {
    expect(init?.method ?? "GET").toBe("GET");
    const parsed = new URL(String(url));
    expect(parsed.origin).toBe(site);
    if (parsed.pathname === "/api/pricing") return Response.json({
      data: captured.data.map((row, index) => ({ ...row, enable_groups: [group], quota_type: 1, model_price: 1 + index / 100 })),
      group_ratio: { [group]: 1 }, supported_endpoint: captured.supported_endpoint,
    });
    if (parsed.pathname === "/api/status") return Response.json({ data: {
      quota_display_type: "CUSTOM", custom_currency_symbol: "¥", custom_currency_exchange_rate: 1,
    } });
    if (parsed.pathname === "/api/user/self/groups") return Response.json({ data: { [group]: { desc: group, ratio: 1 } } });
    if (parsed.pathname === "/") {
      expect(init?.headers).toBeUndefined();
      return new Response('<script defer src="/static/js/index.723048e8ea.js"></script>');
    }
    if (String(url) === captured.sourceReceipt.sourceUrl) {
      expect(init?.headers).toBeUndefined();
      return new Response(validTemplate ? captured.templateExcerpt : "invalid-isolated-template");
    }
    throw new Error(`Unexpected isolated document path: ${parsed.pathname}`);
  });
}
async function plaza(checkedAt = firstAt, validTemplate = true, group = "vip", refreshId?: string) {
  vi.setSystemTime(new Date(checkedAt));
  const fetcher = publicDirectoryFetch(validTemplate, group);
  const catalog = await discoverSupplierCatalog({ siteUrl: site, apiUrl, kind: "newapi", ...(refreshId ? { refreshId } : {}) }, fetcher);
  expect(catalog.status).toBe("live");
  expect(catalog.groups[0]?.models).toHaveLength(28);
  expect(fetcher.mock.calls.filter(([url]) => new URL(String(url)).pathname.startsWith("/static/js/"))).toHaveLength(1);
  return catalog;
}
function supplier(catalog: SupplierCatalogDiscovery, id = "isolated-live-jiasu") {
  return { id, name: "Isolated Jiasu", supplierKey: "jiasu", siteUrl: site, apiUrl, kind: "newapi",
    state: { sourceId: `${id}-source` }, catalog: { groups: catalog.groups }, scanStatus: "live", scanComplete: true,
    scannedAt: catalog.checkedAt, createdAt: firstAt, updatedAt: catalog.checkedAt };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(firstAt));
  isolatedNetwork.providerFetch.mockReset().mockImplementation(async (_url, init) => {
    expect(init?.method ?? "GET").toBe("GET");
    throw new Error("Isolated free directory failure");
  });
  isolatedNetwork.globalFetch.mockReset().mockRejectedValue(new Error("Real network is forbidden in this test"));
  vi.stubGlobal("fetch", isolatedNetwork.globalFetch);
  vi.mocked(getSupplierRecord).mockResolvedValue(null);
});
afterEach(() => {
  try { expect(isolatedNetwork.globalFetch).not.toHaveBeenCalled(); }
  finally { vi.unstubAllGlobals(); vi.useRealTimers(); }
});

describe("Jiasu live plaza contracts across native, saved and cached inventories", () => {
  it("keeps the current Key's 13 IDs while merging all matching live examples from the captured 28-model plaza", async () => {
    const catalog = await plaza();
    const native = directory();
    expect(native).toHaveLength(13);
    expect(native.some(model => example(model)?.sourceStatus === "snapshot")).toBe(true);
    expect(native.every(model => example(model)?.sourceStatus !== "live")).toBe(true);
    const merged = applySupplierCatalogPrices(native, "vip", catalog, site);
    const bound = bindScannedModelProtocols(connection(), merged).models;
    const saved = clone(bound);
    const cached = bindScannedModelProtocols(connection(), applySupplierCatalogPrices(saved, "vip", catalog, site, { savedCatalog: true })).models;
    for (const models of [merged, bound, saved, cached]) {
      expect(models.map(model => model.id)).toEqual(keyVideoIds);
      for (const model of models) {
        const publicModel = catalog.groups[0]!.models.find(item => item.id === model.id)!;
        expect(example(model)).toEqual(example(publicModel));
        expect(nestedExample(model)).toEqual(example(publicModel));
        expect(model.metadata).toMatchObject({ jiasuApiExampleScanStatus: "live", jiasuApiExampleCheckedAt: firstAt });
        expect(model.pricing).toEqual(merged.find(item => item.id === model.id)?.pricing);
      }
    }
    const dola = cached.find(model => model.id === "dola-sd-2.5")!;
    expect(dola.parameters?.find(parameter => parameter.key === "resolution")).toMatchObject({ control: "text", allowCustomValue: true, placeholder: "720p" });
    expect(dola.parameters?.find(parameter => parameter.key === "resolution")?.default).toBeUndefined();
  });

  it("updates example evidence even when a later exact group price makes cached pricing return early", async () => {
    const catalog = await plaza();
    const id = "dola-sd-2.5";
    const native = directory([id])[0]!;
    const pricing = { kind: "per-request" as const, currency: "CNY", billingUnit: "request" as const,
      unitAmount: 9, checkedAt: nextAt, confidence: "exact" as const, sourceUrl: `${site}/api/pricing` };
    const quoted = { ...native, pricing, metadata: { ...native.metadata, priceSource: "supplier-catalog", supplierPriceGroup: "vip", priceLabel: "9 CNY / 次", priceCheckedAt: nextAt } };
    const merged = applySupplierCatalogPrices([quoted], "vip", catalog, site, { savedCatalog: true })[0]!;
    expect(merged.pricing).toEqual(pricing);
    expect(merged.metadata?.priceCheckedAt).toBe(nextAt);
    expect(example(merged)).toEqual(example(catalog.groups[0]!.models.find(model => model.id === id)!));
    expect(nestedExample(merged)).toEqual(example(merged));
  });

  it("merges same-source saved live contracts before a forced public price read fails", async () => {
    const catalog = await plaza();
    const owner = supplier(catalog, "isolated-force-failure");
    vi.mocked(getSupplierRecord).mockResolvedValue(owner as unknown as Awaited<ReturnType<typeof getSupplierRecord>>);
    vi.setSystemTime(new Date(nextAt));
    const priced = applySupplierCatalogPrices(directory(), "vip", catalog, site);
    // The native read inherits the previous exact quote while its contract is
    // still sparse/snapshot. A failed refresh must retain this actual quote.
    const inherited = directory().map(model => {
      const prior = priced.find(item => item.id === model.id)!;
      return { ...model, pricing: prior.pricing, metadata: { ...model.metadata,
        priceLabel: prior.metadata?.priceLabel, priceSource: prior.metadata?.priceSource,
        supplierPriceGroup: "vip", priceCheckedAt: prior.metadata?.priceCheckedAt } };
    });
    const result = await enrichSupplierModelPrices({ config: { supplierId: owner.id, supplierSourceId: owner.state.sourceId,
      baseUrl: apiUrl, accountKeyGroup: "vip", modelGroup: "vip" } }, inherited, true, true, { refreshId: "isolated-force-failure" });
    expect(result.map(model => model.id)).toEqual(keyVideoIds);
    expect(isolatedNetwork.providerFetch).toHaveBeenCalled();
    for (const model of result) {
      expect(example(model)).toMatchObject({ modelId: model.id, sourceStatus: "live", checkedAt: firstAt });
      expect(nestedExample(model)).toEqual(example(model));
      expect(model.pricing).toEqual(priced.find(item => item.id === model.id)?.pricing);
    }
    const cached = await enrichSupplierModelPrices({ config: { supplierId: owner.id, supplierSourceId: owner.state.sourceId,
      baseUrl: apiUrl, accountKeyGroup: "vip", modelGroup: "vip" } }, clone(result), false, false);
    expect(cached.map(example)).toEqual(result.map(example));
  });

  it("does not let an older live example or a partial snapshot replace newer live evidence", async () => {
    const oldCatalog = await plaza(firstAt);
    const currentCatalog = await plaza(nextAt);
    const partialCatalog = await plaza(partialAt, false);
    const current = applySupplierCatalogPrices(directory(), "vip", currentCatalog, site);
    const older = applySupplierCatalogPrices(current, "vip", oldCatalog, site, { savedCatalog: true });
    const partial = applySupplierCatalogPrices(older, "vip", partialCatalog, site);
    for (const model of partial) {
      expect(example(model)).toEqual(example(current.find(item => item.id === model.id)!));
      expect(nestedExample(model)).toEqual(example(model));
      expect(model.metadata).toMatchObject({ jiasuApiExampleScanStatus: "partial", jiasuApiExampleCheckedAt: partialAt });
      const rebound = remainingVideoModel("jiasu", model.id, clone(model), { group: "vip" })!;
      expect(example(rebound)).toEqual(example(model));
      expect(rebound.metadata?.jiasuApiExampleScanStatus).toBe("partial");
    }
  });

  it("reuses one operation's complete 28-model public receipt without downloading the JS twice", async () => {
    const refreshId = "isolated-current-operation";
    const catalog = await plaza(firstAt, true, "vip", refreshId);
    const saved = supplier(catalog, "isolated-operation-reuse");
    const owner = { ...saved, state: { ...saved.state, scanId: refreshId } };
    vi.mocked(getSupplierRecord).mockResolvedValue(owner as unknown as Awaited<ReturnType<typeof getSupplierRecord>>);
    const fetcher = publicDirectoryFetch();
    isolatedNetwork.providerFetch.mockImplementation(fetcher);
    vi.setSystemTime(new Date(nextAt));
    const result = await enrichSupplierModelPrices({ config: { supplierId: owner.id, supplierSourceId: owner.state.sourceId,
      baseUrl: apiUrl, accountKeyGroup: "vip", modelGroup: "vip" } }, directory(), true, true, { refreshId });
    expect(result.map(model => model.id)).toEqual(keyVideoIds);
    expect(fetcher.mock.calls.some(([url]) => new URL(String(url)).pathname === "/api/pricing")).toBe(true);
    expect(fetcher.mock.calls.filter(([url]) => ["/", new URL(captured.sourceReceipt.sourceUrl).pathname].includes(new URL(String(url)).pathname))).toHaveLength(0);
    for (const model of result) {
      expect(example(model)).toMatchObject({ sourceStatus: "live", checkedAt: firstAt, modelId: model.id });
      expect(nestedExample(model)).toEqual(example(model));
      expect(model.metadata).toMatchObject({ jiasuApiExampleScanStatus: "live", jiasuApiExampleCheckedAt: firstAt, jiasuApiExampleRefreshId: refreshId });
    }
  });

  it.each(["another-operation", "missing-public-model"])("reads fresh JS when the reusable receipt is %s", async condition => {
    const originalRefreshId = `isolated-receipt-${condition}`;
    const catalog = await plaza(firstAt, true, "vip", originalRefreshId);
    const saved = supplier(catalog, `isolated-incomplete-reuse-${condition}`);
    const owner = { ...saved, state: { ...saved.state, scanId: originalRefreshId } };
    if (condition === "missing-public-model") {
      // WAN3 is outside this Key's 13 IDs, but public receipt coverage must
      // include it too before the next whole-plaza JS read may be skipped.
      expect(keyVideoIds).not.toContain("wan3");
      const omitted = owner.catalog.groups[0]!.models.find(model => model.id === "wan3")!;
      omitted.metadata = { ...omitted.metadata, jiasuApiExampleRefreshId: undefined };
    }
    const refreshId = condition === "another-operation" ? `${originalRefreshId}-new` : originalRefreshId;
    vi.mocked(getSupplierRecord).mockResolvedValue(owner as unknown as Awaited<ReturnType<typeof getSupplierRecord>>);
    const fetcher = publicDirectoryFetch();
    isolatedNetwork.providerFetch.mockImplementation(fetcher);
    vi.setSystemTime(new Date(nextAt));
    const result = await enrichSupplierModelPrices({ config: { supplierId: owner.id, supplierSourceId: owner.state.sourceId,
      baseUrl: apiUrl, accountKeyGroup: "vip", modelGroup: "vip" } }, directory(), true, true, { refreshId });
    expect(fetcher.mock.calls.filter(([url]) => new URL(String(url)).pathname.startsWith("/static/js/"))).toHaveLength(1);
    expect(result.map(model => model.id)).toEqual(keyVideoIds);
    expect(result.every(model => example(model)?.sourceStatus === "live" && example(model)?.checkedAt === nextAt)).toBe(true);
  });

  it("carries the current public context into a native Key read without an account-key precommit", async () => {
    const refreshId = "isolated-uncommitted-context";
    const oldCatalog = await plaza(firstAt, false);
    const currentCatalog = await plaza(nextAt, true, "vip", refreshId);
    const saved = supplier(oldCatalog, "isolated-no-account-precommit");
    // There is no site login or account-key synchronization. The repository
    // still contains old snapshots while this operation has new public data.
    const owner = { ...saved, state: { ...saved.state, scanId: refreshId } };
    const before = clone(owner);
    vi.mocked(getSupplierRecord).mockResolvedValue(owner as unknown as Awaited<ReturnType<typeof getSupplierRecord>>);
    const fetcher = publicDirectoryFetch();
    isolatedNetwork.providerFetch.mockImplementation(fetcher);
    vi.setSystemTime(new Date(partialAt));
    const result = await enrichSupplierModelPrices({ config: { supplierId: owner.id, supplierSourceId: owner.state.sourceId,
      baseUrl: apiUrl, accountKeyGroup: "vip", modelGroup: "vip" } }, directory(), true, true, {
      refreshId, jiasuApiExampleContext: { supplierId: owner.id, sourceId: owner.state.sourceId, refreshId, catalog: currentCatalog },
    });
    expect(result.map(model => model.id)).toEqual(keyVideoIds);
    expect(result.every(model => example(model)?.sourceStatus === "live" && example(model)?.checkedAt === nextAt)).toBe(true);
    expect(result.map(nestedExample)).toEqual(result.map(example));
    expect(fetcher.mock.calls.some(([url]) => new URL(String(url)).pathname === "/api/pricing")).toBe(true);
    expect(fetcher.mock.calls.filter(([url]) => ["/", new URL(captured.sourceReceipt.sourceUrl).pathname].includes(new URL(String(url)).pathname))).toHaveLength(0);
    expect(owner).toEqual(before);
    const cached = await enrichSupplierModelPrices({ config: { supplierId: owner.id, supplierSourceId: owner.state.sourceId,
      baseUrl: apiUrl, accountKeyGroup: "vip", modelGroup: "vip" } }, clone(result), false, false);
    expect(cached.map(example)).toEqual(result.map(example));
    expect(cached.map(nestedExample)).toEqual(result.map(example));
  });

  it.each(["old-operation", "other-supplier", "other-source", "other-group", "missing-connection-source"])("rejects the %s current-directory context", async condition => {
    const refreshId = `isolated-context-${condition}`;
    const oldCatalog = await plaza(firstAt, false);
    const currentCatalog = await plaza(nextAt, true, condition === "other-group" ? "another-group" : "vip", refreshId);
    const saved = supplier(oldCatalog, `isolated-context-owner-${condition}`);
    const owner = { ...saved, state: { ...saved.state, scanId: refreshId } };
    vi.mocked(getSupplierRecord).mockResolvedValue(owner as unknown as Awaited<ReturnType<typeof getSupplierRecord>>);
    const context = { supplierId: condition === "other-supplier" ? "another-supplier" : owner.id,
      sourceId: condition === "other-source" ? "another-source" : owner.state.sourceId,
      refreshId: condition === "old-operation" ? `${refreshId}-previous` : refreshId, catalog: currentCatalog };
    const result = await enrichSupplierModelPrices({ config: { supplierId: owner.id,
      ...(condition === "missing-connection-source" ? {} : { supplierSourceId: owner.state.sourceId }),
      baseUrl: apiUrl, accountKeyGroup: "vip", modelGroup: "vip" } }, directory(), true, false, {
      refreshId, jiasuApiExampleContext: context,
    });
    expect(result.map(model => model.id)).toEqual(keyVideoIds);
    expect(result.every(model => example(model)?.sourceStatus !== "live")).toBe(true);
    expect(result.map(nestedExample)).toEqual(result.map(example));
    expect(isolatedNetwork.providerFetch).not.toHaveBeenCalled();
  });

  it("does not borrow contracts from a different site, group, full ID or edited supplier source", async () => {
    const catalog = await plaza();
    const native = directory();
    for (const [group, source] of [["vip", "https://other.invalid"], ["another-group", site]]) {
      const result = applySupplierCatalogPrices(native, group!, catalog, source);
      expect(result.map(example)).toEqual(native.map(example));
      expect(result.map(nestedExample)).toEqual(native.map(nestedExample));
    }
    const alias = directory(["dola-sd-2.5-alias"])[0]!;
    expect(example(applySupplierCatalogPrices([alias], "vip", catalog, site)[0]!)).toEqual(example(alias));
    const invalid = clone(catalog);
    const invalidRow = invalid.groups[0]!.models.find(model => model.id === "dola-sd-2.5")!;
    const otherExample = example(invalid.groups[0]!.models.find(model => model.id === "dola-sd-2.0")!)!;
    invalidRow.metadata = { ...invalidRow.metadata, jiasuApiExampleContract: otherExample,
      jiasuCatalogRecord: { ...(invalidRow.metadata?.jiasuCatalogRecord as Record<string, unknown>), apiExampleContract: otherExample } };
    const invalidNative = directory([invalidRow.id]);
    const invalidMerged = applySupplierCatalogPrices(invalidNative, "vip", invalid, site)[0]!;
    expect(example(invalidMerged)).toEqual(example(invalidNative[0]!));
    expect(nestedExample(invalidMerged)).toEqual(nestedExample(invalidNative[0]!));
    const owner = supplier(catalog, "isolated-source-mismatch");
    vi.mocked(getSupplierRecord).mockResolvedValue(owner as unknown as Awaited<ReturnType<typeof getSupplierRecord>>);
    const result = await enrichSupplierModelPrices({ config: { supplierId: owner.id, supplierSourceId: "changed-source",
      baseUrl: apiUrl, accountKeyGroup: "vip", modelGroup: "vip" } }, native, false, false);
    expect(result.map(example)).toEqual(native.map(example));
    expect(isolatedNetwork.providerFetch).not.toHaveBeenCalled();
  });

  it.each(["manual", "paid-test"])("keeps the explicitly saved %s protocol contract", async source => {
    const catalog = await plaza();
    const native = directory(["dola-sd-2.5"])[0]!;
    const original = { ...native, metadata: { ...native.metadata, source, protocolEvidence: source === "paid-test" ? "paid-test" : "manual",
      protocol: "documented-rest", endpointPath: "/isolated/custom-route" } };
    const merged = applySupplierCatalogPrices([original], "vip", catalog, site)[0]!;
    expect(example(merged)).toEqual(example(original));
    expect(nestedExample(merged)).toEqual(nestedExample(original));
    expect(merged.metadata?.endpointPath).toBe("/isolated/custom-route");
  });
});
