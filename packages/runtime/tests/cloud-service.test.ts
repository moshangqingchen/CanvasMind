import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { MemoryRepository } from "@super-canvas/db";
import { OpenAIImageAdapter, StaticConnectionResolver } from "@super-canvas/providers";
import { RunService } from "../src/service.js";
import { saveCloudGenerationConfig } from "../src/cloud-generation.js";
const mocks = vi.hoisted(() => ({ fetch: vi.fn<typeof fetch>() }));
vi.mock("@super-canvas/providers", async original => ({ ...await original<typeof import("@super-canvas/providers")>(), providerFetch: mocks.fetch }));
vi.mock("node:dns/promises", () => ({ lookup: vi.fn(async () => [{ address: "93.184.216.34", family: 4 }]) }));
afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });

it("retrieves the same cloud job after a lost acceptance and a supplier mode change, without repurchasing", async () => {
  const dir = await mkdtemp(join(tmpdir(), "canvas-cloud-test-"));
  vi.stubEnv("LOCAL_DATABASE_PATH", join(dir, "db.json"));
  vi.stubEnv("MASTER_KEY", "local-development-master-key");
  try {
    await saveCloudGenerationConfig({ endpoint: "https://cloud.example.com", token: "a".repeat(48) });
    let exists = false; let purchases = 0; let progressQueries = 0; let observedGenerating = false; const ids = new Set<string>();
    mocks.fetch.mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.endsWith("/health")) return Response.json({ service: "super-canvas-generation-v1", ready: true, storage: true });
      ids.add(url.replace(/\/response$/, ""));
      if (init?.method === "PUT") { exists = true; purchases++; throw new Error("client disconnected after acceptance"); }
      if (!exists) return Response.json({}, { status: 404 });
      if (url.endsWith("/response")) return Response.json({ data: [{ b64_json: "aW1hZ2U=" }] }, { headers: { "x-supercanvas-response": "1" } });
      if (++progressQueries <= 2) return Response.json({ state: "running", phase: "generating" });
      const pending = (await repository.listNodeRuns(run.id))[0];
      expect(pending?.status).toBe("running");
      expect(pending?.inputJson.submissionPhase).toBe("generating");
      observedGenerating = true;
      return Response.json({ state: "complete" });
    });
    const repository = new MemoryRepository();
    const supplier = await repository.saveSupplier({ id: "supplier", name: "Fixture", supplierKey: "fixture", siteUrl: "", apiUrl: "https://provider.example.com/v1", kind: "openai-compatible", scanStatus: "unscanned", catalog: { groups: [] },
      state: { version: 1, revision: 0, sourceId: "source", fingerprint: "fixture", visibility: "visible", history: [], generationTransport: "cloudflare" } });
    await repository.saveConnection({ id: "connection", name: "Fixture", provider: "openai", encryptedSecret: null,
      config: { supplierId: supplier.id, supplierSourceId: "source", baseUrl: "https://provider.example.com/v1" } });
    const canvas = await repository.ensureDefaultCanvas();
    await repository.saveCanvas({ id: canvas.id, graph: { schemaVersion: 1, nodes: [{ id: "image", type: "workflow", data: {
      nodeType: "image-generation", provider: "openai", connectionId: "connection", model: "gpt-image-2", parts: [{ type: "text", text: "Offline recovery test" }], outputs: [{ id: "image", kind: "image" }],
    } }], edges: [] } });
    const supplierFetch = vi.fn<typeof fetch>();
    const adapter = new OpenAIImageAdapter(new StaticConnectionResolver([{ id: "connection", provider: "openai", apiKey: "fixture-key", baseUrl: "https://provider.example.com/v1" }]), { fetch: supplierFetch });
    class Service extends RunService { override adapters() { return new Map([["openai", adapter]]); } }
    const saved = new Map<string, { bytes: Uint8Array; contentType: string }>();
    const options = { repository, storage: { async get(key: string) { return saved.get(key) ?? null; }, async put(key: string, bytes: Uint8Array, contentType: string) { saved.set(key, { bytes, contentType }); } }, executionMode: "queue" as const, enqueueRun: async () => {}, pollIntervalMs: 0 };
    const first = new Service(options);
    const run = await first.createRun({ canvasId: canvas.id, clientRequestId: "one", scope: "all" });
    await first.execute(run.id, new AbortController().signal);
    const lost = await first.getRun(run.id);
    expect(lost?.run.status, JSON.stringify(lost)).toBe("needs_attention");
    expect(lost?.nodes[0]?.providerTaskId).toMatch(/^cloud:/);
    await repository.saveSupplier({ ...supplier, state: { ...supplier.state!, generationTransport: "local" } });
    const recovered = new Service(options);
    await recovered.resumeInterruptedCloudRuns();
    await recovered.execute(run.id, new AbortController().signal);
    const result = await recovered.getRun(run.id);
    expect(result?.run.status, JSON.stringify(result)).toBe("succeeded");
    expect(purchases).toBe(1); expect(ids.size).toBe(1); expect(supplierFetch).not.toHaveBeenCalled();
    expect(observedGenerating).toBe(true);
    expect(saved.size).toBe(1); expect(result?.nodes[0]?.outputAssetIds).toHaveLength(1);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
