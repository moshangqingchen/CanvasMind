import { createHash } from "node:crypto";
import { compileDocumentedInterface, type DocumentedModelInterface, type ModelDescriptor, type ModelParameterDescriptor } from "@super-canvas/providers";
import { catalogContractEndpoint, catalogContractFromDocumented, catalogContractParameterFingerprint } from "./catalog-contract-policy";
import type { CatalogContractDiagnostic } from "./catalog-read-contracts";

export interface CatalogNormalizedInterfaceDocument {
  schemaVersion: 1;
  sourceUrl: string;
  apiOrigin: string;
  coverage: { modelIds: string[]; endpointPaths: string[]; groupIdentities?: string[] };
  /** Whitelisted invocation declarations only; no prose, examples, credentials or HTTP body. */
  declaration: Record<string, unknown>;
}
export interface CatalogCompiledInterfaceDocuments {
  contracts: DocumentedModelInterface[];
  issues: { modelId: string; code: "contract_incomplete" | "conflicting_contracts" }[];
  contractDiagnostics: CatalogContractDiagnostic[];
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



const safeField = /^[a-zA-Z_][a-zA-Z0-9_]*$/u;
const requestFields = new Set(["model", "prompt", "size", "quality", "n", "resolution", "aspect_ratio", "duration", "seconds", "seed", "response_format", "output_format", "background"]);
const primitives = (value: unknown): value is string | number | boolean => typeof value === "boolean" || typeof value === "number" && Number.isFinite(value) || typeof value === "string" && value.length <= 2048;
function normalizedSchema(document: Record<string, unknown>, input: unknown, request = false, depth = 0): Record<string, unknown> {
  if (depth > 12) return { oneOf: [] };
  const raw = diagnosticSchema(document, input);
  if (!raw) return { oneOf: [] };
  const output: Record<string, unknown> = {};
  if (["string", "integer", "number", "boolean", "object", "array"].includes(String(raw.type))) output.type = raw.type;
  for (const key of ["minimum", "maximum", "minItems", "maxItems"]) if (typeof raw[key] === "number" && Number.isFinite(raw[key])) output[key] = raw[key];
  if (primitives(raw.default)) output.default = raw.default;
  if (Array.isArray(raw.enum)) {
    if (raw.enum.length > 10000 || !raw.enum.every(primitives)) return { oneOf: [] };
    output.enum = raw.enum;
  }
  if (raw.items) output.items = normalizedSchema(document, raw.items, false, depth + 1);
  const properties = record(raw.properties);
  if (raw.required !== undefined && (!Array.isArray(raw.required) || !raw.required.every(value => typeof value === "string"))) return { oneOf: [] };
  const required = Array.isArray(raw.required) ? raw.required.filter((value): value is string => typeof value === "string") : [];
  if (properties) {
    if (Object.keys(properties).length > 100) return { oneOf: [] };
    const fields = Object.entries(properties).filter(([key]) => safeField.test(key) && !["__proto__", "constructor", "prototype"].includes(key) && (!request || requestFields.has(key)));
    output.properties = Object.fromEntries(fields.map(([key, value]) => [key, normalizedSchema(document, value, false, depth + 1)]));
    const unknownRequired = required.some(key => !fields.some(([field]) => field === key));
    if (unknownRequired) (output.properties as Record<string, unknown>)._catalog_unmapped_required = { type: "string" };
    if (required.length) output.required = [...required.filter(key => fields.some(([field]) => field === key)), ...(unknownRequired ? ["_catalog_unmapped_required"] : [])];
  }
  return output;
}
function groupCoverage(raw: Record<string, unknown>): string[] | undefined {
  const identities = raw["x-group-identities"] ?? (raw["x-group-identity"] !== undefined ? [raw["x-group-identity"]] : undefined);
  if (Array.isArray(identities)) return identities.filter((value): value is string => typeof value === "string" && /^(?:site-id|name):[^\s]{1,128}$/u.test(value));
  const ids = raw["x-group-ids"] ?? (raw["x-group-id"] !== undefined ? [raw["x-group-id"]] : undefined);
  if (Array.isArray(ids)) return ids.filter((value): value is string | number => typeof value === "string" || typeof value === "number")
    .map(value => "site-id:" + value).filter(value => value.length <= 136);
  if (Object.keys(raw).some(key => /^x-.*group(?:s|-id|-ids|-identity|-identities)?$/u.test(key))) return [];
  return undefined;
}
const groupsAllow = (groups: string[] | undefined, group?: string) => !groups || !!group && groups.includes(group);
function normalizedSecurity(value: unknown): Record<string, string[]>[] | undefined {
  if (!Array.isArray(value) || value.length > 16) return undefined;
  return value.map(requirement => Object.fromEntries(Object.keys(record(requirement) ?? {}).filter(key => safeField.test(key)).map(key => [key, []])));
}
function servers(value: unknown): { url: string }[] | undefined {
  return Array.isArray(value) && value.length >= 1 && typeof record(value[0])?.url === "string" ? [{ url: record(value[0])!.url as string }] : undefined;
}
/** A bounded semantic projection, never a saved raw schema or a compiled group-A connector. */
export function normalizeCatalogInterfaceDocument(value: unknown, baseUrl: string, sourceUrl: string): CatalogNormalizedInterfaceDocument | undefined {
  const raw = record(value); if (!raw || !record(raw.paths)) return undefined;
  const paths = Object.entries(record(raw.paths)!); if (paths.length > 1000) return undefined;
  const root: Record<string, unknown> = { openapi: "3.0.0", paths: {} };
  if (raw.swagger === "2.0") {
    root.swagger = "2.0"; delete root.openapi;
    for (const key of ["host", "basePath"]) if (typeof raw[key] === "string") root[key] = raw[key];
  }
  const security = normalizedSecurity(raw.security); if (security) root.security = security;
  const rootServers = servers(raw.servers); if (rootServers) root.servers = rootServers;
  const schemes = record(record(raw.components)?.securitySchemes ?? raw.securityDefinitions) ?? {};
  root.components = { securitySchemes: Object.fromEntries(Object.entries(schemes).flatMap(([name, value]) => {
    if (!safeField.test(name)) return [];
    const scheme = diagnosticSchema(raw, value);
    if (scheme?.type === "http" && String(scheme.scheme).toLowerCase() === "bearer") return [[name, { type: "http", scheme: "bearer" }]];
    if (scheme?.type === "apiKey" && scheme.in === "header" && typeof scheme.name === "string" && /^[a-zA-Z0-9-]{1,128}$/u.test(scheme.name))
      return [[name, { type: "apiKey", in: "header", name: scheme.name }]];
    return [[name, { type: "unsupported" }]];
  })) };
  if (raw.swagger === "2.0") root.securityDefinitions = record(root.components)?.securitySchemes;
  const allModels = new Set<string>(), allPaths: string[] = [];
  for (const [path, value] of paths) {
    if (!path.startsWith("/") || path.length > 512) continue;
    const item = record(value); if (!item) continue;
    const normalizedItem: Record<string, unknown> = {};
    const itemServers = servers(item.servers); if (itemServers) normalizedItem.servers = itemServers;
    const itemGroups = groupCoverage(item); if (itemGroups) normalizedItem["x-catalog-group-identities"] = itemGroups;
    for (const method of ["get", "post", "put", "patch"]) {
      const operation = record(item[method]); if (!operation) continue;
      const output: Record<string, unknown> = {};
      if (typeof operation.operationId === "string" && operation.operationId.length <= 256) output.operationId = operation.operationId;
      const operationSecurity = normalizedSecurity(operation.security); if (operationSecurity) output.security = operationSecurity;
      const operationServers = servers(operation.servers); if (operationServers) output.servers = operationServers;
      const operationGroups = groupCoverage(operation); if (operationGroups) output["x-catalog-group-identities"] = operationGroups;
      const body = diagnosticSchema(raw, operation.requestBody), content = record(body?.content), json = record(content?.["application/json"]);
      const swaggerBody = (Array.isArray(operation.parameters) ? operation.parameters : []).map(value => diagnosticSchema(raw, value)).find(value => value?.in === "body");
      if (json?.schema || swaggerBody?.schema) {
        const normalized = normalizedSchema(raw, json?.schema ?? swaggerBody?.schema, true);
        output.requestBody = { content: { "application/json": { schema: normalized } } };
        const model = record(record(normalized.properties)?.model);
        for (const id of Array.isArray(model?.enum) ? model.enum : []) if (typeof id === "string") allModels.add(id);
      }
      const named = operation["x-models"];
      if (Array.isArray(named) && named.length <= 10000 && named.every(value => typeof value === "string" && value.length <= 512)) {
        output["x-models"] = named; named.forEach(value => allModels.add(value));
      }
      const parameters = [...(Array.isArray(item.parameters) ? item.parameters : []), ...(Array.isArray(operation.parameters) ? operation.parameters : [])]
        .map(value => diagnosticSchema(raw, value)).filter(value => value && value.in !== "body");
      if (parameters.length) output.parameters = parameters.slice(0, 100).map(value => ({ in: value!.in, name: value!.name, required: value!.required === true }));
      const responses: Record<string, unknown> = {};
      for (const status of ["200", "201", "202"]) {
        const response = diagnosticSchema(raw, record(operation.responses)?.[status]); if (!response) continue;
        const responseJson = record(record(response.content)?.["application/json"]);
        const links = Object.fromEntries(Object.entries(record(response.links) ?? {}).slice(0, 32).flatMap(([name, value]) => {
          const link = diagnosticSchema(raw, value); if (typeof link?.operationId !== "string") return [];
          const parameters = Object.fromEntries(Object.entries(record(link.parameters) ?? {}).filter(([key, value]) => safeField.test(key) &&
            typeof value === "string" && /^\$response\.body#\/[a-zA-Z0-9_/]+$/u.test(value)));
          return [[name, { operationId: link.operationId, parameters }]];
        }));
        responses[status] = { content: { "application/json": { schema: normalizedSchema(raw, responseJson?.schema ?? response.schema) } }, ...(Object.keys(links).length ? { links } : {}) };
      }
      output.responses = responses; normalizedItem[method] = output;
    }
    (root.paths as Record<string, unknown>)[path] = normalizedItem; allPaths.push(path);
  }
  const groups = groupCoverage(raw);
  const normalized: CatalogNormalizedInterfaceDocument = { schemaVersion: 1, sourceUrl, apiOrigin: new URL(baseUrl).origin,
    coverage: { modelIds: [...allModels], endpointPaths: allPaths, ...(groups ? { groupIdentities: groups } : {}) }, declaration: root };
  return Buffer.byteLength(JSON.stringify(normalized), "utf8") <= 512 * 1024 ? normalized : undefined;
}
function documentForTarget(document: CatalogNormalizedInterfaceDocument, model: ModelDescriptor, group?: string): Record<string, unknown> {
  const root = structuredClone(document.declaration), paths: Record<string, unknown> = {};
  for (const [path, value] of Object.entries(record(root.paths) ?? {})) {
    const item = record(value); if (!item || !groupsAllow(item["x-catalog-group-identities"] as string[] | undefined, group)) continue;
    const selected = { ...item };
    for (const method of ["get", "post", "put", "patch"]) {
      const operation = record(selected[method]); if (!operation) continue;
      if (!groupsAllow(operation["x-catalog-group-identities"] as string[] | undefined, group)) { delete selected[method]; continue; }
      const request = record(record(record(record(operation.requestBody)?.content)?.["application/json"])?.schema);
      const modelField = record(record(request?.properties)?.model);
      if (Array.isArray(modelField?.enum) && modelField.enum.includes(model.id)) modelField.enum = [model.id];
      if (Array.isArray(operation["x-models"]) && (operation["x-models"] as unknown[]).includes(model.id)) operation["x-models"] = [model.id];
    }
    paths[path] = selected;
  }
  return { ...root, paths };
}

const COMPILATION_CACHE_MAX_ENTRIES = 4096;
const COMPILATION_CACHE_MAX_BYTES = 8 * 1024 * 1024;
const compilationCache = new Map<string, { value: CatalogCompiledInterfaceDocuments; bytes: number }>();
let compilationCacheBytes = 0, compilationCacheHits = 0;
/** Diagnostic counts only; the cache never exposes declarations or target data. */
export function catalogInterfaceCompilationCacheStats() { return { entries: compilationCache.size, bytes: compilationCacheBytes, hits: compilationCacheHits }; }
export function clearCatalogInterfaceCompilationCache() { compilationCache.clear(); compilationCacheBytes = 0; compilationCacheHits = 0; }
function memoizedCompilation(key: string, build: () => CatalogCompiledInterfaceDocuments): CatalogCompiledInterfaceDocuments {
  const cached = compilationCache.get(key);
  if (cached) { compilationCache.delete(key); compilationCache.set(key, cached); compilationCacheHits++; return structuredClone(cached.value); }
  const value = build(), bytes = Buffer.byteLength(JSON.stringify(value), "utf8") + key.length * 2;
  if (bytes <= COMPILATION_CACHE_MAX_BYTES) {
    while (compilationCache.size && (compilationCache.size >= COMPILATION_CACHE_MAX_ENTRIES || compilationCacheBytes + bytes > COMPILATION_CACHE_MAX_BYTES)) {
      const oldest = compilationCache.keys().next().value!;
      compilationCacheBytes -= compilationCache.get(oldest)!.bytes; compilationCache.delete(oldest);
    }
    compilationCache.set(key, { value: structuredClone(value), bytes }); compilationCacheBytes += bytes;
  }
  return value;
}

/** Recompile a shared anonymous document for this exact target. No I/O or old connector is reachable. */
export function compileCatalogInterfaceDocuments(documents: readonly CatalogNormalizedInterfaceDocument[], models: readonly ModelDescriptor[],
  target: { baseUrl: string; groupIdentity?: string }): CatalogCompiledInterfaceDocuments {
  const base = new URL(target.baseUrl);
  const applicable = documents.filter(document => document.schemaVersion === 1 && document.apiOrigin === base.origin &&
    (!document.coverage.groupIdentities || !!target.groupIdentity && document.coverage.groupIdentities.includes(target.groupIdentity)));
  const semantic = JSON.stringify(applicable);
  const documentKey = createHash("sha256").update(semantic).digest("hex");
  const groupKey = applicable.some(document => document.coverage.groupIdentities || JSON.stringify(document.declaration).includes('"x-catalog-group-identities"')) ? target.groupIdentity : "*";
  const result: CatalogCompiledInterfaceDocuments = { contracts: [], issues: [], contractDiagnostics: [] };
  for (const model of models) {
    const key = createHash("sha256").update(JSON.stringify([documentKey, base.href, groupKey, model.id, model.operations, model.metadata?.endpointTypes])).digest("hex");
    const compiledModel = memoizedCompilation(key, () => {
      const result: CatalogCompiledInterfaceDocuments = { contracts: [], issues: [], contractDiagnostics: [] };
      const endpointTypes = Array.isArray(model.metadata?.endpointTypes)
        ? model.metadata.endpointTypes.filter((value): value is string => typeof value === "string" && value.length <= 256) : undefined;
      // A contract observation carries the new compiled fields, never an
      // unrelated price cache, prior metadata, or credentials from the input.
      const candidate: ModelDescriptor = { id: model.id, name: model.id, operations: model.operations,
        ...(endpointTypes?.length ? { metadata: { endpointTypes } } : {}) };
      const scoped = applicable.filter(document => document.coverage.modelIds.includes(model.id) || endpointTypes?.some(path => document.coverage.endpointPaths.includes(path)))
        .map(document => ({ schema: documentForTarget(document, candidate, target.groupIdentity), sourceUrl: document.sourceUrl }));
      const schemas = scoped.map(value => value.schema);
      const compiled = scoped.flatMap(({ schema, sourceUrl }) => {
        const read = compileDocumentedInterface(schema, candidate, base.href, sourceUrl);
        return read ? [read] : [];
      });
      const bindings = new Map(compiled.flatMap(value => {
        if (!value.binding) return [];
        const binding = value.binding;
        try {
          const key = binding.model.operations.map(operation => catalogContractFromDocumented({ origin: base.origin,
            sourceId: "normalized-document", groupIdentity: target.groupIdentity ?? "name:document", modelId: model.id, operation }, "rest", binding).identity.schemaFingerprint).join(":");
          return [[key, binding] as const];
        } catch { return [[JSON.stringify(binding), binding] as const]; }
      }));
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
      return result;
    });
    result.contracts.push(...compiledModel.contracts); result.issues.push(...compiledModel.issues); result.contractDiagnostics.push(...compiledModel.contractDiagnostics);
  }

  return result;
}
