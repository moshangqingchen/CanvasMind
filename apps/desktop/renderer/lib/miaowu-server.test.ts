import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import type { ProviderConnectionRecord } from "@super-canvas/db";
import { encryptSecret, type ModelDescriptor, type RestConnectorConfig } from "@super-canvas/providers";
import { loadMiaowuCatalog, miaowuUnparameterizedVideoDescriptor } from "./miaowu-catalog";
import { MIAOWU_BASE_URL, MIAOWU_PRESET_ID, MIAOWU_CONNECTOR, MIAOWU_CHAT_VIDEO_OVERRIDE } from "./miaowu-presets";
import { scanMiaowuConnection, scanMiaowuKeyModels, syncMiaowuConnection } from "./miaowu-server";

const REPOSITORY_KEY = "__superCanvasRepository";
const CATALOG_CACHE_KEY = "__superCanvasMiaowuCatalog";
const PUBLIC_PRICING = JSON.parse(readFileSync(new URL("./miaowu-catalog-20261008.fixture.json", import.meta.url), "utf8"));
const AUTHENTICATED_DIRECTORIES = JSON.parse(readFileSync(new URL("./miaowu-server-20261008.fixture.json", import.meta.url), "utf8"));
const CURRENT_VIDEO_FIXTURE = JSON.parse(readFileSync(new URL("./miaowu-video-20261009.fixture.json", import.meta.url), "utf8"));
const CURRENT_IMAGE_FIXTURE = JSON.parse(readFileSync(new URL("./miaowu-image-20261009.fixture.json", import.meta.url), "utf8"));
const CURRENT_NATIVE_FIXTURE = JSON.parse(readFileSync(new URL("./miaowu-server-20261009.fixture.json", import.meta.url), "utf8"));
const MASTER = "miaowu-test-master-key";
const KEY = "miaowu-test-api-key";
type NativeConnector = RestConnectorConfig & { models: ModelDescriptor[] };
const unexpectedNetwork = vi.fn(async () => { throw new Error("Unexpected real network request"); });

beforeEach(() => {
  vi.stubEnv("MASTER_KEY", MASTER);
  unexpectedNetwork.mockClear();
  vi.stubGlobal("fetch", unexpectedNetwork);
});

function makeRepository(initial: ProviderConnectionRecord) {
  let current = initial;
  const repository = {
    getConnection: vi.fn(async () => structuredClone(current)),
    listConnections: vi.fn(async () => [structuredClone(current)]),
    saveConnection: vi.fn(
      async (
        input: Omit<ProviderConnectionRecord, "createdAt" | "updatedAt">,
      ) => {
        current = {
          ...input,
          createdAt: initial.createdAt,
          updatedAt: "saved",
        };
        return structuredClone(current);
      },
    ),
  };
  (globalThis as Record<string, unknown>)[REPOSITORY_KEY] = repository;
  return repository;
}

function oldScannedConnection(): ProviderConnectionRecord {
  return {
    id: "miaowu-vip",
    name: "喵呜 API · vip",
    provider: "rest",
    encryptedSecret: null,
    config: {
      preset: MIAOWU_PRESET_ID,
      supplierKey: "miaowu",
      modelGroup: "vip",
      defaultModel: "seedance-2.0-mx",
      modelScanStatus: "live",
      scannedModelIds: ["seedance-2.0-mini", "seedance-2.0-mx"],
      connector: {
        models: [{ id: "seedance-2.0-mini" }, { id: "seedance-2.0-mx" }],
      },
    },
    createdAt: "2026-08-30T00:00:00.000Z",
    updatedAt: "initial",
  };
}

afterEach(() => {
  delete (globalThis as Record<string, unknown>)[REPOSITORY_KEY];
  delete (globalThis as Record<string, unknown>)[CATALOG_CACHE_KEY];
  try { expect(unexpectedNetwork).not.toHaveBeenCalled(); }
  finally { vi.unstubAllGlobals(); vi.unstubAllEnvs(); }
});

function authenticatedConnection(): ProviderConnectionRecord {
  const connection = oldScannedConnection();
  return { ...connection, id: "miaowu-default", name: "Miaowu default", encryptedSecret: encryptSecret(KEY, MASTER),
    config: { preset: MIAOWU_PRESET_ID, supplierKey: "miaowu", baseUrl: MIAOWU_BASE_URL, modelGroup: "default",
      accountKeyGroup: "default", supplierSourceId: "test-source", defaultModel: "sora-2" } };
}

function directoryFetch(dream: "live" | "network" | number = "live", openaiStatus = 200, pricing = PUBLIC_PRICING) {
  return vi.fn<typeof fetch>(async (url, init) => {
    const request = new URL(String(url));
    expect(request.origin).toBe(MIAOWU_BASE_URL);
    if (request.pathname === "/api/pricing") return Response.json(pricing);
    expect(init?.method).toBe("GET");
    expect(init?.redirect).toBe("error");
    expect(new Headers(init?.headers).get("Authorization")).toBe(`Bearer ${KEY}`);
    if (request.pathname === "/v1/models") return Response.json({ data: AUTHENTICATED_DIRECTORIES.openaiModels }, { status: openaiStatus });
    if (request.pathname === "/v1/dream/model_schema") return Response.json({ error: { message: "model not found" } }, { status: 404 });
    if (request.pathname !== "/v1/dream/model_list") throw new Error("Unexpected endpoint");
    if (dream === "network") throw new Error("offline");
    return Response.json({ data: AUTHENTICATED_DIRECTORIES.dreamModels }, { status: dream === "live" ? 200 : dream });
  });
}

describe("authenticated native Miaowu media directory", () => {
  const nativeSchemaFetch = (imageStatus = 200) => vi.fn<typeof fetch>(async (url, init) => {
    const endpoint = new URL(String(url));
    expect(endpoint.origin).toBe(MIAOWU_BASE_URL);
    expect(init?.method).toBe("GET");
    if (endpoint.pathname === "/api/pricing") return Response.json(CURRENT_IMAGE_FIXTURE.pricing);
    expect(new Headers(init?.headers).get("Authorization")).toBe(`Bearer ${KEY}`);
    expect(init?.redirect).toBe("error");
    if (endpoint.pathname === "/v1/models") return Response.json({ data: CURRENT_NATIVE_FIXTURE.openaiModels });
    if (endpoint.pathname === "/v1/dream/model_list") return Response.json({ data: CURRENT_NATIVE_FIXTURE.dreamModels });
    if (endpoint.pathname === "/v1/dream/model_schema") {
      const id = endpoint.searchParams.get("model")!;
      const image = CURRENT_IMAGE_FIXTURE.schemas[id];
      const schema = image ?? CURRENT_NATIVE_FIXTURE.videoSchemas[id];
      expect(schema).toBeDefined();
      return Response.json(schema, { status: image ? imageStatus : 200 });
    }
    throw new Error("Unexpected native fixture endpoint");
  });
  const schemaFetch = (schemaStatus = 200, visible = Object.keys(CURRENT_VIDEO_FIXTURE.schemas)) => vi.fn<typeof fetch>(async (url, init) => {
    const endpoint = new URL(String(url));
    expect(endpoint.origin).toBe(MIAOWU_BASE_URL);
    expect(init?.method).toBe("GET");
    if (endpoint.pathname === "/api/pricing") return Response.json(CURRENT_VIDEO_FIXTURE.pricing);
    expect(new Headers(init?.headers).get("Authorization")).toBe(`Bearer ${KEY}`);
    expect(init?.redirect).toBe("error");
    if (endpoint.pathname === "/v1/models") return Response.json({ data: visible.map(id => ({ id, supported_endpoint_types: ["openai"] })) });
    if (endpoint.pathname === "/v1/dream/model_list") return Response.json({ data: visible.map(id => ({ id, type: "video" })) });
    if (endpoint.pathname === "/v1/dream/model_schema") {
      const id = endpoint.searchParams.get("model")!;
      expect(visible).toContain(id);
      return Response.json({ id, type: "video", ...CURRENT_VIDEO_FIXTURE.schemas[id] }, { status: schemaStatus });
    }
    throw new Error("Unexpected endpoint");
  });

  it("joins the current authenticated 21 media schemas with the 16 chat IDs and retains all seven native image contracts", async () => {
    makeRepository(authenticatedConnection());
    const transport = nativeSchemaFetch();
    const scan = await scanMiaowuConnection("miaowu-default", { fetch: transport, forcePricing: true });
    expect(scan).toMatchObject({ status: "live", complete: true });
    expect(scan.modelIds).toHaveLength(26);
    expect(scan.mediaDirectory?.models).toHaveLength(21);
    expect(Object.keys(scan.imageSchemas!)).toHaveLength(7);
    expect(Object.keys(scan.videoSchemas!)).toHaveLength(14);
    expect([...Object.values(scan.imageSchemas!), ...Object.values(scan.videoSchemas!)].every(receipt => receipt.status === "live")).toBe(true);
    expect(transport).toHaveBeenCalledTimes(24);
    const synced = await syncMiaowuConnection("miaowu-default");
    for (const current of [scan.connection!, synced!]) {
      const connector = current.config.connector as unknown as NativeConnector;
      expect(connector.models).toHaveLength(26);
      expect(current.config.modelScanComplete).toBe(true);
      for (const [id, schema] of Object.entries(CURRENT_IMAGE_FIXTURE.schemas) as [string, { request_schema: { properties: { params: { properties: { size: { enum: string[] } } } } }; pricing_display: { groups: { default: { rules: { price: number }[] } } } }][]) {
        const model = connector.models.find(model => model.id === id)!;
        expect(model.metadata).toMatchObject({ parameterSource: "dream.image_schema", imageSchemaStatus: "live", imageSchemaStale: false, canvasRunnable: true });
        expect(model.operations).toEqual(["image.generate", "image.edit"]);
        expect(model.limits).toMatchObject({ maxInputImages: 5, maxOutputImages: 1, maxInputVideos: 0, maxInputAudios: 0 });
        expect(model.parameters?.find(parameter => parameter.key === "resolution")?.options?.map(option => option.value)).toEqual(schema.request_schema.properties.params.properties.size.enum);
        expect(model.pricing).toMatchObject({ kind: "per-request", currency: "CNY", unitAmount: Math.max(...schema.pricing_display.groups.default.rules.map(rule => rule.price)) });
        expect(connector.modelOverrides?.[id]?.submit?.path).toBe("/v1/images");
      }
    }
  });

  it("preserves an exact image's successful schema after a temporary failure with its original timestamp", async () => {
    makeRepository(authenticatedConnection());
    const first = await scanMiaowuConnection("miaowu-default", { fetch: nativeSchemaFetch(), forcePricing: true });
    const next = await scanMiaowuConnection("miaowu-default", { fetch: nativeSchemaFetch(503), forcePricing: true });
    const id = Object.keys(CURRENT_IMAGE_FIXTURE.schemas)[0]!;
    expect(next.imageSchemas?.[id]).toMatchObject({ status: "failed", httpStatus: 503, stale: true,
      lastSuccessfulCheckedAt: first.imageSchemas![id]!.checkedAt });
    const model = (next.connection!.config.connector as unknown as NativeConnector).models.find(model => model.id === id)!;
    expect(model.metadata).toMatchObject({ parameterSource: "dream.image_schema", imageSchemaStatus: "failed", imageSchemaStale: true });
    expect(model.parameters).toEqual((first.connection!.config.connector as unknown as NativeConnector).models.find(model => model.id === id)!.parameters);
  });

  it.each(["credential", "source", "official-group", "unauthorized-schema"] as const)("does not reuse an image schema after %s", async field => {
    const initial = authenticatedConnection();
    initial.config.accountKeyGroupId = "1";
    makeRepository(initial);
    const first = await scanMiaowuConnection("miaowu-default", { fetch: nativeSchemaFetch(), forcePricing: true });
    const changed = structuredClone(first.connection!);
    changed.updatedAt = "changed";
    if (field === "credential") changed.encryptedSecret = encryptSecret(KEY, MASTER);
    if (field === "source") changed.config.supplierSourceId = "other-source";
    if (field === "official-group") changed.config.accountKeyGroupId = "2";
    makeRepository(changed);
    const next = await scanMiaowuConnection("miaowu-default", { fetch: nativeSchemaFetch(field === "unauthorized-schema" ? 403 : 503), forcePricing: true });
    expect(Object.values(next.imageSchemas!).every(receipt => receipt.stale !== true && !receipt.contract)).toBe(true);
    expect((next.connection!.config.connector as unknown as NativeConnector).models.filter(model => model.outputKinds?.includes("image"))
      .every(model => model.metadata?.imageSchemaStale !== true)).toBe(true);
  });

  it("reads only same-Key visible exact video schemas and persists the new models' own limits", async () => {
    makeRepository(authenticatedConnection());
    const transport = schemaFetch();
    const scan = await scanMiaowuConnection("miaowu-default", { fetch: transport, forcePricing: true });
    expect(transport).toHaveBeenCalledTimes(14);
    expect(Object.keys(scan.videoSchemas!)).toHaveLength(11);
    expect(Object.values(scan.videoSchemas!).every(receipt => receipt.status === "live")).toBe(true);
    const connector = scan.connection!.config.connector as unknown as NativeConnector;
    expect(connector.models).toHaveLength(11);
    expect(connector.models.find(model => model.id === "seedance-2.5-pro")).toMatchObject({ limits: { maxPromptCharacters: 5000, maxInputImages: 30, maxInputVideos: 0, maxInputAudios: 10 }, metadata: { parameterSource: "dream.video_schema" } });
    expect(connector.models.find(model => model.id === "doubao-seedance-2.0-mini")?.parameters?.find(parameter => parameter.key === "duration")).toMatchObject({ min: 5, max: 15 });
    const synced = await syncMiaowuConnection("miaowu-default");
    expect((synced!.config.connector as unknown as NativeConnector).models.find(model => model.id === "seedance-2.5-pro")?.limits?.maxPromptCharacters).toBe(5000);
  });

  it("returns the current scan's contracts for a non-persisting read without modifying the saved connection", async () => {
    const initial = authenticatedConnection();
    const repository = makeRepository(initial);
    const scan = await scanMiaowuConnection("miaowu-default", { fetch: schemaFetch(), forcePricing: true, persist: false });
    const connector = scan.connection!.config.connector as unknown as NativeConnector;
    expect(scan).toMatchObject({ status: "live", complete: true });
    expect(connector.models).toHaveLength(11);
    expect(connector.models.find(model => model.id === "seedance-2.5-pro")).toMatchObject({
      parameters: expect.any(Array), limits: { maxPromptCharacters: 5000 }, metadata: { parameterSource: "dream.video_schema" } });
    expect(repository.saveConnection).not.toHaveBeenCalled();
    expect(await repository.getConnection()).toEqual(initial);
  });

  it("does not read publicly quoted models missing from the authenticated media directory", async () => {
    makeRepository(authenticatedConnection());
    const transport = schemaFetch(200, ["doubao-seedance-2.0-mini"]);
    const scan = await scanMiaowuConnection("miaowu-default", { fetch: transport, forcePricing: true });
    expect(transport.mock.calls.filter(([url]) => String(url).includes("model_schema"))).toHaveLength(1);
    expect(scan.modelIds).toEqual(["doubao-seedance-2.0-mini"]);
    expect((scan.connection!.config.connector as unknown as NativeConnector).models.map(model => model.id)).toEqual(["doubao-seedance-2.0-mini"]);
  });

  it("retains an explicit manual native video's parameters and endpoint during schema refresh", async () => {
    const initial = authenticatedConnection(), id = "seedance-2.5-pro";
    const saved: ModelDescriptor = { id, name: "Saved custom Pro", operations: ["video.generate"], outputKinds: ["video"],
      parameters: [{ key: "custom-duration", label: "Custom", control: "number", valueType: "integer", min: 4, max: 29 }],
      metadata: { source: "manual", marketplaceGroup: "default" } };
    const override = { submit: { path: "/custom-video", method: "POST" as const, bodyMode: "json" as const }, output: { path: "$.custom_video", kind: "video" as const } };
    initial.config.modelCatalogModels = [saved] as unknown as ProviderConnectionRecord["config"][];
    initial.config.connector = { ...MIAOWU_CONNECTOR, models: [saved], modelOverrides: { [id]: override } } as unknown as ProviderConnectionRecord["config"];
    makeRepository(initial);
    const scan = await scanMiaowuConnection("miaowu-default", { fetch: schemaFetch(), forcePricing: true });
    const connector = scan.connection!.config.connector as unknown as NativeConnector;
    expect(connector.models.find(model => model.id === id)?.parameters).toEqual(saved.parameters);
    expect(connector.modelOverrides?.[id]).toEqual(override);
  });

  it("retains a same-identity successful schema after a partial failure with its original successful time", async () => {
    makeRepository(authenticatedConnection());
    const first = await scanMiaowuConnection("miaowu-default", { fetch: schemaFetch(), forcePricing: true });
    const next = await scanMiaowuConnection("miaowu-default", { fetch: schemaFetch(503), forcePricing: true });
    const id = "seedance-2.5-pro";
    expect(next.videoSchemas?.[id]).toMatchObject({ status: "failed", httpStatus: 503, stale: true, lastSuccessfulCheckedAt: first.videoSchemas![id]!.checkedAt });
    expect((next.connection!.config.connector as unknown as NativeConnector).models.find(model => model.id === id)).toMatchObject({ limits: { maxPromptCharacters: 5000 }, metadata: { videoSchemaStatus: "failed", videoSchemaStale: true, videoSchemaError: expect.stringContaining("HTTP 503") } });
  });

  it.each(["credential", "source", "official-group"] as const)("does not reuse a successful schema after changing its %s", async field => {
    const initial = authenticatedConnection();
    initial.config.accountKeyGroupId = "1";
    makeRepository(initial);
    const first = await scanMiaowuConnection("miaowu-default", { fetch: schemaFetch(), forcePricing: true });
    const changed = structuredClone(first.connection!);
    changed.updatedAt = "changed";
    if (field === "credential") changed.encryptedSecret = encryptSecret(KEY, MASTER);
    if (field === "source") changed.config.supplierSourceId = "other-source";
    if (field === "official-group") changed.config.accountKeyGroupId = "2";
    makeRepository(changed);
    const next = await scanMiaowuConnection("miaowu-default", { fetch: schemaFetch(503), forcePricing: true });
    expect(next.videoSchemas?.["seedance-2.5-pro"]?.stale).not.toBe(true);
    expect((next.connection!.config.connector as unknown as NativeConnector).models.find(model => model.id === "seedance-2.5-pro")?.limits?.maxPromptCharacters).toBeUndefined();
  });

  it("unions the real fifteen chat-directory IDs and eighteen media IDs into twenty-three without duplicates", async () => {
    const transport = directoryFetch();
    const scan = await scanMiaowuKeyModels(KEY, { fetch: transport });
    expect(scan).toMatchObject({ status: "live", complete: true, openaiModelIds: AUTHENTICATED_DIRECTORIES.openaiModels.map((model: { id: string }) => model.id),
      mediaDirectory: { status: "live", sourceUrl: `${MIAOWU_BASE_URL}/v1/dream/model_list`, models: AUTHENTICATED_DIRECTORIES.dreamModels.map((model: { id: string; type: string }) => ({ id: model.id, kind: model.type })) } });
    expect(scan.modelIds).toHaveLength(23);
    expect(new Set(scan.modelIds).size).toBe(23);
    expect(transport).toHaveBeenCalledTimes(2 + AUTHENTICATED_DIRECTORIES.dreamModels.length);
  });

  it("persists eighteen priced native media contracts, five declared Chat IDs, and each authenticated source", async () => {
    const repository = makeRepository(authenticatedConnection());
    const result = await scanMiaowuConnection("miaowu-default", { fetch: directoryFetch(), forcePricing: true });
    expect(result.modelIds).toHaveLength(23);
    const config = result.connection!.config;
    expect(config.scannedModelIds).toHaveLength(23);
    expect(config.miaowuOpenaiModelIds).toHaveLength(15);
    expect(config.modelScanComplete).toBe(true);
    const connector = config.connector as unknown as NativeConnector;
    expect(connector.models).toHaveLength(23);
    expect(config.modelCatalogModels).toEqual(connector.models);
    expect(connector.models.filter(model => model.pricing)).toHaveLength(18);
    expect(connector.models.find(model => model.id === "dola-seedance-2.5")).toMatchObject({ outputKinds: ["video"],
      pricing: { currency: "CNY", unitAmount: .875 }, metadata: { modelDirectorySources: ["authenticated-dream-media-directory"], parameterSource: "pricing.video_api" } });
    for (const row of AUTHENTICATED_DIRECTORIES.dreamModels) {
      const model = connector.models.find(model => model.id === row.id)!;
      expect(model.outputKinds).toEqual([row.type]);
      expect(model.parameters?.length).toBeGreaterThan(0);
      expect(connector.modelOverrides?.[model.id]?.submit?.path ?? connector.submit.path).toBe(row.type === "image" ? "/v1/images" : "/v1/videos");
    }
    for (const id of ["dreamina-seedance-2.0-fast", "dreamina-seedance-2.0-mini", "seedance-2.0-fast-deal", "seedance-2.5-deal", "video-editing"]) {
      const model = connector.models.find(model => model.id === id)!;
      expect(model.metadata).toMatchObject({ canvasRunnable: true, protocol: "openai-chat", generationVerified: false,
        parameterSource: "supplier-documented-contract", modelDirectorySources: ["openai-key-models"] });
      expect(model.metadata?.miaowuVideoContractPending).not.toBe(true);
      expect(model.metadata?.canvasUnavailableReason).toBeUndefined();
      expect(model.pricing).toBeUndefined();
      expect(model.parameters).toEqual([]);
      expect(connector.modelOverrides?.[id]?.submit?.path).toBe("/v1/chat/completions");
      expect(connector.modelOverrides?.[id]?.output).toMatchObject({ kind: "video", format: "openai-chat-videos", requireOutput: true });
    }
    expect(repository.saveConnection).toHaveBeenCalledTimes(1);
    const synced = await syncMiaowuConnection("miaowu-default");
    expect(synced?.config.modelCatalogModels).toEqual((synced?.config.connector as unknown as NativeConnector).models);
    expect((synced?.config.modelCatalogModels as unknown as ModelDescriptor[]).filter(model => model.metadata?.canvasRunnable === false)).toHaveLength(0);
  });

  it.each(["model-endpoint", "base-endpoint", "mapping", "output", "operation", "binding", "incomplete-binding", "manual", "paid", "native", "denied"] as const)(
    "preserves the saved exact alias descriptor and its %s contract through scan and catalog sync", async customization => {
      const id = "dreamina-seedance-2.0-fast";
      const savedModel: ModelDescriptor = { ...miaowuUnparameterizedVideoDescriptor(id, { group: "default" }),
        pricing: { kind: "per-request", currency: "CNY", unitAmount: 9, confidence: "exact", checkedAt: "then" },
        metadata: { ...miaowuUnparameterizedVideoDescriptor(id).metadata, canvasRunnable: true } };
      const connector = structuredClone(MIAOWU_CONNECTOR);
      connector.models = [savedModel];
      const override = structuredClone(MIAOWU_CHAT_VIDEO_OVERRIDE);
      connector.modelOverrides = { [id]: override };
      const connection = authenticatedConnection();
      if (customization === "model-endpoint") override.submit!.path = "/my-verified-video";
      if (customization === "base-endpoint") { connector.modelOverrides = {}; connector.submit.path = "/my-verified-video"; }
      if (customization === "mapping") override.submit!.mappings = [{ target: "/content", source: { kind: "request", path: "$.prompt" } }];
      if (customization === "output") override.output!.path = "$.custom.video";
      if (customization === "operation") { connector.modelOverrides = {}; connector.operationOverrides = { "video.generate": { submit: { ...connector.submit, path: "/my-verified-video" } } }; }
      if (customization === "manual") savedModel.metadata = { ...savedModel.metadata, source: "manual" };
      if (customization === "paid") savedModel.metadata = { ...savedModel.metadata, protocolEvidence: "paid-test" };
      if (customization === "native") savedModel.metadata = { ...savedModel.metadata, parameterSource: "pricing.video_api" };
      if (customization === "denied") savedModel.metadata = { ...savedModel.metadata, canvasRunnable: false, canvasUnavailableReason: "403 Key 未开通视频" };
      if (customization === "binding" || customization === "incomplete-binding") {
        connection.config.autoModelInterfaces = { [id]: { sourceUrl: `${MIAOWU_BASE_URL}/docs/exact-fixture`,
          model: { ...savedModel, operations: ["video.generate"] }, connector: { submit: { method: "POST", path: "/documented-video", bodyMode: "json",
            mappings: [{ target: "/prompt", source: { kind: "request", path: "$.prompt" } }] }, output: { kind: "video", path: "$.video_url" } } } } as unknown as ProviderConnectionRecord["config"];
        if (customization === "incomplete-binding") savedModel.metadata = { ...savedModel.metadata,
          canvasRunnable: false, autoInterfaceStatus: "incomplete", canvasUnavailableReason: "接口说明待补充" };
      }
      connection.config.connector = connector as unknown as ProviderConnectionRecord["config"];
      connection.config.modelCatalogModels = [savedModel] as unknown as ProviderConnectionRecord["config"][];
      makeRepository(connection);
      const originalBindings = structuredClone(connection.config.autoModelInterfaces);
      const scan = await scanMiaowuConnection("miaowu-default", { fetch: directoryFetch(), forcePricing: true });
      for (const current of [scan.connection!, (await syncMiaowuConnection("miaowu-default"))!]) {
        const config = current.config;
        const updated = config.connector as unknown as NativeConnector;
        expect(config.modelCatalogModels).toEqual(updated.models);
        const model = updated.models.find(row => row.id === id)!;
        expect(model.pricing).toEqual(savedModel.pricing);
        expect(model.operations).toEqual(savedModel.operations);
        expect(model.parameters).toEqual(savedModel.parameters);
        expect(model.metadata).toMatchObject(savedModel.metadata!);
        expect(config.autoModelInterfaces).toEqual(originalBindings);
        if (["model-endpoint", "mapping", "output", "manual", "paid", "native", "denied", "binding", "incomplete-binding"].includes(customization))
          expect(updated.modelOverrides?.[id]).toEqual(override);
        if (customization === "base-endpoint") expect(updated.modelOverrides?.[id]?.submit).toEqual(connector.submit);
        if (customization === "operation") expect(updated.modelOverrides?.[id]?.operationOverrides?.["video.generate"]).toEqual(connector.operationOverrides?.["video.generate"]);
      }
    });

  it.each([401, 403])("never lets public prices or Dream metadata rescue an unauthorized base Key (%s)", async status => {
    const repository = makeRepository(authenticatedConnection());
    const transport = directoryFetch("live", status);
    const result = await scanMiaowuConnection("miaowu-default", { fetch: transport, forcePricing: true });
    expect(result.status).toBe("unauthorized");
    expect(result.modelIds).toEqual([]);
    expect(transport.mock.calls.some(([url]) => String(url).includes("/v1/dream/"))).toBe(false);
    expect(repository.saveConnection).not.toHaveBeenCalled();
  });

  it.each([404, 429, 500, "network"] as const)("records a partial Dream directory failure (%s), without granting all public models", async failure => {
    const result = await scanMiaowuKeyModels(KEY, { fetch: directoryFetch(failure) });
    expect(result).toMatchObject({ status: "live", complete: false, mediaDirectory: { status: failure === 404 ? "unsupported" : "failed", models: [] } });
    expect(result.modelIds).toHaveLength(15);
    expect(result.modelIds).not.toContain("dola-seedance-2.5");
    expect(result.error).toBeTruthy();
  });

  it("retains a known media inventory across a transient 404, labelled stale rather than a fresh success", async () => {
    makeRepository(authenticatedConnection());
    const first = await scanMiaowuConnection("miaowu-default", { fetch: directoryFetch(), forcePricing: true });
    const second = await scanMiaowuConnection("miaowu-default", { fetch: directoryFetch(404), forcePricing: true });
    expect(second.modelIds).toHaveLength(23);
    expect(second.complete).toBe(false);
    expect(second.mediaDirectory).toMatchObject({ status: "unsupported", httpStatus: 404, stale: true, lastSuccessfulCheckedAt: first.mediaDirectory!.checkedAt });
    const models = (second.connection!.config.connector as unknown as NativeConnector).models;
    expect(models.find(model => model.id === "dola-seedance-2.5")?.metadata).toMatchObject({ mediaDirectoryStale: true, mediaDirectoryStatus: "unsupported" });
  });

  it.each(["credentials", "source"] as const)("does not borrow a previous media inventory after a %s change", async change => {
    makeRepository(authenticatedConnection());
    const first = await scanMiaowuConnection("miaowu-default", { fetch: directoryFetch(), forcePricing: true });
    const changed = structuredClone(first.connection!);
    if (change === "credentials") changed.encryptedSecret = encryptSecret(KEY, MASTER);
    else changed.config.supplierSourceId = "different-source";
    changed.updatedAt = "changed";
    makeRepository(changed);
    const second = await scanMiaowuConnection("miaowu-default", { fetch: directoryFetch(404), forcePricing: true });
    expect(second.modelIds).toHaveLength(15);
    expect(second.modelIds).not.toContain("dola-seedance-2.5");
    expect(second.mediaDirectory?.stale).not.toBe(true);
  });

  it("binds fallback media inventory to the actual account Key group rather than its display group", async () => {
    const connection = authenticatedConnection();
    connection.config.modelGroup = "OpenAI Videos";
    makeRepository(connection);
    const first = await scanMiaowuConnection("miaowu-default", { fetch: directoryFetch(), forcePricing: true });
    expect(first.connection?.config.miaowuDirectoryGroup).toBe("default");
    const second = await scanMiaowuConnection("miaowu-default", { fetch: directoryFetch(404), forcePricing: true });
    expect(second.modelIds).toHaveLength(23);
    expect(second.mediaDirectory?.stale).toBe(true);
    const changed = structuredClone(second.connection!);
    changed.config.accountKeyGroup = "vip";
    changed.updatedAt = "group-changed";
    makeRepository(changed);
    const third = await scanMiaowuConnection("miaowu-default", { fetch: directoryFetch(404), forcePricing: true });
    expect(third.modelIds).toHaveLength(15);
    expect(third.mediaDirectory?.stale).not.toBe(true);
  });

  it("retains every authenticated non-default-group ID without borrowing another group's price or parameters", async () => {
    const pricing = structuredClone(PUBLIC_PRICING);
    pricing.group_ratio.vip = .8;
    for (const model of pricing.data) model.enable_groups = model.model_name === "sora-2" ? ["default", "vip"] : ["default"];
    const connection = authenticatedConnection();
    connection.config.modelGroup = "vip";
    connection.config.accountKeyGroup = "vip";
    makeRepository(connection);
    const result = await scanMiaowuConnection("miaowu-default", { fetch: directoryFetch("live", 200, pricing), forcePricing: true });
    const connector = result.connection!.config.connector as unknown as NativeConnector;
    expect(result.modelIds).toHaveLength(23);
    expect(connector.models).toHaveLength(23);
    expect(connector.models.filter(model => model.pricing)).toHaveLength(1);
    expect(connector.models.find(model => model.id === "sora-2")?.pricing?.unitAmount).toBeCloseTo(.8);
    const image = connector.models.find(model => model.id === "gpt-image-2.5-flare")!;
    expect(image.pricing).toBeUndefined();
    expect(image.outputKinds).toEqual(["image"]);
    expect(image.operations).toEqual(["image.generate"]);
    expect(image.parameters).toEqual([]);
    expect(image.metadata).toMatchObject({ marketplaceGroup: "vip", canvasRunnable: false,
      outputKindsSource: "declared", modelDirectorySources: ["authenticated-dream-media-directory"] });
    expect(image.metadata?.priceLabel).toBeUndefined();
    expect(image.description).toContain("图片");
    expect(connector.modelOverrides?.[image.id]).toBeUndefined();
    const video = connector.models.find(model => model.id === "dola-seedance-2.5")!;
    expect(video.pricing).toBeUndefined();
    expect(video.parameters).toEqual([]);
    expect(video.metadata?.canvasRunnable).toBe(false);
    expect(connector.modelOverrides?.[video.id]).toBeUndefined();
    const synced = await syncMiaowuConnection("miaowu-default");
    const syncedConnector = synced!.config.connector as unknown as NativeConnector;
    expect(syncedConnector.models).toHaveLength(23);
    expect(syncedConnector.models.find(model => model.id === image.id)?.pricing).toBeUndefined();
    expect(syncedConnector.models.find(model => model.id === image.id)?.metadata?.canvasRunnable).toBe(false);
  });

  it("prices the assigned account group through scan and sync while preserving a different display group", async () => {
    const pricing = structuredClone(PUBLIC_PRICING);
    pricing.group_ratio.vip = .8;
    for (const model of pricing.data) model.enable_groups = ["default", "vip"];
    const connection = authenticatedConnection();
    connection.config.modelGroup = "vip";
    connection.config.accountKeyGroup = "default";
    makeRepository(connection);
    const scan = await scanMiaowuConnection("miaowu-default", { fetch: directoryFetch("live", 200, pricing), forcePricing: true });
    const synced = await syncMiaowuConnection("miaowu-default");
    for (const current of [scan.connection!, synced!]) {
      expect(current.config.modelGroup).toBe("vip");
      expect(current.config.accountKeyGroup).toBe("default");
      const sora = (current.config.connector as unknown as NativeConnector).models.find(model => model.id === "sora-2")!;
      expect(sora.pricing?.unitAmount).toBe(1);
      expect(sora.metadata?.marketplaceGroup).toBe("default");
    }
  });

  it.each([401, 403])("keeps the successful generic inventory, but removes Dream-only IDs after media authentication fails (%s)", async status => {
    const repository = makeRepository(authenticatedConnection());
    await scanMiaowuConnection("miaowu-default", { fetch: directoryFetch(), forcePricing: true });
    const result = await scanMiaowuConnection("miaowu-default", { fetch: directoryFetch(status), forcePricing: true });
    expect(result).toMatchObject({ status: "live", complete: false, mediaDirectory: { status: "unauthorized", models: [] } });
    expect(result.modelIds).toEqual(AUTHENTICATED_DIRECTORIES.openaiModels.map((model: { id: string }) => model.id));
    expect(result.modelIds).not.toContain("dola-seedance-2.5");
    expect(result.mediaDirectory?.stale).not.toBe(true);
    expect(result.checkedAt).toBe(result.mediaDirectory?.checkedAt);
    expect(result.connection?.config.scannedModelIds).toHaveLength(15);
    const connector = result.connection!.config.connector as unknown as NativeConnector;
    expect(connector.models).toHaveLength(15);
    expect(connector.models.some(model => model.id === "dola-seedance-2.5")).toBe(false);
    expect(repository.saveConnection).toHaveBeenCalledTimes(2);
  });

  it("never queries the official Dream endpoint for a custom source", async () => {
    const transport = vi.fn<typeof fetch>(async url => {
      expect(String(url)).toBe("https://instance.test/v1/models");
      return Response.json({ data: [{ id: "custom" }] });
    });
    const scan = await scanMiaowuKeyModels(KEY, { fetch: transport, baseUrl: "https://instance.test" });
    expect(scan.modelIds).toEqual(["custom"]);
    expect(scan.mediaDirectory).toBeUndefined();
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it("does not treat an undeclared chat record in the media response as generated video", async () => {
    const transport = vi.fn<typeof fetch>(async url => Response.json({ data: String(url).endsWith("/v1/models") ? [] : [{ id: "plain-chat", type: "chat" }] }));
    const scan = await scanMiaowuKeyModels(KEY, { fetch: transport });
    expect(scan.modelIds).toEqual([]);
    expect(scan.complete).toBe(false);
    expect(scan.mediaDirectory?.status).toBe("failed");
  });
});

describe("syncMiaowuConnection", () => {
  it("preserves every scanned video model without inventing controls or a Chat route", async () => {
    const repository = makeRepository(oldScannedConnection());
    await loadMiaowuCatalog({
      fetch: vi.fn(async () =>
        Response.json({
          group_ratio: { default: 1, vip: 0.8 },
          data: [
            {
              model_name: "seedance-2.0-mini",
              model_price: 0.1142857142857143,
              quota_type: 1,
              enable_groups: ["default", "vip"],
              supported_endpoint_types: ["openai"],
              video_api: {
                images_max: 9,
                videos_max: 3,
                audios_max: 3,
                seconds_min: 5,
                seconds_max: 15,
                sizes: ["480p", "720p"],
                ratios: ["1:1", "16:9", "9:16", "4:3", "3:4"],
              },
            },
            {
              model_name: "kling-3.0-omni",
              model_price: 0.014285714285714287,
              quota_type: 0,
              enable_groups: ["default", "vip"],
              supported_endpoint_types: ["openai"],
              video_api: {
                images_max: 3,
                seconds_min: 5,
                seconds_max: 15,
                sizes: ["720p"],
                ratios: ["1:1", "16:9", "9:16", "4:3", "3:4"],
              },
            },
          ],
        }),
      ) as unknown as typeof fetch,
    });

    const synced = await syncMiaowuConnection("miaowu-vip");
    const config = synced?.config as Record<string, unknown>;
    const connector = config.connector as {
      models: Array<{
        id: string;
        parameters?: unknown[];
        metadata?: Record<string, unknown>;
      }>;
      modelOverrides?: Record<string, { submit?: { path?: string } }>;
    };
    expect(connector.models.map((model) => model.id)).toEqual([
      "seedance-2.0-mini",
      "seedance-2.0-mx",
    ]);
    expect(config.defaultModel).toBe("seedance-2.0-mx");
    expect(
      connector.models.find((model) => model.id === "seedance-2.0-mx"),
    ).toMatchObject({
      parameters: [],
      metadata: { parameterControlsUnavailable: true, canvasRunnable: false },
    });
    expect(connector.modelOverrides?.["seedance-2.0-mx"]).toBeUndefined();
    expect(config.unknownModels).toEqual(["seedance-2.0-mx"]);
    expect(config.unavailableModels).toEqual(["kling-3.0-omni"]);
    expect(repository.saveConnection).toHaveBeenCalledTimes(1);
  });
});
