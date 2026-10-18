import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { MemoryRepository, type JsonObject } from "@super-canvas/db";
import { encryptSecret, LangframeAdapter, type ProviderConnectionResolver } from "@super-canvas/providers";
import { RunService } from "../src/service.js";
import { saveCloudGenerationConfig } from "../src/cloud-generation.js";
import { validPngBase64 } from "./fixtures/image-bytes.js";

const mocks = vi.hoisted(() => ({ fetch: vi.fn<typeof fetch>() }));
vi.mock("@super-canvas/providers", async original => ({ ...await original<typeof import("@super-canvas/providers")>(), providerFetch: mocks.fetch }));
vi.mock("node:dns/promises", () => ({ lookup: vi.fn(async () => [{ address: "93.184.216.34", family: 4 }]) }));
afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });

it.each([false, true])("preserves Langframe's cloud manifest, async polling and original checkpoint (lost acceptance: %s)", async lostAcceptance => {
  const dir = await mkdtemp(join(tmpdir(), "langframe-cloud-fixture-"));
  vi.stubEnv("LOCAL_DATABASE_PATH", join(dir, "db.json"));
  vi.stubEnv("MASTER_KEY", "local-development-master-key");
  try {
    await saveCloudGenerationConfig({ endpoint: "https://cloud.example.com", token: "f".repeat(48) });
    let exists = false, cloudPurchases = 0, manifest: Record<string, any> | undefined;
    const targets = new Set<string>();
    mocks.fetch.mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.endsWith("/health")) return Response.json({ service: "super-canvas-generation-v1", ready: true, storage: true });
      targets.add(url.replace(/\/response$/u, ""));
      if (init?.method === "PUT") {
        exists = true; cloudPurchases++;
        manifest = JSON.parse(Buffer.from(new Headers(init.headers).get("x-supercanvas-manifest")!, "base64").toString("utf8"));
        const body = JSON.parse(Buffer.from(init.body as ArrayBuffer).toString("utf8"));
        expect(body).toMatchObject({ model: "image-2.5-flare-1K-2k-4kMAX品质", resolution: "4K", quality: "max" });
        if (lostAcceptance) throw new Error("connection lost after cloud accepted request");
        return Response.json({ ok: true });
      }
      if (!exists) return Response.json({}, { status: 404 });
      if (url.endsWith("/response")) return Response.json({ task: { status: "succeeded", images: [{ b64_json: validPngBase64 }] } }, { headers: { "x-supercanvas-response": "1", "x-supercanvas-upstream-task": "original-native-task" } });
      return Response.json({ state: "complete" });
    });
    const repository = new MemoryRepository();
    const supplier = await repository.saveSupplier({ id: "supplier", name: "Wolf fixture", supplierKey: "wolf", siteUrl: "https://vipprompt.cn", apiUrl: "https://vipprompt.cn/v1", kind: "langframe", scanStatus: "live", catalog: { groups: [] },
      state: { version: 1, revision: 1, sourceId: "source", fingerprint: "fixture", visibility: "visible", history: [], generationTransport: "cloudflare" } });
    const model = "image-2.5-flare-1K-2k-4kMAX品质";
    await repository.saveConnection({ id: "wolf", name: "Wolf fixture", provider: "langframe", encryptedSecret: encryptSecret("fixture-key", "local-development-master-key"),
      config: { supplierId: supplier.id, supplierSourceId: "source", baseUrl: "https://vipprompt.cn/v1", modelCatalogModels: [{ id: model, name: model, operations: ["image.generate"], metadata: { rawParams: { resolutions: ["4K"] } } }] } });
    await repository.saveCanvas({ id: "canvas", title: "Cloud fixture", graph: { schemaVersion: 1, nodes: [{ id: "image", type: "workflow", data: {
      nodeType: "image-generation", provider: "langframe", connectionId: "wolf", model, parameters: { resolution: "4K", quality: "max" }, parts: [{ type: "text", text: "offline fixture" }], outputs: [{ id: "image", kind: "image" }],
    } }], edges: [] } as JsonObject });
    const supplierFetch = vi.fn<typeof fetch>();
    class Service extends RunService {
      override adapters(resolver?: ProviderConnectionResolver) { return resolver ? new Map([["langframe", new LangframeAdapter(resolver, { fetch: supplierFetch })]]) : new Map(); }
    }
    const stored = new Map<string, { bytes: Uint8Array; contentType: string }>();
    const options = { repository, storage: { async get(key: string) { return stored.get(key) ?? null; }, async put(key: string, bytes: Uint8Array, contentType: string) { stored.set(key, { bytes, contentType }); } }, executionMode: "queue" as const, enqueueRun: async () => {}, pollIntervalMs: 0 };
    const service = new Service(options);
    const run = await service.createRun({ canvasId: "canvas", clientRequestId: "cloud-wolf", scope: "all" });
    await service.execute(run.id, new AbortController().signal);
    if (lostAcceptance) {
      const pending = await service.getRun(run.id);
      expect(pending?.run.status).toBe("needs_attention");
      expect(pending?.nodes[0]?.providerTaskId).toMatch(/^cloud:/u);
      await repository.saveSupplier({ ...supplier, state: { ...supplier.state!, generationTransport: "local" } });
      const recovered = new Service(options);
      await recovered.resumeInterruptedCloudRuns();
      await recovered.execute(run.id, new AbortController().signal);
    }
    const final = await service.getRun(run.id);
    expect(final?.run.status, JSON.stringify(final)).toBe("succeeded");
    expect(supplierFetch).not.toHaveBeenCalled();
    expect(cloudPurchases).toBe(1); expect(targets.size).toBe(1); expect(stored.size).toBe(1);
    expect(manifest?.url).toBe("https://vipprompt.cn/v1/images/generations");
    expect(manifest?.headers.prefer).toBe("respond-async");
    expect(manifest?.polling).toMatchObject({ method: "GET", urlTemplate: "https://vipprompt.cn/v1/images/tasks/__SUPER_CANVAS_CLOUD_TASK__",
      submitMapping: { taskIdPath: "$.taskId", taskIdFallbackPaths: expect.arrayContaining(["$.task_id", "$.id"]) }, pollMapping: { statusPath: "$.task.status" } });
  } finally { await rm(dir, { recursive: true, force: true }); }
});
