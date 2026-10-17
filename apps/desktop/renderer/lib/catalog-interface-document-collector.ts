import { isIP } from "node:net";
import { assertSafeProviderEndpoint, compileDocumentedInterface, type DocumentedModelInterface, type ModelDescriptor, type ModelParameterDescriptor } from "@super-canvas/providers";
import { readCatalogLoaderText, type CatalogLoaderReadOptions } from "./catalog-loader-http";
import { modelInventoryFailure, type ModelInventoryFailure } from "./model-inventory-failure";
import { catalogContractEndpoint, catalogContractFromDocumented, catalogContractParameterFingerprint } from "./catalog-contract-policy";
import type { CatalogContractDiagnostic } from "./catalog-read-contracts";

export interface CatalogInterfaceEntry { url: string; priority: 0 | 1; kind: "linked" | "candidate" }
export interface CatalogInterfaceDocumentRead {
  url: string;
  checkedAt: string;
  status: "complete" | "empty" | "invalid" | "failed" | "aborted" | "unsafe";
  complete: boolean;
  contracts: DocumentedModelInterface[];
  discoveredEntries: CatalogInterfaceEntry[];
  schemaCount: number;
  issues: { modelId: string; code: "contract_incomplete" | "conflicting_contracts" }[];
  contractDiagnostics: CatalogContractDiagnostic[];
  failure?: Pick<ModelInventoryFailure, "code" | "httpStatus">;
}

const record = (value: unknown): Record<string, unknown> | undefined =>
  value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;

function diagnosticSchema(document: Record<string, unknown>, value: unknown, depth = 0): Record<string, unknown> | undefined {
  const raw = record(value);
  if (!raw || depth > 12 || raw.oneOf || raw.anyOf) return undefined;
  if (typeof raw.$ref === "string") {
    if (!raw.$ref.startsWith("#/")) return undefined;
    let target: unknown = document;
    for (const encoded of raw.$ref.slice(2).split("/")) {
      const part = encoded.replace(/~1/gu, "/").replace(/~0/gu, "~");
      if (["__proto__", "constructor", "prototype"].includes(part)) return undefined;
      target = record(target)?.[part];
    }
    return diagnosticSchema(document, target, depth + 1);
  }
  if (Array.isArray(raw.allOf)) {
    const parts = raw.allOf.map(part => diagnosticSchema(document, part, depth + 1));
    if (parts.some(part => !part)) return undefined;
    return { ...raw, properties: Object.assign({}, ...parts.map(part => record(part?.properties)), record(raw.properties)),
      required: [...new Set([...parts.flatMap(part => Array.isArray(part?.required) ? part.required : []), ...(Array.isArray(raw.required) ? raw.required : [])])] };
  }
  return raw;
}

/** Conservative compiler-compatible normalization. Unresolved refs remain unknown. */
function parameterFingerprint(document: Record<string, unknown>, operation: Record<string, unknown>): string | undefined {
  const body = diagnosticSchema(document, operation.requestBody), content = record(body?.content), json = record(content?.["application/json"]);
  const schema = diagnosticSchema(document, json?.schema), properties = record(schema?.properties);
  if (!schema || !properties || schema.$ref || schema.anyOf || schema.oneOf) return undefined;
  const required = schema.required === undefined ? [] : Array.isArray(schema.required) && schema.required.every(value => typeof value === "string") ? schema.required as string[] : undefined;
  if (!required) return undefined;
  const parameters: ModelParameterDescriptor[] = [];
  for (const [key, value] of Object.entries(properties)) {
    if (["model", "prompt"].includes(key)) continue;
    const field = diagnosticSchema(document, value);
    if (!field || field.$ref || field.anyOf || field.oneOf) return undefined;
    if (!["size", "quality", "n", "resolution", "aspect_ratio", "duration", "seconds", "seed", "response_format", "output_format", "background"].includes(key)) continue;
    const type = field.type;
    if (!["string", "integer", "number", "boolean"].includes(String(type))) return undefined;
    const options = Array.isArray(field.enum) ? field.enum.filter((option): option is string | number | boolean => ["string", "number", "boolean"].includes(typeof option)).slice(0, 128) : undefined;
    const fallback = ["string", "number", "boolean"].includes(typeof field.default) ? field.default as string | number | boolean : key === "n" ? 1 : undefined;
    parameters.push({ key, label: key, control: options?.length ? "select" : type === "string" ? key === "size" ? "dimensions" : "text" : type === "boolean" ? "toggle" : "number",
      valueType: type as ModelParameterDescriptor["valueType"], ...(fallback !== undefined ? { default: fallback } : {}),
      ...(options?.length ? { options: options.map(value => ({ label: String(value), value })) } : {}),
      ...(typeof field.minimum === "number" ? { min: field.minimum } : {}), ...(typeof field.maximum === "number" ? { max: field.maximum } : {}), required: required.includes(key) });
  }
  return catalogContractParameterFingerprint({ parameters }, [...new Set(["model", "prompt", ...required])]);
}

function declarationDiagnostics(documents: readonly unknown[], model: ModelDescriptor, base: URL,
  code: CatalogContractDiagnostic["code"]): CatalogContractDiagnostic[] {
  const diagnostics: CatalogContractDiagnostic[] = [];
  for (const value of documents) {
    const document = record(value)!;
    for (const [path, raw] of Object.entries(record(document.paths) ?? {})) {
      const item = record(raw); if (!item) continue;
      for (const method of ["post", "put", "patch", "get"]) {
        const operation = record(item[method]); if (!operation) continue;
        const body = diagnosticSchema(document, operation.requestBody), content = record(body?.content), json = record(content?.["application/json"]);
        const properties = record(diagnosticSchema(document, json?.schema)?.properties), modelField = diagnosticSchema(document, properties?.model);
        const named = [...(Array.isArray(modelField?.enum) ? modelField.enum : []), ...(Array.isArray(operation["x-models"]) ? operation["x-models"] : [])];
        const endpoints = model.metadata?.endpointTypes;
        const exact = named.length ? named.includes(model.id) : Array.isArray(endpoints) && endpoints.includes(path);
        if (!exact) continue;
        const servers = operation.servers ?? item.servers ?? document.servers;
        const server = Array.isArray(servers) ? record(servers[0])?.url : undefined;
        try {
          const serverUrl = typeof server === "string" ? new URL(server, base.origin) : new URL(base.origin);
          if (serverUrl.origin !== base.origin || serverUrl.search || serverUrl.hash || serverUrl.username || serverUrl.password) continue;
          const submitEndpoint = catalogContractEndpoint(base.origin, `${serverUrl.pathname.replace(/\/$/u, "")}${path}`);
          const fingerprint = parameterFingerprint(document, operation);
          for (const operationName of model.operations) diagnostics.push({ modelId: model.id, operation: operationName, method: method.toUpperCase(), submitEndpoint,
            code, ...(fingerprint ? { parameterFingerprint: fingerprint } : {}) });
        } catch { /* An unresolved/cross-origin path cannot prove a comparable contract change. */ }
      }
    }
  }
  return [...new Map(diagnostics.map(value => [JSON.stringify(value), value])).values()];
}

/** No credentials, query tokens, local-network literals, or executable URLs can
 * enter the read plan. DNS is checked again immediately before dispatch. */
function safeUrl(raw: string, relativeTo?: URL): URL | undefined {
  try {
    const url = new URL(raw, relativeTo);
    const host = url.hostname.toLowerCase().replace(/^\[|\]$/gu, "");
    if (url.protocol !== "https:" || url.username || url.password || url.search || isIP(host) ||
      host === "localhost" || host.endsWith(".localhost") || host.endsWith(".internal") || !host.includes(".")) return undefined;
    url.hash = "";
    return url;
  } catch { return undefined; }
}

/** Enumerate, do not dispatch or silently truncate. The orchestrator owns the
 * read budget and retains any entries that have not yet been dispatched. */
export function discoverCatalogInterfaceEntries(baseUrl: string, siteUrl: string, models: readonly ModelDescriptor[]): CatalogInterfaceEntry[] {
  const base = safeUrl(baseUrl);
  if (!base) return [];
  const site = safeUrl(siteUrl) ?? base;
  const urls = new Map<string, CatalogInterfaceEntry>();
  for (const model of models) for (const key of ["documentationUrl", "docsUrl", "documentationUrls", "docsUrls"]) {
    const values = model.metadata?.[key];
    for (const raw of Array.isArray(values) ? values : [values]) {
      if (typeof raw !== "string") continue;
      const url = safeUrl(raw, site);
      if (url && !urls.has(url.href)) urls.set(url.href, { url: url.href, priority: 0, kind: "linked" });
    }
  }
  for (const origin of [site, base]) {
    const prefix = origin.pathname.replace(/\/(?:v1|v1beta)\/?$/u, "").replace(/\/$/u, "");
    for (const path of [prefix + "/openapi.json", prefix + "/swagger.json", origin.pathname.replace(/\/$/u, "") + "/openapi.json"]) {
      const url = safeUrl(path, new URL(origin.origin));
      if (url && !urls.has(url.href)) urls.set(url.href, { url: url.href, priority: 1, kind: "candidate" });
    }
  }
  return [...urls.values()];
}

function literalSchemas(text: string): unknown[] {
  const values: unknown[] = [];
  const decode = (value: string) => value.replace(/&quot;/gu, '"').replace(/&#39;|&apos;/gu, "'")
    .replace(/&lt;/gu, "<").replace(/&gt;/gu, ">").replace(/&amp;/gu, "&");
  const parse = (value: string) => {
    try {
      const parsed = JSON.parse(decode(value)) as unknown;
      const root = record(parsed);
      if (root && /^(?:2|3)\./u.test(String(root.openapi ?? root.swagger ?? "")) && record(root.paths)) values.push(parsed);
    } catch { /* Only literal JSON is data; never execute page scripts. */ }
  };
  parse(text);
  for (const match of text.matchAll(/<(?:script|pre|code)\b[^>]*>([\s\S]*?)<\/(?:script|pre|code)>/giu))
    parse(match[1]!.replace(/<[^>]+>/gu, ""));
  return [...new Map(values.map(value => [JSON.stringify(value), value])).values()];
}

function linkedJsonEntries(text: string, documentUrl: URL): CatalogInterfaceEntry[] {
  const urls = new Map<string, CatalogInterfaceEntry>();
  for (const match of text.matchAll(/(?:href\s*=|["']?\burl["']?\s*:)\s*["']([^"'\s<>]+\.json(?:#[^"'\s<>]*)?)["']/giu)) {
    const target = safeUrl(match[1]!, documentUrl);
    if (target && target.origin === documentUrl.origin && !urls.has(target.href))
      urls.set(target.href, { url: target.href, priority: 0, kind: "linked" });
  }
  return [...urls.values()];
}

/** One anonymous, bounded document read. No cache, recursive follow, repository,
 * session, model listing or generated requests are reachable from this entry. */
export async function collectCatalogInterfaceDocument(input: { url: string; baseUrl: string; models: readonly ModelDescriptor[] },
  options: CatalogLoaderReadOptions): Promise<CatalogInterfaceDocumentRead> {
  const checkedAt = options.checkedAt ?? new Date().toISOString();
  const base = safeUrl(input.baseUrl), url = safeUrl(input.url);
  const result: CatalogInterfaceDocumentRead = { url: url?.href ?? "", checkedAt, status: "unsafe", complete: false,
    contracts: [], discoveredEntries: [], schemaCount: 0, issues: [], contractDiagnostics: [] };
  if (!base || !url) return result;
  try {
    options.signal?.throwIfAborted();
    await assertSafeProviderEndpoint(url.href);
    const text = await readCatalogLoaderText(url.href, { ...options,
      fetch: (endpoint, init) => options.fetch(endpoint, { ...init, credentials: "omit", headers: {} }),
    }, 1024 * 1024);
    result.discoveredEntries = linkedJsonEntries(text, url);
    if (!text.trim()) return { ...result, status: "empty" };
    const schemas = literalSchemas(text);
    result.schemaCount = schemas.length;
    if (!schemas.length) return { ...result, status: result.discoveredEntries.length ? "complete" : "invalid",
      complete: result.discoveredEntries.length > 0 };
    // The legacy compiler has an explicit path budget; do not present its
    // silent truncation as a complete source observation.
    if (schemas.some(value => Object.keys(record(record(value)?.paths) ?? {}).length > 1000))
      return { ...result, status: "failed", failure: { code: "incomplete_directory" } };
    for (const model of input.models) {
      const endpointTypes = Array.isArray(model.metadata?.endpointTypes)
        ? model.metadata.endpointTypes.filter((value): value is string => typeof value === "string" && value.length <= 256) : undefined;
      // A contract observation carries the new compiled fields, never an
      // unrelated price cache, prior metadata, or credentials from the input.
      const candidate: ModelDescriptor = { id: model.id, name: model.id, operations: model.operations,
        ...(endpointTypes?.length ? { metadata: { endpointTypes } } : {}) };
      const compiled = schemas.flatMap(document => {
        const read = compileDocumentedInterface(document, candidate, base.href, url.href);
        return read ? [read] : [];
      });
      const bindings = new Map(compiled.flatMap(value => value.binding ? [[JSON.stringify(value.binding), value.binding] as const] : []));
      if (bindings.size > 1) {
        result.issues.push({ modelId: model.id, code: "conflicting_contracts" });
        for (const binding of bindings.values()) for (const operation of binding.model.operations) try {
          const identity = catalogContractFromDocumented({ origin: base.origin, sourceId: "diagnostic", groupIdentity: "name:document", modelId: model.id, operation }, "rest", binding).identity;
          result.contractDiagnostics.push({ modelId: model.id, operation, method: identity.method, submitEndpoint: identity.submit,
            schemaFingerprint: identity.schemaFingerprint, code: "conflicting_contracts" });
        } catch { /* Unnormalized fields are not comparable fingerprints. */ }
      } else if (compiled.some(value => value.reason)) {
        result.issues.push({ modelId: model.id, code: "contract_incomplete" });
        result.contractDiagnostics.push(...declarationDiagnostics(schemas, candidate, base, "contract_incomplete"));
      }
      else if (bindings.size === 1) result.contracts.push([...bindings.values()][0]!);
      else result.contractDiagnostics.push(...declarationDiagnostics(schemas, candidate, base, "contract_incomplete").filter(value => value.method !== "POST"));
    }
    return { ...result, status: "complete", complete: true };
  } catch (error) {
    const failure = modelInventoryFailure(error);
    return { ...result, status: options.signal?.aborted ? "aborted" : "failed",
      failure: { code: failure.code, ...(failure.httpStatus ? { httpStatus: failure.httpStatus } : {}) } };
  }
}
