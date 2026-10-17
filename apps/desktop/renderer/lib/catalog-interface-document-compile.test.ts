import { describe, expect, it, vi } from "vitest";
import type { ModelDescriptor } from "@super-canvas/providers";
import { catalogInterfaceCompilationCacheStats, clearCatalogInterfaceCompilationCache, compileCatalogInterfaceDocuments, normalizeCatalogInterfaceDocument } from "./catalog-interface-document-compile";

const baseUrl = "https://fixture-api.invalid/v1", sourceUrl = "https://fixture-docs.invalid/openapi.json";
const model = (id: string): ModelDescriptor => ({ id, name: id, operations: ["image.generate"] });
function document(ids: string[]) {
  return { openapi: "3.1.0", info: { title: "raw-prose-secret" }, security: [{ bearer: [] }], components: {
    securitySchemes: { bearer: { type: "http", scheme: "bearer", description: "raw-auth-description" } },
    schemas: { Request: { type: "object", required: ["model", "prompt"], properties: {
      model: { type: "string", enum: ids }, prompt: { type: "string" }, quality: { type: "string", enum: ["high", "low"], default: "high" },
    } } },
  }, paths: { "/images/generations": { post: { summary: "raw-summary-secret", requestBody: {
    content: { "application/json": { schema: { $ref: "#/components/schemas/Request" } } },
  }, responses: { "200": { content: { "application/json": { schema: { type: "object", properties: {
    data: { type: "array", items: { type: "object", properties: { url: { type: "string" } } } },
  } } } } } } } } } };
}
const compile = (value: unknown, ids: string[], groupIdentity = "site-id:group-b") => {
  const normalized = normalizeCatalogInterfaceDocument(value, baseUrl, sourceUrl)!;
  return compileCatalogInterfaceDocuments([JSON.parse(JSON.stringify(normalized))], ids.map(model), { baseUrl, groupIdentity });
};

describe("bounded shared document declarations", () => {
  it("recompiles one persisted schema for a sibling group and a model outside the first Key subset without HTTP", () => {
    const normalized = normalizeCatalogInterfaceDocument(document(["only-key-a", "only-key-b"]), baseUrl, sourceUrl)!;
    const globalFetch = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("No HTTP permitted"));
    try {
      const a = compileCatalogInterfaceDocuments([normalized], [model("only-key-a")], { baseUrl, groupIdentity: "site-id:group-a" });
      const b = compileCatalogInterfaceDocuments([JSON.parse(JSON.stringify(normalized))], [model("only-key-b")], { baseUrl, groupIdentity: "site-id:group-b" });
      expect(a.contracts.map(value => value.model.id)).toEqual(["only-key-a"]);
      expect(b.contracts.map(value => value.model.id)).toEqual(["only-key-b"]);
      expect(b.contracts[0]?.connector.submit.path).toBe("/images/generations");
      expect(globalFetch).not.toHaveBeenCalled();
      expect(normalized.coverage.modelIds).toEqual(["only-key-a", "only-key-b"]);
      expect(JSON.stringify(normalized)).not.toMatch(/raw-prose|raw-summary|raw-auth|description|\$ref/u);
    } finally { globalFetch.mockRestore(); }
  });
  it("does not lose model declarations after the legacy compiler's 32-item list budget", () => {
    const ids = Array.from({ length: 140 }, (_, index) => "full-model-" + index);
    expect(compile(document(ids), [ids[139]!]).contracts[0]?.model.id).toBe(ids[139]);
  });
  it("does not grant a sibling group a group-restricted declaration, including operation coverage", () => {
    for (const level of ["root", "path", "operation"]) {
      const value = document(["id"]), target = level === "root" ? value : level === "path" ? value.paths["/images/generations"] : value.paths["/images/generations"].post;
      Object.assign(target, { "x-group-ids": ["group-a"] });
      expect(compile(value, ["id"], "site-id:group-a").contracts).toHaveLength(1);
      expect(compile(value, ["id"], "site-id:group-b").contracts).toHaveLength(0);
      expect(compile(value, ["id"], "site-id:group-b").contractDiagnostics).toHaveLength(0);
    }
  });
  it("does not borrow an unnamed model, a different API origin or an unsupported group declaration", () => {
    expect(compile(document(["key-a"]), ["key-b"]).contracts).toHaveLength(0);
    const normalized = normalizeCatalogInterfaceDocument(document(["id"]), baseUrl, sourceUrl)!;
    expect(compileCatalogInterfaceDocuments([normalized], [model("id")], { baseUrl: "https://other.invalid", groupIdentity: "site-id:group-a" }).contracts).toHaveLength(0);
    expect(compile({ ...document(["id"]), "x-groups": ["ambiguous display name"] }, ["id"]).contracts).toHaveLength(0);
  });
  it("retains unknown required presence without copying raw field names or manufacturing a usable bundle", () => {
    const value = document(["id"]), request = value.components.schemas.Request;
    request.required.push("raw-secret-field"); Object.assign(request.properties, { "raw-secret-field": { type: "string", default: "raw-secret-value" } });
    const normalized = normalizeCatalogInterfaceDocument(value, baseUrl, sourceUrl)!;
    const read = compileCatalogInterfaceDocuments([normalized], [model("id")], { baseUrl });
    expect(read.contracts).toEqual([]); expect(read.issues).toContainEqual({ modelId: "id", code: "contract_incomplete" });
    expect(JSON.stringify(normalized)).not.toContain("raw-secret");
  });
  it("keeps incomplete, conflicting and changed endpoint diagnostics scoped to the exact target", () => {
    const a = normalizeCatalogInterfaceDocument(document(["id"]), baseUrl, sourceUrl)!;
    const changed = document(["id"]);
    Object.assign(changed.paths, { "/new-images/generations": changed.paths["/images/generations"] });
    delete (changed.paths as Record<string, unknown>)["/images/generations"];
    const b = normalizeCatalogInterfaceDocument(changed, baseUrl, sourceUrl)!;
    const result = compileCatalogInterfaceDocuments([a, b], [model("id")], { baseUrl });
    expect(result.contracts).toHaveLength(0); expect(result.issues[0]?.code).toBe("conflicting_contracts");
    expect(result.contractDiagnostics.map(value => value.submitEndpoint)).toContain("https://fixture-api.invalid/new-images/generations");
  });
  it("treats identical invocation declarations from two linked pages as one contract and preserves the first source", () => {
    const first = normalizeCatalogInterfaceDocument(document(["id"]), baseUrl, sourceUrl)!, second = { ...first, sourceUrl: "https://fixture-docs.invalid/duplicate.json" };
    const read = compileCatalogInterfaceDocuments([first, second], [model("id")], { baseUrl });
    expect(read.contracts).toHaveLength(1); expect(read.issues).toEqual([]);
  });
  it("does not turn a malformed required declaration or singular group restriction into unrestricted access", () => {
    const malformed = document(["id"]); Object.assign(malformed.components.schemas.Request, { required: "arbitrary-required-field" });
    expect(compile(malformed, ["id"]).contracts).toEqual([]);
    const scoped = document(["id"]); Object.assign(scoped, { "x-group-id": "group-a" });
    expect(compile(scoped, ["id"], "site-id:group-b").contracts).toEqual([]);
    expect(compile(scoped, ["id"], "site-id:group-a").contracts).toHaveLength(1);
  });
  it("reuses only equivalent normalized invocation work without caching target prices, permissions or mutable caller objects", () => {
    clearCatalogInterfaceCompilationCache();
    const docs = [normalizeCatalogInterfaceDocument(document(["id"]), baseUrl, sourceUrl)!];
    const first = compileCatalogInterfaceDocuments(docs, [model("id")], { baseUrl, groupIdentity: "site-id:a" });
    first.contracts[0]!.connector.submit.path = "/caller-tamper";
    const second = compileCatalogInterfaceDocuments(JSON.parse(JSON.stringify(docs)), [{ ...model("id"), metadata: { secret: "input-secret", priceLabel: "fake-price" } }], { baseUrl, groupIdentity: "site-id:b" });
    expect(catalogInterfaceCompilationCacheStats().hits).toBe(1);
    expect(second.contracts[0]?.connector.submit.path).toBe("/images/generations");
    expect(JSON.stringify(second)).not.toMatch(/input-secret|fake-price|caller-tamper/u);
    const changed = document(["id"]); changed.components.schemas.Request.properties.quality.default = "low";
    const replacement = compileCatalogInterfaceDocuments([normalizeCatalogInterfaceDocument(changed, baseUrl, sourceUrl)!], [model("id")], { baseUrl });
    expect(replacement.contracts[0]?.model.parameters?.[0]?.default).toBe("low");
  });
  it("bounds compiled semantic memoization by both entry count and bytes", () => {
    clearCatalogInterfaceCompilationCache();
    compileCatalogInterfaceDocuments([], Array.from({ length: 4200 }, (_, i) => model("missing-" + i)), { baseUrl });
    expect(catalogInterfaceCompilationCacheStats().entries).toBeLessThanOrEqual(4096);
    expect(catalogInterfaceCompilationCacheStats().bytes).toBeLessThanOrEqual(8 * 1024 * 1024);
    clearCatalogInterfaceCompilationCache(); expect(catalogInterfaceCompilationCacheStats()).toEqual({ entries: 0, bytes: 0, hits: 0 });
  });
  it("rejects declarations exceeding path or normalized byte budgets without silently claiming completeness", () => {
    const value = document(["id"]);
    const path = value.paths["/images/generations"];
    Object.assign(value, { paths: Object.fromEntries(Array.from({ length: 1001 }, (_, i) => ["/path-" + i, path])) });
    expect(normalizeCatalogInterfaceDocument(value, baseUrl, sourceUrl)).toBeUndefined();
    const huge = document(Array.from({ length: 10000 }, (_, i) => "id-" + i + "x".repeat(80)));
    expect(normalizeCatalogInterfaceDocument(huge, baseUrl, sourceUrl)).toBeUndefined();
  });
});
