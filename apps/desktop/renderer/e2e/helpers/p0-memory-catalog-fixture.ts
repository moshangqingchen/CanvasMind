import { createHash } from "node:crypto";
import { appendFile, readFile, realpath } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import type { Route } from "@playwright/test";
import type { CanvasDocument } from "../../components/types";
import type { ProviderConnectionView } from "../../lib/client-api";
import type { SupplierRecord } from "../../lib/client-suppliers";

export type MemoryCatalogArm = "simple" | "real-sanitized";
type SourceMode = "sanitized-public-catalog" | "synthetic-shape-only";
type JsonRecord = Record<string, unknown>;
export type MemoryCanvasBinding = {
  nodeId: string;
  connectionId?: string;
  generatedConnectionId?: string;
  model?: string;
  generatedModel?: string;
};
export type MemoryCatalogSettingsTarget = {
  supplierId: string; supplierName: string; supplierModels: number; groupId: string; groupModels: number; searchModelId: string;
};
type SafeCatalog = {
  connections: ProviderConnectionView[];
  suppliers: SupplierRecord[];
  originalProviderByConnectionId?: Record<string, string>;
  canvasBindings?: MemoryCanvasBinding[];
  verificationSummaries?: Record<string, { revision: number }>;
};
type FixtureProof = {
  sourceMode: SourceMode;
  sourceUnchanged: boolean;
  source: { sha256: string; connections: number; suppliers: number };
  sourceAfterSha256: string;
  outputSha256: string;
  outputBytes: number;
  scan: Record<string, number> | null;
  outputScan?: Record<string, number> | null;
  scanTarget?: string;
  limitations?: string[];
};
type Category = "providers" | "models" | "suppliers" | "supplierDetail" | "verificationSummary" | "verificationFull" | "unknownCatalog";
type PreparedBody = { body: string; bytes: number; sha256: string; status: number; headers: Record<string, string> };
type CategoryCounters = { count: number; totalBytes: number; maxBytes: number; firstAt: string; lastAt: string };

const record = (value: unknown): JsonRecord => value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : {};
const digest = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
const normalizeField = (value: string) => value.replace(/[^a-z0-9]/gi, "").toLowerCase();
const credentialFields = new Set(["key", "keys", "token", "tokens", "secret", "secrets", "cipher", "ciphertext", "auth", "authentication",
  "authorization", "headers", "requestheaders", "responseheaders", "cookie", "cookies", "session", "sessions", "sessionid", "credentials",
  "credential", "sitelogin", "login", "loginname", "username", "password", "passwd", "pwd", "account", "accountname", "accountemail", "email",
  "userid", "openid", "bearer", "privatekey", "clientsecret", "masterkey", "env", "environment", "command", "executable", "arguments", "args"]);
const credentialFlags = new Set(["apikeyset", "apikeyusable", "keyconfigured", "tokenconfigured", "hasapikey", "hascredentials", "verificationscheduled"]);
const providerNames = new Set(["openai", "weai", "runway", "rest", "fake", "cli"]);
const generationTypes = new Set(["image-generation", "video-generation", "audio-generation", "music-generation", "text-generation"]);

export function readMemoryCatalogArm(value = process.env.P0_MEMORY_CATALOG): MemoryCatalogArm {
  if (value === undefined || value === "" || value === "simple") return "simple";
  if (value === "real-sanitized") return value;
  throw new Error("P0_MEMORY_CATALOG must be simple or real-sanitized");
}

/** Defence in depth after the prepared fixture's provenance/hash validation. */
export function assertSafeMemoryCatalog(value: unknown): asserts value is SafeCatalog {
  const root = record(value);
  if (!Array.isArray(root.connections) || !Array.isArray(root.suppliers)) throw new Error("Invalid safe catalog tables");
  const checkString = (text: string) => {
    const urls = text.matchAll(/\b[a-z][a-z0-9+.-]*:\/\/[^\s"'<>`\\)\]]+/gi);
    for (const match of urls) {
      let host: string;
      try { host = new URL(match[0]).hostname; } catch { throw new Error("Invalid URI in prepared safe catalog"); }
      if (host !== "p0-catalog.invalid") throw new Error("Prepared catalog contains a non-neutralized URI");
    }
    if (/\b(?:sk|rk|sess|key|token)-[A-Za-z0-9_-]{8,}|\b(?:Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}|\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}|-----BEGIN [^-]*PRIVATE KEY-----/iu.test(text))
      throw new Error("Prepared catalog contains a credential-shaped string");
  };
  const walk = (item: unknown) => {
    if (typeof item === "string") { checkString(item); return; }
    if (Array.isArray(item)) { for (const child of item) walk(child); return; }
    if (!item || typeof item !== "object") return;
    const parent = item as JsonRecord;
    for (const [field, child] of Object.entries(parent)) {
      checkString(field);
      const name = normalizeField(field);
      const parameterKey = name === "key" && typeof child === "string" && /^[a-z][a-z0-9_.-]{0,63}$/i.test(child) &&
        ("control" in parent || "valueType" in parent || "options" in parent || "required" in parent && "type" in parent);
      const blankApiKey = name === "apikey" && child === "";
      if (credentialFlags.has(name)) {
        if (child !== false) throw new Error("Prepared catalog credential flag must be false");
      } else if (name !== "supplierkey" && !parameterKey && !blankApiKey &&
          (credentialFields.has(name) || /(?:apikey|apitoken|authtoken|accesstoken|refreshtoken|idtoken|encrypted|ciphertext|secret|password|passwd|credential|authorization|sessionid|cookie|login)/.test(name)))
        throw new Error("Prepared catalog contains a credential field");
      walk(child);
    }
  };
  walk(root);
  const connectionIds = new Set<string>();
  for (const raw of root.connections) {
    const connection = record(raw);
    if (typeof connection.id !== "string" || !connection.id || connectionIds.has(connection.id) || !connection.config || typeof connection.config !== "object")
      throw new Error("Invalid or duplicate prepared connection identity");
    if (connection.provider !== "fake" || connection.apiKey !== "" || connection.apiKeySet !== false || connection.apiKeyUsable !== false)
      throw new Error("Prepared catalog connections must be credential-free Fake");
    connectionIds.add(connection.id);
  }
  const supplierIds = new Set<string>();
  for (const raw of root.suppliers) {
    const supplier = record(raw);
    if (typeof supplier.id !== "string" || !supplier.id || supplierIds.has(supplier.id) || !Array.isArray(record(supplier.catalog).groups))
      throw new Error("Invalid or duplicate prepared supplier identity");
    supplierIds.add(supplier.id);
  }
  for (const [id, provider] of Object.entries(record(root.originalProviderByConnectionId)))
    if (!connectionIds.has(id) || typeof provider !== "string" || !providerNames.has(provider)) throw new Error("Invalid original provider display metadata");
  if (root.canvasBindings !== undefined) {
    if (!Array.isArray(root.canvasBindings)) throw new Error("Invalid prepared canvas bindings");
    const nodeIds = new Set<string>();
    for (const raw of root.canvasBindings) {
      const binding = record(raw);
      if (typeof binding.nodeId !== "string" || !binding.nodeId || nodeIds.has(binding.nodeId)) throw new Error("Invalid prepared canvas node binding");
      nodeIds.add(binding.nodeId);
      for (const field of ["connectionId", "generatedConnectionId"])
        if (binding[field] !== undefined && (typeof binding[field] !== "string" || !connectionIds.has(binding[field] as string)))
          throw new Error("Prepared canvas binding references an absent safe connection");
      for (const field of ["model", "generatedModel"])
        if (binding[field] !== undefined && typeof binding[field] !== "string") throw new Error("Invalid prepared model binding");
    }
  }
}

function jsonBody(value: unknown, status = 200, headers: Record<string, string> = {}): PreparedBody {
  const body = JSON.stringify(value);
  return { body, bytes: Buffer.byteLength(body), sha256: digest(body), status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...headers } };
}

function modelScanHeaders(config: JsonRecord) {
  const headers: Record<string, string> = {};
  for (const [field, header] of [["modelScanStatus", "X-Model-Scan-Status"], ["modelScanCheckedAt", "X-Model-Scan-Checked-At"],
    ["modelScanLastSuccessAt", "X-Model-Scan-Last-Success-At"], ["modelScanSource", "X-Model-Scan-Source"]]) {
    const value = config[field];
    // Do not accept line breaks in any prepared response header.
    if (typeof value === "string" && value && /^[\x20-\x7e]+$/.test(value)) headers[header] = value;
  }
  if (typeof config.modelScanComplete === "boolean") headers["X-Model-Scan-Complete"] = String(config.modelScanComplete);
  return headers;
}

/** Standalone pure preparation, useful for fixture tests without a browser. */
export function prepareMemoryCatalogResponses(catalog: SafeCatalog) {
  assertSafeMemoryCatalog(catalog);
  const providers = jsonBody(catalog.connections);
  const suppliers = jsonBody(catalog.suppliers);
  const models = new Map(catalog.connections.map((connection, index) => [connection.id, {
    index, body: jsonBody(Array.isArray(connection.config.modelCatalogModels) ? connection.config.modelCatalogModels : [], 200, modelScanHeaders(connection.config)),
    source: Array.isArray(connection.config.modelCatalogModels) ? "connection.config.modelCatalogModels" : "absent; empty fixture inventory",
    count: Array.isArray(connection.config.modelCatalogModels) ? connection.config.modelCatalogModels.length : 0,
  }]));
  const details = new Map(catalog.suppliers.map((supplier, index) => {
    const savedRevision = catalog.verificationSummaries?.[supplier.id]?.revision;
    const revision = Number.isSafeInteger(savedRevision) && (savedRevision ?? -1) >= 0 ? savedRevision! : 0;
    return [supplier.id, { index, body: jsonBody(supplier), summary: jsonBody({ revision }),
      summarySource: savedRevision === undefined ? "mock fixed revision 0; ledger not copied" : "prepared fixed revision" }];
  }));
  return { providers, suppliers, models, details, fullVerification: jsonBody(null), unknown: jsonBody({ error: "Unknown isolated catalog route" }, 404) };
}

/** Deterministic display-only target; no supplier refresh or mutation is needed. */
export function memoryCatalogSettingsTarget(catalog: SafeCatalog): MemoryCatalogSettingsTarget | null {
  let target: MemoryCatalogSettingsTarget | null = null;
  for (const supplier of catalog.suppliers) {
    if (supplier.state?.visibility === "hidden" || supplier.state?.visibility === "deleted") continue;
    const groups = supplier.catalog.groups;
    const largest = groups.reduce<typeof groups[number] | undefined>((best, group) =>
      !best || group.models.length > best.models.length ? group : best, undefined);
    if (!largest?.models.length) continue;
    const supplierModels = groups.reduce((total, group) => total + group.models.length, 0);
    if (!target || supplierModels > target.supplierModels) target = {
      supplierId: supplier.id, supplierName: supplier.name, supplierModels, groupId: largest.id,
      groupModels: largest.models.length, searchModelId: largest.models[0].id,
    };
  }
  return target;
}

/** Read only the prepared evidence copy; never a formal profile path. */
export async function loadMemoryCatalogFixture(output: string) {
  if (readMemoryCatalogArm() === "simple") return undefined;
  const configured = process.env.P0_MEMORY_CATALOG_FIXTURE_DIR;
  if (!configured) throw new Error("Real-sanitized catalog arm requires P0_MEMORY_CATALOG_FIXTURE_DIR");
  const evidence = await realpath(process.env.P0_MEMORY_EVIDENCE_ROOT ?? dirname(output));
  const root = await realpath(configured);
  if (!root.toLowerCase().startsWith(`${evidence.toLowerCase()}${sep}`)) throw new Error("Prepared catalog must be below the evidence directory");
  const pathInFixture = async (name: string) => {
    const path = await realpath(resolve(root, name));
    if (!path.toLowerCase().startsWith(`${root.toLowerCase()}${sep}`)) throw new Error("Prepared catalog file escapes its evidence directory");
    return path;
  };
  const owner = record(JSON.parse(await readFile(await pathInFixture(".p0-owned-fixture.json"), "utf8")));
  if (owner.owner !== "codex-phase3-p0-memory" || owner.kind !== "sanitized-renderer-catalog") throw new Error("Prepared catalog ownership marker is invalid");
  const proof = JSON.parse(await readFile(await pathInFixture("credential-scan-report.json"), "utf8")) as FixtureProof;
  if (!["sanitized-public-catalog", "synthetic-shape-only"].includes(proof.sourceMode) || proof.sourceUnchanged !== true ||
      !proof.source?.sha256 || proof.sourceAfterSha256 !== proof.source.sha256) throw new Error("Prepared catalog source integrity proof is invalid");
  const finalScan = proof.outputScan ?? (proof.sourceMode === "sanitized-public-catalog" || proof.scanTarget === "final-output" ? proof.scan : null);
  if (!finalScan || !Object.keys(finalScan).length || Object.values(finalScan).some(value => typeof value !== "number" || value !== 0))
    throw new Error("Prepared catalog has no passing final credential scan");
  const bytes = await readFile(await pathInFixture("catalog.safe.json"));
  if (bytes.length !== proof.outputBytes || digest(bytes) !== proof.outputSha256) throw new Error("Prepared catalog SHA/byte proof mismatch");
  const catalog: unknown = JSON.parse(bytes.toString("utf8"));
  assertSafeMemoryCatalog(catalog);
  if (catalog.connections.length !== proof.source.connections || catalog.suppliers.length !== proof.source.suppliers)
    throw new Error("Prepared catalog scale differs from its reported source counts");
  return createMemoryCatalogResponder(catalog, output, { sourceMode: proof.sourceMode, outputBytes: proof.outputBytes,
    outputSha256: proof.outputSha256, finalScan, limitations: proof.limitations ?? [] });
}

export function createMemoryCatalogResponder(catalog: SafeCatalog, output: string, provenance: JsonRecord = {}) {
  const bodies = prepareMemoryCatalogResponses(catalog);
  const settingsTarget = memoryCatalogSettingsTarget(catalog);
  const started = Date.now();
  const counters: Record<Category, CategoryCounters> = Object.fromEntries(
    ["providers", "models", "suppliers", "supplierDetail", "verificationSummary", "verificationFull", "unknownCatalog"].map(category =>
      [category, { count: 0, totalBytes: 0, maxBytes: 0, firstAt: "", lastAt: "" }]),
  ) as Record<Category, CategoryCounters>;
  const connectionReads = catalog.connections.map(() => 0);
  const supplierReads = catalog.suppliers.map(() => 0);
  let sequence = 0;
  let failed = 0;
  let writes = Promise.resolve();
  const bodyManifest = (body: PreparedBody) => ({ bytes: body.bytes, sha256: body.sha256 });
  return {
    settingsTarget,
    manifest: { ...provenance, arm: "real-sanitized", connections: catalog.connections.length, suppliers: catalog.suppliers.length,
      executableProviders: "Fake only", credentials: 0, externalUrls: "only non-routable p0-catalog.invalid placeholders; page/server guards still mandatory",
      bindings: catalog.canvasBindings?.length ?? 0, fullVerification: "not copied; null response", providers: bodyManifest(bodies.providers), suppliersBody: bodyManifest(bodies.suppliers),
      settingsTarget,
      models: [...bodies.models.values()].map(item => ({ connectionIndex: item.index, models: item.count, source: item.source, ...bodyManifest(item.body) })),
      summaries: [...bodies.details.values()].map(item => ({ supplierIndex: item.index, source: item.summarySource, ...bodyManifest(item.summary) })) },
    snapshot: () => ({ categories: Object.fromEntries(Object.entries(counters).map(([key, value]) => [key, { ...value }])),
      connectionReads: [...connectionReads], supplierReads: [...supplierReads], requests: sequence, failed }),
    /** Apply only signed, safe identity fields; media IDs/geometry/data stay intact. */
    bindGraph(graph: CanvasDocument) {
      const bindings = new Map(catalog.canvasBindings?.map(binding => [binding.nodeId, binding]));
      if (!bindings.size) throw new Error("Full catalog arm requires prepared canvas identity bindings");
      const graphIds = new Set(graph.nodes.map(node => node.id));
      for (const id of bindings.keys()) if (!graphIds.has(id)) throw new Error("Prepared catalog binding references another canvas");
      let restored = 0;
      for (const node of graph.nodes) {
        const binding = bindings.get(node.id);
        if (generationTypes.has(node.data.nodeType ?? "") && !binding?.connectionId) throw new Error("Generation node lacks a prepared safe connection binding");
        if (!binding) continue;
        for (const field of ["connectionId", "generatedConnectionId", "model", "generatedModel"] as const)
          if (binding[field] !== undefined) node.data[field] = binding[field];
        if (generationTypes.has(node.data.nodeType ?? "")) node.data.provider = "fake";
        restored++;
      }
      return { restored, source: provenance.sourceMode ?? "unlabelled", execution: "Every generation node stays Fake; prepared model identity is display metadata only" };
    },
    /** Call after the one shared external/mutation guard; never add a second page.route. */
    async handle(route: Route) {
      const request = route.request();
      const url = new URL(request.url());
      const path = url.pathname;
      if (!(path === "/api/providers" || path.startsWith("/api/providers/") || path === "/api/suppliers" || path.startsWith("/api/suppliers/"))) return false;
      if (!["GET", "HEAD"].includes(request.method())) throw new Error("Catalog responder must run after the shared mutation guard");
      let category: Category = "unknownCatalog";
      let body = bodies.unknown;
      let connectionIndex: number | undefined;
      let supplierIndex: number | undefined;
      if (path === "/api/providers") { category = "providers"; body = bodies.providers; }
      else if (path === "/api/suppliers") { category = "suppliers"; body = bodies.suppliers; }
      else {
        const modelMatch = path.match(/^\/api\/providers\/([^/]+)\/models$/);
        const supplierMatch = path.match(/^\/api\/suppliers\/([^/]+)(\/verification)?$/);
        if (modelMatch) {
          let id = ""; try { id = decodeURIComponent(modelMatch[1]); } catch { /* Remain a local unknown 404. */ }
          const found = bodies.models.get(id);
          if (found) { category = "models"; body = found.body; connectionIndex = found.index; }
        } else if (supplierMatch) {
          let id = ""; try { id = decodeURIComponent(supplierMatch[1]); } catch { /* Remain a local unknown 404. */ }
          const found = bodies.details.get(id);
          if (found) {
            supplierIndex = found.index;
            if (!supplierMatch[2]) { category = "supplierDetail"; body = found.body; }
            else if (url.searchParams.get("summary") === "1") { category = "verificationSummary"; body = found.summary; }
            else { category = "verificationFull"; body = bodies.fullVerification; }
          }
        }
      }
      const index = sequence++;
      const at = Date.now(); const timestamp = new Date(at).toISOString();
      const responseBytes = request.method() === "HEAD" ? 0 : body.bytes;
      let success = false;
      try {
        await route.fulfill({ status: body.status, body: request.method() === "HEAD" ? "" : body.body, headers: body.headers });
        const count = counters[category]; count.count++; count.totalBytes += responseBytes; count.maxBytes = Math.max(count.maxBytes, responseBytes);
        if (!count.firstAt) count.firstAt = timestamp;
        count.lastAt = timestamp;
        if (connectionIndex !== undefined) connectionReads[connectionIndex]++;
        if (supplierIndex !== undefined) supplierReads[supplierIndex]++;
        success = true;
      } catch (error) { failed++; throw error; }
      finally {
        const line = `${JSON.stringify({ sequence: index, timestamp, elapsedMs: at - started, category, connectionIndex, supplierIndex,
          status: body.status, success, requestRefreshFlag: url.searchParams.get("refresh") === "1", requestCachedFlag: url.searchParams.get("cached") === "1",
          responseBytes: success ? responseBytes : 0, bodySha256: body.sha256, fulfillmentDurationMs: Date.now() - at })}\n`;
        writes = writes.then(() => appendFile(join(output, "catalog-responses.jsonl"), line));
        await writes;
      }
      return true;
    },
    async flush() { await writes; },
  };
}
