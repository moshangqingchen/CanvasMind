import { describe, expect, it, vi } from "vitest";
import type { ModelDescriptor } from "@super-canvas/providers";
import { collectCatalogInterfaceDocument, discoverCatalogInterfaceEntries } from "./catalog-interface-document-collector";
import { applyCatalogContractDiagnostics, catalogContractFromDocumented, catalogContractSlotKey, emptyCatalogContractState,
  reduceCatalogContract } from "./catalog-contract-policy";

const model: ModelDescriptor = { id: "fixture-image-model", name: "Fixture image", operations: ["image.generate"],
  metadata: { endpointTypes: ["/images/generations"], secret: "input-secret-must-not-leak" } };
const baseUrl = "https://api.supplier.test/v1", url = "https://docs.supplier.test/image";
const checkedAt = "2026-10-17T11:22:33.000Z";
const schema = (quality = "high") => ({ openapi: "3.1.0", security: [{ bearer: [] }], components: {
  securitySchemes: { bearer: { type: "http", scheme: "bearer", description: "raw-doc-secret-must-not-leak" } },
}, paths: { "/images/generations": { post: { requestBody: { content: { "application/json": { schema: {
  type: "object", required: ["model", "prompt"], properties: { model: { type: "string", enum: [model.id] }, prompt: { type: "string" },
    quality: { type: "string", enum: [quality], default: quality } },
} } } }, responses: { "200": { content: { "application/json": { schema: { type: "object", properties: {
  data: { type: "array", items: { type: "object", properties: { url: { type: "string" } } } },
} } } } } } } } } });

describe("single-source documentation collector", () => {
  it("carries exact changed path and parameter diagnostics without treating a parser error alone as a new contract", async () => {
    const transport = (value: unknown) => vi.fn<typeof fetch>(async () => Response.json(value));
    const initial = await collectCatalogInterfaceDocument({ url, baseUrl, models: [model] }, { fetch: transport(schema()), checkedAt });
    const scope = { origin: "https://api.supplier.test", sourceId: "fixture-source", groupIdentity: "site-id:7", modelId: model.id, operation: "image.generate" as const };
    const normalized = catalogContractFromDocumented(scope, "rest", initial.contracts[0]!);
    const accepted = reduceCatalogContract(emptyCatalogContractState(), { ...normalized, sourceKey: "source-doc", owner: "automatic", presence: "present", complete: true, checkedAt });
    const context = { ...scope, sourceKey: "source-doc", checkedAt };
    const changedSource = schema(), changed = { ...changedSource, paths: { "/v2/images/generations": changedSource.paths["/images/generations"] } };
    const request = changed.paths["/v2/images/generations"].post.requestBody.content["application/json"].schema;
    request.required.push("extra_field"); Object.assign(request.properties, { extra_field: { type: "string" } });
    const read = await collectCatalogInterfaceDocument({ url, baseUrl, models: [model] }, { fetch: transport(changed), checkedAt });
    expect(read.contracts).toEqual([]);
    expect(read.contractDiagnostics).toContainEqual(expect.objectContaining({ modelId: model.id, method: "POST", submitEndpoint: "https://api.supplier.test/v2/images/generations" }));
    const pending = applyCatalogContractDiagnostics(accepted, read.contractDiagnostics, context);
    expect(pending.slots[catalogContractSlotKey(scope)]?.blocked).toBe(true);
    const parameterOnly = schema("low");
    parameterOnly.paths["/images/generations"].post.requestBody.content["application/json"].schema.required.push("extra_field");
    Object.assign(parameterOnly.paths["/images/generations"].post.requestBody.content["application/json"].schema.properties, { extra_field: { type: "string" } });
    const parameters = await collectCatalogInterfaceDocument({ url, baseUrl, models: [model] }, { fetch: transport(parameterOnly), checkedAt });
    expect(applyCatalogContractDiagnostics(accepted, parameters.contractDiagnostics, context).slots[catalogContractSlotKey(scope)]?.blocked).toBe(true);
    const network = await collectCatalogInterfaceDocument({ url, baseUrl, models: [model] }, { fetch: vi.fn(async () => new Response(null, { status: 503 })), checkedAt });
    expect(network.contractDiagnostics).toEqual([]);
    expect(applyCatalogContractDiagnostics(accepted, network.contractDiagnostics, context)).toEqual(accepted);
    expect(JSON.stringify(read)).not.toContain("extra_field");
  });
  it("compiles literal OpenAPI through the existing compiler without raw bodies, inherited prices or secrets", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => Response.json(schema()));
    const read = await collectCatalogInterfaceDocument({ url, baseUrl, models: [model] }, { fetch, checkedAt });
    expect(read).toMatchObject({ url, checkedAt, status: "complete", complete: true, schemaCount: 1, issues: [] });
    expect(read.contracts).toHaveLength(1);
    expect(read.contracts[0]).toMatchObject({ sourceUrl: url, model: { id: model.id,
      parameters: [{ key: "quality", default: "high" }] }, connector: { auth: { type: "bearer" }, submit: { path: "/images/generations" } } });
    const serialized = JSON.stringify(read);
    expect(serialized).not.toContain("raw-doc-secret");
    expect(serialized).not.toContain("input-secret");
    expect(serialized).not.toContain('"body"');
    expect(fetch).toHaveBeenCalledExactlyOnceWith(url, expect.objectContaining({ method: "GET", credentials: "omit", headers: {}, redirect: "error" }));
  });

  it("records all same-origin literal schema links without executing scripts or following any of them", async () => {
    const links = Array.from({ length: 40 }, (_, index) => `<a href="/schema-${index}.json">schema</a>`).join("");
    const fetch = vi.fn<typeof globalThis.fetch>(async () => new Response(`<script>throw Error('must not execute'); window.open('https://external.test');</script>${links}
      <script>const ui = {url: '/inline.json'};</script><a href="https://elsewhere.test/ignore.json">other</a>
      <a href="https://user:password@docs.supplier.test/reject.json">secret</a><a href="/reject.json?key=secret">query</a>`));
    const read = await collectCatalogInterfaceDocument({ url, baseUrl, models: [model] }, { fetch });
    expect(read).toMatchObject({ status: "complete", complete: true, contracts: [], schemaCount: 0 });
    expect(read.discoveredEntries).toHaveLength(41);
    expect(read.discoveredEntries.every(entry => entry.url.startsWith("https://docs.supplier.test/"))).toBe(true);
    expect(JSON.stringify(read)).not.toContain("password");
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("parses embedded literal JSON but never evaluates JavaScript configuration", async () => {
    const encoded = JSON.stringify(schema()).replaceAll('"', "&quot;");
    const fetch = vi.fn<typeof globalThis.fetch>(async () => new Response(`<pre>${encoded}</pre><script>globalThis.attack = true</script>`));
    expect((await collectCatalogInterfaceDocument({ url, baseUrl, models: [model] }, { fetch })).contracts).toHaveLength(1);
    const script = vi.fn<typeof globalThis.fetch>(async () => new Response(`<script>window.doc = ${JSON.stringify(schema())};</script>`));
    expect(await collectCatalogInterfaceDocument({ url, baseUrl, models: [model] }, { fetch: script })).toMatchObject({ status: "invalid", complete: false, contracts: [] });
  });

  it("distinguishes an empty response, an error page, an empty valid schema and a failed request", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValueOnce(new Response(""))
      .mockResolvedValueOnce(new Response("<html>upstream-error-secret</html>"))
      .mockResolvedValueOnce(Response.json({ openapi: "3.0.0", paths: {} }))
      .mockResolvedValueOnce(new Response("authorization-secret", { status: 401 }));
    const input = { url, baseUrl, models: [model] };
    const empty = await collectCatalogInterfaceDocument(input, { fetch });
    const invalid = await collectCatalogInterfaceDocument(input, { fetch });
    const valid = await collectCatalogInterfaceDocument(input, { fetch });
    const failed = await collectCatalogInterfaceDocument(input, { fetch });
    expect(empty).toMatchObject({ status: "empty", complete: false });
    expect(invalid).toMatchObject({ status: "invalid", complete: false });
    expect(valid).toMatchObject({ status: "complete", complete: true, schemaCount: 1, contracts: [] });
    expect(failed).toMatchObject({ status: "failed", complete: false, failure: { code: "invalid_credentials", httpStatus: 401 } });
    expect(JSON.stringify([empty, invalid, valid, failed])).not.toContain("secret");
  });

  it("does not cache, silently choose conflicting schemas, or leak compilation error text", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => new Response(`<pre>${JSON.stringify(schema("high"))}</pre><pre>${JSON.stringify(schema("low"))}</pre>`));
    const read = await collectCatalogInterfaceDocument({ url, baseUrl, models: [model] }, { fetch });
    expect(read).toMatchObject({ complete: true, contracts: [], issues: [{ modelId: model.id, code: "conflicting_contracts" }] });
    await collectCatalogInterfaceDocument({ url, baseUrl, models: [model] }, { fetch });
    expect(fetch).toHaveBeenCalledTimes(2);
    const broken = schema();
    broken.paths["/images/generations"].post.requestBody.content["application/json"].schema.required.push("raw-secret-field");
    Object.assign(broken.paths["/images/generations"].post.requestBody.content["application/json"].schema.properties, { "raw-secret-field": { type: "string" } });
    const invalid = await collectCatalogInterfaceDocument({ url, baseUrl, models: [model] }, { fetch: vi.fn(async () => Response.json(broken)) });
    expect(invalid.issues).toEqual([{ modelId: model.id, code: "contract_incomplete" }]);
    expect(JSON.stringify(invalid)).not.toContain("raw-secret-field");
  });

  it("rejects unsafe URLs before dispatch, bounds bytes and treats cancellation as a distinct receipt", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => new Response("x".repeat(1024 * 1024 + 1)));
    for (const unsafe of ["http://docs.supplier.test/schema.json", "https://user:secret@docs.supplier.test/x", "https://127.0.0.1/x", "https://docs.supplier.test/x?key=secret"])
      expect(await collectCatalogInterfaceDocument({ url: unsafe, baseUrl, models: [model] }, { fetch })).toMatchObject({ status: "unsafe", complete: false, url: "" });
    expect(fetch).not.toHaveBeenCalled();
    expect(await collectCatalogInterfaceDocument({ url, baseUrl, models: [model] }, { fetch })).toMatchObject({ status: "failed", failure: { code: "incomplete_directory" } });
    fetch.mockClear();
    const controller = new AbortController(); controller.abort();
    expect(await collectCatalogInterfaceDocument({ url, baseUrl, models: [model] }, { fetch, signal: controller.signal })).toMatchObject({ status: "aborted", complete: false });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("has no default network transport when an invalid JavaScript caller omits the required injected fetch", async () => {
    const globalFetch = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("must not dispatch"));
    try {
      const read = await collectCatalogInterfaceDocument({ url, baseUrl, models: [model] },
        {} as Parameters<typeof collectCatalogInterfaceDocument>[1]);
      expect(read).toMatchObject({ status: "failed", complete: false, contracts: [] });
      expect(globalFetch).not.toHaveBeenCalled();
    } finally { globalFetch.mockRestore(); }
  });
});

describe("documentation read planning", () => {
  it("enumerates all explicit linked URLs plus API/site candidates without the old 12-entry truncation", () => {
    const models = Array.from({ length: 40 }, (_, index) => ({ ...model, id: `model-${index}`,
      metadata: { documentationUrl: `/guide-${index}`, docsUrl: index ? `/guide-${index}` : "/other-guide" } }));
    const entries = discoverCatalogInterfaceEntries(baseUrl, "https://supplier.test", models);
    expect(entries.filter(entry => entry.kind === "linked")).toHaveLength(41);
    expect(entries.filter(entry => entry.kind === "candidate").map(entry => entry.url)).toEqual([
      "https://supplier.test/openapi.json", "https://supplier.test/swagger.json",
      "https://api.supplier.test/openapi.json", "https://api.supplier.test/swagger.json", "https://api.supplier.test/v1/openapi.json",
    ]);
    const dispatched = entries.slice(0, 32), deferred = entries.slice(32);
    expect(dispatched.length + deferred.length).toBe(entries.length);
    expect(deferred).toContainEqual(expect.objectContaining({ url: "https://supplier.test/guide-39" }));
  });

  it("deduplicates fragment links, supports explicit arrays and excludes credential-bearing entries", () => {
    const entries = discoverCatalogInterfaceEntries(baseUrl, "https://supplier.test", [{ ...model, metadata: {
      docsUrl: ["https://docs.supplier.test/a#one", "https://docs.supplier.test/a#two", "javascript:attack", "https://docs.supplier.test/a?token=secret"],
      documentationUrls: ["https://docs.supplier.test/b"],
    } }]);
    expect(entries.filter(entry => entry.kind === "linked").map(entry => entry.url)).toEqual(["https://docs.supplier.test/a", "https://docs.supplier.test/b"]);
    expect(JSON.stringify(entries)).not.toContain("secret");
    expect(discoverCatalogInterfaceEntries("http://unsafe.test", "https://supplier.test", [model])).toEqual([]);
  });
});
