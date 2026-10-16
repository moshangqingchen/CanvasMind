import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import ts from "../../node_modules/typescript/lib/typescript.js";

const source = await readFile(new URL("./p0-memory-catalog-fixture.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const { readMemoryCatalogArm, assertSafeMemoryCatalog, prepareMemoryCatalogResponses, createMemoryCatalogResponder, memoryCatalogSettingsTarget } =
  await import(`data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`);

function fixture() {
  return {
    connections: [{ id: "connection-0", name: "隔离连接", provider: "fake", apiKey: "", apiKeySet: false, apiKeyUsable: false,
      config: { supplierId: "supplier-0", supplierKey: "chentu", preset: "chentu", modelGroup: "group-0",
        modelScanStatus: "live", modelScanComplete: true, modelScanCheckedAt: "2000-01-01T00:00:00.000Z",
        modelCatalogModels: [{ id: "model-0", name: "隔离型号", operations: ["image.generate"],
          parameters: [{ key: "width", control: "number", valueType: "number", min: 8, step: 8 }] }] } }],
    suppliers: [{ id: "supplier-0", supplierKey: "chentu", name: "隔离供应商", siteUrl: "https://p0-catalog.invalid", apiUrl: "https://p0-catalog.invalid/v1",
      kind: "openai-compatible", scanStatus: "live", createdAt: "2000-01-01T00:00:00.000Z", updatedAt: "2000-01-01T00:00:00.000Z",
      catalog: { groups: [{ id: "group-0", label: "隔离分组", models: [{ id: "model-0", name: "隔离型号", capability: "image" }] }] } }],
    originalProviderByConnectionId: { "connection-0": "openai" },
    canvasBindings: [{ nodeId: "node-generator", connectionId: "connection-0", model: "model-0" },
      { nodeId: "node-result", generatedConnectionId: "connection-0", generatedModel: "model-0" }],
  };
}

test("catalog memory arm is an explicit opt-in", () => {
  for (const value of ["", "simple"]) assert.equal(readMemoryCatalogArm(value), "simple");
  assert.equal(readMemoryCatalogArm("real-sanitized"), "real-sanitized");
  assert.throws(() => readMemoryCatalogArm("real"));
});

test("safe catalog rejects active providers, credentials and external destinations while retaining model parameter keys", () => {
  assert.doesNotThrow(() => assertSafeMemoryCatalog(fixture()));
  for (const mutate of [
    item => { item.connections[0].provider = "openai"; },
    item => { item.connections[0].apiKeySet = true; },
    item => { item.connections[0].config.password = "synthetic-secret"; },
    item => { item.connections[0].config.encryptedKey = "synthetic-secret"; },
    item => { item.connections[0].config.baseUrl = "https://example.com/v1"; },
    item => { item.connections[0].config.note = "Bearer synthetic-bearer-value"; },
    item => { item.canvasBindings[0].connectionId = "missing"; },
  ]) {
    const item = fixture(); mutate(item);
    assert.throws(() => assertSafeMemoryCatalog(item));
  }
});

test("catalog response preparation preserves UTF-8 byte counts, per-connection inventories and small fixed summaries", () => {
  const catalog = fixture(); const bodies = prepareMemoryCatalogResponses(catalog);
  assert.equal(bodies.providers.bytes, Buffer.byteLength(bodies.providers.body));
  assert.ok(bodies.providers.bytes > bodies.providers.body.length);
  assert.deepEqual(JSON.parse(bodies.models.get("connection-0").body.body), catalog.connections[0].config.modelCatalogModels);
  assert.equal(bodies.models.get("connection-0").body.headers["X-Model-Scan-Complete"], "true");
  assert.deepEqual(JSON.parse(bodies.details.get("supplier-0").summary.body), { revision: 0 });
  assert.equal(bodies.fullVerification.body, "null");
});

test("settings target deterministically chooses the largest visible supplier and group without hardcoded fixture names", () => {
  const catalog = fixture();
  catalog.suppliers.push({ ...structuredClone(catalog.suppliers[0]), id: "supplier-1", name: "更多型号",
    catalog: { groups: [{ id: "small-group", models: [{ id: "model-a" }] },
      { id: "largest-group", models: [{ id: "model-b" }, { id: "model-c" }] }] } });
  const target = memoryCatalogSettingsTarget(catalog);
  assert.deepEqual(target, { supplierId: "supplier-1", supplierName: "更多型号", supplierModels: 3,
    groupId: "largest-group", groupModels: 2, searchModelId: "model-b" });
  assert.deepEqual(createMemoryCatalogResponder(catalog, "unused-output").settingsTarget, target);
  catalog.suppliers[1].state = { visibility: "hidden" };
  assert.equal(memoryCatalogSettingsTarget(catalog).supplierId, "supplier-0");
  catalog.suppliers[0].catalog.groups = [];
  assert.equal(memoryCatalogSettingsTarget(catalog), null);
});

test("catalog responder locally fulfills every query variant, records scalar bytes and rejects unknown routes locally", async () => {
  const output = await mkdtemp(join(tmpdir(), "p0-catalog-helper-test-"));
  try {
    const responder = createMemoryCatalogResponder(fixture(), output, { sourceMode: "synthetic-shape-only" });
    const fulfill = async path => {
      let result;
      const route = { request: () => ({ url: () => `http://127.0.0.1:1234${path}`, method: () => "GET" }),
        fulfill: async response => { result = response; } };
      assert.equal(await responder.handle(route), true);
      return result;
    };
    const hashes = new Set();
    for (const query of ["?fresh=1", "?fresh=2&refresh=1", "?cached=1&clearUnavailable=1"]) {
      const response = await fulfill(`/api/providers/connection-0/models${query}`);
      assert.equal(response.status, 200); hashes.add(response.body);
    }
    assert.equal(hashes.size, 1);
    assert.equal((await fulfill("/api/providers/missing/models?refresh=1")).status, 404);
    assert.equal((await fulfill("/api/suppliers/supplier-0/verification?summary=1")).body, '{"revision":0}');
    assert.equal((await fulfill("/api/suppliers/supplier-0/verification")).body, "null");
    assert.equal((await fulfill("/api/suppliers/unknown/refresh")).status, 404);
    await responder.flush();
    const snapshot = responder.snapshot();
    assert.equal(snapshot.requests, 7); assert.equal(snapshot.failed, 0);
    assert.equal(snapshot.categories.models.count, 3); assert.equal(snapshot.categories.unknownCatalog.count, 2);
    assert.equal(snapshot.categories.models.totalBytes, 3 * Buffer.byteLength([...hashes][0]));
    assert.deepEqual(snapshot.connectionReads, [3]);
    const rows = (await readFile(join(output, "catalog-responses.jsonl"), "utf8")).trim().split("\n").map(row => JSON.parse(row));
    assert.equal(rows.length, 7);
    assert.equal(rows.filter(row => row.requestRefreshFlag).length, 2);
    assert.ok(rows.every(row => !("body" in row) && !("request" in row) && !("route" in row)));
  } finally {
    const root = resolve(output);
    assert.ok(root.startsWith(resolve(tmpdir())) && root.includes("p0-catalog-helper-test-"));
    await rm(root, { recursive: true, force: true });
  }
});

test("catalog graph bindings preserve positions, media and selection, while missing generator bindings fail", () => {
  const responder = createMemoryCatalogResponder(fixture(), "unused-test-output");
  const graph = { schemaVersion: 1, viewport: { x: 10, y: 20, zoom: 0.5 }, edges: [{ id: "edge-0", source: "node-generator", target: "node-result" }],
    nodes: [{ id: "node-generator", position: { x: 40, y: 80 }, selected: false, data: { nodeType: "image-generation", provider: "fake", connectionId: "old", model: "old" } },
      { id: "node-result", position: { x: 400, y: 80 }, selected: true, data: { nodeType: "asset-input", assetId: "original-media", generatedConnectionId: "old", generatedModel: "old" } }] };
  const geometry = JSON.stringify({ viewport: graph.viewport, edges: graph.edges, nodes: graph.nodes.map(({ position, selected }) => ({ position, selected })) });
  assert.equal(responder.bindGraph(graph).restored, 2);
  assert.equal(graph.nodes[0].data.provider, "fake");
  assert.equal(graph.nodes[0].data.connectionId, "connection-0");
  assert.equal(graph.nodes[1].data.assetId, "original-media");
  assert.equal(graph.nodes[1].data.generatedConnectionId, "connection-0");
  assert.equal(JSON.stringify({ viewport: graph.viewport, edges: graph.edges, nodes: graph.nodes.map(({ position, selected }) => ({ position, selected })) }), geometry);
  graph.nodes.push({ id: "unmapped-generator", data: { nodeType: "image-generation" } });
  assert.throws(() => responder.bindGraph(graph));
});
