import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { MemoryRepository, type JsonObject } from "@super-canvas/db";
import { AutoInterfaceAdapter, GenericRestAdapter, OpenAIImageAdapter, StaticConnectionResolver, type ProviderAdapter, type RestConnectorConfig } from "@super-canvas/providers";
import { RunService } from "../src/service.js";
import { saveCloudGenerationConfig } from "../src/cloud-generation.js";
import { validPngBase64, validPngBytes } from "./fixtures/image-bytes.js";

const mocks = vi.hoisted(() => ({ fetch: vi.fn<typeof fetch>() }));
vi.mock("@super-canvas/providers", async original => ({ ...await original<typeof import("@super-canvas/providers")>(), providerFetch: mocks.fetch }));
vi.mock("node:dns/promises", () => ({ lookup: vi.fn(async () => [{ address: "93.184.216.34", family: 4 }]) }));
afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });

const connector: RestConnectorConfig = {
  auth: { type: "bearer" }, submit: { path: "/images/edits", method: "POST", bodyMode: "multipart", mappings: [
    { target: "/model", source: { kind: "request", path: "$.model" } }, { target: "/prompt", source: { kind: "request", path: "$.prompt" } },
    { target: "/image", source: { kind: "assets", assetKind: "image", select: "all" } },
  ], response: { taskIdPath: "$.task_id", statusPath: "$.status" } },
  poll: { path: "/tasks/{taskId}", method: "GET", bodyMode: "none", response: { statusPath: "$.status" } },
  statusMap: { done: "succeeded", queued: "queued" },
  output: { kind: "image", path: "$.data", base64Path: "$.b64_json", requireOutput: true },
};

for (const finalStatus of [200, 404]) it.each(["openai", "rest", "auto"] as const)(`recovers a real %s image edit without local references or new submissions (cloud HTTP ${finalStatus})`, async kind => {
  const directory = await mkdtemp(join(tmpdir(), "canvas-cloud-query-"));
  vi.stubEnv("LOCAL_DATABASE_PATH", join(directory, "db.json")); vi.stubEnv("MASTER_KEY", "local-development-master-key");
  try {
    await saveCloudGenerationConfig({ endpoint: "https://cloud.example.com", token: "a".repeat(48) });
    let exists = false, purchases = 0; const targets = new Set<string>();
    mocks.fetch.mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.endsWith("/health")) return Response.json({ service: "super-canvas-generation-v1", ready: true, storage: true });
      targets.add(url.replace(/\/response$/u, ""));
      if (init?.method === "PUT") {
        purchases++; exists = true;
        const manifest = JSON.parse(Buffer.from(new Headers(init.headers).get("x-supercanvas-manifest")!, "base64").toString("utf8"));
        expect(manifest.url).toContain("/images/edits");
        const form = await new Request(manifest.url, { method: manifest.method, headers: manifest.headers, body: init.body }).formData();
        const file = form.get("image") as File;
        expect(new Uint8Array(await file.arrayBuffer())).toEqual(new Uint8Array(validPngBytes));
        throw new Error("lost cloud acceptance acknowledgement");
      }
      if (!exists || finalStatus === 404) return Response.json({}, { status: 404 });
      if (url.endsWith("/response")) return Response.json(kind === "openai" ? { data: [{ b64_json: validPngBase64 }] } : { status: "done", data: [{ b64_json: validPngBase64 }] },
        { headers: { "x-supercanvas-response": "1", ...(kind === "openai" ? {} : { "x-supercanvas-upstream-task": "accepted-T" }) } });
      return Response.json({ state: "complete" });
    });
    const repository = new MemoryRepository(), provider = kind === "openai" ? "openai" : "rest";
    const model = kind === "openai" ? "gpt-image-2" : "fixture-image";
    const descriptor = { id: model, name: model, operations: ["image.generate", "image.edit"], metadata: { source: "manual" } };
    const settings = { supplierId: "supplier", supplierSourceId: "source", baseUrl: "https://provider.example.com/v1", connector,
      modelCatalogModels: [descriptor], autoModelInterfaces: { [model]: { model: descriptor, connector } } };
    await repository.saveSupplier({ id: "supplier", name: "Fixture", supplierKey: "fixture", siteUrl: "", apiUrl: settings.baseUrl, kind: "openai-compatible", scanStatus: "unscanned", catalog: { groups: [] },
      state: { version: 1, revision: 0, sourceId: "source", fingerprint: "fixture", visibility: "visible", history: [], generationTransport: "cloudflare" } });
    await repository.saveConnection({ id: "connection", name: "Fixture", provider, encryptedSecret: null, config: settings });
    const canvas = await repository.ensureDefaultCanvas();
    await repository.saveAsset({ id: "original-ref", kind: "image", name: "original.png", mimeType: "image/png", size: validPngBytes.length, storageKey: "original-ref", metadata: {} });
    await repository.saveCanvas({ id: canvas.id, graph: { schemaVersion: 1, nodes: [{ id: "image", type: "workflow", data: {
      nodeType: "image-generation", provider, connectionId: "connection", model, parts: [{ type: "text", text: "original edit" }, { type: "asset", assetId: "original-ref", role: "reference" }],
      outputs: [{ id: "image", kind: "image" }],
    } }], edges: [] } as JsonObject });
    const supplierFetch = vi.fn<typeof fetch>(), resolver = new StaticConnectionResolver([{ id: "connection", provider, apiKey: "fixture-key", baseUrl: settings.baseUrl, settings }]);
    const adapter: ProviderAdapter = kind === "openai" ? new OpenAIImageAdapter(resolver, { fetch: supplierFetch })
      : kind === "auto" ? new AutoInterfaceAdapter(resolver, new GenericRestAdapter(resolver, { fetch: supplierFetch }), { fetch: supplierFetch })
      : new GenericRestAdapter(resolver, { fetch: supplierFetch, config: connector });
    class Service extends RunService { override adapters() { return new Map([[provider, adapter]]); } }
    const stored = new Map<string, { bytes: Uint8Array; contentType: string }>([["original-ref", { bytes: new Uint8Array(validPngBytes), contentType: "image/png" }]]);
    const storage = { get: vi.fn(async (key: string) => stored.get(key) ?? null), put: vi.fn(async (key: string, bytes: Uint8Array, contentType: string) => { stored.set(key, { bytes, contentType }); }) };
    const service = new Service({ repository, storage, executionMode: "queue", enqueueRun: async () => {}, pollIntervalMs: 0 });
    const run = await service.createRun({ canvasId: canvas.id, clientRequestId: `lost-${kind}`, scope: "node", nodeId: "image" });
    await service.execute(run.id, new AbortController().signal);
    expect((await service.getRun(run.id))?.run.status).toBe("needs_attention"); expect(purchases).toBe(1);
    await repository.deleteAssets(["original-ref"]); stored.delete("original-ref");
    storage.get.mockClear(); const validate = vi.spyOn(adapter, "validate"), submit = vi.spyOn(adapter, "submit");
    await service.retryRun(run.id); await service.execute(run.id, new AbortController().signal);
    const result = await service.getRun(run.id);
    expect(result?.run.status, JSON.stringify(result)).toBe(finalStatus === 200 ? "succeeded" : "needs_attention");
    if (finalStatus === 404) expect(result?.nodes[0]?.providerTaskId).toMatch(/^cloud:/u);
    expect(result?.nodes[0]?.inputJson).toMatchObject({ operation: "image.edit", prompt: "original edit [参考素材 1]", assetIds: ["original-ref"], inputAssets: [{ id: "original-ref", role: "reference" }] });
    expect(validate).not.toHaveBeenCalled(); expect(submit).not.toHaveBeenCalled();
    expect(storage.get.mock.calls.some(([key]) => key === "original-ref")).toBe(false);
    expect(purchases).toBe(1); expect(targets.size).toBe(1); expect(supplierFetch).not.toHaveBeenCalled();
  } finally { await rm(directory, { recursive: true, force: true }); }
});
