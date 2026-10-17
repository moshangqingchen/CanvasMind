import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRepository, type ProviderConnectionRecord } from "@super-canvas/db";

const guards = vi.hoisted(() => ({ implicit: vi.fn(), endpoint: vi.fn(async () => undefined) }));
vi.mock("@super-canvas/providers", async original => ({ ...await original<typeof import("@super-canvas/providers")>(),
  assertSafeProviderEndpoint: guards.endpoint, providerFetch: guards.implicit, weAIFetch: guards.implicit }));
vi.mock("./supplier-site-session", () => ({ openSupplierSiteSession: guards.implicit, supplierSiteLoginCacheIdentity: vi.fn() }));
vi.mock("./supplier-service", () => ({ getSupplierRecord: guards.implicit }));

import { collectCatalogReadTask, discoverCatalogModelTasks, type CatalogReadTask } from "./catalog-read-task";
import { catalogConnectionManifest } from "./catalog-read-contracts";
import { catalogConnectionScopes, catalogReadItem, catalogSafeSourceUrl, catalogSourcePlan } from "./catalog-source-plan";
import { withCatalogRepository } from "./catalog-repository-scope";
import type { CatalogCollectorDependencies } from "./catalog-read-collector";

const now = () => "2026-10-17T12:00:00Z";
const context = { runId: "fixture-run", observationCycleId: "fixture-cycle", identityEpoch: "fixture-epoch", dispatchSeq: 1 };
const connection = (baseUrl = "https://fixture.invalid/v1"): ProviderConnectionRecord => ({ id: "fixture-key", name: "Fixture Key", provider: "openai",
  encryptedSecret: "opaque-fixture", config: { baseUrl }, createdAt: now(), updatedAt: now() });
const dependencies = (transport: typeof fetch, overrides: Partial<CatalogCollectorDependencies> = {}): CatalogCollectorDependencies => ({
  apiKey: "fixture-only-key", enabled: true, context, now, fetchFor: () => transport, ...overrides,
});
const keyTask = (row: ProviderConnectionRecord): CatalogReadTask => ({ spec: catalogSourcePlan(row).find(spec => spec.entryId === "key-models")! });
const image = { id: "fixture-image-id", name: "Fixture", operations: ["image.generate" as const], outputKinds: ["image" as const] };
const schema = () => ({ openapi: "3.1.0", security: [{ bearer: [] }], components: { securitySchemes: { bearer: { type: "http", scheme: "bearer" } } },
  paths: { "/images/generations": { post: { requestBody: { content: { "application/json": { schema: { type: "object", required: ["model", "prompt"],
    properties: { model: { type: "string", enum: [image.id] }, prompt: { type: "string" } } } } } }, responses: { "200": { content: { "application/json": {
      schema: { type: "object", properties: { data: { type: "array", items: { type: "object", properties: { url: { type: "string" } } } } } } },
    } } } } } } });

beforeEach(() => {
  vi.clearAllMocks();
  guards.implicit.mockImplementation(() => { throw new Error("Ambient network, credential and repository access forbidden"); });
  vi.stubGlobal("fetch", guards.implicit);
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("resumable logical catalog tasks", () => {
  it("sends every equivalent Key fallback HTTP through one injected transport and one receipt", async () => {
    const row = connection("https://fixture.invalid");
    const transport = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response(null, { status: 404 }))
      .mockResolvedValueOnce(Response.json({ data: [{ id: "exact-full-id" }] }));
    const result = await collectCatalogReadTask(keyTask(row), row, undefined, [], dependencies(transport));
    expect(result.observation.receipt).toMatchObject({ status: "succeeded", complete: true, context,
      attemptedUrls: ["https://fixture.invalid/models", "https://fixture.invalid/v1/models"] });
    expect(result.observation.receipt.attemptId).toBeTruthy();
    expect(result.observation.facts.models.map(model => model.id)).toEqual(["exact-full-id"]);
    expect(transport).toHaveBeenCalledTimes(2);
    for (const [, init] of transport.mock.calls) expect(init).toMatchObject({ method: "GET", headers: { Authorization: "Bearer fixture-only-key" } });
    expect(guards.implicit).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toContain("fixture-only-key");
  });

  it("supports only the existing configured HTTP Key origin while public sources remain HTTPS", async () => {
    const row = connection("http://fixture.invalid/v1"), task = keyTask(row);
    const transport = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ data: [{ id: "configured-http-key" }] }));
    expect((await collectCatalogReadTask(task, row, undefined, [], dependencies(transport))).observation.receipt.complete).toBe(true);
    expect(transport).toHaveBeenCalledExactlyOnceWith("http://fixture.invalid/v1/models", expect.anything());
    expect(() => catalogSafeSourceUrl("http://fixture.invalid/prices")).toThrow();
    const scopes = catalogConnectionScopes(row);
    expect(() => catalogReadItem("public", "http://fixture.invalid/prices", "catalog-offer", scopes.anonymous, scopes.apply)).toThrow();
    const forged = { ...task, spec: { ...task.spec, authScope: scopes.anonymous, role: "catalog-offer" as const } };
    transport.mockClear();
    expect((await collectCatalogReadTask(forged, row, undefined, [], dependencies(transport))).observation.receipt.status).toBe("failed");
    expect(transport).not.toHaveBeenCalled();
    expect(guards.implicit).not.toHaveBeenCalled();
  });

  it.each([
    ["https://ai.cangyuansuanli.cn/v1", "cangyuan-pricing"],
    ["https://tu.988236.xyz/v1", "chentu-pricing"],
    ["https://api.3365api.cn/v1", "cyberafei-pricing"],
    ["https://api.miaowuai.store/v1", "miaowu-pricing"],
  ])("dedicated %s source uses the dispatched HTTP and never grants public IDs to a Key", async (baseUrl, entryId) => {
    const row = connection(baseUrl), plan = catalogSourcePlan(row), spec = plan.find(item => item.entryId === entryId)!;
    const transport = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ data: [{ model_name: "public-only-id", enable_groups: ["fixture-group"] }] }));
    const result = await collectCatalogReadTask({ spec }, row, undefined, [], dependencies(transport));
    expect(result.observation.facts.models.map(model => model.id)).toContain("public-only-id");
    expect(result.observation.receipt).toMatchObject({ status: "succeeded", spec: { role: "catalog-offer", authScope: { kind: "anonymous" } } });
    expect(catalogConnectionManifest(row.id, context.observationCycleId, [result.observation], plan).complete).toBe(false);
    expect(transport).toHaveBeenCalledTimes(1); expect(guards.implicit).not.toHaveBeenCalled();
    expect(new Headers(transport.mock.calls[0]?.[1]?.headers).has("authorization")).toBe(false);
  });

  it("does not let failed public data consume or erase a separately dispatched Key success", async () => {
    const row = connection("https://ai.cangyuansuanli.cn/v1"), plan = catalogSourcePlan(row);
    const transport = vi.fn<typeof fetch>(async url => String(url).endsWith("/models") ? Response.json({ data: [{ id: "key-survives" }] }) : new Response(null, { status: 503 }));
    const key = await collectCatalogReadTask(keyTask(row), row, undefined, [], dependencies(transport));
    const publicRead = await collectCatalogReadTask({ spec: plan.find(item => item.entryId === "cangyuan-pricing")! }, row, undefined, [], dependencies(transport));
    expect(key.observation.facts.models.map(model => model.id)).toEqual(["key-survives"]);
    expect(publicRead.observation.receipt).toMatchObject({ status: "failed", complete: false });
    expect(catalogConnectionManifest(row.id, context.observationCycleId, [publicRead.observation, key.observation], plan).complete).toBe(true);
    expect(transport).toHaveBeenCalledTimes(2); expect(guards.implicit).not.toHaveBeenCalled();
  });

  it("persists discovered documentation tasks as plain data, then resumes the child through its dispatcher", async () => {
    const row = connection(), scopes = catalogConnectionScopes(row), task = { spec: catalogReadItem("schema-document:https://docs.fixture.invalid/guide",
      "https://docs.fixture.invalid/guide", "schema", scopes.anonymous, scopes.apply) };
    const transport = vi.fn<typeof fetch>(async url => String(url).endsWith("/guide") ? new Response('<a href="/schema.json">schema</a><script>globalThis.attack=true</script>')
      : Response.json(schema()));
    const first = await collectCatalogReadTask(task, row, undefined, [image], dependencies(transport));
    expect(transport).toHaveBeenCalledTimes(1);
    const resumed = JSON.parse(JSON.stringify(first.discovered)) as CatalogReadTask[];
    expect(resumed).toHaveLength(1);
    expect(resumed[0]?.spec.sourceUrl).toBe("https://docs.fixture.invalid/schema.json");
    const child = await collectCatalogReadTask(resumed[0]!, row, undefined, [image], dependencies(transport));
    expect(child.observation.receipt).toMatchObject({ status: "succeeded", complete: true, attemptedUrls: [resumed[0]!.spec.sourceUrl] });
    expect(child.observation.facts.contracts?.[0]?.model.id).toBe(image.id);
    expect(transport).toHaveBeenCalledTimes(2); expect(guards.implicit).not.toHaveBeenCalled();
    expect((globalThis as Record<string, unknown>).attack).toBeUndefined();
    expect(JSON.stringify(first.discovered)).not.toMatch(/fixture-only-key|opaque-fixture|"body"/u);
  });

  it("discovers supplementary per-group tasks without HTTP recursion and resumes with the same group digest", async () => {
    const row = connection("https://asian-acc.we-token.cc/v1"), scopes = catalogConnectionScopes(row);
    const url = "https://asian-acc.we-token.cc/api/v1/model-plaza-legacy/models";
    const task: CatalogReadTask = { spec: catalogReadItem("supplement:weai-legacy-index", url, "catalog-offer", scopes.account, scopes.apply),
      supplement: { entryId: "weai-legacy-index", sourceUrl: url, role: "catalog-offer", authKind: "site-account" } };
    const payload = (id: number) => ({ code: 0, data: { groups: [{ id: 101, name: "one", platform: "fixture" }, { id: 102, name: "two", platform: "fixture" }],
      selected_group_id: id, token_multiplier: 1, image_multiplier: 2, image_quality_billing: false,
      models: [{ name: `full-id-${id}`, billing_mode: "image", per_request_price: .1 }] } });
    const transport = vi.fn<typeof fetch>(async input => Response.json(payload(new URL(String(input)).searchParams.get("group_id") === "102" ? 102 : 101)));
    const index = await collectCatalogReadTask(task, row, undefined, [], dependencies(transport));
    expect(transport).toHaveBeenCalledTimes(1);
    const resumed = JSON.parse(JSON.stringify(index.discovered)) as CatalogReadTask[];
    expect(resumed[0]?.supplement?.expectedGroupSetSha256).toMatch(/^[a-f0-9]{64}$/u);
    expect(resumed[0]?.spec.applyScope.groupIdentity).toBe("site-id:102");
    const child = await collectCatalogReadTask(resumed[0]!, row, undefined, [], dependencies(transport));
    expect(child.observation.facts.models.map(model => model.id)).toEqual(["full-id-102"]);
    expect(transport).toHaveBeenCalledTimes(2); expect(guards.implicit).not.toHaveBeenCalled();
    expect(JSON.stringify(resumed)).not.toMatch(/fixture-only-key|opaque-fixture|"body"/u);
  });

  it("discovers Miaowu model-schema tasks and routes the actual schema request through injected transport", async () => {
    const row = connection("https://api.miaowuai.store/v1");
    const discovered = discoverCatalogModelTasks(row, undefined, [image], true);
    const task = JSON.parse(JSON.stringify(discovered.find(item => item.spec.entryId === `miaowu-schema:${image.id}`))) as CatalogReadTask;
    const array = (maxItems: number) => ({ type: "array", items: { type: "string" }, minItems: 0, maxItems });
    const transport = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ id: image.id, type: "image", request_schema: { properties: { params: { properties: {
      mode: { type: "string", enum: ["text-to-image", "image-to-image"] }, prompt: { type: "string" }, size: { type: "string", enum: ["2K", "4K"] },
      ratio: { type: "string", enum: ["1:1", "16:9"] }, image_urls: array(2), video_urls: array(0), audio_urls: array(0),
    } } } } }));
    const result = await collectCatalogReadTask(task, row, undefined, [image], dependencies(transport));
    expect(result.observation).toMatchObject({ receipt: { status: "succeeded", complete: true }, facts: {
      sourceFacts: { kind: "miaowu-schema", contract: { resolutions: ["2K", "4K"] } }, contractDigests: [expect.stringMatching(/^[a-f0-9]{64}$/u)] } });
    expect(transport).toHaveBeenCalledExactlyOnceWith(task.spec.sourceUrl, expect.objectContaining({ method: "GET" }));
    expect(guards.implicit).not.toHaveBeenCalled();
  });

  it("has no repository writes, stored secret resolver, site session or implicit transport side effects", async () => {
    const repository = new MemoryRepository();
    const methods = [vi.spyOn(repository, "saveConnection"), vi.spyOn(repository, "setApplicationSetting"), vi.spyOn(repository, "saveSupplier"),
      vi.spyOn(repository, "commitCatalogObservation")];
    const snapshot = repository.exportSnapshot(), row = connection(), original = structuredClone(row);
    const transport = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ data: [{ id: "only-collected" }] }));
    await withCatalogRepository(repository, () => collectCatalogReadTask(keyTask(row), row, undefined, [], dependencies(transport)));
    for (const method of methods) expect(method).not.toHaveBeenCalled();
    expect(repository.exportSnapshot()).toEqual(snapshot); expect(row).toEqual(original); expect(guards.implicit).not.toHaveBeenCalled();
  });

  it("is disabled or pre-aborted before acquiring transport, and does not retry an interrupted request", async () => {
    const row = connection(), task = keyTask(row), transport = vi.fn<typeof fetch>();
    const fetchFor = vi.fn(() => transport);
    expect((await collectCatalogReadTask(task, row, undefined, [], dependencies(transport, { enabled: false, fetchFor }))).observation.receipt.status).toBe("deferred");
    const controller = new AbortController(); controller.abort();
    expect((await collectCatalogReadTask(task, row, undefined, [], dependencies(transport, { signal: controller.signal, fetchFor }))).observation.receipt.reason).toBe("cancelled");
    expect(fetchFor).not.toHaveBeenCalled(); expect(transport).not.toHaveBeenCalled();
    const running = new AbortController();
    transport.mockImplementation(async () => { running.abort(); throw new Error("raw response secret must not leak"); });
    const failed = await collectCatalogReadTask(task, row, undefined, [], dependencies(transport, { signal: running.signal }));
    expect(failed.observation.receipt).toMatchObject({ status: "failed", reason: "cancelled", complete: false });
    expect(transport).toHaveBeenCalledTimes(1); expect(JSON.stringify(failed)).not.toContain("raw response secret");
  });
});
