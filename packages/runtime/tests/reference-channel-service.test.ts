import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRepository, type JsonObject } from "@super-canvas/db";
import {
  remainingVideoModel,
  type NormalizedRequest,
  type ProviderAdapter,
} from "@super-canvas/providers";
import type { ObjectStorage, StoredObject } from "@super-canvas/storage";
import { RunService } from "../src/service.js";
import { validPngBytes } from "./fixtures/image-bytes.js";
import { validWebmBytes } from "./fixtures/video-bytes.js";

const mocks = vi.hoisted(() => ({ fetch: vi.fn<typeof fetch>(), hasProxy: vi.fn(() => false) }));
vi.mock("@super-canvas/providers", async importOriginal => ({
  ...await importOriginal<object>(),
  providerFetch: mocks.fetch,
  hasProviderHttpProxy: mocks.hasProxy,
}));

const modelId = "SD2.5特价30-10线路二";
const savedParameters = { duration: 5, resolution: "720p", aspect_ratio: "16:9" };
let temporaryRoot: string;
let channelFile: string;

class MemoryStorage implements ObjectStorage {
  readonly values = new Map<string, StoredObject>();
  async put(key: string, bytes: Uint8Array, contentType: string) {
    this.values.set(key, { bytes: new Uint8Array(bytes), contentType });
  }
  async get(key: string) { return this.values.get(key) ?? null; }
}

class IsolatedRunService extends RunService {
  constructor(repository: MemoryRepository, storage: ObjectStorage, private readonly adapter: ProviderAdapter) {
    super({ repository, storage, retryBaseDelayMs: 1, pollIntervalMs: 0 });
  }
  override adapters(): Map<string, ProviderAdapter> { return new Map([["openai", this.adapter]]); }
}

beforeEach(() => {
  temporaryRoot = mkdtempSync(join(tmpdir(), "supercanvas-channel-service-test-"));
  channelFile = join(temporaryRoot, "channel-state.json");
  vi.stubEnv("SUPERCANVAS_DESKTOP", "true");
  vi.stubEnv("SUPERCANVAS_REFERENCE_CHANNEL_FILE", channelFile);
  vi.stubEnv("MASTER_KEY", "isolated-reference-service-key");
  writeFileSync(channelFile, JSON.stringify({ enabled: true, ready: true,
    baseUrl: "https://assets.example.test", updatedAt: Date.now(), instance: "isolated-instance" }));
  mocks.fetch.mockReset();
  mocks.hasProxy.mockReset().mockReturnValue(false);
  // Any accidental real network route must fail inside this isolated regression.
  vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("Real network is forbidden in this fixture"); }));
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  rmSync(temporaryRoot, { recursive: true, force: true });
});

async function fixture() {
  const repository = new MemoryRepository();
  const storage = new MemoryStorage();
  const canvas = await repository.ensureDefaultCanvas();
  const references = await Promise.all(Array.from({ length: 4 }, async (_, index) => {
    const id = `reference-${index + 1}`;
    const storageKey = `originals/${id}.png`;
    await storage.put(storageKey, validPngBytes, "image/png");
    const record = await repository.saveAsset({ id, name: `${id}.png`, kind: "image", mimeType: "image/png",
      size: validPngBytes.byteLength, storageKey, metadata: { originalFixture: true } });
    return { record, bytes: new Uint8Array(validPngBytes) };
  }));
  const model = remainingVideoModel("jijiu", modelId)!;
  expect(model.metadata?.remoteMediaUrlsOnly).toBe(true);
  await repository.saveConnection({ id: "jijiu-sd25-fixture", name: "极九 · 视频SD2.5", provider: "openai", encryptedSecret: null,
    config: { baseUrl: "https://newapi.jijiucanvas.com/v1", supplierKey: "jijiu", modelGroup: "视频SD2.5",
      accountKeyGroup: "视频SD2.5", defaultModel: modelId,
      modelCatalogModels: [model as unknown as JsonObject] } });
  const graph: JsonObject = { schemaVersion: 1, nodes: [{ id: "video", type: "workflow", data: {
    nodeType: "video-generation", provider: "openai", connectionId: "jijiu-sd25-fixture", model: modelId,
    parts: [{ type: "text", text: "Animate these four original references" },
      ...references.map(({ record }) => ({ type: "asset", assetId: record.id, role: "reference" }))],
    parameters: { ...savedParameters }, outputs: [{ id: "video", kind: "video" }],
  } }], edges: [] };
  await repository.saveCanvas({ id: canvas.id, graph });
  return { repository, storage, canvasId: canvas.id, references, originalCanvas: await repository.getCanvas(canvas.id) };
}

function adapterFixture(onSubmit?: (request: NormalizedRequest) => void) {
  const submit = vi.fn<ProviderAdapter["submit"]>(async request => {
    onSubmit?.(request);
    return { providerTaskId: "isolated-provider-task", status: "succeeded", result: { completed: true } };
  });
  const adapter: ProviderAdapter = {
    testConnection: vi.fn(async () => {}), listModels: vi.fn(async () => []),
    validate: vi.fn(async () => ({ valid: true, issues: [] })), submit,
    extractOutputs: vi.fn(async () => [{ kind: "video", data: new Uint8Array(validWebmBytes),
      mimeType: "video/webm", metadata: { fake: true } }]),
  };
  return { adapter, submit };
}

async function waitForRun(service: RunService, runId: string) {
  let snapshot: Awaited<ReturnType<RunService["getRun"]>>;
  await vi.waitFor(async () => {
    snapshot = await service.getRun(runId);
    expect(snapshot && ["succeeded", "failed", "needs_attention", "cancelled"].includes(snapshot.run.status)).toBe(true);
  }, { timeout: 5_000, interval: 10 });
  return snapshot!;
}

async function expectOriginalsPreserved(state: Awaited<ReturnType<typeof fixture>>) {
  expect(await state.repository.getCanvas(state.canvasId)).toEqual(state.originalCanvas);
  for (const { record, bytes } of state.references) {
    expect(await state.repository.getAsset(record.id)).toEqual(record);
    expect((await state.storage.get(record.storageKey))?.bytes).toEqual(bytes);
  }
}

describe("RunService local reference preflight submission boundary (offline)", () => {
  it("blocks a four-reference Jijiu SD2.5 submission when the real public file returns HTML, preserving originals and charge semantics", async () => {
    const state = await fixture();
    const publicAssetUrls: string[] = [];
    mocks.fetch.mockImplementation(async input => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("/_health")) return new Response("isolated-instance");
      publicAssetUrls.push(url.href);
      const reference = state.references.find(({ record }) => url.pathname.endsWith(`/${record.id}`));
      if (!reference) throw new Error("Unexpected fixture asset");
      return reference.record.id === "reference-2"
        ? new Response("Cloudflare access page", { headers: { "content-type": "text/html" } })
        : new Response(new Uint8Array(reference.bytes).buffer, { headers: { "content-type": reference.record.mimeType } });
    });
    const provider = adapterFixture();
    const service = new IsolatedRunService(state.repository, state.storage, provider.adapter);
    const run = await service.createRun({ canvasId: state.canvasId, clientRequestId: "blocked-reference-preflight", scope: "node", nodeId: "video" });
    const snapshot = await waitForRun(service, run.id);
    const node = snapshot.nodes.find(item => item.nodeId === "video")!;

    expect(snapshot.run.status).toBe("failed");
    expect(node).toMatchObject({ status: "failed", providerTaskId: null, outputAssetIds: [] });
    expect(node.inputJson).not.toHaveProperty("providerTask");
    expect(node.errorJson).toMatchObject({ code: "LOCAL_REFERENCE_ASSET_PREFLIGHT_FAILED", source: "local_validation",
      failureCategory: "local_network", phase: "submit", submissionMayHaveOccurred: false,
      charge: { status: "not_charged", source: "not_submitted" } });
    expect(node.errorJson?.message).toContain("第 2 项素材");
    expect(node.errorJson?.message).toContain("当前生成尚未提交");
    expect(node.errorJson).not.toHaveProperty("providerMessage");
    const diagnostics = node.errorJson?.["referenceDiagnostics"] as JsonObject[];
    expect(diagnostics).toHaveLength(4);
    expect(diagnostics).toMatchObject([
      { assetIndex: 1, code: "ok", httpStatus: 200, actualBytes: validPngBytes.byteLength },
      { assetIndex: 2, code: "mime", httpStatus: 200, expectedMime: "image/png", actualMime: "text/html" },
      { assetIndex: 3, code: "ok", httpStatus: 200, actualBytes: validPngBytes.byteLength },
      { assetIndex: 4, code: "ok", httpStatus: 200, actualBytes: validPngBytes.byteLength },
    ]);
    for (const diagnostic of diagnostics) {
      expect(diagnostic["durationMs"]).toEqual(expect.any(Number));
      expect(diagnostic["durationMs"]).toBeGreaterThanOrEqual(0);
      expect(diagnostic["attempts"]).toBe(1);
      expect(diagnostic["assetReference"]).toMatch(/^[a-f0-9]{12}$/u);
    }
    expect(JSON.stringify(diagnostics)).not.toContain("https://");
    const savedError = JSON.stringify(node.errorJson);
    for (const forbidden of ["isolated-reference-service-key", "assets.example.test", "token=",
      ...state.references.map(({ record }) => record.id), ...publicAssetUrls]) {
      expect(savedError).not.toContain(forbidden);
    }
    expect(provider.submit).not.toHaveBeenCalled();
    expect(provider.adapter.validate).not.toHaveBeenCalled();
    expect(provider.adapter.extractOutputs).not.toHaveBeenCalled();
    expect(publicAssetUrls).toHaveLength(4);
    expect(new Set(publicAssetUrls.map(url => new URL(url).pathname))).toEqual(new Set(state.references.map(({ record }) => `/api/provider-assets/${record.id}`)));
    expect(await state.repository.listAssets()).toHaveLength(4);
    const frozenNodes = snapshot.run.revisionGraph["nodes"] as JsonObject[];
    expect((frozenNodes[0]!["data"] as JsonObject)["parameters"]).toEqual(savedParameters);
    await expectOriginalsPreserved(state);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("submits only after all four complete originals are read and uses the same verified signed URLs in order", async () => {
    const state = await fixture();
    const verifiedUrls = new Map<string, string>();
    const completedReads = new Set<string>();
    mocks.fetch.mockImplementation(async input => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("/_health")) return new Response("isolated-instance");
      const reference = state.references.find(({ record }) => url.pathname.endsWith(`/${record.id}`));
      if (!reference) throw new Error("Unexpected fixture asset");
      verifiedUrls.set(reference.record.id, url.href);
      return new Response(new ReadableStream<Uint8Array>({ async start(controller) {
        controller.enqueue(reference.bytes.slice(0, 4));
        await new Promise(resolve => setTimeout(resolve, 5));
        controller.enqueue(reference.bytes.slice(4));
        completedReads.add(reference.record.id);
        controller.close();
      } }), { headers: { "content-type": reference.record.mimeType, "content-length": String(reference.bytes.length) } });
    });
    const provider = adapterFixture(request => {
      expect(completedReads.size).toBe(4);
      expect(request).toMatchObject({ model: modelId, operation: "video.image-to-video", parameters: savedParameters });
      expect(request.assets?.map(asset => asset.id)).toEqual(state.references.map(({ record }) => record.id));
      expect(request.assets?.map(asset => asset.url)).toEqual(state.references.map(({ record }) => verifiedUrls.get(record.id)));
      for (const [index, asset] of request.assets!.entries()) expect(asset.data).toEqual(state.references[index]!.bytes);
    });
    const service = new IsolatedRunService(state.repository, state.storage, provider.adapter);
    const run = await service.createRun({ canvasId: state.canvasId, clientRequestId: "verified-reference-preflight", scope: "node", nodeId: "video" });
    const snapshot = await waitForRun(service, run.id);
    const node = snapshot.nodes.find(item => item.nodeId === "video")!;

    expect(snapshot.run.status, JSON.stringify(node.errorJson)).toBe("succeeded");
    expect(provider.submit).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ parameters: savedParameters }));
    expect(node.providerTaskId).toBe("isolated-provider-task");
    expect(node.inputJson.assetIds).toEqual(state.references.map(({ record }) => record.id));
    expect(node.inputJson.parameters).toEqual(savedParameters);
    expect(mocks.fetch).toHaveBeenCalledTimes(5);
    await expectOriginalsPreserved(state);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("uses exactly five authenticated relay GETs before submitting the same four public HTTPS URLs", async () => {
    const state = await fixture();
    vi.stubEnv("SUPERCANVAS_DESKTOP_TOKEN", "isolated-desktop-session-token");
    writeFileSync(channelFile, JSON.stringify({ enabled: true, ready: true, desktopPublicProbe: true,
      baseUrl: "https://assets.example.test", updatedAt: Date.now(), instance: "isolated-instance" }));
    const verifiedUrls = new Map<string, string>();
    const relayFetch = vi.mocked(globalThis.fetch);
    relayFetch.mockImplementation(async (input, init) => {
      const relay = new URL(String(input));
      expect(relay.origin).toBe("http://127.0.0.1:3210");
      expect(init).toMatchObject({ method: "GET", redirect: "error", cache: "no-store",
        headers: { "x-supercanvas-desktop-token": "isolated-desktop-session-token" } });
      if (relay.pathname === "/api/reference-channel-probe/_health") return new Response("isolated-instance");
      const reference = state.references.find(({ record }) => relay.pathname === `/api/reference-channel-probe/${record.id}`);
      if (!reference) throw new Error("Unexpected fixture relay path");
      const publicUrl = new URL(`/api/provider-assets/${reference.record.id}`, "https://assets.example.test");
      publicUrl.search = relay.search;
      verifiedUrls.set(reference.record.id, publicUrl.href);
      return new Response(new Uint8Array(reference.bytes).buffer,
        { headers: { "content-type": reference.record.mimeType, "content-length": String(reference.bytes.length) } });
    });
    const provider = adapterFixture(request => {
      expect(relayFetch).toHaveBeenCalledTimes(5);
      expect(request.assets?.map(asset => asset.url)).toEqual(state.references.map(({ record }) => verifiedUrls.get(record.id)));
      expect(request.assets?.every(asset => new URL(asset.url!).protocol === "https:")).toBe(true);
      expect(request.parameters).toEqual(savedParameters);
    });
    const service = new IsolatedRunService(state.repository, state.storage, provider.adapter);
    const run = await service.createRun({ canvasId: state.canvasId, clientRequestId: "verified-relay-preflight", scope: "node", nodeId: "video" });
    const snapshot = await waitForRun(service, run.id);
    const node = snapshot.nodes.find(item => item.nodeId === "video")!;

    expect(snapshot.run.status, JSON.stringify(node.errorJson)).toBe("succeeded");
    expect(provider.submit).toHaveBeenCalledTimes(1);
    expect(relayFetch).toHaveBeenCalledTimes(5);
    expect(mocks.fetch).not.toHaveBeenCalled();
    expect(node.inputJson.parameters).toEqual(savedParameters);
    await expectOriginalsPreserved(state);
  });
});
