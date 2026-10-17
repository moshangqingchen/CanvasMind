import { isIP } from "node:net";
import { assertSafeProviderEndpoint, compileDocumentedInterface, type DocumentedModelInterface, type ModelDescriptor } from "@super-canvas/providers";
import { readCatalogLoaderText, type CatalogLoaderReadOptions } from "./catalog-loader-http";
import { modelInventoryFailure, type ModelInventoryFailure } from "./model-inventory-failure";

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
  failure?: Pick<ModelInventoryFailure, "code" | "httpStatus">;
}

const record = (value: unknown): Record<string, unknown> | undefined =>
  value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;

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
    contracts: [], discoveredEntries: [], schemaCount: 0, issues: [] };
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
      if (bindings.size > 1) result.issues.push({ modelId: model.id, code: "conflicting_contracts" });
      else if (compiled.some(value => value.reason)) result.issues.push({ modelId: model.id, code: "contract_incomplete" });
      else if (bindings.size === 1) result.contracts.push([...bindings.values()][0]!);
    }
    return { ...result, status: "complete", complete: true };
  } catch (error) {
    const failure = modelInventoryFailure(error);
    return { ...result, status: options.signal?.aborted ? "aborted" : "failed",
      failure: { code: failure.code, ...(failure.httpStatus ? { httpStatus: failure.httpStatus } : {}) } };
  }
}
