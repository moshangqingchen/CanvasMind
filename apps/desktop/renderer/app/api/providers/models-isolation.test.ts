import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRepository } from "@super-canvas/db";
const mocks = vi.hoisted(() => ({
  repository: undefined as unknown as MemoryRepository,
  fetch: vi.fn(),
  syncCangyuan: vi.fn(),
  document: vi.fn(),
}));
vi.mock("../../../lib/supplier-document", () => ({ readSupplierDocument: mocks.document }));
vi.mock("../../../lib/cangyuan-catalog", async (original) => ({
  ...(await original<typeof import("../../../lib/cangyuan-catalog")>()),
  syncCangyuanConnection: mocks.syncCangyuan,
}));
vi.mock("../../../lib/server", () => ({
  get repository() {
    return mocks.repository;
  },
  jsonError: (error: string, status: number) =>
    Response.json({ error }, { status }),
}));
vi.mock("@super-canvas/providers", async (original) => ({
  ...(await original<typeof import("@super-canvas/providers")>()),
  providerFetch: mocks.fetch,
}));
import { encryptSecret } from "@super-canvas/providers";
import {
  createSupplierRecord,
  patchSupplierRecord,
} from "../../../lib/supplier-service";
import { GET } from "./[id]/models/route";
import * as supplierModelPricing from "../../../lib/supplier-model-pricing";
import { modelPriceSummary } from "../../../lib/model-display";
import {
  mikotoConnectorForGroup,
  MIKOTO_IMAGE_GROUP,
  MIKOTO_IMAGE_4K_GROUP,
} from "../../../lib/mikoto-presets";
const refresh = (id: string, enabled = true) =>
  GET(
    new Request(
      `http://localhost/api/providers/${id}/models${enabled ? "?refresh=1" : ""}`,
    ),
    { params: Promise.resolve({ id }) },
  );
beforeEach(() => {
  mocks.repository = new MemoryRepository();
  mocks.fetch.mockReset();
  mocks.syncCangyuan.mockReset();
  mocks.document.mockReset();
  process.env.MASTER_KEY = "isolated-test-master";
});
async function fixture(supplierKey?: string) {
  const supplier = await createSupplierRecord({
    name: "Instance",
    supplierKey,
    siteUrl: "https://instance.example.com/prefix",
    apiUrl: "https://instance.example.com/prefix/v1",
  });
  const connection = await mocks.repository.saveConnection({
    id: "group",
    name: "Group",
    provider: "openai",
    encryptedSecret: encryptSecret("mock-key", "isolated-test-master"),
    config: {
      supplierId: supplier.id,
      supplierSourceId: supplier.state!.sourceId,
      supplierKey: supplier.supplierKey,
      baseUrl: supplier.apiUrl,
      modelGroup: "same-name",
      customGroup: true,
      manualModels: [
        { id: "manual-only", capability: "image", protocol: "openai-images" },
      ],
    },
  });
  return { supplier, connection };
}
async function mixedGroupPriceFixture() {
  const { supplier, connection } = await fixture("mikoto");
  const group = "生图（2k4k 高质量）";
  const declarations = ["image2 0.1一张 能高质量", "image2.5 flare 0.13一张 支持五档质量", "image2.5 sub 0.16一张 支持五档质量"];
  const ids = ["gpt-image-2", "gpt-image-2.5-flare", "gpt-image-2.5-sunburst"];
  const savedSupplier = await mocks.repository.saveSupplier({ ...supplier, kind: "newapi", scanStatus: "live", scanComplete: true,
    catalog: { groups: [{ id: group, label: group, models: [], details: { source: "key-groups", description: declarations.join("\n"),
      referencePrice: declarations.join("；"), supportedResolutions: ["2K", "4K"],
      imagePrices: [{ resolution: "2K", amount: 0.1 }, { resolution: "4K", amount: 0.1 }] } }] } });
  const models = ids.map(id => ({ id, name: id, operations: ["image.generate"],
    pricing: { kind: "tiered", currency: "credits", checkedAt: "2026-09-20T00:00:00Z", confidence: "exact",
      tiers: [{ id: "2K", label: "2K", dimension: "resolution", value: "2K", price: 0.1 },
        { id: "4K", label: "4K", dimension: "resolution", value: "4K", price: 0.1 }] },
    metadata: { priceSource: "supplier-group", priceLabel: declarations.join("；") + "（分组说明参考）" } }));
  const savedConnection = await mocks.repository.saveConnection({ ...connection, config: { ...connection.config, modelGroup: group,
    manualModels: [], modelScanStatus: "live", modelScanCheckedAt: "2026-09-20T00:00:00Z", modelScanComplete: true,
    scannedModelIds: ids, modelCatalogModels: models } });
  return { supplier: savedSupplier, connection: savedConnection, declarations, ids, models };
}
describe("model refresh source boundary", () => {
  it.each([false, true])("quotes an appended manual model from only its saved supplier/group without network, cached=%s", async cachedOnly => {
    const { supplier, connection } = await fixture();
    const savedSupplier = await mocks.repository.saveSupplier({ ...supplier, kind: "newapi", scanStatus: "live", scanComplete: true,
      catalog: { groups: [
        { id: "same-name", label: "Current", models: [{ id: "manual-only", capability: "image", priceLabel: "$0.19/张" }] },
        { id: "other-group", label: "Other", models: [{ id: "manual-only", capability: "image", priceLabel: "$9/张" }] },
      ] } });
    const saved = await mocks.repository.saveConnection({ ...connection, config: { ...connection.config,
      modelScanStatus: "live", modelCatalogModels: [] } });
    const lookup = vi.spyOn(supplierModelPricing, "enrichSupplierModelPrices");
    try {
      const response = await GET(new Request(`http://localhost/api/providers/${connection.id}/models${cachedOnly ? "?cached=1" : ""}`),
        { params: Promise.resolve({ id: connection.id }) });
      expect(response.status).toBe(200);
      const models = await response.json();
      expect(models.map((model: { id: string }) => model.id)).toEqual(["manual-only"]);
      expect(models[0].metadata).toMatchObject({ source: "manual", priceSource: "supplier-catalog", priceLabel: "$0.19/张" });
      expect(modelPriceSummary(models[0], {})).toBe("0.19 USD / 张");
      expect(lookup.mock.calls.some(([, models]) => models.some(model => model.id === "manual-only"))).toBe(true);
      expect(lookup.mock.calls.every(([, , force, allowNetwork]) => force === false && allowNetwork === false)).toBe(true);
      expect(mocks.fetch).not.toHaveBeenCalled();
      expect(mocks.document).not.toHaveBeenCalled();
      expect(await mocks.repository.getConnection(connection.id)).toEqual(saved);
      expect(await mocks.repository.getSupplier(supplier.id)).toEqual(savedSupplier);
    } finally {
      lookup.mockRestore();
    }
  });
  it("repairs saved mixed model prices after an upstream outage without another price lookup or changing inventory", async () => {
    const { supplier, connection, declarations, ids, models: oldModels } = await mixedGroupPriceFixture();
    mocks.fetch.mockRejectedValue(new Error("upstream model directory unavailable"));
    const lookup = vi.spyOn(supplierModelPricing, "enrichSupplierModelPrices");
    try {
      const response = await refresh(connection.id);
      expect(response.status).toBe(200);
      expect(response.headers.get("X-Model-Scan-Status")).toBe("stale");
      const models = await response.json();
      expect(models.map((model: { id: string }) => model.id)).toEqual(ids);
      for (const [index, model] of models.entries()) {
        expect(model.pricing).toBeUndefined();
        expect(model.metadata.priceLabel).toContain(declarations[index]);
        for (const other of declarations.filter((_, otherIndex) => index !== otherIndex))
          expect(model.metadata.priceLabel).not.toContain(other);
        expect(modelPriceSummary(model, { size_tier: "4K", quality: "max" })).not.toContain("额度");
      }
      expect(lookup.mock.calls.length).toBeGreaterThan(0);
      expect(lookup.mock.calls.every(([, , force, allowNetwork]) => force === false && allowNetwork === false)).toBe(true);
      expect(mocks.fetch.mock.calls.every(([url]) => String(url).includes("/models"))).toBe(true);
      expect(mocks.document).not.toHaveBeenCalled();
      const saved = (await mocks.repository.getConnection(connection.id))!;
      expect(saved.config.scannedModelIds).toEqual(ids);
      expect(saved.config.modelCatalogModels).toEqual(oldModels);
      expect(saved.encryptedSecret).toBe(connection.encryptedSecret);
      expect(await mocks.repository.getSupplier(supplier.id)).toEqual(supplier);
    } finally {
      lookup.mockRestore();
    }
  });
  it("discards an appended manual price when the connection group changes during offline enrichment", async () => {
    const { supplier, connection } = await fixture();
    await mocks.repository.saveSupplier({ ...supplier, kind: "newapi", scanStatus: "live", scanComplete: true,
      catalog: { groups: [{ id: "same-name", label: "Current", models: [{ id: "manual-only", capability: "image", priceLabel: "$0.19/张" }] }] } });
    const saved = await mocks.repository.saveConnection({ ...connection, config: { ...connection.config,
      modelScanStatus: "live", modelCatalogModels: [] } });
    const actual = supplierModelPricing.enrichSupplierModelPrices;
    let changed = false;
    const lookup = vi.spyOn(supplierModelPricing, "enrichSupplierModelPrices").mockImplementation(async (source, models, ...options) => {
      if (!changed && models.some(model => model.id === "manual-only")) {
        changed = true;
        await mocks.repository.saveConnection({ ...saved, config: { ...saved.config, modelGroup: "other-group" } });
      }
      return actual(source, models, ...options);
    });
    try {
      const response = await GET(new Request(`http://localhost/api/providers/${connection.id}/models?cached=1`),
        { params: Promise.resolve({ id: connection.id }) });
      expect(response.status).toBe(409);
      expect((await response.json()).error).toContain("连接已改变");
      expect((await mocks.repository.getConnection(connection.id))?.config.modelGroup).toBe("other-group");
      expect(mocks.fetch).not.toHaveBeenCalled();
      expect(mocks.document).not.toHaveBeenCalled();
    } finally {
      lookup.mockRestore();
    }
  });
  it("repairs mixed prices in the failure fallback after a saved model read throws", async () => {
    const { connection, declarations, ids, models: oldModels } = await mixedGroupPriceFixture();
    const lookup = vi.spyOn(supplierModelPricing, "enrichSupplierModelPrices").mockRejectedValueOnce(new Error("temporary price read error"));
    try {
      const response = await refresh(connection.id, false);
      expect(response.status).toBe(200);
      expect(response.headers.get("X-Model-Scan-Status")).toBe("stale");
      const models = await response.json();
      expect(models.map((model: { id: string }) => model.id)).toEqual(ids);
      for (const [index, model] of models.entries()) {
        expect(model.pricing).toBeUndefined();
        expect(model.metadata.priceLabel).toContain(declarations[index]);
        for (const other of declarations.filter((_, otherIndex) => index !== otherIndex))
          expect(model.metadata.priceLabel).not.toContain(other);
      }
      expect(lookup.mock.calls).toHaveLength(2);
      expect(lookup.mock.calls.every(([, , force, allowNetwork]) => force === false && allowNetwork === false)).toBe(true);
      expect(mocks.fetch).not.toHaveBeenCalled();
      expect(mocks.document).not.toHaveBeenCalled();
      expect((await mocks.repository.getConnection(connection.id))?.config.modelCatalogModels).toEqual(oldModels);
    } finally {
      lookup.mockRestore();
    }
  });
  it.each(["canvas", "agent"])("keeps supported object-map/alternate model-list payloads for %s connections", async usage => {
    const { connection } = await fixture();
    await mocks.repository.saveConnection({ ...connection, config: { ...connection.config, usage, manualModels: [] } });
    mocks.fetch.mockImplementation(async (url: string | URL | Request) => String(url).includes("/models")
      ? Response.json({ items: { "map-image": { display_name: "Map image" } }, result: [{ model_name: "other-model" }] })
      : Response.json({}, { status: 404 }));
    const response = await refresh(connection.id);
    expect(response.status).toBe(200);
    expect((await response.json()).map((model: { id: string }) => model.id)).toEqual(["map-image", "other-model"]);
    expect((await mocks.repository.getConnection(connection.id))?.config.scannedModelIds).toEqual(["map-image", "other-model"]);
  });
  it.each([
    { payload: {}, code: "invalid_response" },
    { payload: { success: "false", data: [], message: "private-token-must-not-echo" }, code: "invalid_response" },
    { payload: { data: [{ id: "partial-new" }], has_more: "true", total: "100" }, code: "incomplete_directory" },
  ])("preserves confirmed inventory and manual configuration on $code HTTP 200 responses", async ({ payload, code }) => {
    const { connection } = await fixture();
    const confirmed = "2026-09-20T00:00:00.000Z";
    const catalog = [{ id: "old-image", name: "Old image", operations: ["image.generate"] }];
    await mocks.repository.saveConnection({ ...connection, config: { ...connection.config,
      modelScanStatus: "live", modelScanComplete: true, modelScanCheckedAt: confirmed, modelCatalogModels: catalog,
      scannedModelIds: ["old-image"], modelRemovedModels: [{ id: "earlier-removed" }],
    } });
    mocks.fetch.mockResolvedValue(Response.json(payload));
    const response = await refresh(connection.id);
    expect(response.headers.get("X-Model-Scan-Status")).toBe("stale");
    expect((await response.json()).map((model: { id: string }) => model.id)).toContain("old-image");
    const saved = (await mocks.repository.getConnection(connection.id))!;
    expect(saved.config).toMatchObject({ modelScanStatus: "failed", modelScanComplete: false,
      modelScanErrorCode: code, modelScanHttpStatus: 200, modelScanLastSuccessAt: confirmed,
      modelCatalogModels: catalog, scannedModelIds: ["old-image"], modelRemovedModels: [{ id: "earlier-removed" }],
      manualModels: connection.config.manualModels,
    });
    expect(saved.encryptedSecret).toBe(connection.encryptedSecret);
    expect(JSON.stringify(saved.config)).not.toContain("private-token");
    mocks.fetch.mockImplementation(async (url: string | URL | Request) => String(url).includes("/models")
      ? Response.json({ data: [{ id: "new-image" }] }) : Response.json({}, { status: 404 }));
    expect((await refresh(connection.id)).headers.get("X-Model-Scan-Complete")).toBe("true");
    expect((await mocks.repository.getConnection(connection.id))?.config).toMatchObject({ modelScanComplete: true,
      modelScanError: null, modelScanErrorCode: null, modelScanHttpStatus: null, scannedModelIds: ["new-image"] });
  });
  it.each([{ code: "401", expectedStatus: 401, failure: "invalid_credentials" },
    { code: "403", expectedStatus: 403, failure: "permission_denied" }])(
    "treats HTTP 200 application code $code as authorization failure without promoting an empty directory", async ({code, expectedStatus, failure}) => {
      const { connection } = await fixture();
      mocks.fetch.mockResolvedValue(Response.json({ code, data: [], message: "private-token-must-not-echo" }));
      const response = await refresh(connection.id);
      expect(response.status).toBe(expectedStatus);
      expect(response.headers.get("X-Model-Scan-Status")).toBe("unauthorized");
      expect(JSON.stringify(await response.json())).not.toContain("private-token");
      expect((await mocks.repository.getConnection(connection.id))?.config).toMatchObject({ modelScanStatus: "unauthorized",
        modelScanComplete: false, modelScanErrorCode: failure, modelScanHttpStatus: 200 });
      expect((await mocks.repository.getConnection(connection.id))?.config.modelScanLastSuccessAt).toBeNull();
    });
  it("retains actual upstream HTTP failures as safe metadata", async () => {
    const { connection } = await fixture();
    mocks.fetch.mockResolvedValue(Response.json({ message: "private-token-must-not-echo" }, { status: 502 }));
    await refresh(connection.id);
    const saved = (await mocks.repository.getConnection(connection.id))!;
    expect(saved.config).toMatchObject({ modelScanErrorCode: "directory_unavailable", modelScanHttpStatus: 502, modelScanComplete: false });
    expect(JSON.stringify(saved.config)).not.toContain("private-token");
  });
  it.each([false, true])("does not revive removed catalog interface metadata after REST binding, fresh API override=%s", async apiOverride => {
    const { connection } = await fixture();
    const oldDoc = "https://instance.example.com/old-interface.json";
    const apiDoc = "https://instance.example.com/current-api-interface.json";
    const descriptor = { id: "gpt-image-2", name: "Image", operations: ["image.generate", "image.edit"], metadata: {
      endpointTypes: ["/old-draw"], documentationUrl: oldDoc,
      supplierCatalogEndpointTypes: ["/old-draw"], supplierCatalogDocumentationUrl: oldDoc,
      supplierCatalogCheckedAt: "2026-09-20T00:00:00.000Z", supplierCatalogMetadataVersion: 1,
    } };
    const connector = mikotoConnectorForGroup(MIKOTO_IMAGE_GROUP);
    await mocks.repository.saveConnection({ ...connection, provider: "rest", config: { ...connection.config,
      manualModels: [], modelScanStatus: "live", modelCatalogModels: [descriptor],
      connector: { ...connector, allowedHosts: ["instance.example.com"], models: [descriptor] },
    } });
    mocks.fetch.mockImplementation(async (url: string | URL | Request) => {
      if (String(url).endsWith("/api/pricing")) return Response.json({ group_ratio: { "same-name": 1 }, data: [
        { model_name: "gpt-image-2", quota_type: 1, model_price: 0.08, enable_groups: ["same-name"] },
      ] });
      if (String(url).endsWith("/api/status")) return Response.json({ data: { quota_display_type: "CNY", usd_exchange_rate: 1 } });
      if (String(url).endsWith("/api/user/self/groups")) return Response.json({ data: { "same-name": { desc: "Current group", ratio: 1 } } });
      if (String(url).includes("/models")) return Response.json({ data: [{ id: "gpt-image-2",
        ...(apiOverride ? { documentationUrl: apiDoc, endpointTypes: ["/v1/images/generations"] } : {}),
      }] });
      return Response.json({}, { status: 404 });
    });
    const response = await refresh(connection.id);
    expect(response.status).toBe(200);
    const models = await response.json();
    expect(models[0].metadata.documentationUrl).toBe(apiOverride ? apiDoc : undefined);
    expect(models[0].metadata.endpointTypes).toEqual(apiOverride ? ["/v1/images/generations"] : undefined);
    expect(models[0].metadata.supplierCatalogDocumentationUrl).toBeUndefined();
    expect(models[0].metadata.supplierCatalogEndpointTypes).toBeUndefined();
    expect(mocks.fetch.mock.calls.some(([url]) => String(url) === oldDoc)).toBe(false);
    const saved = (await mocks.repository.getConnection(connection.id))!;
    const savedModels = saved.config.modelCatalogModels as Array<{ metadata: Record<string, unknown> }>;
    expect(savedModels[0]?.metadata.documentationUrl).toBe(apiOverride ? apiDoc : undefined);
    expect(savedModels[0]?.metadata.endpointTypes).toEqual(apiOverride ? ["/v1/images/generations"] : undefined);
    expect(savedModels[0]?.metadata.supplierCatalogDocumentationUrl).toBeUndefined();
    expect((saved.config.connector as typeof connector).models?.[0]?.metadata?.documentationUrl).toBe(apiOverride ? apiDoc : undefined);
  });
  it.each(["site-login", "revision-only"])("checks private site login identity after async documentation without blocking $mode changes", async mode => {
    const { supplier, connection } = await fixture();
    await mocks.repository.saveSupplier({ ...supplier, kind: "newapi", state: { ...supplier.state!, siteLogin: {
      authMode: "access-token", siteUrl: supplier.siteUrl,
      encryptedAccessToken: encryptSecret("fixture-old-site-token", "isolated-test-master"),
    } } });
    const docUrl = `https://instance.example.com/private-site-scope-${mode}.json`;
    mocks.fetch.mockImplementation(async (url: string | URL | Request) => {
      if (String(url).endsWith("/api/pricing")) return Response.json({ group_ratio: { "same-name": 1 }, data: [
        { model_name: "future-image", quota_type: 1, model_price: 0.08, enable_groups: ["same-name"] },
      ] });
      if (String(url).endsWith("/api/status")) return Response.json({ data: { quota_display_type: "CNY", usd_exchange_rate: 1 } });
      if (String(url).endsWith("/api/user/self/groups")) return Response.json({ data: { "same-name": { desc: "Group", ratio: 1 } } });
      if (String(url).endsWith("/api/user/self")) return Response.json({ success: true, data: { id: 42, username: "fixture-user" } });
      if (String(url).includes("/models")) return Response.json({ data: [{ id: "future-image", output_modalities: ["image"], documentationUrl: docUrl }] });
      if (String(url) === docUrl) {
        if (mode === "site-login") await patchSupplierRecord(supplier.id, {
          siteLogin: { authMode: "access-token", accessToken: "fixture-new-site-token" },
        });
        else {
          const current = (await mocks.repository.getSupplier(supplier.id))!;
          await mocks.repository.saveSupplier({ ...current, state: { ...current.state!, revision: current.state!.revision + 1 } });
        }
        return Response.json({ openapi: "3.1.0", paths: {} });
      }
      return Response.json({}, { status: 404 });
    });
    const response = await refresh(connection.id);
    expect(response.status).toBe(mode === "site-login" ? 409 : 200);
    const saved = (await mocks.repository.getConnection(connection.id))!;
    if (mode === "site-login") {
      expect(saved.config.autoModelInterfaces).toBeUndefined();
      expect(JSON.stringify(saved.config.modelCatalogModels)).not.toContain("¥0.08");
      expect(JSON.stringify(await response.json())).not.toContain("fixture-new-site-token");
    } else expect(saved.config.modelScanStatus).toBe("live");
  });
  it.each([false, true])("persists automatic agent discovery only for the current Key: changed=%s", async changed => {
    const { connection } = await fixture();
    const alias = "gpt-pro-[稳定优先]";
    await mocks.repository.saveConnection({ ...connection, config: { ...connection.config, usage: "agent", manualModels: [] } });
    mocks.fetch.mockImplementation(async (url: string) => Response.json(String(url).includes("/models")
      ? { data: [{ id: alias, upstream_model: "gpt-5.4" }] } : { data: [] }));
    mocks.document.mockImplementation(async () => {
      if (changed) {
        const latest = (await mocks.repository.getConnection(connection.id))!;
        await mocks.repository.saveConnection({ ...latest, encryptedSecret: "replaced-key", config: { ...latest.config,
          modelScanRequestId: "new-scope", modelCatalogModels: [], scannedModelIds: [] } });
      }
      return `${alias}: 官方型号：gpt-5.4`;
    });
    const response = await refresh(connection.id);
    expect(response.status).toBe(changed ? 409 : 200);
    const saved = (await mocks.repository.getConnection(connection.id))!;
    if (changed) expect(saved.config.modelCatalogModels).toEqual([]);
    else expect(saved.config.modelCatalogModels).toEqual([expect.objectContaining({ id: alias,
      metadata: expect.objectContaining({ agentDiscovery: expect.objectContaining({ officialModelId: "gpt-5.4", status: "complete" }) }) })]);
    expect(mocks.fetch.mock.calls.every(([, init]) => !init?.method || init.method === "GET")).toBe(true);
    expect(await mocks.repository.getSupplierVerification(String(connection.config.supplierId))).toBeNull();
  });
  it("repairs group price and compact size declarations during cache-only hydration without network or writes", async () => {
    const { supplier, connection } = await fixture();
    const group = "image2.5特价";
    const savedSupplier = await mocks.repository.saveSupplier({ ...supplier, scanStatus: "live", catalog: { groups: [
      { id: group, label: group, models: [], details: { source: "key-groups", description: "image2.5特价，0.06一张，124k" } },
    ] } });
    const saved = await mocks.repository.saveConnection({ ...connection, config: {
      ...connection.config, modelGroup: group, modelScanStatus: "live", scannedModelIds: ["gpt-image-2.5-all"], manualModels: [],
      modelCatalogModels: [{ id: "gpt-image-2.5-all", name: "gpt-image-2.5-all", operations: ["image.generate"], metadata: { priceLabel: "价格未公布", priceSource: "supplier-catalog" } }],
    } });
    const response = await GET(new Request(`http://localhost/api/providers/${connection.id}/models?cached=1`),
      { params: Promise.resolve({ id: connection.id }) });
    expect(response.status).toBe(200);
    const models = await response.json();
    expect(models).toHaveLength(1);
    expect(models[0].metadata).toMatchObject({ priceLabel: "0.06一张（分组说明参考）", priceSource: "supplier-group" });
    const sizes = models[0].parameters.find((p: { key: string }) => p.key === "size").options;
    expect(sizes.some((o: { value: string }) => o.value === "auto")).toBe(true);
    for (const tier of ["1K", "2K", "4K"])
      expect(sizes.filter((o: { label: string }) => o.label.startsWith(tier))).toHaveLength(11);
    expect(models[0].parameters.find((p: { key: string }) => p.key === "quality")).toMatchObject({ default: "max",
      options: ["auto", "low", "medium", "high", "xhigh", "max"].map(value => ({ value })),
    });
    expect(mocks.fetch).not.toHaveBeenCalled();
    expect(mocks.syncCangyuan).not.toHaveBeenCalled();
    expect(await mocks.repository.getConnection(connection.id)).toEqual(saved);
    expect(await mocks.repository.getSupplier(supplier.id)).toEqual(savedSupplier);
    expect(await mocks.repository.getSupplierVerification(supplier.id)).toBeNull();
  });
  it.each([false, true])("discovers and persists interfaces without paid calls, discarding stale results: %s", async stale => {
    const { connection } = await fixture();
    const docUrl = `https://instance.example.com/prefix/new-interface-${stale}.json`;
    const spec = { openapi: "3.0.3", servers: [{ url: "/prefix/v1" }], security: [{ bearer: [] }],
      components: { securitySchemes: { bearer: { type: "http", scheme: "bearer" } } },
      paths: { "/draw": { post: { requestBody: { content: { "application/json": { schema: { type: "object", properties: {
        model: { type: "string", enum: ["future-image"] }, prompt: { type: "string" }, size: { type: "string" },
      }, required: ["model", "prompt"] } } } }, responses: { "200": { content: { "application/json": { schema: { type: "object", properties: { url: { type: "string" } } } } } } } } } } };
    mocks.fetch.mockImplementation(async (url: string | URL | Request, init?: RequestInit) => {
      expect(init?.method ?? "GET").toBe("GET");
      if (String(url) === docUrl) {
        expect(new Headers(init?.headers).get("authorization")).toBeNull();
        if (stale) {
          const latest = (await mocks.repository.getConnection(connection.id))!;
          await mocks.repository.saveConnection({ ...latest, config: { ...latest.config, modelScanRequestId: "newer-scan" } });
        }
        return Response.json(spec);
      }
      if (String(url).endsWith("/models")) return Response.json({ data: [{ id: "future-image", output_modalities: ["image"], documentationUrl: docUrl }] });
      return Response.json({}, { status: 404 });
    });
    const response = await refresh(connection.id);
    if (stale) {
      expect(response.status).toBe(409);
      expect((await mocks.repository.getConnection(connection.id))?.config.autoModelInterfaces).toBeUndefined();
      return;
    }
    expect(response.status).toBe(200);
    const models = await response.json();
    expect(models[0].metadata.autoInterfaceStatus).toBe("connected");
    const saved = (await mocks.repository.getConnection(connection.id))!;
    expect(saved.config.autoModelInterfaces).toMatchObject({ "future-image": { connector: { submit: { path: "/prefix/v1/draw" } } } });
    expect(saved.encryptedSecret).toBe(connection.encryptedSecret);
    expect(await mocks.repository.getSupplierVerification(String(connection.config.supplierId))).toBeNull();
    mocks.fetch.mockClear();
    const cached = await GET(new Request(`http://localhost/api/providers/${connection.id}/models?cached=1`), { params: Promise.resolve({ id: connection.id }) });
    expect((await cached.json())[0].metadata.autoInterfaceStatus).toBe("connected");
    expect(mocks.fetch).not.toHaveBeenCalled();
  });
  it("preserves mixed Key models and image binding across a legacy agent refresh and cached reread", async () => {
    const { connection } = await fixture();
    await mocks.repository.saveConnection({ ...connection, provider: "rest", config: { ...connection.config,
      usage: "agent", customGroup: false, manualModels: [], allowedModels: ["gpt-6-astra"], protocol: "responses",
      connector: { submit: { path: "/images", mappings: [{ target: "/model", source: { kind: "request", path: "$.model" } }] },
        models: [{ id: "gpt-image-2", name: "Image", operations: ["image.generate"] }] },
    } });
    mocks.fetch.mockImplementation(async (url: string | URL | Request) => String(url).includes("/models")
      ? Response.json({ data: [{ id: "gpt-6-astra", input_modalities: ["text", "image"], output_modalities: ["text"] }, { id: "gpt-image-2" }] })
      : Response.json({}, { status: 404 }));
    const result = await refresh(connection.id);
    expect(result.status).toBe(200);
    const models = await result.json();
    expect(models.map((model: { id: string }) => model.id)).toEqual(["gpt-6-astra", "gpt-image-2"]);
    expect(models[0]).toMatchObject({ operations: [], inputKinds: ["text", "image"] });
    expect(models[1]).toMatchObject({ operations: ["image.generate"], metadata: { canvasRunnable: true } });
    const saved = (await mocks.repository.getConnection(connection.id))!;
    expect(saved.encryptedSecret).toBe(connection.encryptedSecret);
    expect(saved.config.protocol).toBe("responses");
    expect(saved.config.scannedModelIds).toEqual(["gpt-6-astra", "gpt-image-2"]);
    mocks.fetch.mockClear();
    const cached = await GET(new Request(`http://localhost/api/providers/${connection.id}/models?cached=1`), { params: Promise.resolve({ id: connection.id }) });
    expect((await cached.json()).map((model: { id: string }) => model.id)).toEqual(["gpt-6-astra", "gpt-image-2"]);
    expect(mocks.fetch).not.toHaveBeenCalled();
  });
  it("does not mutate attempt state when cache-only hydration encounters a malformed saved snapshot", async () => {
    const { connection } = await fixture();
    const saved = await mocks.repository.saveConnection({ ...connection, config: {
      ...connection.config, modelScanStatus: "live", modelScanCheckedAt: "old-time", modelCatalogModels: [null],
    } });
    const response = await GET(new Request(`http://localhost/api/providers/${connection.id}/models?cached=1`),
      { params: Promise.resolve({ id: connection.id }) });
    expect(response.status).toBe(500);
    expect(await mocks.repository.getConnection(connection.id)).toEqual(saved);
    expect(mocks.fetch).not.toHaveBeenCalled();
  });
  it("only reads a CLI catalog even when GET asks for refresh", async () => {
    const models = [{ id: "personal-video", name: "Personal", operations: ["video.generate"], parameters: [] }];
    const connection = await mocks.repository.saveConnection({ id: "personal-cli", name: "CLI", provider: "cli", config: {
      cli: { executable: "MUST-NOT-EXECUTE.exe", enabled: true }, modelCatalogModels: models, modelScanStatus: "live",
    } });
    const lookup = vi.spyOn(supplierModelPricing, "enrichSupplierModelPrices");
    try {
      const response = await refresh(connection.id);
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual(models);
      expect(response.headers.get("X-Model-Scan-Source")).toBe("cli-saved");
      expect(await mocks.repository.getConnection(connection.id)).toEqual(connection);
      expect(mocks.fetch).not.toHaveBeenCalled();
      expect(lookup).not.toHaveBeenCalled();
    } finally {
      lookup.mockRestore();
    }
  });
  it("hydrates a new connection from saved data without scanning or writing, even when refresh is also present", async () => {
    const { connection } = await fixture();
    const before = await mocks.repository.getConnection(connection.id);
    const response = await GET(new Request(`http://localhost/api/providers/${connection.id}/models?cached=1&refresh=1`),
      { params: Promise.resolve({ id: connection.id }) });
    expect(response.status).toBe(200);
    expect(response.headers.get("X-Model-Scan-Status")).toBe("unscanned");
    expect(response.headers.get("X-Model-Scan-Source")).toBe("saved");
    expect((await response.json()).map((m: { id: string }) => m.id)).toContain("manual-only");
    expect(mocks.fetch).not.toHaveBeenCalled();
    expect(mocks.syncCangyuan).not.toHaveBeenCalled();
    expect(await mocks.repository.getConnection(connection.id)).toEqual(before);
  });
  it("keeps the last successful scan time when a later attempt fails and cache hydration does not retry it", async () => {
    const { connection } = await fixture();
    const confirmed = "2026-09-20T00:00:00.000Z";
    await mocks.repository.saveConnection({ ...connection, config: { ...connection.config,
      modelScanStatus: "live", modelScanCheckedAt: confirmed,
      modelCatalogModels: [{ id: "old-image", name: "Old", operations: ["image.generate"] }],
    } });
    mocks.fetch.mockRejectedValue(new Error("offline"));
    const failed = await refresh(connection.id);
    const saved = (await mocks.repository.getConnection(connection.id))!;
    expect(saved.config.modelScanStatus).toBe("failed");
    expect(saved.config.modelScanLastSuccessAt).toBe(confirmed);
    expect(saved.config.modelScanCheckedAt).not.toBe(confirmed);
    expect(failed.headers.get("X-Model-Scan-Last-Success-At")).toBe(confirmed);
    mocks.fetch.mockClear();
    const cached = await GET(new Request(`http://localhost/api/providers/${connection.id}/models?cached=1`),
      { params: Promise.resolve({ id: connection.id }) });
    expect(cached.headers.get("X-Model-Scan-Status")).toBe("stale");
    expect(cached.headers.get("X-Model-Scan-Last-Success-At")).toBe(confirmed);
    expect((await cached.json()).some((m: { id: string }) => m.id === "old-image")).toBe(true);
    expect(mocks.fetch).not.toHaveBeenCalled();
  });
  it("persists removed models and additions, preserves them on outage, and clears restored IDs", async () => {
    const { connection } = await fixture();
    await mocks.repository.saveConnection({ ...connection, config: { ...connection.config, manualModels: [], modelCatalogModels: [{ id: "old-image", name: "Old", operations: ["image.generate"] }], scannedModelIds: ["old-image"], modelScanStatus: "live" } });
    mocks.fetch.mockImplementation(async (url: string | URL | Request) => String(url).includes("/models") ? Response.json({ data: [{ id: "new-image" }] }) : Response.json({}, { status: 404 }));
    expect((await refresh(connection.id)).status).toBe(200);
    let saved = (await mocks.repository.getConnection(connection.id))!;
    expect(saved.config.modelScanLastSuccessAt).toBe(saved.config.modelScanCheckedAt);
    expect(saved.config.modelAddedIds).toEqual(["new-image"]);
    expect(saved.config.modelRemovedModels).toEqual([{ id: "old-image", name: "Old" }]);
    expect(saved.config.scannedModelIds).toEqual(["new-image"]);
    expect(saved.encryptedSecret).toBe(connection.encryptedSecret);
    mocks.fetch.mockRejectedValue(new Error("network offline"));
    await refresh(connection.id);
    saved = (await mocks.repository.getConnection(connection.id))!;
    expect(saved.config.modelScanStatus).toBe("failed");
    expect(saved.config.modelRemovedModels).toEqual([{ id: "old-image", name: "Old" }]);
    expect(saved.config.scannedModelIds).toEqual(["new-image"]);
    mocks.fetch.mockImplementation(async (url: string | URL | Request) => String(url).includes("/models") ? Response.json({ data: [{ id: "old-image" }, { id: "new-image" }] }) : Response.json({}, { status: 404 }));
    await refresh(connection.id);
    expect((await mocks.repository.getConnection(connection.id))!.config.modelRemovedModels).toEqual([]);
  });
  it("removes absent Mikoto models before reapplying verified 4K controls", async () => {
    (globalThis as Record<string, unknown>).__superCanvasRepository = mocks.repository;
    try {
      const connector = mikotoConnectorForGroup(MIKOTO_IMAGE_4K_GROUP);
      await mocks.repository.saveConnection({ id: "mikoto-current", name: "Mikoto", provider: "rest", encryptedSecret: encryptSecret("mock-key", "isolated-test-master"), config: {
        supplierKey: "mikoto", preset: "mikoto-pro", baseUrl: "https://api.mikoto.vip", modelGroup: MIKOTO_IMAGE_4K_GROUP, usage: "canvas",
        connector: connector as never, modelCatalogModels: connector.models as never,
      } });
      mocks.fetch.mockResolvedValue(Response.json({ data: [{ id: "gpt-image-2" }, { id: "gpt-6-astra" }] }));
      const result = await refresh("mikoto-current");
      expect(result.status).toBe(200);
      expect((await result.json()).map((model: { id: string }) => model.id)).toEqual(["gpt-image-2", "gpt-6-astra"]);
      const saved = await mocks.repository.getConnection("mikoto-current");
      expect((saved?.config.connector as typeof connector).models?.map(model => model.id)).toEqual(["gpt-image-2"]);
    } finally {
      delete (globalThis as Record<string, unknown>).__superCanvasRepository;
    }
  });
  it("uses freshly synchronized Cangyuan transport instead of an unavailable cached catalog entry", async () => {
    const model = {id: "happyhorse-1.1", name: "HappyHorse", operations: ["video.generate"], outputKinds: ["video"], metadata: {priceLabel: "¥2.8/次"}};
    const connector = {submit: {path: "/v1/videos", mappings: [{target: "/model", source: {kind: "request", path: "$.model"}}]}, output: {path: "$.url", kind: "video"}, models: [model]};
    await mocks.repository.saveConnection({id: "cangyuan-fresh", name: "Cangyuan", provider: "rest", encryptedSecret: encryptSecret("mock-key", "isolated-test-master"), config: {
      supplierKey: "cangyuan", preset: "cangyuan-gpt-image-2", baseUrl: "https://ai.cangyuansuanli.cn", modelGroup: "全模型-无claude/gpt", usage: "canvas",
      modelCatalogModels: [{...model, operations: [], metadata: {canvasRunnable: false, canvasUnavailableReason: "此模型已扫描到，但生成协议尚未验证"}}],
      connector: {...connector, models: []},
    }});
    mocks.fetch.mockResolvedValue(Response.json({data: [{id: model.id}]}));
    mocks.syncCangyuan.mockImplementation(async (id: string) => {
      const previous = (await mocks.repository.getConnection(id))!;
      return mocks.repository.saveConnection({...previous, config: {...previous.config, connector}});
    });
    const result = await refresh("cangyuan-fresh");
    expect(result.status).toBe(200);
    const models = await result.json();
    expect(models).toHaveLength(1);
    expect(models[0].operations).toEqual(["video.generate"]);
    expect(models[0].metadata.canvasRunnable).not.toBe(false);
    expect(models[0].metadata.canvasUnavailableReason).toBeUndefined();
  });
  it("automatically prices a newly scanned model from its own group's marketplace", async () => {
    await fixture();
    mocks.fetch.mockImplementation(async (url: string | URL | Request, init?: RequestInit) => {
      if (String(url).endsWith("/api/pricing")) {
        expect(new Headers(init?.headers).get("authorization")).toBeNull();
        return Response.json({ group_ratio: { "same-name": 0.5 }, data: [
          { model_name: "future-image-v99", quota_type: 1, model_price: 0.08, request_unit: "image", enable_groups: ["same-name"] },
          { model_name: "not-in-key", quota_type: 1, model_price: 0.01, enable_groups: ["same-name"] },
        ] });
      }
      if (String(url).endsWith("/api/status")) return Response.json({ data: { quota_display_type: "CNY", usd_exchange_rate: 1 } });
      return Response.json({ data: [{ id: "future-image-v99" }] });
    });
    const response = await refresh("group");
    expect(response.status).toBe(200);
    const models = await response.json();
    expect(models.map((m: { id: string }) => m.id)).toEqual(["future-image-v99"]);
    expect(models[0].metadata).toMatchObject({ priceLabel: "¥0.04/张", priceSource: "supplier-catalog" });
    const saved = await mocks.repository.getConnection("group");
    expect((saved?.config.modelCatalogModels as Array<{ metadata: { priceLabel: string } }>)[0]?.metadata.priceLabel).toBe("¥0.04/张");
  });

  it("repairs old Chentu protocol decisions in cached keyed models without rescanning or widening inventory", async () => {
    const cached = ["gpt-image-2-low", "gpt-image-2.5"].map((id) => ({
      id,
      name: `${id} · ￥ 0.0154 / 请求`,
      operations: ["image.generate", "image.edit"],
      metadata: {
        canvasRunnable: false,
        canvasUnavailableReason: "尚无已验证的画布生成协议",
        priceLabel: "￥ 0.0154 / 请求",
      },
    }));
    const denied = {
      ...cached[0]!,
      id: "gpt-image-denied",
      metadata: {
        canvasRunnable: false,
        canvasUnavailableReason: "403 权限拒绝",
      },
    };
    await mocks.repository.saveConnection({
      id: "chentu-cached",
      provider: "openai",
      name: "Chentu",
      encryptedSecret: encryptSecret("mock-key", "isolated-test-master"),
      config: {
        supplierKey: "chentu",
        baseUrl: "https://tu.988236.xyz/v1",
        modelGroup: "1k低价生图",
        usage: "canvas",
        modelScanStatus: "live",
        scannedModelIds: [...cached.map((model) => model.id), denied.id],
        modelCatalogModels: [...cached, denied],
      },
    });
    const result = await refresh("chentu-cached", false);
    expect(result.status).toBe(200);
    const models = await result.json();
    expect(models.map((model: { id: string }) => model.id)).toEqual([
      ...cached.map((model) => model.id),
      denied.id,
    ]);
    expect(
      models
        .slice(0, 2)
        .every(
          (model: { metadata: { canvasRunnable: boolean } }) =>
            model.metadata.canvasRunnable,
        ),
    ).toBe(true);
    expect(models[0].metadata.priceLabel).toBe("￥ 0.0154 / 请求");
    expect(models[0].metadata.canvasUnavailableReason).toBeUndefined();
    expect(models[2].metadata.canvasRunnable).toBe(false);
    expect(
      (await mocks.repository.getConnection("chentu-cached"))?.config
        .modelCatalogModels,
    ).toEqual(models);
    expect(mocks.fetch).not.toHaveBeenCalled();
    expect(await (await refresh("chentu-cached", false)).json()).toEqual(
      models,
    );
  });
  it("persists refreshed REST models into the runnable connector and restores them after an empty scan", async () => {
    const { connection } = await fixture();
    const connector = mikotoConnectorForGroup(MIKOTO_IMAGE_GROUP);
    await mocks.repository.saveConnection({
      ...connection,
      provider: "rest",
      config: {
        ...connection.config,
        connector: { ...connector, allowedHosts: ["instance.example.com"] },
      },
    });
    mocks.fetch.mockResolvedValueOnce(
      Response.json({ data: [{ id: "gpt-image-2.5-flare" }] }),
    );
    const result = await refresh(connection.id);
    expect(result.status).toBe(200);
    expect((await result.json())[0].metadata.canvasRunnable).toBe(true);
    const saved = await mocks.repository.getConnection(connection.id);
    expect(saved?.config.defaultModel).toBe("gpt-image-2.5-flare");
    expect(saved?.config.connector).toMatchObject({
      models: [{ id: "gpt-image-2.5-flare" }],
    });
    expect(
      (await (await refresh(connection.id, false)).json())[0].metadata
        .canvasRunnable,
    ).toBe(true);
    mocks.fetch.mockResolvedValueOnce(Response.json({ data: [] }));
    expect(await (await refresh(connection.id)).json()).toEqual([]);
    mocks.fetch.mockResolvedValueOnce(
      Response.json({ data: [{ id: "gpt-image-2.6" }] }),
    );
    expect(
      (await (await refresh(connection.id)).json())[0].metadata.canvasRunnable,
    ).toBe(true);
    expect(
      (await mocks.repository.getConnection(connection.id))?.config.connector,
    ).toMatchObject({ models: [{ id: "gpt-image-2.6" }] });
  });
  it("replaces disappeared models and returns an authoritative empty list despite manual entries", async () => {
    const { connection } = await fixture();
    mocks.fetch.mockResolvedValueOnce(
      Response.json({ data: [{ id: "gpt-image-2" }, { id: "gone" }] }),
    );
    expect((await refresh(connection.id)).status).toBe(200);
    mocks.fetch.mockResolvedValueOnce(
      Response.json({ data: [{ id: "gpt-image-2" }] }),
    );
    const updated = await refresh(connection.id);
    expect((await updated.json()).map((m: { id: string }) => m.id)).toEqual([
      "gpt-image-2",
    ]);
    mocks.fetch.mockResolvedValueOnce(Response.json({ data: [] }));
    expect(await (await refresh(connection.id)).json()).toEqual([]);
    expect(await (await refresh(connection.id, false)).json()).toEqual([]);
    expect(
      (await mocks.repository.getConnection(connection.id))?.config
        .manualModels,
    ).toHaveLength(1);
  });
  it("keeps a same-source cache after network failure but never after explicit authorization denial", async () => {
    const { connection } = await fixture();
    mocks.fetch.mockResolvedValueOnce(
      Response.json({ data: [{ id: "gpt-image-2" }] }),
    );
    await refresh(connection.id);
    mocks.fetch.mockRejectedValue(new Error("offline"));
    const stale = await refresh(connection.id);
    expect(stale.headers.get("X-Model-Scan-Status")).toBe("stale");
    expect((await stale.json()).map((m: { id: string }) => m.id)).toEqual([
      "gpt-image-2",
    ]);
    expect(
      (await (await refresh(connection.id, false)).json()).map(
        (m: { id: string }) => m.id,
      ),
    ).toEqual(["gpt-image-2"]);
    mocks.fetch.mockResolvedValue(Response.json({}, { status: 401 }));
    expect((await refresh(connection.id)).status).toBe(401);
    expect((await refresh(connection.id, false)).status).toBe(401);
    expect(
      (await mocks.repository.getConnection(connection.id))?.config
        .modelScanStatus,
    ).toBe("unauthorized");
  });
  it.each(["empty", "unauthorized"])(
    "a later network failure cannot undo %s availability",
    async (status) => {
      const { connection } = await fixture();
      mocks.fetch.mockResolvedValueOnce(
        status === "empty"
          ? Response.json({ data: [] })
          : Response.json({}, { status: 401 }),
      );
      await refresh(connection.id);
      const confirmedAt = (await mocks.repository.getConnection(connection.id))?.config.modelScanLastSuccessAt;
      mocks.fetch.mockRejectedValue(new Error("offline"));
      await refresh(connection.id);
      expect(
        (await mocks.repository.getConnection(connection.id))?.config
          .modelScanStatus,
      ).toBe(status);
      const cached = await refresh(connection.id, false);
      if (status === "empty") {
        expect(await cached.json()).toEqual([]);
        expect(cached.headers.get("X-Model-Scan-Status")).toBe("stale");
        const saved = (await mocks.repository.getConnection(connection.id))!;
        expect(saved.config.modelScanAttemptStatus).toBe("failed");
        expect(saved.config.modelScanLastSuccessAt).toBe(confirmedAt);
        const settingsCache = await GET(new Request(`http://localhost/api/providers/${connection.id}/models?cached=1`),
          { params: Promise.resolve({ id: connection.id }) });
        expect(settingsCache.headers.get("X-Model-Scan-Status")).toBe("stale");
        expect(await settingsCache.json()).toEqual([]);
        mocks.fetch.mockResolvedValueOnce(Response.json({ data: [] }));
        const recovered = await refresh(connection.id);
        expect(recovered.headers.get("X-Model-Scan-Status")).toBe("empty");
        expect((await mocks.repository.getConnection(connection.id))?.config.modelScanAttemptStatus).toBe("empty");
      }
      else expect(cached.status).toBe(401);
    },
  );
  it("discards slower refreshes even if the old result contains more models", async () => {
    const { connection } = await fixture();
    let finish!: (r: Response) => void;
    mocks.fetch.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const old = refresh(connection.id);
    await vi.waitFor(() => expect(finish).toBeTypeOf("function"));
    mocks.fetch.mockResolvedValueOnce(Response.json({ data: [{ id: "new" }] }));
    await refresh(connection.id);
    finish(Response.json({ data: [{ id: "old" }] }));
    expect((await old).status).toBe(409);
    expect(
      (await mocks.repository.getConnection(connection.id))?.config
        .scannedModelIds,
    ).toEqual(["new"]);
  });
  it("cannot write an old key scan into an archived source or transfer its key", async () => {
    const { supplier, connection } = await fixture();
    let finish!: (r: Response) => void;
    mocks.fetch.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const old = refresh(connection.id);
    await vi.waitFor(() => expect(finish).toBeTypeOf("function"));
    await patchSupplierRecord(supplier.id, {
      apiUrl: "https://new.example.com/v1",
    });
    finish(Response.json({ data: [{ id: "old" }] }));
    expect((await old).status).toBe(409);
    expect(
      (await mocks.repository.getConnection(connection.id))?.config
        .modelCatalogModels,
    ).toBeUndefined();
    expect((await refresh(connection.id)).status).toBe(409);
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
    expect(String(mocks.fetch.mock.calls[0]![0])).toContain(
      "instance.example.com/prefix",
    );
  });
  it.each([
    ["chentu", "chentu-openai-images"],
    ["cyberafei", "cyberafei-api"],
    ["mikoto", "mikoto-pro"],
    ["miaowu", "miaowu-openai-videos"],
    ["frimodel", "frimodel-openai-images"],
    ["cangyuan", "cangyuan-gpt-image-2"],
    ["weai", ""],
  ])(
    "%s at another instance queries its configured gateway without template models",
    async (key, preset) => {
      const { connection } = await fixture(key);
      await mocks.repository.saveConnection({
        ...connection,
        config: {
          ...connection.config,
          preset,
          customGroup: false,
        },
      });
      mocks.fetch.mockResolvedValue(
        Response.json({ data: [{ id: "instance-only" }] }),
      );
      const result = await refresh(connection.id);
      expect(result.status).toBe(200);
      expect((await result.json()).map((m: { id: string }) => m.id)).toEqual([
        "instance-only",
      ]);
      expect(
        mocks.fetch.mock.calls.every((call) =>
          String(call[0]).startsWith("https://instance.example.com/prefix/"),
        ),
      ).toBe(true);
      expect(
        (await mocks.repository.getConnection(connection.id))?.config.baseUrl,
      ).toBe(connection.config.baseUrl);
    },
  );
});
