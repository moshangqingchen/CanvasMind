import sharp from "sharp";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRepository, type JsonObject } from "@super-canvas/db";
import type { ProviderAdapter, ProviderAssetInput, NormalizedRequest } from "@super-canvas/providers";
import type { ObjectStorage, StoredObject } from "@super-canvas/storage";
import { resolveImageMask } from "../src/image-mask.js";
import { RunService } from "../src/service.js";

const channel = vi.hoisted(() => ({ configured: vi.fn(() => false), urls: vi.fn(async (ids: string[]) => ids.map(id => `https://isolated.test/assets/${id}`)) }));
vi.mock("../src/reference-channel.js", () => ({ localReferenceChannel: () => null,
  localReferenceChannelConfigured: channel.configured, localReferenceUrls: channel.urls }));
afterEach(() => { channel.configured.mockReturnValue(false); channel.urls.mockClear(); });

class MemoryStorage implements ObjectStorage {
  readonly objects = new Map<string, StoredObject>();
  async put(key: string, bytes: Uint8Array, contentType: string) { this.objects.set(key, { bytes, contentType }); }
  async get(key: string) { return this.objects.get(key) ?? null; }
}

async function png(alpha: number[], width = 2, height = 2) {
  const pixels = Buffer.from(alpha.flatMap(value => [255, 255, 255, value]));
  return sharp(pixels, { raw: { width, height, channels: 4 } }).png().toBuffer();
}

async function fixture(maskBytes?: Uint8Array) {
  const repository = new MemoryRepository();
  const storage = new MemoryStorage();
  const sourceBytes = await png([255, 255, 255, 255]);
  const mask = maskBytes ?? await png([0, 255, 255, 255]);
  for (const [id, bytes] of [["source", sourceBytes], ["mask", mask]] as const) {
    await storage.put(`${id}.png`, bytes, "image/png");
    await repository.saveAsset({ id, name: `${id}.png`, kind: "image", mimeType: "image/png", size: bytes.length,
      storageKey: `${id}.png`, metadata: { width: 2, height: 2, hasAlpha: true } });
  }
  const assets: ProviderAssetInput[] = [{ id: "source", kind: "image", role: "reference", mimeType: "image/png", data: sourceBytes }];
  return { repository, storage, assets, parameters: { maskAssetId: "mask", maskSourceAssetId: "source" }, supported: true, imageEdit: true };
}

describe("stored image masks", () => {
  it("preserves exact PNG bytes and verifies the original pixel size", async () => {
    const input = await fixture();
    const result = await resolveImageMask(input);
    expect(result?.asset).toMatchObject({ id: "mask", role: "mask", mimeType: "image/png" });
    expect(result?.asset.data).toEqual((await input.storage.get("mask.png"))?.bytes);
    expect(result?.provenance).toEqual({ maskAssetId: "mask", maskSourceAssetId: "source", width: 2, height: 2 });
  });
  it.each([
    { label: "unsupported route", patch: { supported: false }, code: "unsupported_mask" },
    { label: "no original", patch: { imageEdit: false, assets: [] }, code: "mask_requires_image" },
    { label: "different first original", patch: { parameters: { maskAssetId: "mask", maskSourceAssetId: "other" } }, code: "mask_source_changed" },
    { label: "incomplete binding", patch: { parameters: { maskAssetId: "mask" } }, code: "invalid_mask_reference" },
    { label: "second legacy mask", patch: { parameters: { maskAssetId: "mask", maskSourceAssetId: "source", mask: "https://example.test/mask.png" } }, code: "multiple_masks" },
  ])("rejects $label before a submission", async ({ patch, code }) => {
    await expect(resolveImageMask({ ...await fixture(), ...patch })).rejects.toMatchObject({ code });
  });
  it("rejects a mask also connected as a reference", async () => {
    const input = await fixture();
    input.assets.push({ ...input.assets[0]!, id: "mask" });
    await expect(resolveImageMask(input)).rejects.toMatchObject({ code: "multiple_masks" });
  });
  it("rejects a forged prompt mask role without an original binding", async () => {
    const input = await fixture();
    input.assets[0]!.role = "mask";
    await expect(resolveImageMask({ ...input, parameters: {} })).rejects.toMatchObject({ code: "invalid_mask_reference" });
  });
  it("rejects deleted original assets", async () => {
    const input = await fixture();
    await input.repository.deleteAssets(["source"]);
    await expect(resolveImageMask(input)).rejects.toMatchObject({ code: "invalid_mask_source" });
  });
  it("rejects forged dimensions despite asset metadata claiming a match", async () => {
    await expect(resolveImageMask(await fixture(await png([0, 255], 2, 1)))).rejects.toMatchObject({ code: "mask_size_mismatch" });
  });
  it("rejects non-PNG bytes despite PNG MIME and alpha metadata", async () => {
    const jpeg = await sharp(await png([0, 255, 255, 255])).jpeg().toBuffer();
    await expect(resolveImageMask(await fixture(jpeg))).rejects.toMatchObject({ code: "invalid_mask" });
  });
  it("rejects PNG without an alpha channel and unpainted selections", async () => {
    const noAlpha = await sharp(await png([255, 255, 255, 255])).removeAlpha().png().toBuffer();
    await expect(resolveImageMask(await fixture(noAlpha))).rejects.toMatchObject({ code: "invalid_mask" });
    await expect(resolveImageMask(await fixture(await png([255, 255, 255, 255])))).rejects.toMatchObject({ code: "empty_mask_selection" });
  });
  it("accepts deliberate full selection and soft edge selections", async () => {
    expect(await resolveImageMask(await fixture(await png([0, 0, 0, 0])))).not.toBeNull();
    expect(await resolveImageMask(await fixture(await png([254, 255, 255, 255])))).not.toBeNull();
  });
});

class MaskRunService extends RunService {
  constructor(readonly adapter: ProviderAdapter, repository: MemoryRepository, storage: ObjectStorage) {
    super({ repository, storage, pollIntervalMs: 0, retryBaseDelayMs: 1 });
  }
  override adapters() { return new Map([["openai", this.adapter]]); }
}

describe("RunService mask submission boundary", () => {
  it.each([{ supported: true, url: false }, { supported: false, url: false }, { supported: true, url: true }])("keeps mask provenance internal and rejects unsupported routes: supported=$supported url=$url", async ({ supported, url }) => {
    const { repository, storage } = await fixture();
    channel.configured.mockReturnValue(url);
    await repository.saveConnection({ id: "isolated", name: "No network fixture", provider: "openai", encryptedSecret: null,
      config: { baseUrl: url ? "https://vapi.chuangxiangai.asia" : supported ? "https://api.frimodel.com/v1" : "https://example.test/v1", modelGroup: url ? "生图" : "default" } });
    const canvas = await repository.ensureDefaultCanvas();
    await repository.saveCanvas({ id: canvas.id, graph: { schemaVersion: 1, nodes: [
      { id: "image", type: "workflow", data: { nodeType: "image-generation", provider: "openai", connectionId: "isolated", model: url ? "gpt-image-2-1k" : "gpt-image-2",
        parts: [{ type: "text", text: "change selected area" }, { type: "asset", assetId: "source", role: "reference" }],
        parameters: { maskAssetId: "mask", maskSourceAssetId: "source", quality: "high" }, outputs: [{ id: "image", kind: "image" }] } },
    ], edges: [] } as JsonObject });
    const submitted: NormalizedRequest[] = [];
    const adapter: ProviderAdapter = {
      async testConnection() {}, async listModels() { return []; }, async validate() { return { valid: true, issues: [] }; },
      async submit(request) { submitted.push(request); return { providerTaskId: "isolated-task", status: "succeeded", result: {} }; },
      async extractOutputs() { return [{ kind: "image", data: await png([255, 255, 255, 255]), mimeType: "image/png" }]; },
    };
    const service = new MaskRunService(adapter, repository, storage);
    const run = await service.createRun({ canvasId: canvas.id, scope: "all", clientRequestId: `mask-${supported}` });
    await vi.waitFor(async () => expect((await service.getRun(run.id))?.run.status).toBe(supported ? "succeeded" : "failed"));
    const snapshot = (await service.getRun(run.id))!;
    if (!supported) {
      expect(submitted).toHaveLength(0);
      expect(snapshot.nodes[0]?.errorJson).toMatchObject({ code: "unsupported_mask", charge: { status: "not_charged", source: "not_submitted" } });
      return;
    }
    expect(submitted).toHaveLength(1);
    expect(submitted[0]?.operation).toBe("image.edit");
    expect(submitted[0]?.assets?.map(asset => [asset.id, asset.role])).toEqual([["source", "reference"], ["mask", "mask"]]);
    if (url) {
      expect(channel.urls).toHaveBeenCalledExactlyOnceWith(["source", "mask"]);
      expect(submitted[0]?.assets?.map(asset => asset.url)).toEqual(["https://isolated.test/assets/source", "https://isolated.test/assets/mask"]);
    } else expect(channel.urls).not.toHaveBeenCalled();
    expect(submitted[0]?.parameters).toEqual({ quality: "high" });
    expect(snapshot.nodes[0]?.inputJson).toMatchObject({
      imageMask: { maskAssetId: "mask", maskSourceAssetId: "source", width: 2, height: 2 },
      assetIds: ["source", "mask"], parameters: { quality: "high" },
      inputAssets: [{ id: "source", role: "reference" }, { id: "mask", role: "mask" }],
    });
  });
});
