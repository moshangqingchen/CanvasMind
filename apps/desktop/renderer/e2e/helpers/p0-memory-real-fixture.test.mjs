import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import test from "node:test";
import ts from "../../node_modules/typescript/lib/typescript.js";

const source = await readFile(new URL("./p0-memory-real-fixture.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const { loadRealMemoryFixture } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`);
const bytes = Buffer.from("unchanged local original bytes for fake HTTP regression");
const hash = createHash("sha256").update(bytes).digest("hex");

async function isolatedFixture(run) {
  const temporaryRoot = resolve(tmpdir());
  const root = await mkdtemp(join(temporaryRoot, "supercanvas-p0-fixture-unit-"));
  const old = process.env.P0_MEMORY_REAL_FIXTURE_DIR;
  process.env.P0_MEMORY_REAL_FIXTURE_DIR = root;
  const graph = { schemaVersion: 1, viewport: { x: -1595, y: 2005, zoom: 0.435 }, edges: [], nodes: [
    { id: "generator", type: "workflow", selected: false, position: { x: 48, y: 96 }, measured: { width: 360, height: 260 },
      data: { label: "Fake mapped", nodeType: "image-generation", provider: "old-provider", connectionId: "p0-isolated-fake-connection", model: "old-model", materializedOutputAssetIds: ["original-asset"] } },
    { id: "result", type: "workflow", selected: true, position: { x: 512, y: 96 }, data: { label: "Result", nodeType: "asset-input", generatedResult: true, assetId: "original-asset" } },
  ] };
  const manifest = { canvas: { id: "original-canvas", title: "Isolated", graphFile: "graph.safe.json" }, assets: [{ id: "original-asset", name: "isolated.png", mimeType: "image/png", kind: "image", size: bytes.length,
    relativePath: "original.png", sourceSHA256: hash, copySHA256: hash, metadata: { width: 4096, height: 4096, imageHasAlpha: true, imageHasTransparentPixels: true } }] };
  await writeFile(join(root, "graph.safe.json"), JSON.stringify(graph));
  await writeFile(join(root, "original.png"), bytes);
  await writeFile(join(root, "manifest.json"), JSON.stringify(manifest));
  const calls = [];
  const response = data => ({ ok: () => true, status: () => 200, json: async () => data, dispose: async () => calls.push("dispose") });
  const request = {
    post: async (path, options) => {
      calls.push(path); assert.deepEqual(options.multipart.file.buffer, bytes);
      return response({ id: "isolated-asset", kind: "image", metadata: { source: "upload" } });
    },
    get: async path => {
      calls.push(path);
      return { ...response(null), body: async () => bytes };
    },
  };
  try { await run({ root, graph, manifest, request, calls }); }
  finally {
    if (old === undefined) delete process.env.P0_MEMORY_REAL_FIXTURE_DIR; else process.env.P0_MEMORY_REAL_FIXTURE_DIR = old;
    assert.equal(dirname(root), temporaryRoot);
    assert.ok(basename(root).startsWith("supercanvas-p0-fixture-unit-"));
    await rm(root, { recursive: true, force: true });
  }
}

test("real fixture retains geometry, viewport, selection and alpha metadata while remapping every asset and execution identity", async () => {
  await isolatedFixture(async ({ graph, request, calls }) => {
    const result = await loadRealMemoryFixture(request, "isolated-fake-connection");
    assert.deepEqual(result.graph.viewport, graph.viewport);
    assert.deepEqual(result.graph.nodes.map(node => [node.position, node.measured, node.selected]), graph.nodes.map(node => [node.position, node.measured, node.selected]));
    assert.equal(result.graph.nodes[0].data.provider, "fake");
    assert.equal(result.graph.nodes[0].data.connectionId, "isolated-fake-connection");
    assert.equal(result.graph.nodes[0].data.model, "fake-image-v1");
    assert.deepEqual(result.graph.nodes[0].data.materializedOutputAssetIds, ["isolated-asset"]);
    assert.equal(result.graph.nodes[1].data.assetId, "isolated-asset");
    assert.equal(result.assets[0].metadata.imageHasAlpha, true);
    assert.equal(result.assets[0].metadata.width, 4096);
    assert.equal(result.evidence.originalBytesVerified, true);
    assert.deepEqual(calls, ["/api/assets/upload", "dispose", "/api/assets/isolated-asset/content", "dispose"]);
  });
});

test("prepared original hash mismatch stops before upload", async () => {
  await isolatedFixture(async ({ root, request, calls }) => {
    await writeFile(join(root, "original.png"), "changed");
    await assert.rejects(loadRealMemoryFixture(request, "fake"), /Prepared asset hash mismatch/);
    assert.deepEqual(calls, []);
  });
});

test("changed upload bytes are rejected rather than treated as original media", async () => {
  await isolatedFixture(async ({ request }) => {
    const get = request.get;
    request.get = async path => ({ ...await get(path), body: async () => Buffer.from("re-encoded") });
    await assert.rejects(loadRealMemoryFixture(request, "fake"), /Upload changed original bytes/);
  });
});

test("prepared manifest cannot escape its owned fixture directory", async () => {
  await isolatedFixture(async ({ root, manifest, request, calls }) => {
    // The external existing file is only resolved; it must never be read/imported.
    manifest.canvas.graphFile = (await import("node:url")).fileURLToPath(import.meta.url);
    await writeFile(join(root, "manifest.json"), JSON.stringify(manifest));
    await assert.rejects(loadRealMemoryFixture(request, "fake"), /escapes prepared copy/);
    assert.deepEqual(calls, []);
  });
});
