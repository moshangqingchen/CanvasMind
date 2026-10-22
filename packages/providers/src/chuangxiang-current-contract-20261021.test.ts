import fs from "node:fs";
import { describe, expect, it, vi } from "vitest";
import type { NormalizedRequest, ProviderAssetInput } from "./contracts.js";
import { StaticConnectionResolver } from "./credentials.js";
import { AutoInterfaceAdapter } from "./auto-interface-adapter.js";
import { OpenAIImageAdapter } from "./openai.js";
import { chuangxiangVideoModel, normalizeChuangxiangVideoParameters, validateChuangxiangVideoRequest } from "./chuangxiang-video-contract.js";

const captured = JSON.parse(fs.readFileSync(new URL("./fixtures/chuangxiang-video-contract-20261021.json", import.meta.url), "utf8")) as {
  models: { id: string; capability: { min_duration: number; max_duration: number; max_reference_images: number; max_count: number; resolutions: string[] } }[];
};
const asset = (kind: "image" | "video" | "audio", id = kind): ProviderAssetInput => ({ id, kind, mimeType: `${kind}/sample`, url: `https://assets.example/${id}`, durationSeconds: 3 });
const request = (model: string, parameters: Record<string, unknown> = {}, assets: ProviderAssetInput[] = []): NormalizedRequest => ({
  connectionId: "cx", idempotencyKey: "offline-only", operation: "video.generate", prompt: "Offline contract", model, parameters, assets,
});
function fixture(id: string, group = "27", origin = "https://vapi.chuangxiangai.asia") {
  const fetcher = vi.fn<typeof fetch>(async () => Response.json({ task_id: "original-task", status: "queued" }));
  const resolver = new StaticConnectionResolver([{ id: "cx", provider: "openai", baseUrl: origin, apiKey: "offline-key", settings: {
    baseUrl: origin, accountKeyGroupId: group, accountKeyGroup: "视频", usage: "canvas", scannedModelIds: [id], modelScanStatus: "live",
    modelCatalogModels: [chuangxiangVideoModel(id)],
  } }]);
  return { adapter: new AutoInterfaceAdapter(resolver, new OpenAIImageAdapter(resolver, { fetch: fetcher }), { fetch: fetcher }), fetcher };
}

describe("October 21 exact Creative public media contracts", () => {
  it.each(captured.models)("covers the actual public $id bounds, output tier and image limit", ({ id, capability: c }) => {
    const model = chuangxiangVideoModel(id);
    expect(model.metadata).toMatchObject({ videoMinDuration: c.min_duration, videoMaxDuration: c.max_duration, videoSupportedResolutions: c.resolutions });
    expect(model.metadata?.videoReferenceImageLimit).toBe(c.max_reference_images);
    expect(model.parameters?.find(p => p.key === "n")?.max).toBe(c.max_count);
    const input = request(id, { duration: c.min_duration, resolution: c.resolutions[0] }, id.startsWith("omni-v2v") ? [asset("image")] : []);
    expect(validateChuangxiangVideoRequest(input)).toEqual([]);
    expect(input.parameters?.duration).toBe(c.min_duration);
  });

  it("submits WAN automatic duration, quantity, measured timed references and false audio without dropping fields", async () => {
    const id = "wan3.0-video-prime-720p", f = fixture(id);
    const input = request(id, { duration_seconds: -1, count: 1000, generateAudio: false, aspect_ratio: "adaptive" }, [asset("image"), asset("video"), asset("audio")]);
    const before = structuredClone(input);
    await f.adapter.submit(input);
    expect(input).toEqual(before);
    expect(f.fetcher).toHaveBeenCalledOnce();
    expect(String(f.fetcher.mock.calls[0]![0])).toBe("https://vapi.chuangxiangai.asia/v1/videos/generations");
    expect(JSON.parse(String(f.fetcher.mock.calls[0]![1]?.body))).toMatchObject({ model: id, duration: -1, n: 1000, generate_audio: false,
      image_urls: [asset("image").url], video_references: [{ url: asset("video").url, duration: 3 }], audio_urls: [asset("audio").url] });
  });

  it("allows the exact WAN's optional prompt while other supplier/model/group requests retain their prompt guard", async () => {
    const id = "wan3.0-image-480p", f = fixture(id);
    expect((await f.adapter.validate({ ...request(id, { duration: 8 }), prompt: "" })).valid).toBe(true);
    for (const other of [fixture(id, "43"), fixture(id, "27", "https://other.example"), fixture("wan3.0-unknown-480p")]) {
      const input = { ...request(id, { duration: 8 }), prompt: "" };
      expect((await other.adapter.validate(input)).valid).toBe(false);
      expect(other.fetcher).not.toHaveBeenCalled();
    }
  });

  it("rejects conflicting aliases, video-less variants' videos, invalid true durations, frames and excess images before submission", async () => {
    const id = "wan3.0-video-720p", f = fixture(id);
    for (const parameters of [
      { duration: 8, seconds: 10 }, { n: 1, count: 2 }, { n: 1001 }, { duration: 3 }, { duration: 31 },
      { video_references: [{ url: "https://assets.example/v", duration: 3.5 }] },
      { video_references: [{ url: "https://assets.example/v", duration: 3 }, { url: "https://assets.example/v", duration: 4 }] },
      { image_url: "https://assets.example/one", images: Array.from({ length: 10 }, (_, i) => `https://assets.example/${i}`) },
    ]) {
      const input = request(id, parameters), before = structuredClone(input);
      await expect(f.adapter.submit(input)).rejects.toThrow();
      expect(input).toEqual(before);
    }
    expect(validateChuangxiangVideoRequest(request("wan3.0-image-720p", { video_references: [{ url: "http://assets.example/v", duration: 3 }] }))).not.toEqual([]);
    expect(validateChuangxiangVideoRequest(request(id, {}, [{ ...asset("image"), role: "firstFrame" }]))).not.toEqual([]);
    expect(f.fetcher).not.toHaveBeenCalled();
  });

  it("retains every distinct source role, including an explicit audio preference on supported SD13/Kling models", async () => {
    for (const id of ["sd13-seedance-2.0", "kling-3.0-pro"]) {
      const f = fixture(id);
      await f.adapter.submit(request(id, { duration: 8, resolution: "720p", generate_audio: false }));
      expect(JSON.parse(String(f.fetcher.mock.calls[0]![1]?.body))).toMatchObject({ generate_audio: false });
    }
    expect(validateChuangxiangVideoRequest(request("grok-imagine-video-1.5", { resolution: "1080p" }, [asset("image"), asset("image", "second")]))).not.toEqual([]);
    const saved = request("sd8-seedance-2.5-n", { duration: 15, resolution: "1080p" });
    expect(validateChuangxiangVideoRequest(saved)).not.toEqual([]);
    expect(normalizeChuangxiangVideoParameters(saved)).toMatchObject({ duration: 15, resolution: "1080p" });
  });
});
